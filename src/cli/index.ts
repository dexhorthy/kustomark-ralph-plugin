#!/usr/bin/env bun

import { existsSync } from "fs";
import { readFile, writeFile, mkdir, readdir, rm, stat } from "fs/promises";
import { join, dirname, resolve, relative } from "path";
import * as Diff from "diff";
import * as readline from "readline";
import { loadConfigFile, generateJsonSchema } from "../core/config.js";
import { resolveResources } from "../core/resources.js";
import { applyPatches, resolveExtends, type GroupOptions } from "../core/patches.js";
import { runGlobalValidators, type ValidationError } from "../core/validation.js";
import { applyFileOperations, applyFileOperationResults } from "../core/file-operations.js";
import { lintConfig, type LintResult } from "../core/lint.js";
import {
  explainConfig,
  explainFile,
  type ExplainResult,
  type FileLineageResult,
} from "../core/explain.js";
import {
  analyzeChanges,
  calculateHash,
  calculatePatchesHash,
  createManifest,
  createManifestFile,
  getManifestPath,
  readManifest,
  writeManifest,
  type ManifestFile,
} from "../core/incremental.js";
import {
  BuildCache,
  calculatePatchesHashForCache,
} from "../core/cache.js";

// Types for CLI output
interface BuildResult {
  success: boolean;
  filesWritten: number;
  patchesApplied: number;
  warnings: string[];
  // Stats (only populated with --stats)
  duration?: number;
  files?: { processed: number; written: number };
  patches?: { applied: number; skipped: number };
  bytes?: number;
  byOperation?: Record<string, number>;
}

interface DiffFileResult {
  path: string;
  status: "added" | "modified" | "deleted" | "unchanged";
  diff?: string;
}

interface DiffResult {
  hasChanges: boolean;
  files: DiffFileResult[];
}

interface ValidateResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  validationErrors?: ValidationError[];
}

interface InitResult {
  success: boolean;
  created: string;
  type: "base" | "overlay";
  error?: string;
}

interface SchemaResult {
  schema: Record<string, unknown>;
}

// CLI options
interface CliOptions {
  format: "text" | "json";
  clean: boolean;
  verbose: number; // 0, 1, 2, or 3
  quiet: boolean;
  // Init command options
  base?: string;
  output?: string;
  interactive: boolean;
  // Lint command options
  strict: boolean;
  // Explain command options
  file?: string;
  // Watch command options
  debounce: number;
  // UI command options
  port: number;
  // Build command options
  stats: boolean;
  debug: boolean; // Step-through debug mode
  incremental: boolean; // Only rebuild changed files
  cache: boolean; // Cache patch computation results
  parallel: number; // 0 = sequential, >0 = concurrency limit
  // Patch group options
  enableGroups: string[];
  disableGroups: string[];
}

// Parse command line arguments
function parseArgs(args: string[]): {
  command: string | null;
  path: string;
  options: CliOptions;
} {
  const options: CliOptions = {
    format: "text",
    clean: false,
    verbose: 0,
    quiet: false,
    interactive: false,
    strict: false,
    debounce: 300,
    port: 3000,
    stats: false,
    debug: false,
    incremental: false,
    cache: false,
    parallel: 0,
    enableGroups: [],
    disableGroups: [],
  };

  let command: string | null = null;
  let path = ".";
  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--format=")) {
      const formatValue = arg.slice("--format=".length);
      if (formatValue === "text" || formatValue === "json") {
        options.format = formatValue;
      }
    } else if (arg === "--format" && i + 1 < args.length) {
      const formatValue = args[++i];
      if (formatValue === "text" || formatValue === "json") {
        options.format = formatValue;
      }
    } else if (arg === "--clean") {
      options.clean = true;
    } else if (arg === "-vvv") {
      options.verbose = 3;
    } else if (arg === "-vv") {
      options.verbose = 2;
    } else if (arg === "-v") {
      options.verbose = 1;
    } else if (arg === "-q") {
      options.quiet = true;
    } else if (arg.startsWith("--base=")) {
      options.base = arg.slice("--base=".length);
    } else if (arg === "--base" && i + 1 < args.length) {
      options.base = args[++i];
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
    } else if (arg === "--output" && i + 1 < args.length) {
      options.output = args[++i];
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg.startsWith("--file=")) {
      options.file = arg.slice("--file=".length);
    } else if (arg === "--file" && i + 1 < args.length) {
      options.file = args[++i];
    } else if (arg.startsWith("--debounce=")) {
      options.debounce = parseInt(arg.slice("--debounce=".length), 10) || 300;
    } else if (arg === "--debounce" && i + 1 < args.length) {
      options.debounce = parseInt(args[++i], 10) || 300;
    } else if (arg.startsWith("--port=")) {
      options.port = parseInt(arg.slice("--port=".length), 10) || 3000;
    } else if (arg === "--port" && i + 1 < args.length) {
      options.port = parseInt(args[++i], 10) || 3000;
    } else if (arg === "--stats") {
      options.stats = true;
    } else if (arg === "--debug") {
      options.debug = true;
    } else if (arg === "--incremental") {
      options.incremental = true;
    } else if (arg === "--cache") {
      options.cache = true;
    } else if (arg === "--interactive" || arg === "-i") {
      options.interactive = true;
    } else if (arg === "--parallel") {
      options.parallel = 4; // default concurrency
    } else if (arg.startsWith("--parallel=")) {
      options.parallel = parseInt(arg.slice("--parallel=".length), 10) || 4;
    } else if (arg.startsWith("--enable-groups=")) {
      options.enableGroups = arg.slice("--enable-groups=".length).split(",").filter(Boolean);
    } else if (arg === "--enable-groups" && i + 1 < args.length) {
      options.enableGroups = args[++i].split(",").filter(Boolean);
    } else if (arg.startsWith("--disable-groups=")) {
      options.disableGroups = arg.slice("--disable-groups=".length).split(",").filter(Boolean);
    } else if (arg === "--disable-groups" && i + 1 < args.length) {
      options.disableGroups = args[++i].split(",").filter(Boolean);
    } else if (!arg.startsWith("-")) {
      positionalArgs.push(arg);
    }
  }

  if (positionalArgs.length > 0) {
    command = positionalArgs[0];
  }
  if (positionalArgs.length > 1) {
    path = positionalArgs[1];
  }

  return { command, path, options };
}

