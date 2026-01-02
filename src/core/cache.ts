import { readFile, writeFile, mkdir, readdir, rm, stat } from "fs/promises";
import { join, dirname } from "path";
import { createHash } from "crypto";
import { existsSync } from "fs";

/**
 * Default cache directory name
 */
export const CACHE_DIR_NAME = ".kustomark-cache";

/**
 * Cache entry metadata
 */
interface CacheEntryMeta {
  sourceHash: string;
  patchesHash: string;
  createdAt: string;
  size: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  totalSize: number;
}

/**
 * Build cache for storing computed patch results
 */
export class BuildCache {
  private cacheDir: string;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    entries: 0,
    totalSize: 0,
  };

  constructor(outputDir: string, cacheDir?: string) {
    this.cacheDir = cacheDir || join(outputDir, CACHE_DIR_NAME);
  }

  /**
   * Generate a cache key from source content and patches
   */
  generateCacheKey(sourceContent: string, patchesHash: string, relativePath: string): string {
    const hash = createHash("sha256");
    hash.update(relativePath);
    hash.update("\0");
    hash.update(sourceContent);
    hash.update("\0");
    hash.update(patchesHash);
    return hash.digest("hex");
  }

  /**
   * Get the path for a cache entry
   */
  private getCachePath(cacheKey: string): string {
    // Use first 2 chars as subdirectory for better filesystem performance
    const subdir = cacheKey.substring(0, 2);
    return join(this.cacheDir, subdir, `${cacheKey}.cache`);
  }

  /**
   * Get the path for cache entry metadata
   */
  private getMetaPath(cacheKey: string): string {
    const subdir = cacheKey.substring(0, 2);
    return join(this.cacheDir, subdir, `${cacheKey}.meta.json`);
  }

  /**
   * Check if a cache entry exists
   */
  async has(cacheKey: string): Promise<boolean> {
    const cachePath = this.getCachePath(cacheKey);
    return existsSync(cachePath);
  }

  /**
   * Get cached content if it exists
   */
  async get(cacheKey: string): Promise<string | null> {
    const cachePath = this.getCachePath(cacheKey);
    try {
      const content = await readFile(cachePath, "utf-8");
      this.stats.hits++;
      return content;
    } catch {
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Store content in cache
   */
  async set(
    cacheKey: string,
    content: string,
    sourceHash: string,
    patchesHash: string
  ): Promise<void> {
    const cachePath = this.getCachePath(cacheKey);
    const metaPath = this.getMetaPath(cacheKey);
    const cacheSubdir = dirname(cachePath);

    await mkdir(cacheSubdir, { recursive: true });

    // Write content
    await writeFile(cachePath, content, "utf-8");

    // Write metadata
    const meta: CacheEntryMeta = {
      sourceHash,
      patchesHash,
      createdAt: new Date().toISOString(),
      size: Buffer.byteLength(content, "utf-8"),
    };
    await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Initialize the cache directory
   */
  async init(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<number> {
    if (!existsSync(this.cacheDir)) {
      return 0;
    }

    let count = 0;
    const subdirs = await readdir(this.cacheDir);

    for (const subdir of subdirs) {
      const subdirPath = join(this.cacheDir, subdir);
      const subdirStat = await stat(subdirPath);

      if (subdirStat.isDirectory()) {
        const files = await readdir(subdirPath);
        count += files.filter((f) => f.endsWith(".cache")).length;
        await rm(subdirPath, { recursive: true });
      }
    }

    return count;
  }

  /**
   * Get cache size information
   */
  async getSize(): Promise<{ entries: number; totalBytes: number }> {
    if (!existsSync(this.cacheDir)) {
      return { entries: 0, totalBytes: 0 };
    }

    let entries = 0;
    let totalBytes = 0;

    const subdirs = await readdir(this.cacheDir);

    for (const subdir of subdirs) {
      const subdirPath = join(this.cacheDir, subdir);
      try {
        const subdirStat = await stat(subdirPath);
        if (subdirStat.isDirectory()) {
          const files = await readdir(subdirPath);
          for (const file of files) {
            if (file.endsWith(".cache")) {
              entries++;
              const filePath = join(subdirPath, file);
              const fileStat = await stat(filePath);
              totalBytes += fileStat.size;
            }
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    }

    this.stats.entries = entries;
    this.stats.totalSize = totalBytes;

    return { entries, totalBytes };
  }

  /**
   * Prune cache entries older than maxAge (in milliseconds)
   */
  async prune(maxAge: number): Promise<number> {
    if (!existsSync(this.cacheDir)) {
      return 0;
    }

    const cutoff = Date.now() - maxAge;
    let pruned = 0;

    const subdirs = await readdir(this.cacheDir);

    for (const subdir of subdirs) {
      const subdirPath = join(this.cacheDir, subdir);
      try {
        const subdirStat = await stat(subdirPath);
        if (subdirStat.isDirectory()) {
          const files = await readdir(subdirPath);
          for (const file of files) {
            if (file.endsWith(".meta.json")) {
              const metaPath = join(subdirPath, file);
              try {
                const metaContent = await readFile(metaPath, "utf-8");
                const meta: CacheEntryMeta = JSON.parse(metaContent);
                const createdAt = new Date(meta.createdAt).getTime();

                if (createdAt < cutoff) {
                  // Remove both cache and meta files
                  const cacheKey = file.replace(".meta.json", "");
                  const cachePath = join(subdirPath, `${cacheKey}.cache`);
                  await rm(metaPath, { force: true });
                  await rm(cachePath, { force: true });
                  pruned++;
                }
              } catch {
                // Skip invalid meta files
              }
            }
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    }

    return pruned;
  }
}

/**
 * Calculate hash for patches array (for cache key generation)
 */
export function calculatePatchesHashForCache(patches: unknown[]): string {
  const hash = createHash("sha256");
  // Sort patches by their JSON representation for deterministic hashing
  const patchStrings = patches.map((p) => JSON.stringify(p)).sort();
  for (const patchStr of patchStrings) {
    hash.update(patchStr);
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Format bytes for display
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
