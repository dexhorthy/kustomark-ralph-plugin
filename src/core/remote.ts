import { mkdir, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { homedir, tmpdir } from "os";
import { spawn } from "child_process";

/**
 * Types of remote resources
 */
export type RemoteType = "git" | "http" | "local";

/**
 * Parsed remote resource URL
 */
export interface ParsedRemoteUrl {
  type: RemoteType;
  /** Original URL string */
  original: string;
  /** URL to fetch from (git clone URL or HTTP URL) */
  fetchUrl: string;
  /** Path within the repo/archive to extract */
  subpath: string;
  /** Git ref (branch, tag, or sha) for git resources */
  ref?: string;
  /** Whether this is a GitHub shorthand URL */
  isGitHubShorthand?: boolean;
}

/**
 * Cache entry for a fetched resource
 */
export interface CacheEntry {
  url: string;
  resolved: string;
  integrity: string;
  fetched: string;
  path: string;
}

/**
 * Result of fetching a remote resource
 */
export interface FetchResult {
  /** Whether the fetch was successful */
  success: boolean;
  /** Files fetched from the remote */
  files: Array<{ relativePath: string; content: string }>;
  /** Whether the result came from cache */
  cached: boolean;
  /** Error message if fetch failed */
  error?: string;
}

/**
 * Default cache directory
 */
const DEFAULT_CACHE_DIR = join(homedir(), ".cache", "kustomark");

/**
 * Check if a URL is a remote resource (not a local path)
 */
export function isRemoteResource(resource: string): boolean {
  // Git prefixed URLs
  if (resource.startsWith("git::")) {
    return true;
  }

  // HTTP/HTTPS URLs
  if (resource.startsWith("http://") || resource.startsWith("https://")) {
    return true;
  }

  // GitHub shorthand (github.com/org/repo//)
  if (resource.startsWith("github.com/") && resource.includes("//")) {
    return true;
  }

  return false;
}

/**
 * Parse a remote resource URL into its components
 */
export function parseRemoteUrl(resource: string): ParsedRemoteUrl {
  // GitHub shorthand: github.com/org/repo//path?ref=v1.0.0
  if (resource.startsWith("github.com/") && resource.includes("//")) {
    const [urlPart, queryPart] = resource.split("?");
    const [hostAndRepo, subpath] = urlPart.split("//");

    // Parse query params for ref
    let ref: string | undefined;
    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      ref = params.get("ref") || undefined;
    }

    // Construct full git URL
    const fetchUrl = `https://${hostAndRepo}.git`;

    return {
      type: "git",
      original: resource,
      fetchUrl,
      subpath: subpath || "",
      ref,
      isGitHubShorthand: true,
    };
  }

  // Git explicit URL: git::https://github.com/org/repo.git//subdir?ref=main
  // or: git::git@github.com:org/repo.git//path?ref=abc1234
  if (resource.startsWith("git::")) {
    const withoutPrefix = resource.slice(5);
    const [urlPart, queryPart] = withoutPrefix.split("?");

    // Find the // that separates URL from subpath
    // Need to handle https:// by looking for // after the protocol
    let fetchUrl: string;
    let subpath: string;

    // Match pattern: look for // that's not part of http:// or https://
    const protocolMatch = urlPart.match(/^(https?:\/\/)/);
    if (protocolMatch) {
      // URL has protocol, look for // after the protocol
      const afterProtocol = urlPart.slice(protocolMatch[0].length);
      const doubleSlashIndex = afterProtocol.indexOf("//");
      if (doubleSlashIndex !== -1) {
        fetchUrl = protocolMatch[0] + afterProtocol.slice(0, doubleSlashIndex);
        subpath = afterProtocol.slice(doubleSlashIndex + 2);
      } else {
        fetchUrl = urlPart;
        subpath = "";
      }
    } else {
      // SSH or other URL, just split on //
      const parts = urlPart.split("//");
      fetchUrl = parts[0];
      subpath = parts.slice(1).join("//");
    }

    // Parse query params for ref
    let ref: string | undefined;
    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      ref = params.get("ref") || undefined;
    }

    return {
      type: "git",
      original: resource,
      fetchUrl,
      subpath: subpath || "",
      ref,
    };
  }

  // HTTP URL: https://example.com/release.tar.gz//subdir/
  if (resource.startsWith("http://") || resource.startsWith("https://")) {
    // Same logic as git URLs - find // after the protocol
    const protocolMatch = resource.match(/^(https?:\/\/)/);
    if (protocolMatch) {
      const afterProtocol = resource.slice(protocolMatch[0].length);
      const doubleSlashIndex = afterProtocol.indexOf("//");
      if (doubleSlashIndex !== -1) {
        const fetchUrl = protocolMatch[0] + afterProtocol.slice(0, doubleSlashIndex);
        const subpath = afterProtocol.slice(doubleSlashIndex + 2);
        return {
          type: "http",
          original: resource,
          fetchUrl,
          subpath,
        };
      }
    }

    return {
      type: "http",
      original: resource,
      fetchUrl: resource,
      subpath: "",
    };
  }

  // Local path - just return it as-is
  return {
    type: "local",
    original: resource,
    fetchUrl: resource,
    subpath: "",
  };
}