// Logger utility based on verbosity
function createLogger(options: CliOptions) {
  return {
    error: (msg: string) => {
      if (options.format === "text") {
        console.error(`ERROR: ${msg}`);
      }
    },
    warn: (msg: string) => {
      if (options.format === "text" && !options.quiet) {
        console.warn(`WARN: ${msg}`);
      }
    },
    info: (msg: string) => {
      if (options.format === "text" && !options.quiet) {
        console.log(msg);
      }
    },
    verbose: (msg: string, level: number = 1) => {
      if (options.format === "text" && options.verbose >= level && !options.quiet) {
        console.log(msg);
      }
    },
  };
}

// Find kustomark.yaml in the given path
async function findConfigPath(basePath: string): Promise<string> {
  const resolvedPath = resolve(basePath);

  // Check if path is a file
  try {
    const pathStat = await stat(resolvedPath);
    if (pathStat.isFile()) {
      return resolvedPath;
    }
  } catch {
    // Path doesn't exist, will be handled below
  }

  // Check for kustomark.yaml in directory
  const configPath = join(resolvedPath, "kustomark.yaml");
  if (existsSync(configPath)) {
    return configPath;
  }

  // Also check for kustomark.yml
  const configPathYml = join(resolvedPath, "kustomark.yml");
  if (existsSync(configPathYml)) {
    return configPathYml;
  }

  throw new Error(`No kustomark.yaml found in ${resolvedPath}`);
}

// Get all files in output directory recursively
async function getOutputFiles(outputDir: string): Promise<Set<string>> {
  const files = new Set<string>();

  if (!existsSync(outputDir)) {
    return files;
  }

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        files.add(relative(outputDir, fullPath));
      }
    }
  }

  await walk(outputDir);
  return files;
}

// Parallel processing utility with concurrency limit
async function processInParallel<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  if (concurrency <= 0) {
    // Sequential processing
    const results: R[] = [];
    for (const item of items) {
      results.push(await processor(item));
    }
    return results;
  }

  // Parallel processing with concurrency limit
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await processor(items[index]);
    }
  }

  // Start workers up to concurrency limit
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

