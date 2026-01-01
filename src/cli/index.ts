#!/usr/bin/env bun

import { existsSync } from "fs";
import { readFile, writeFile, mkdir, readdir, rm, stat } from "fs/promises";
import { join, dirname, resolve, relative } from "path";
import * as Diff from "diff";
import { loadConfigFile } from "../core/config.js";
import { resolveResources } from "../core/resources.js";
import { applyPatches } from "../core/patches.js";
import { runGlobalValidators, type ValidationError } from "../core/validation.js";
import { applyFileOperations, applyFileOperationResults } from "../core/file-operations.js";

// Types for CLI output
interface BuildResult {
  success: boolean;
  filesWritten: number;
  patchesApplied: number;
  warnings: string[];
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

// CLI options
interface CliOptions {
  format: "text" | "json";
  clean: boolean;
  verbose: number; // 0, 1, 2, or 3
  quiet: boolean;
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

// Build command implementation
async function build(
  configPath: string,
  options: CliOptions
): Promise<BuildResult> {
  const logger = createLogger(options);
  const result: BuildResult = {
    success: false,
    filesWritten: 0,
    patchesApplied: 0,
    warnings: [],
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
    const patches = config.patches || [];
    const fileOpsResult = applyFileOperations(patches, resources);
    const processedResources = applyFileOperationResults(resources, fileOpsResult);

    result.patchesApplied += fileOpsResult.operationsApplied;
    result.warnings.push(...fileOpsResult.warnings);
    logger.verbose(`Applied ${fileOpsResult.operationsApplied} file operations`, 2);

    // Track files we write for clean option
    const writtenFiles = new Set<string>();
    const existingFiles = await getOutputFiles(outputDir);

    // Process each resource
    for (const resource of processedResources) {
      logger.verbose(`Processing ${resource.relativePath}`, 2);

      // Apply content patches
      const patchResult = applyPatches(
        resource.content,
        patches,
        resource.relativePath
      );

      result.patchesApplied += patchResult.applied;
      result.warnings.push(...patchResult.warnings);

      // Write output file
      const outputPath = join(outputDir, resource.relativePath);
      const outputDirPath = dirname(outputPath);

      await mkdir(outputDirPath, { recursive: true });
      await writeFile(outputPath, patchResult.content, "utf-8");

      writtenFiles.add(resource.relativePath);
      result.filesWritten++;

      logger.verbose(`  Wrote ${outputPath}`, 3);
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

    result.success = true;

    // Log warnings
    for (const warning of result.warnings) {
      logger.warn(warning);
    }

    logger.info(
      `Build complete: ${result.filesWritten} files written, ${result.patchesApplied} patches applied`
    );
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
    const patches = config.patches || [];
    const fileOpsResult = applyFileOperations(patches, resources);
    const processedResources = applyFileOperationResults(resources, fileOpsResult);

    logger.verbose(`Applied ${fileOpsResult.operationsApplied} file operations`, 2);

    const existingFiles = await getOutputFiles(outputDir);
    const processedFiles = new Set<string>();

    // Process each resource
    for (const resource of processedResources) {
      logger.verbose(`Processing ${resource.relativePath}`, 2);

      // Apply content patches
      const patchResult = applyPatches(
        resource.content,
        patches,
        resource.relativePath
      );

      const outputPath = join(outputDir, resource.relativePath);
      processedFiles.add(resource.relativePath);

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
        result.hasChanges = true;
        const fileDiff = Diff.createPatch(
          resource.relativePath,
          existingContent,
          patchResult.content,
          "existing",
          "new"
        );

        result.files.push({
          path: resource.relativePath,
          status: fileStatus,
          diff: fileDiff,
        });

        if (options.format === "text") {
          logger.info(`${fileStatus.toUpperCase()}: ${resource.relativePath}`);
          if (options.verbose >= 1) {
            console.log(fileDiff);
          }
        }
      } else {
        logger.verbose(`  Unchanged: ${resource.relativePath}`, 3);
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

Options:
  --format=<text|json>  Output format (default: text)
  --clean               Remove files not in source (build only)
  -v, -vv, -vvv         Verbose output (increasing levels)
  -q                    Quiet mode (errors only)

Examples:
  kustomark build ./my-project
  kustomark diff ./my-project --format=json
  kustomark validate ./my-project -v
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