/**
 * Generate a cache key for a remote URL
 */
export function getCacheKey(parsed: ParsedRemoteUrl): string {
  // Create a safe filename from the URL
  const safeName = parsed.original
    .replace(/[^a-zA-Z0-9]/g, "_")
    .substring(0, 100);

  // Add ref to cache key for git resources
  if (parsed.type === "git" && parsed.ref) {
    return `${safeName}_${parsed.ref}`;
  }

  return safeName;
}

/**
 * Get the cache directory path
 */
export function getCacheDir(): string {
  return process.env.KUSTOMARK_CACHE_DIR || DEFAULT_CACHE_DIR;
}

/**
 * Execute a shell command and return the output
 */
async function execCommand(
  command: string,
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });

    proc.on("error", (err) => {
      stderr += err.message;
      resolve({ stdout, stderr, exitCode: 1 });
    });
  });
}

/**
 * Clone a git repository to a temporary directory
 */
async function gitClone(
  url: string,
  ref: string | undefined,
  destDir: string
): Promise<{ success: boolean; error?: string }> {
  // Clone the repository
  const cloneArgs = ["clone", "--depth", "1"];

  if (ref) {
    cloneArgs.push("--branch", ref);
  }

  cloneArgs.push(url, destDir);

  const result = await execCommand("git", cloneArgs);

  if (result.exitCode !== 0) {
    // If branch clone failed, try without --branch and checkout
    if (ref && result.stderr.includes("not found")) {
      const fullCloneArgs = ["clone", url, destDir];
      const fullResult = await execCommand("git", fullCloneArgs);

      if (fullResult.exitCode !== 0) {
        return { success: false, error: fullResult.stderr };
      }

      // Checkout the specific ref
      const checkoutResult = await execCommand("git", ["checkout", ref], destDir);
      if (checkoutResult.exitCode !== 0) {
        return { success: false, error: `Failed to checkout ${ref}: ${checkoutResult.stderr}` };
      }
    } else {
      return { success: false, error: result.stderr };
    }
  }

  return { success: true };
}

/**
 * Read all files from a directory recursively
 */