// Build command implementation
async function build(
  configPath: string,
  options: CliOptions
): Promise<BuildResult> {
  const logger = createLogger(options);
  const startTime = options.stats ? Date.now() : 0;
  const result: BuildResult = {
    success: false,
    filesWritten: 0,
    patchesApplied: 0,
    warnings: [],
  };

  // Stats tracking
  let totalBytes = 0;
  let filesProcessed = 0;
  let patchesSkipped = 0;
  const byOperation: Record<string, number> = {};

  try {
    logger.verbose(`Loading config from ${configPath}`, 1);
    const config = await loadConfigFile(configPath);

    logger.verbose(`Resolving resources...`, 1);
    const resources = await resolveResources(configPath, config.resources);
    logger.verbose(`Found ${resources.length} resources`, 2);

    const configDir = dirname(configPath);
    const outputDir = resolve(configDir, config.output);
    logger.verbose(`Output directory: ${outputDir}`, 1);

    // Apply file operations first (copy, rename, delete, move)
    // Resolve patch inheritance first
    const patches = config.patches ? resolveExtends(config.patches) : [];
    const fileOpsResult = applyFileOperations(patches, resources);
    const processedResources = applyFileOperationResults(resources, fileOpsResult);

    result.patchesApplied += fileOpsResult.operationsApplied;
    result.warnings.push(...fileOpsResult.warnings);
    logger.verbose(`Applied ${fileOpsResult.operationsApplied} file operations`, 2);

    // Track file operation stats
    if (options.stats) {
      for (const patch of patches) {
        if (["copy-file", "rename-file", "delete-file", "move-file"].includes(patch.op)) {
          byOperation[patch.op] = (byOperation[patch.op] || 0) + 1;
        }
      }
    }

    // Track files we write for clean option
    const writtenFiles = new Set<string>();
    const existingFiles = await getOutputFiles(outputDir);

    // Incremental build support
    let incrementalAnalysis: ReturnType<typeof analyzeChanges> | null = null;
    let configHash = "";
    let patchesHash = "";
    const manifestFiles: ManifestFile[] = [];
    let filesSkipped = 0;

    if (options.incremental) {
      // Calculate hashes for change detection
      const configContent = await readFile(configPath, "utf-8");
      configHash = calculateHash(configContent);
      patchesHash = calculatePatchesHash(patches);

      // Read existing manifest
      const manifestPath = getManifestPath(outputDir);
      const manifest = await readManifest(manifestPath);

      // Analyze what needs to be rebuilt
      incrementalAnalysis = analyzeChanges(
        manifest,
        configHash,
        patchesHash,
        processedResources
      );

      if (incrementalAnalysis.fullRebuildRequired) {
        logger.verbose(
          `Full rebuild required: config=${incrementalAnalysis.configChanged}, patches=${incrementalAnalysis.patchesChanged}`,
          1
        );
      } else {
        logger.verbose(
          `Incremental build: ${incrementalAnalysis.filesToRebuild.length} to rebuild, ${incrementalAnalysis.filesToSkip.length} unchanged`,
          1
        );
        filesSkipped = incrementalAnalysis.filesToSkip.length;
      }
    }

    // Build group options from CLI flags
    const groupOptions: GroupOptions = {
      enableGroups: options.enableGroups.length > 0 ? options.enableGroups : undefined,
      disableGroups: options.disableGroups.length > 0 ? options.disableGroups : undefined,
    };

    // Build cache support
    let buildCache: BuildCache | null = null;
    let cachePatchesHash = "";
    let cacheHits = 0;

    if (options.cache) {
      buildCache = new BuildCache(outputDir);
      await buildCache.init();
      cachePatchesHash = calculatePatchesHashForCache(patches);
      logger.verbose(`Build cache enabled in ${outputDir}/.kustomark-cache/`, 1);
    }

    // Import minimatch once for stats tracking
    const minimatchModule = options.stats ? await import("minimatch") : null;

    // Define resource processor function
    interface ResourceResult {
      relativePath: string;
      patchesApplied: number;
      warnings: string[];
      bytes: number;
      eligiblePatches: number;
      opCounts: Record<string, number>;
      // For incremental build manifest
      sourceContent: string;
      outputContent: string;
      // For cache stats
      cacheHit: boolean;
    }

    const processResource = async (resource: { relativePath: string; content: string }): Promise<ResourceResult> => {
      logger.verbose(`Processing ${resource.relativePath}`, 2);

      let outputContent: string;
      let patchesApplied = 0;
      let warnings: string[] = [];
      let cacheHit = false;

      // Check cache first
      if (buildCache) {
        const cacheKey = buildCache.generateCacheKey(resource.content, cachePatchesHash, resource.relativePath);
        const cachedContent = await buildCache.get(cacheKey);

        if (cachedContent !== null) {
          outputContent = cachedContent;
          cacheHit = true;
          logger.verbose(`  Cache hit for ${resource.relativePath}`, 2);
        } else {
          // Apply content patches with group filtering
          const patchResult = applyPatches(
            resource.content,
            patches,
            resource.relativePath,
            groupOptions
          );
          outputContent = patchResult.content;
          patchesApplied = patchResult.applied;
          warnings = patchResult.warnings;

          // Store in cache
          const sourceHash = calculateHash(resource.content);
          await buildCache.set(cacheKey, outputContent, sourceHash, cachePatchesHash);
          logger.verbose(`  Cached result for ${resource.relativePath}`, 3);
        }
      } else {
        // Apply content patches with group filtering (no cache)
        const patchResult = applyPatches(
          resource.content,
          patches,
          resource.relativePath,
          groupOptions
        );
        outputContent = patchResult.content;
        patchesApplied = patchResult.applied;
        warnings = patchResult.warnings;
      }

      // Track stats
      let eligiblePatches = 0;
      const opCounts: Record<string, number> = {};

      if (options.stats && minimatchModule) {
        for (const patch of patches) {
          if (!["copy-file", "rename-file", "delete-file", "move-file"].includes(patch.op)) {
            const include = patch.include || ["**/*"];
            const exclude = patch.exclude || [];
            const matchesInclude = include.some((pattern) =>
              minimatchModule.minimatch(resource.relativePath, pattern)
            );
            const matchesExclude = exclude.some((pattern) =>
              minimatchModule.minimatch(resource.relativePath, pattern)
            );
            if (matchesInclude && !matchesExclude) {
              eligiblePatches++;
              opCounts[patch.op] = (opCounts[patch.op] || 0) + 1;
            }
          }
        }
      }

      // Write output file
      const outputPath = join(outputDir, resource.relativePath);
      const outputDirPath = dirname(outputPath);

      await mkdir(outputDirPath, { recursive: true });
      await writeFile(outputPath, outputContent, "utf-8");

      const bytes = options.stats ? Buffer.byteLength(outputContent, "utf-8") : 0;

      logger.verbose(`  Wrote ${outputPath}`, 3);

      return {
        relativePath: resource.relativePath,
        patchesApplied,
        warnings,
        bytes,
        eligiblePatches,
        opCounts,
        sourceContent: resource.content,
        outputContent,
        cacheHit,
      };
    };

    // Process resources (parallel or sequential based on --parallel flag)
    // Debug mode forces sequential processing
    let debugQuit = false;

    if (options.debug) {
      // Debug mode: process files sequentially with interactive step-through
      console.log("\n🔍 Debug Mode - Step through patches for each file\n");
      console.log(`   ${processedResources.length} file(s) to process`);
      console.log(`   ${patches.length} patch(es) defined\n`);

      for (const resource of processedResources) {
        if (debugQuit) break;

        const debugResult = await applyPatchesDebug(
          resource.content,
          patches as unknown as Array<Record<string, unknown>>,
          resource.relativePath,
          groupOptions
        );

        if (debugResult.quit) {
          debugQuit = true;
          break;
        }

        // Write output file
        const outputPath = join(outputDir, resource.relativePath);
        const outputDirPath = dirname(outputPath);
        await mkdir(outputDirPath, { recursive: true });
        await writeFile(outputPath, debugResult.content, "utf-8");

        result.patchesApplied += debugResult.applied;
        writtenFiles.add(resource.relativePath);
        result.filesWritten++;
        filesProcessed++;

        console.log(`\n✅ Wrote ${outputPath} (${debugResult.applied} patches applied, ${debugResult.skipped} skipped)\n`);
      }

      if (debugQuit) {
        logger.info("Debug session ended early by user");
      }
    } else {
      // Filter resources for incremental build
      let resourcesToProcess = processedResources;
      if (options.incremental && incrementalAnalysis && !incrementalAnalysis.fullRebuildRequired) {
        const rebuildSet = new Set(incrementalAnalysis.filesToRebuild);
        resourcesToProcess = processedResources.filter((r) => rebuildSet.has(r.relativePath));

        // For skipped files, we need to add them to writtenFiles so they don't get cleaned
        for (const skippedPath of incrementalAnalysis.filesToSkip) {
          writtenFiles.add(skippedPath);
        }
      }

      // Normal mode: use parallel processing
      const resourceResults = await processInParallel(
        resourcesToProcess,
        processResource,
        options.parallel
      );

      // Aggregate results
      for (const resourceResult of resourceResults) {
        result.patchesApplied += resourceResult.patchesApplied;
        result.warnings.push(...resourceResult.warnings);
        writtenFiles.add(resourceResult.relativePath);
        result.filesWritten++;
        filesProcessed++;

        // Track cache hits
        if (resourceResult.cacheHit) {
          cacheHits++;
        }

        if (options.stats) {
          totalBytes += resourceResult.bytes;
          patchesSkipped += Math.max(0, resourceResult.eligiblePatches - resourceResult.patchesApplied);
          for (const [op, count] of Object.entries(resourceResult.opCounts)) {
            byOperation[op] = (byOperation[op] || 0) + count;
          }
        }

        // Track manifest entry for incremental builds
        if (options.incremental) {
          manifestFiles.push(
            createManifestFile(
              resourceResult.relativePath,
              resourceResult.relativePath,
              resourceResult.sourceContent,
              resourceResult.outputContent,
              resourceResult.patchesApplied
            )
          );
        }
      }

      // For incremental builds, add entries for skipped files from old manifest
      if (options.incremental && incrementalAnalysis && !incrementalAnalysis.fullRebuildRequired) {
        const manifestPath = getManifestPath(outputDir);
        const oldManifest = await readManifest(manifestPath);
        if (oldManifest) {
          for (const skippedPath of incrementalAnalysis.filesToSkip) {
            const oldEntry = oldManifest.files.find((f) => f.source === skippedPath);
            if (oldEntry) {
              manifestFiles.push(oldEntry);
            }
          }
        }
      }
    }

    // Clean up files not in source if --clean is set
    if (options.clean) {
      for (const existingFile of existingFiles) {
        if (!writtenFiles.has(existingFile)) {
          const filePath = join(outputDir, existingFile);
          await rm(filePath);
          logger.verbose(`  Deleted ${filePath}`, 2);
        }
      }
    }

    // Write incremental build manifest
    if (options.incremental && manifestFiles.length > 0) {
      // Calculate hashes if not already done (for full rebuilds)
      if (!configHash) {
        const configContent = await readFile(configPath, "utf-8");
        configHash = calculateHash(configContent);
        patchesHash = calculatePatchesHash(patches);
      }

      const manifestPath = getManifestPath(outputDir);
      const manifest = createManifest(configHash, patchesHash, manifestFiles);
      await writeManifest(manifestPath, manifest);
      logger.verbose(`Wrote incremental build manifest to ${manifestPath}`, 2);
    }

    result.success = true;

    // Add stats if requested
    if (options.stats) {
      result.duration = Date.now() - startTime;
      result.files = { processed: filesProcessed, written: result.filesWritten };
      result.patches = { applied: result.patchesApplied, skipped: patchesSkipped };
      result.bytes = totalBytes;
      result.byOperation = byOperation;
    }

    // Log warnings
    for (const warning of result.warnings) {
      logger.warn(warning);
    }

    // Build log message with relevant stats
    const logParts = [`Build complete: ${result.filesWritten} files written`];
    if (options.incremental && filesSkipped > 0) {
      logParts.push(`${filesSkipped} unchanged`);
    }
    if (options.cache && cacheHits > 0) {
      logParts.push(`${cacheHits} cache hits`);
    }
    logParts.push(`${result.patchesApplied} patches applied`);
    logger.info(logParts.join(", "));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(errorMsg);
    result.warnings.push(errorMsg);
  }

  return result;
}

