import { glob } from "glob";
import { readFile } from "fs/promises";
import { dirname, join, resolve, relative, isAbsolute } from "path";
import { stat } from "fs/promises";
import { loadConfigFile, type Patch } from "./config.js";
import { isRemoteResource, fetchRemoteResource } from "./remote.js";

/**
 * Represents a resolved file with its path information and content.
 */
export interface ResolvedFile {
  /** Path relative to the config file's directory */
  relativePath: string;
  /** Absolute path to the file */
  absolutePath: string;
  /** File content as a string */
  content: string;
}

/**
 * Alias for ResolvedFile - used for backwards compatibility
 */
export type ResolvedResource = ResolvedFile;

/**
 * Check if a path is a directory.
 * @param path - Path to check
 * @returns True if the path is a directory
 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a file exists.
 * @param path - Path to check
 * @returns True if the file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Simple minimatch-like function for basic glob matching.
 * Supports * and ** patterns.
 * @param path - Path to test
 * @param pattern - Glob pattern
 * @returns True if path matches pattern
 */
function simpleMatch(path: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
    .replace(/\?/g, ".");

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(path);
}

/**
 * Apply patches from a kustomark config to resolved files.
 * This is a placeholder that will be implemented by the patch engine.
 * For now, it returns files unchanged.
 * @param files - Files to patch
 * @param _patches - Array of patches to apply
 * @returns Patched files
 */
async function applyPatchesToFiles(
  files: ResolvedFile[],
  _patches: Patch[] | undefined
): Promise<ResolvedFile[]> {
  // TODO: Implement patch application using the patch engine
  // For now, return files unchanged - the patch engine will handle this
  return files;
}

/**
 * Resolve a single resource pattern to files.
 * @param configDir - Directory containing the config file
 * @param pattern - Resource pattern to resolve
 * @param negationPatterns - Patterns to exclude
 * @returns Array of resolved files
 */
async function resolveSingleResource(
  configDir: string,
  pattern: string,
  negationPatterns: string[]
): Promise<ResolvedFile[]> {
  const resolvedFiles: ResolvedFile[] = [];

  // Check if this is a remote resource (git or http)
  if (isRemoteResource(pattern)) {
    const fetchResult = await fetchRemoteResource(pattern);

    if (!fetchResult.success) {
      throw new Error(`Failed to fetch remote resource ${pattern}: ${fetchResult.error}`);
    }

    // Convert fetched files to resolved files
    for (const file of fetchResult.files) {
      resolvedFiles.push({
        relativePath: file.relativePath,
        absolutePath: `remote://${pattern}/${file.relativePath}`,
        content: file.content,
      });
    }

    return resolvedFiles;
  }

  // Check if this is a kustomark config directory (ends with "/" or is a directory with kustomark.yaml)
  const isKustomarkDir = pattern.endsWith("/");
  const patternPath = isAbsolute(pattern) ? pattern : resolve(configDir, pattern);
  const normalizedPath = isKustomarkDir ? patternPath.slice(0, -1) : patternPath;

  // Check if it's a directory with kustomark.yaml
  if (isKustomarkDir || (await isDirectory(normalizedPath))) {
    const kustomarkConfigPath = join(normalizedPath, "kustomark.yaml");

    if (await fileExists(kustomarkConfigPath)) {
      // Recursively resolve the nested kustomark config
      const nestedConfig = await loadConfigFile(kustomarkConfigPath);
      const nestedFiles = await resolveResourcesInternal(
        kustomarkConfigPath,
        nestedConfig.resources
      );

      // Apply patches from the nested config
      const patchedFiles = await applyPatchesToFiles(nestedFiles, nestedConfig.patches);

      // Re-map relative paths to be relative to the current config directory
      for (const file of patchedFiles) {
        resolvedFiles.push({
          relativePath: relative(configDir, file.absolutePath),
          absolutePath: file.absolutePath,
          content: file.content,
        });
      }

      return resolvedFiles;
    }
  }

  // Check if it's a glob pattern (contains * or ?)
  const isGlob = pattern.includes("*") || pattern.includes("?");

  if (isGlob) {
    // Use glob to find matching files
    const matches = await glob(pattern, {
      cwd: configDir,
      nodir: true,
      ignore: negationPatterns.map((p) => p.slice(1)), // Remove "!" prefix for glob ignore
    });

    for (const match of matches) {
      const absolutePath = resolve(configDir, match);
      const content = await readFile(absolutePath, "utf-8");

      resolvedFiles.push({
        relativePath: match,
        absolutePath,
        content,
      });
    }
  } else {
    // Single file path
    const absolutePath = isAbsolute(pattern) ? pattern : resolve(configDir, pattern);

    if (await fileExists(absolutePath)) {
      const content = await readFile(absolutePath, "utf-8");
      const relativePath = relative(configDir, absolutePath);

      // Check if the file matches any negation pattern
      const shouldExclude = negationPatterns.some((negPattern) => {
        const negGlob = negPattern.slice(1); // Remove "!" prefix
        // Simple glob matching for single file check
        return simpleMatch(relativePath, negGlob);
      });

      if (!shouldExclude) {
        resolvedFiles.push({
          relativePath,
          absolutePath,
          content,
        });
      }
    }
  }

  return resolvedFiles;
}