async function readDirRecursive(
  dir: string,
  baseDir: string = dir
): Promise<Array<{ relativePath: string; content: string }>> {
  const files: Array<{ relativePath: string; content: string }> = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      // Skip .git directory
      if (entry.name === ".git") {
        continue;
      }

      if (entry.isDirectory()) {
        const subFiles = await readDirRecursive(fullPath, baseDir);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        try {
          const content = await readFile(fullPath, "utf-8");
          const relativePath = fullPath.substring(baseDir.length + 1);
          files.push({ relativePath, content });
        } catch {
          // Skip files that can't be read as text
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return files;
}

/**
 * Fetch a git remote resource
 */
export async function fetchGitResource(
  parsed: ParsedRemoteUrl,
  options: { cacheDir?: string; noCache?: boolean } = {}
): Promise<FetchResult> {
  const cacheDir = options.cacheDir || getCacheDir();
  const cacheKey = getCacheKey(parsed);
  const cachePath = join(cacheDir, "git", cacheKey);

  // Check cache first (unless noCache is set)
  if (!options.noCache) {
    try {
      const cacheStats = await stat(cachePath);
      if (cacheStats.isDirectory()) {
        // Cache hit - read files from cache
        const subdir = parsed.subpath
          ? join(cachePath, parsed.subpath)
          : cachePath;

        const files = await readDirRecursive(subdir, subdir);
        return { success: true, files, cached: true };
      }
    } catch {
      // Cache miss - continue to fetch
    }
  }

  // Ensure cache directory exists
  await mkdir(dirname(cachePath), { recursive: true });

  // Clone the repository
  const cloneResult = await gitClone(parsed.fetchUrl, parsed.ref, cachePath);

  if (!cloneResult.success) {
    return {
      success: false,
      files: [],
      cached: false,
      error: cloneResult.error || "Git clone failed",
    };
  }

  // Read files from the cloned repo (or subpath)
  const subdir = parsed.subpath
    ? join(cachePath, parsed.subpath)
    : cachePath;

  const files = await readDirRecursive(subdir, subdir);

  return { success: true, files, cached: false };
}

/**
 * Determine the archive type from URL
 */
function getArchiveType(url: string): "tar.gz" | "tgz" | "tar" | "zip" | null {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.endsWith(".tar.gz")) return "tar.gz";
  if (lowerUrl.endsWith(".tgz")) return "tgz";
  if (lowerUrl.endsWith(".tar")) return "tar";
  if (lowerUrl.endsWith(".zip")) return "zip";
  return null;
}

/**
 * Extract a tar archive to a directory
 */
async function extractTar(
  archivePath: string,
  destDir: string,
  gzipped: boolean
): Promise<{ success: boolean; error?: string }> {
  const args = gzipped
    ? ["-xzf", archivePath, "-C", destDir]
    : ["-xf", archivePath, "-C", destDir];

  const result = await execCommand("tar", args);

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr };
  }

  return { success: true };
}

/**
 * Extract a zip archive to a directory
 */
async function extractZip(
  archivePath: string,
  destDir: string
): Promise<{ success: boolean; error?: string }> {
  const result = await execCommand("unzip", ["-o", archivePath, "-d", destDir]);

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr };
  }

  return { success: true };
}

/**
 * Download a file from a URL
 */