// Diff command implementation
async function diff(
  configPath: string,
  options: CliOptions
): Promise<DiffResult> {
  const logger = createLogger(options);
  const result: DiffResult = {
    hasChanges: false,
    files: [],
  };

  try {
    logger.verbose(`Loading config from ${configPath}`, 1);
    const config = await loadConfigFile(configPath);

    logger.verbose(`Resolving resources...`, 1);
    const resources = await resolveResources(configPath, config.resources);
    logger.verbose(`Found ${resources.length} resources`, 2);

    const configDir = dirname(configPath);
    const outputDir = resolve(configDir, config.output);
    logger.verbose(`Output directory: ${outputDir}`, 1);

    // Apply file operations first (copy, rename, delete, move)
    // Resolve patch inheritance first
    const patches = config.patches ? resolveExtends(config.patches) : [];
    const fileOpsResult = applyFileOperations(patches, resources);
    const processedResources = applyFileOperationResults(resources, fileOpsResult);

    logger.verbose(`Applied ${fileOpsResult.operationsApplied} file operations`, 2);

    const existingFiles = await getOutputFiles(outputDir);
    const processedFiles = new Set<string>();

    // Build group options from CLI flags
    const groupOptions: GroupOptions = {
      enableGroups: options.enableGroups.length > 0 ? options.enableGroups : undefined,
      disableGroups: options.disableGroups.length > 0 ? options.disableGroups : undefined,
    };

    // Define resource processor function for diff
    interface DiffResourceResult {
      relativePath: string;
      fileResult: DiffFileResult | null;
      hasChanges: boolean;
    }

    const processDiffResource = async (resource: { relativePath: string; content: string }): Promise<DiffResourceResult> => {
      logger.verbose(`Processing ${resource.relativePath}`, 2);

      // Apply content patches with group filtering
      const patchResult = applyPatches(
        resource.content,
        patches,
        resource.relativePath,
        groupOptions
      );

      const outputPath = join(outputDir, resource.relativePath);

      // Compare with existing file
      let existingContent = "";
      let fileStatus: DiffFileResult["status"] = "added";

      if (existsSync(outputPath)) {
        existingContent = await readFile(outputPath, "utf-8");
        if (existingContent === patchResult.content) {
          fileStatus = "unchanged";
        } else {
          fileStatus = "modified";
        }
      }

      if (fileStatus !== "unchanged") {
        const fileDiff = Diff.createPatch(
          resource.relativePath,
          existingContent,
          patchResult.content,
          "existing",
          "new"
        );

        return {
          relativePath: resource.relativePath,
          fileResult: {
            path: resource.relativePath,
            status: fileStatus,
            diff: fileDiff,
          },
          hasChanges: true,
        };
      } else {
        logger.verbose(`  Unchanged: ${resource.relativePath}`, 3);
        return {
          relativePath: resource.relativePath,
          fileResult: null,
          hasChanges: false,
        };
      }
    };

    // Process resources (parallel or sequential based on --parallel flag)
    const diffResults = await processInParallel(
      processedResources,
      processDiffResource,
      options.parallel
    );

    // Aggregate results
    for (const diffResult of diffResults) {
      processedFiles.add(diffResult.relativePath);
      if (diffResult.hasChanges && diffResult.fileResult) {
        result.hasChanges = true;
        result.files.push(diffResult.fileResult);

        if (options.format === "text") {
          logger.info(`${diffResult.fileResult.status.toUpperCase()}: ${diffResult.relativePath}`);
          if (options.verbose >= 1) {
            console.log(diffResult.fileResult.diff);
          }
        }
      }
    }

    // Check for deleted files
    for (const existingFile of existingFiles) {
      if (!processedFiles.has(existingFile)) {
        result.hasChanges = true;
        result.files.push({
          path: existingFile,
          status: "deleted",
        });

        if (options.format === "text") {
          logger.info(`DELETED: ${existingFile}`);
        }
      }
    }

    if (!result.hasChanges) {
      logger.info("No changes detected");
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(errorMsg);
    result.hasChanges = true;
    result.files.push({
      path: "",
      status: "modified",
      diff: `Error: ${errorMsg}`,
    });
  }

  return result;
}

// Validate command implementation
async function validate(
  configPath: string,
  options: CliOptions
): Promise<ValidateResult> {
  const logger = createLogger(options);
  const result: ValidateResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  try {
    logger.verbose(`Validating config at ${configPath}`, 1);

    // Try to load and parse the config
    const config = await loadConfigFile(configPath);

    logger.verbose(`Config parsed successfully`, 2);

    // Check that resources exist
    logger.verbose(`Checking resources...`, 1);
    try {
      const resources = await resolveResources(configPath, config.resources);
      logger.verbose(`Found ${resources.length} resources`, 2);

      if (resources.length === 0) {
        result.warnings.push("No resources found matching the specified patterns");
      }
    } catch (resourceError) {
      const errorMsg =
        resourceError instanceof Error ? resourceError.message : String(resourceError);
      result.errors.push(`Resource resolution failed: ${errorMsg}`);
      result.valid = false;
    }

    // Check output directory configuration
    if (!config.output) {
      result.errors.push("Missing required field: output");
      result.valid = false;
    }

    // Validate patch configurations
    if (config.patches) {
      for (let i = 0; i < config.patches.length; i++) {
        const patch = config.patches[i];
        logger.verbose(`Validating patch ${i + 1}: ${patch.op}`, 3);

        // Validate regex patterns for replace-regex
        if (patch.op === "replace-regex") {
          try {
            new RegExp(patch.pattern, patch.flags || "");
          } catch {
            result.errors.push(
              `Patch ${i + 1}: Invalid regex pattern "${patch.pattern}"`
            );
            result.valid = false;
          }
        }
      }
    }

    // Run global validators if present
    if (config.validators && config.validators.length > 0) {
      logger.verbose(`Running ${config.validators.length} global validators...`, 1);

      try {
        const resources = await resolveResources(configPath, config.resources);
        const patches = config.patches || [];

        // Apply patches and collect patched content
        const patchedFiles: Array<{ path: string; content: string }> = [];
        for (const resource of resources) {
          const patchResult = applyPatches(resource.content, patches, resource.relativePath);
          patchedFiles.push({
            path: resource.relativePath,
            content: patchResult.content,
          });
        }

        // Run validators
        const validationErrors = patchedFiles.flatMap((file) =>
          runGlobalValidators(file.content, file.path, config.validators!)
        );

        if (validationErrors.length > 0) {
          result.valid = false;
          result.validationErrors = validationErrors;

          for (const error of validationErrors) {
            const errorMsg = `Validator '${error.validator}' failed on ${error.file}: ${error.message}`;
            result.errors.push(errorMsg);
            logger.error(errorMsg);
          }
        } else {
          logger.verbose("All validators passed", 2);
        }
      } catch (validationError) {
        const errorMsg =
          validationError instanceof Error ? validationError.message : String(validationError);
        result.warnings.push(`Could not run validators: ${errorMsg}`);
      }
    }

    if (result.valid) {
      logger.info("Configuration is valid");
    } else {
      for (const error of result.errors) {
        logger.error(error);
      }
    }

    for (const warning of result.warnings) {
      logger.warn(warning);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMsg);
    result.valid = false;
    logger.error(errorMsg);
  }

  return result;
}

// Init command implementation
/**
 * Prompt the user for input with a default value.
 * Returns the user's input or the default if they press Enter.
 */
async function prompt(question: string, defaultValue: string = ""): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const displayDefault = defaultValue ? ` (${defaultValue})` : "";

  return new Promise((resolve) => {
    rl.question(`${question}${displayDefault}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

/**
 * Prompt the user for a yes/no confirmation.
 * Returns true for yes, false for no.
 */
async function promptConfirm(question: string, defaultValue: boolean = false): Promise<boolean> {
  const defaultHint = defaultValue ? "Y/n" : "y/N";
  const answer = await prompt(`${question} [${defaultHint}]`);

  if (!answer) return defaultValue;
  return answer.toLowerCase().startsWith("y");
}

/**
 * Debug step action types
 */
type DebugAction = "next" | "skip" | "quit" | "diff" | "help";

/**
 * Prompt for debug step action.
 * Returns the action to take.
 */
async function promptDebugStep(): Promise<DebugAction> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("[n]ext [s]kip [d]iff [q]uit [h]elp > ", (answer) => {
      rl.close();
      const cmd = answer.trim().toLowerCase();
      if (cmd === "n" || cmd === "next" || cmd === "") {
        resolve("next");
      } else if (cmd === "s" || cmd === "skip") {
        resolve("skip");
      } else if (cmd === "d" || cmd === "diff") {
        resolve("diff");
      } else if (cmd === "q" || cmd === "quit") {
        resolve("quit");
      } else if (cmd === "h" || cmd === "help") {
        resolve("help");
      } else {
        resolve("next"); // default to next
      }
    });
  });
}

/**
 * Show debug help.
 */
function showDebugHelp(): void {
  console.log(`
Debug Mode Commands:
  n, next   - Apply this patch and continue (default)
  s, skip   - Skip this patch and continue
  d, diff   - Show what this patch will change
  q, quit   - Stop debugging and exit
  h, help   - Show this help
`);
}

/**
 * Format a patch for debug display.
 */
function formatPatchInfo(patch: Record<string, unknown>, index: number): string {
  const op = patch.op as string;
  let details = "";

  switch (op) {
    case "replace":
      details = `"${patch.old}" → "${patch.new}"`;
      break;
    case "replace-regex":
      details = `/${patch.pattern}/ → "${patch.replacement}"`;
      break;
    case "remove-section":
      details = `section: ${patch.id}`;
      break;
    case "replace-section":
    case "prepend-to-section":
    case "append-to-section":
      details = `section: ${patch.id}`;
      break;
    case "set-frontmatter":
      details = `${patch.key} = ${JSON.stringify(patch.value)}`;
      break;
    case "remove-frontmatter":
    case "rename-frontmatter":
      details = `key: ${patch.key || patch.old}`;
      break;
    case "insert-after-line":
    case "insert-before-line":
    case "replace-line":
      details = patch.match ? `match: "${patch.match}"` : `pattern: /${patch.pattern}/`;
      break;
    case "delete-between":
    case "replace-between":
      details = `"${patch.start}" ... "${patch.end}"`;
      break;
    case "rename-header":
      details = `${patch.id} → "${patch.new}"`;
      break;
    case "move-section":
      details = `${patch.id} ${patch.after ? `after ${patch.after}` : `before ${patch.before}`}`;
      break;
    case "change-section-level":
      details = `${patch.id} delta: ${patch.delta}`;
      break;
    default:
      details = JSON.stringify(patch).slice(0, 60);
  }

  const include = patch.include ? ` include: ${JSON.stringify(patch.include)}` : "";
  const exclude = patch.exclude ? ` exclude: ${JSON.stringify(patch.exclude)}` : "";
  const group = patch.group ? ` [group: ${patch.group}]` : "";

  return `[${index + 1}] ${op}: ${details}${include}${exclude}${group}`;
}

/**
 * Apply patches with interactive debug mode.
 * Allows step-through of each patch with user confirmation.
 */
async function applyPatchesDebug(
  content: string,
  patches: Array<Record<string, unknown>>,
  filePath: string,
  groupOptions: GroupOptions
): Promise<{ content: string; applied: number; skipped: number; quit: boolean }> {
  let currentContent = content;
  let applied = 0;
  let skipped = 0;

  console.log(`\n📄 File: ${filePath}`);
  console.log(`   ${patches.length} patch(es) to review\n`);

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];

    // Show patch info
    console.log(`\n${formatPatchInfo(patch, i)}`);

    let action: DebugAction = "next";
    let decided = false;

    while (!decided) {
      action = await promptDebugStep();

      switch (action) {
        case "help":
          showDebugHelp();
          break;
        case "diff": {
          // Show what would change by applying this single patch
          const testResult = applyPatches(
            currentContent,
            [patch] as Parameters<typeof applyPatches>[1],
            filePath,
            groupOptions
          );
          if (testResult.content !== currentContent) {
            const diff = Diff.createPatch(filePath, currentContent, testResult.content, "before", "after");
            console.log("\n" + diff);
          } else {
            console.log("  (no changes for this file)");
          }
          break;
        }
        case "next":
        case "skip":
        case "quit":
          decided = true;
          break;
      }
    }

    if (action === "quit") {
      console.log("\n⏹️  Debug session ended by user\n");
      return { content: currentContent, applied, skipped: patches.length - i, quit: true };
    }

    if (action === "skip") {
      console.log("  ⏭️  Skipped");
      skipped++;
      continue;
    }

    // Apply this single patch
    const result = applyPatches(
      currentContent,
      [patch] as Parameters<typeof applyPatches>[1],
      filePath,
      groupOptions
    );
    currentContent = result.content;
    if (result.applied > 0) {
      console.log("  ✅ Applied");
      applied++;
    } else {
      console.log("  ⚠️  No match (patch didn't apply)");
    }
  }

  return { content: currentContent, applied, skipped, quit: false };
}

/**
 * Run the interactive init wizard.
 * Prompts the user for configuration options and returns them.
 */
async function runInteractiveInit(): Promise<{
  output: string;
  base?: string;
  resources: string;
  addExamplePatch: boolean;
}> {
  console.log("\n🔧 Kustomark Interactive Setup\n");

  // Ask if this is an overlay (extends another config)
  const isOverlay = await promptConfirm("Is this an overlay that extends another config?", false);

  let base: string | undefined;
  let resources = "*.md";

  if (isOverlay) {
    base = await prompt("Base config path (relative)", "../base");
    console.log(`  → Will reference: ${base}`);
  } else {
    resources = await prompt("Resource glob pattern", "*.md");
    console.log(`  → Will include: ${resources}`);
  }

  const output = await prompt("Output directory", "./output");
  console.log(`  → Will output to: ${output}`);

  const addExamplePatch = await promptConfirm("Add an example patch?", true);

  console.log("");

  return { output, base, resources, addExamplePatch };
}

async function init(
  targetPath: string,
  options: CliOptions
): Promise<InitResult> {
  const logger = createLogger(options);
  const result: InitResult = {
    success: false,
    created: "",
    type: options.base ? "overlay" : "base",
  };

  try {
    // Run interactive wizard if requested
    let base = options.base;
    let output = options.output || "./output";
    let resources = "*.md";
    let addExamplePatch = false;

    if (options.interactive) {
      const wizardResult = await runInteractiveInit();
      base = wizardResult.base;
      output = wizardResult.output;
      resources = wizardResult.resources;
      addExamplePatch = wizardResult.addExamplePatch;
      result.type = base ? "overlay" : "base";
    }

    const resolvedPath = resolve(targetPath);
    const configPath = join(resolvedPath, "kustomark.yaml");
    result.created = configPath;

    // Check if config already exists
    if (existsSync(configPath)) {
      throw new Error(`Config already exists: ${configPath}`);
    }

    // Create directory if it doesn't exist
    await mkdir(resolvedPath, { recursive: true });

    // Generate config content
    let configContent: string;

    // Build example patch if requested
    const examplePatch = addExamplePatch
      ? `
  - op: replace
    old: "example"
    new: "replaced"
    include:
      - "**/*.md"
`
      : "";

    if (base) {
      // Overlay config that references a base
      configContent = `apiVersion: kustomark/v1
kind: Kustomization
output: ${output}
resources:
  - ${base}
patches:${examplePatch || " []"}
`;
    } else {
      // Base config
      configContent = `apiVersion: kustomark/v1
kind: Kustomization
output: ${output}
resources:
  - "${resources}"
patches:${examplePatch || " []"}
`;
    }

    // Write the config file
    await writeFile(configPath, configContent, "utf-8");

    result.success = true;
    logger.info(`Created ${configPath}`);
    logger.verbose(`Type: ${result.type}`, 1);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.error = errorMsg;
    logger.error(errorMsg);
  }

  return result;
}

// Schema command implementation
function schema(): SchemaResult {
  const jsonSchema = generateJsonSchema();
  return { schema: jsonSchema };
}

// Lint command implementation
async function lint(
  configPath: string,
  options: CliOptions
): Promise<LintResult> {
  const logger = createLogger(options);

  try {
    logger.verbose(`Loading config from ${configPath}`, 1);
    const config = await loadConfigFile(configPath);

    logger.verbose(`Resolving resources...`, 1);
    let resources: Array<{ relativePath: string; content: string }> = [];
    try {
      resources = await resolveResources(configPath, config.resources);
      logger.verbose(`Found ${resources.length} resources`, 2);
    } catch {
      logger.verbose(`Could not resolve resources, linting without file context`, 1);
    }

    logger.verbose(`Running lint checks...`, 1);
    const result = lintConfig(config, resources);

    // Print issues in text format
    if (options.format === "text") {
      for (const issue of result.issues) {
        const prefix =
          issue.level === "error"
            ? "ERROR"
            : issue.level === "warning"
              ? "WARN"
              : "INFO";
        logger.info(`${prefix}: ${issue.message}`);
      }

      if (result.issues.length === 0) {
        logger.info("No issues found");
      } else {
        logger.info(
          `Found ${result.errorCount} errors, ${result.warningCount} warnings, ${result.infoCount} info`
        );
      }
    }

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(errorMsg);
    return {
      issues: [{ level: "error", message: errorMsg }],
      errorCount: 1,
      warningCount: 0,
      infoCount: 0,
    };
  }
}

// Explain command implementation
async function explain(
  configPath: string,
  options: CliOptions
): Promise<ExplainResult | FileLineageResult> {
  const logger = createLogger(options);

  try {
    if (options.file) {
      // Explain specific file lineage
      logger.verbose(`Explaining file lineage for ${options.file}`, 1);
      const result = await explainFile(configPath, options.file);

      if (options.format === "text") {
        logger.info(`File: ${result.file}`);
        logger.info(`Source: ${result.source}`);
        logger.info(`Patches applied: ${result.patches.length}`);

        for (const patch of result.patches) {
          logger.info(`  - [${patch.config}] ${patch.op}`);
        }
      }

      return result;
    } else {
      // Explain overall config
      logger.verbose(`Explaining config at ${configPath}`, 1);
      const result = await explainConfig(configPath);

      if (options.format === "text") {
        logger.info(`Config: ${result.config}`);
        logger.info(`Output: ${result.output}`);
        logger.info(`Resolution chain:`);

        for (const entry of result.chain) {
          logger.info(`  - ${entry.config}: ${entry.resources} resources, ${entry.patches} patches`);
        }

        logger.info(`Total: ${result.totalFiles} files, ${result.totalPatches} patches`);
      }

      return result;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(errorMsg);
    throw error;
  }
}

// Watch event result
interface WatchEvent {
  event: "build" | "error" | "start";
  success?: boolean;
  filesWritten?: number;
  patchesApplied?: number;
  error?: string;
  timestamp: string;
}

// Hook execution environment variables
interface HookEnv {
  KUSTOMARK_EVENT: string;
  KUSTOMARK_SUCCESS?: string;
  KUSTOMARK_FILES_WRITTEN?: string;
  KUSTOMARK_PATCHES_APPLIED?: string;
  KUSTOMARK_ERROR?: string;
}

// Execute watch hooks
async function executeHooks(
  hooks: string[] | undefined,
  env: HookEnv,
  options: CliOptions
): Promise<void> {
  if (!hooks || hooks.length === 0) return;

  const { spawn } = await import("child_process");

  for (const command of hooks) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, [], {
          shell: true,
          env: { ...process.env, ...env },
          stdio: options.format === "json" ? "ignore" : "inherit",
        });

        child.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Hook "${command}" exited with code ${code}`));
          }
        });

        child.on("error", (err) => {
          reject(err);
        });
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (options.format !== "json") {
        console.error(`Hook error: ${errorMsg}`);
      }
    }
  }
}