/**
 * Internal implementation for resolving resources from a kustomark configuration file.
 *
 * @param configPath - Absolute or relative path to the kustomark config file
 * @param resources - Array of resource patterns to resolve
 * @returns Array of resolved files with paths and content
 */
async function resolveResourcesInternal(
  configPath: string,
  resources: string[]
): Promise<ResolvedFile[]> {
  const absoluteConfigPath = isAbsolute(configPath)
    ? configPath
    : resolve(process.cwd(), configPath);
  const configDir = dirname(absoluteConfigPath);

  // Separate negation patterns from inclusion patterns
  const negationPatterns: string[] = [];
  const inclusionPatterns: string[] = [];

  for (const resource of resources) {
    if (resource.startsWith("!")) {
      negationPatterns.push(resource);
    } else {
      inclusionPatterns.push(resource);
    }
  }

  // Resolve all inclusion patterns
  const allFiles: ResolvedFile[] = [];
  const seenPaths = new Set<string>();

  for (const pattern of inclusionPatterns) {
    const files = await resolveSingleResource(configDir, pattern, negationPatterns);

    for (const file of files) {
      // Deduplicate by absolute path (last wins for conflicts per spec)
      if (seenPaths.has(file.absolutePath)) {
        // Remove existing entry and add new one (last wins)
        const existingIndex = allFiles.findIndex((f) => f.absolutePath === file.absolutePath);
        if (existingIndex !== -1) {
          allFiles.splice(existingIndex, 1);
        }
      }
      seenPaths.add(file.absolutePath);
      allFiles.push(file);
    }
  }

  return allFiles;
}

/**
 * Resolve resources from a kustomark configuration file.
 *
 * Handles these resource types:
 * - Glob patterns like "**\/*.md" - matches multiple files
 * - Negation patterns starting with "!" - excludes files from results
 * - File paths like "./file.md" - single file
 * - Directory paths ending with "/" - if contains kustomark.yaml, recursively resolve
 *
 * @param configPath - Absolute or relative path to the kustomark config file
 * @param resources - Array of resource patterns to resolve
 * @returns Array of resolved files with paths and content
 *
 * @example
 * const files = await resolveResources("./kustomark.yaml", resources);
 */
export async function resolveResources(
  configPath: string,
  resources: string[]
): Promise<ResolvedFile[]>;

/**
 * Resolve resources using resources array and config directory.
 *
 * @param resources - Array of resource patterns to resolve
 * @param configDir - Directory containing the config file
 * @returns Array of resolved files with paths and content
 */
export async function resolveResources(
  resources: string[],
  configDir: string
): Promise<ResolvedFile[]>;

/**
 * Implementation of resolveResources that handles both signatures.
 */
export async function resolveResources(
  arg1: string | string[],
  arg2: string | string[]
): Promise<ResolvedFile[]> {
  // Detect which signature is being used
  if (Array.isArray(arg1) && typeof arg2 === "string") {
    // CLI-style: resolveResources(resources[], configDir)
    const resources = arg1;
    const configDir = arg2;
    const configPath = join(configDir, "kustomark.yaml");
    return resolveResourcesInternal(configPath, resources);
  } else if (typeof arg1 === "string" && Array.isArray(arg2)) {
    // Config-style: resolveResources(configPath, resources[])
    const configPath = arg1;
    const resources = arg2;
    return resolveResourcesInternal(configPath, resources);
  } else {
    throw new Error("Invalid arguments: expected (configPath, resources[]) or (resources[], configDir)");
  }
}