async function downloadFile(
  url: string,
  destPath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    if (!response.body) {
      return { success: false, error: "No response body" };
    }

    // Ensure directory exists
    await mkdir(dirname(destPath), { recursive: true });

    // Write the response to a file
    const arrayBuffer = await response.arrayBuffer();
    await writeFile(destPath, Buffer.from(arrayBuffer));

    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * Fetch an HTTP remote resource (archive)
 */
export async function fetchHttpResource(
  parsed: ParsedRemoteUrl,
  options: { cacheDir?: string; noCache?: boolean } = {}
): Promise<FetchResult> {
  const cacheDir = options.cacheDir || getCacheDir();
  const cacheKey = getCacheKey(parsed);
  const cachePath = join(cacheDir, "http", cacheKey);

  // Check cache first (unless noCache is set)
  if (!options.noCache) {
    try {
      const cacheStats = await stat(cachePath);
      if (cacheStats.isDirectory()) {
        // Cache hit - read files from cache
        const subdir = parsed.subpath
          ? join(cachePath, parsed.subpath)
          : cachePath;

        const files = await readDirRecursive(subdir, subdir);
        return { success: true, files, cached: true };
      }
    } catch {
      // Cache miss - continue to fetch
    }
  }

  // Determine archive type
  const archiveType = getArchiveType(parsed.fetchUrl);

  if (!archiveType) {
    // Not an archive - try to fetch as a single file
    const downloadResult = await downloadFile(
      parsed.fetchUrl,
      join(cachePath, "file")
    );

    if (!downloadResult.success) {
      return {
        success: false,
        files: [],
        cached: false,
        error: downloadResult.error,
      };
    }

    // Read the single file
    try {
      const content = await readFile(join(cachePath, "file"), "utf-8");
      const filename = parsed.fetchUrl.split("/").pop() || "file";
      return {
        success: true,
        files: [{ relativePath: filename, content }],
        cached: false,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        files: [],
        cached: false,
        error: `Failed to read downloaded file: ${error}`,
      };
    }
  }

  // Download the archive to a temp location
  const tempDir = join(tmpdir(), `kustomark-${Date.now()}`);
  const archiveName = parsed.fetchUrl.split("/").pop() || "archive";
  const archivePath = join(tempDir, archiveName);

  await mkdir(tempDir, { recursive: true });

  const downloadResult = await downloadFile(parsed.fetchUrl, archivePath);

  if (!downloadResult.success) {
    await rm(tempDir, { recursive: true }).catch(() => {});
    return {
      success: false,
      files: [],
      cached: false,
      error: downloadResult.error,
    };
  }

  // Create cache directory for extraction
  await mkdir(cachePath, { recursive: true });

  // Extract the archive
  let extractResult: { success: boolean; error?: string };

  switch (archiveType) {
    case "tar.gz":
    case "tgz":
      extractResult = await extractTar(archivePath, cachePath, true);
      break;
    case "tar":
      extractResult = await extractTar(archivePath, cachePath, false);
      break;
    case "zip":
      extractResult = await extractZip(archivePath, cachePath);
      break;
  }

  // Clean up temp directory
  await rm(tempDir, { recursive: true }).catch(() => {});

  if (!extractResult.success) {
    await rm(cachePath, { recursive: true }).catch(() => {});
    return {
      success: false,
      files: [],
      cached: false,
      error: extractResult.error,
    };
  }

  // Read files from the extracted archive (or subpath)
  const subdir = parsed.subpath
    ? join(cachePath, parsed.subpath)
    : cachePath;

  const files = await readDirRecursive(subdir, subdir);

  return { success: true, files, cached: false };
}

/**
 * Fetch a remote resource (auto-detects type)
 */
export async function fetchRemoteResource(
  resource: string,
  options: { cacheDir?: string; noCache?: boolean } = {}
): Promise<FetchResult> {
  const parsed = parseRemoteUrl(resource);

  switch (parsed.type) {
    case "git":
      return fetchGitResource(parsed, options);

    case "http":
      return fetchHttpResource(parsed, options);

    case "local":
      return {
        success: false,
        files: [],
        cached: false,
        error: "Not a remote resource",
      };
  }
}

/**
 * Clear the cache for a specific URL or all cached resources
 */
export async function clearCache(
  filter?: string,
  options: { cacheDir?: string } = {}
): Promise<{ cleared: number }> {
  const cacheDir = options.cacheDir || getCacheDir();
  let cleared = 0;

  // Clear both git and http caches
  for (const subdir of ["git", "http"]) {
    const typeCacheDir = join(cacheDir, subdir);

    try {
      const entries = await readdir(typeCacheDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // If filter is provided, check if the entry name matches
          if (filter) {
            if (!entry.name.includes(filter.replace(/[^a-zA-Z0-9]/g, "_"))) {
              continue;
            }
          }

          const entryPath = join(typeCacheDir, entry.name);
          await rm(entryPath, { recursive: true });
          cleared++;
        }
      }
    } catch {
      // Cache directory doesn't exist
    }
  }

  return { cleared };
}

/**
 * List cached resources
 */
export async function listCache(
  options: { cacheDir?: string } = {}
): Promise<Array<{ key: string; path: string; size: number; type: "git" | "http" }>> {
  const cacheDir = options.cacheDir || getCacheDir();
  const entries: Array<{ key: string; path: string; size: number; type: "git" | "http" }> = [];

  // List both git and http caches
  for (const subdir of ["git", "http"] as const) {
    const typeCacheDir = join(cacheDir, subdir);

    try {
      const dirEntries = await readdir(typeCacheDir, { withFileTypes: true });

      for (const entry of dirEntries) {
        if (entry.isDirectory()) {
          const entryPath = join(typeCacheDir, entry.name);

          // Calculate directory size (simplified - just count files)
          const files = await readDirRecursive(entryPath, entryPath);
          const size = files.reduce((acc, f) => acc + f.content.length, 0);

          entries.push({
            key: entry.name,
            path: entryPath,
            size,
            type: subdir,
          });
        }
      }
    } catch {
      // Cache directory doesn't exist
    }
  }

  return entries;
}