// Watch command implementation
async function watch(
  configPath: string,
  options: CliOptions
): Promise<void> {
  const fs = await import("fs");
  const configDir = dirname(configPath);

  // Load config to get watch hooks
  let watchHooks: { onStart?: string[]; onBuild?: string[]; onError?: string[] } | undefined;
  try {
    const config = await loadConfigFile(configPath);
    watchHooks = config.watch;
  } catch {
    // Config load failed - hooks will not be available
  }

  // Emit event
  function emit(event: WatchEvent): void {
    if (options.format === "json") {
      console.log(JSON.stringify(event));
    } else {
      const time = new Date().toLocaleTimeString();
      if (event.event === "start") {
        console.error(`[${time}] Watching for changes...`);
      } else if (event.event === "build") {
        if (event.success) {
          console.error(
            `[${time}] Build complete: ${event.filesWritten} files, ${event.patchesApplied} patches`
          );
        } else {
          console.error(`[${time}] Build failed: ${event.error}`);
        }
      } else if (event.event === "error") {
        console.error(`[${time}] Error: ${event.error}`);
      }
    }
  }

  // Run a build
  async function runBuild(): Promise<void> {
    try {
      const result = await build(configPath, { ...options, format: "text", quiet: true });
      emit({
        event: "build",
        success: result.success,
        filesWritten: result.filesWritten,
        patchesApplied: result.patchesApplied,
        error: result.warnings.length > 0 ? result.warnings[0] : undefined,
        timestamp: new Date().toISOString(),
      });

      // Execute onBuild or onError hooks based on result
      if (result.success) {
        await executeHooks(watchHooks?.onBuild, {
          KUSTOMARK_EVENT: "build",
          KUSTOMARK_SUCCESS: "true",
          KUSTOMARK_FILES_WRITTEN: String(result.filesWritten),
          KUSTOMARK_PATCHES_APPLIED: String(result.patchesApplied),
        }, options);
      } else {
        await executeHooks(watchHooks?.onError, {
          KUSTOMARK_EVENT: "error",
          KUSTOMARK_SUCCESS: "false",
          KUSTOMARK_ERROR: result.warnings[0] || "Build failed",
        }, options);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      emit({
        event: "build",
        success: false,
        error: errorMsg,
        timestamp: new Date().toISOString(),
      });

      // Execute onError hooks
      await executeHooks(watchHooks?.onError, {
        KUSTOMARK_EVENT: "error",
        KUSTOMARK_SUCCESS: "false",
        KUSTOMARK_ERROR: errorMsg,
      }, options);
    }
  }

  // Debounced build
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function debouncedBuild(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      runBuild();
    }, options.debounce);
  }

  // Emit start event
  emit({
    event: "start",
    timestamp: new Date().toISOString(),
  });

  // Execute onStart hooks
  await executeHooks(watchHooks?.onStart, {
    KUSTOMARK_EVENT: "start",
  }, options);

  // Initial build
  await runBuild();

  // Watch for changes
  const watcher = fs.watch(configDir, { recursive: true }, (eventType, filename) => {
    // Ignore output directory changes and hidden files
    if (!filename || filename.startsWith(".") || filename.includes("node_modules")) {
      return;
    }

    // Only watch relevant files
    if (
      filename.endsWith(".md") ||
      filename.endsWith(".yaml") ||
      filename.endsWith(".yml")
    ) {
      debouncedBuild();
    }
  });

  // Handle cleanup on SIGINT
  process.on("SIGINT", () => {
    watcher.close();
    if (options.format !== "json") {
      console.error("\nStopped watching.");
    }
    process.exit(0);
  });

  // Keep the process running
  await new Promise(() => {
    // Never resolves - runs until SIGINT
  });
}

// Print usage information
function printUsage(): void {
  console.log(`
kustomark - Declarative markdown patching pipeline

Usage:
  kustomark <command> [path] [options]

Commands:
  build [path]     Build and write output
  diff [path]      Show what would change
  validate [path]  Validate config
  init [path]      Create a new kustomark.yaml
  schema           Export JSON Schema for editor integration
  lint [path]      Check for common issues
  explain [path]   Show resolution chain and patch details
  watch [path]     Rebuild on file changes
  lsp              Start Language Server Protocol server
  ui [path]        Start Web UI for visual editing

Options:
  --format=<text|json>  Output format (default: text)
  --clean               Remove files not in source (build only)
  --stats               Include build statistics (build only)
  --debug               Step-through debug mode (build only)
  --incremental         Only rebuild changed files (build only)
  --cache               Cache patch computation results (build only)
  --parallel[=<n>]      Process files in parallel (default: 4 workers)
  --enable-groups=<g>   Only apply patches in these groups (comma-separated)
  --disable-groups=<g>  Skip patches in these groups (comma-separated)
  -v, -vv, -vvv         Verbose output (increasing levels)
  -q                    Quiet mode (errors only)
  --base=<path>         Base config to extend (init only)
  --output=<path>       Output directory (init only)
  -i, --interactive     Interactive setup wizard (init only)
  --strict              Treat warnings as errors (lint only)
  --file=<path>         Show lineage for specific file (explain only)
  --debounce=<ms>       Debounce delay in milliseconds (watch only, default: 300)
  --port=<number>       Port for web UI (ui only, default: 3000)

Examples:
  kustomark build ./my-project
  kustomark build ./my-project --parallel
  kustomark build ./my-project --parallel=8
  kustomark build ./my-project --debug
  kustomark build ./my-project --incremental
  kustomark build ./my-project --cache
  kustomark build ./my-project --enable-groups=production
  kustomark build ./my-project --disable-groups=debug,verbose
  kustomark diff ./my-project --format=json
  kustomark validate ./my-project -v
  kustomark init ./overlays/team --base ../company
  kustomark init ./my-project --interactive
  kustomark schema > kustomark.schema.json
  kustomark lint ./my-project --strict
  kustomark explain ./team --file skills/commit.md
  kustomark watch ./team --debounce 500
  kustomark ui ./my-project
  kustomark ui ./my-project --port 8080

Patch Groups:
  Assign patches to groups in kustomark.yaml:
    patches:
      - op: replace
        old: "debug=true"
        new: "debug=false"
        group: production
      - op: replace
        old: "localhost"
        new: "api.example.com"
        group: production

  Use --enable-groups to only apply patches in specific groups (ungrouped patches always apply).
  Use --disable-groups to skip patches in specific groups.

Watch Hooks:
  Configure shell commands to run on watch events in kustomark.yaml:
    watch:
      onStart: ["echo starting"]
      onBuild: ["echo done"]
      onError: ["notify-send failed"]

  Hooks receive environment variables:
    KUSTOMARK_EVENT          - "start", "build", or "error"
    KUSTOMARK_SUCCESS        - "true" or "false"
    KUSTOMARK_FILES_WRITTEN  - Number of files written
    KUSTOMARK_PATCHES_APPLIED - Number of patches applied
    KUSTOMARK_ERROR          - Error message (on error)
`);
}

// Main entry point
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { command, path, options } = parseArgs(args);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  let exitCode = 0;

  // Handle schema command separately (doesn't need any path)
  if (command === "schema") {
    const result = schema();
    // Schema always outputs JSON
    console.log(JSON.stringify(result.schema, null, 2));
    process.exit(0);
  }

  // Handle init command separately (doesn't need existing config)
  if (command === "init") {
    try {
      const result = await init(path, options);
      if (options.format === "json") {
        console.log(JSON.stringify(result, null, 2));
      }
      exitCode = result.success ? 0 : 1;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (options.format === "json") {
        console.log(
          JSON.stringify({
            success: false,
            error: errorMsg,
          })
        );
      } else {
        console.error(`ERROR: ${errorMsg}`);
      }
      exitCode = 1;
    }
    process.exit(exitCode);
  }

  try {
    const configPath = await findConfigPath(path);

    switch (command) {
      case "build": {
        const result = await build(configPath, options);
        if (options.format === "json") {
          console.log(JSON.stringify(result, null, 2));
        }
        exitCode = result.success ? 0 : 1;
        break;
      }

      case "diff": {
        const result = await diff(configPath, options);
        if (options.format === "json") {
          console.log(JSON.stringify(result, null, 2));
        }
        exitCode = result.hasChanges ? 1 : 0;
        break;
      }

      case "validate": {
        const result = await validate(configPath, options);
        if (options.format === "json") {
          console.log(JSON.stringify(result, null, 2));
        }
        exitCode = result.valid ? 0 : 1;
        break;
      }

      case "lint": {
        const result = await lint(configPath, options);
        if (options.format === "json") {
          console.log(JSON.stringify(result, null, 2));
        }
        // With --strict, warnings count as failures
        if (options.strict) {
          exitCode = result.errorCount > 0 || result.warningCount > 0 ? 1 : 0;
        } else {
          exitCode = result.errorCount > 0 ? 1 : 0;
        }
        break;
      }

      case "explain": {
        const result = await explain(configPath, options);
        if (options.format === "json") {
          console.log(JSON.stringify(result, null, 2));
        }
        exitCode = 0;
        break;
      }

      case "watch": {
        await watch(configPath, options);
        // watch never returns (runs until SIGINT)
        break;
      }

      case "lsp": {
        // Start LSP server - import dynamically to avoid loading LSP deps unless needed
        // The server starts listening when the module is imported
        await import("../lsp/server.js");
        // LSP server runs until connection closes
        break;
      }

      case "ui": {
        // Start Web UI server
        const { startWebServer } = await import("../web/server.js");
        await startWebServer({
          port: options.port,
          configPath,
        });
        // Server runs until SIGINT
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        exitCode = 1;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (options.format === "json") {
      console.log(
        JSON.stringify({
          success: false,
          error: errorMsg,
        })
      );
    } else {
      console.error(`ERROR: ${errorMsg}`);
    }
    exitCode = 1;
  }

  process.exit(exitCode);
}

// Run main function
main();
