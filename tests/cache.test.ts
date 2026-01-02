import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  BuildCache,
  calculatePatchesHashForCache,
  formatBytes,
  CACHE_DIR_NAME,
} from "../src/core/cache.js";

describe("Build Cache", () => {
  let tempDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `kustomark-cache-test-${Date.now()}`);
    outputDir = join(tempDir, "output");
    await mkdir(outputDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("BuildCache", () => {
    test("generates consistent cache keys", () => {
      const cache = new BuildCache(outputDir);
      const key1 = cache.generateCacheKey("content", "patchhash", "file.md");
      const key2 = cache.generateCacheKey("content", "patchhash", "file.md");
      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[a-f0-9]{64}$/);
    });

    test("generates different keys for different content", () => {
      const cache = new BuildCache(outputDir);
      const key1 = cache.generateCacheKey("content1", "patchhash", "file.md");
      const key2 = cache.generateCacheKey("content2", "patchhash", "file.md");
      expect(key1).not.toBe(key2);
    });

    test("generates different keys for different patches", () => {
      const cache = new BuildCache(outputDir);
      const key1 = cache.generateCacheKey("content", "patchhash1", "file.md");
      const key2 = cache.generateCacheKey("content", "patchhash2", "file.md");
      expect(key1).not.toBe(key2);
    });

    test("generates different keys for different file paths", () => {
      const cache = new BuildCache(outputDir);
      const key1 = cache.generateCacheKey("content", "patchhash", "file1.md");
      const key2 = cache.generateCacheKey("content", "patchhash", "file2.md");
      expect(key1).not.toBe(key2);
    });

    test("initializes cache directory", async () => {
      const cache = new BuildCache(outputDir);
      await cache.init();

      const cacheDir = join(outputDir, CACHE_DIR_NAME);
      const entries = await readdir(cacheDir);
      expect(entries).toBeDefined();
    });

    test("stores and retrieves cached content", async () => {
      const cache = new BuildCache(outputDir);
      await cache.init();

      const cacheKey = cache.generateCacheKey("source", "patches", "test.md");
      await cache.set(cacheKey, "output content", "sourcehash", "patcheshash");

      const cached = await cache.get(cacheKey);
      expect(cached).toBe("output content");
    });

    test("returns null for cache miss", async () => {
      const cache = new BuildCache(outputDir);
      await cache.init();

      const cached = await cache.get("nonexistent-key");
      expect(cached).toBeNull();
    });

    test("tracks cache hits and misses", async () => {
      const cache = new BuildCache(outputDir);
      await cache.init();

      const key = cache.generateCacheKey("source", "patches", "test.md");
      await cache.set(key, "content", "sh", "ph");

      // One hit
      await cache.get(key);
      // One miss
      await cache.get("nonexistent");

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    test("checks cache entry existence", async () => {
      const cache = new BuildCache(outputDir);
      await cache.init();

      const key = cache.generateCacheKey("source", "patches", "test.md");
      expect(await cache.has(key)).toBe(false);

      await cache.set(key, "content", "sh", "ph");
      expect(await cache.has(key)).toBe(true);
    });

    test("clears all cache entries", async () => {
      const cache = new BuildCache(outputDir);
      await cache.init();

      // Add some entries
      const key1 = cache.generateCacheKey("s1", "p", "f1.md");
      const key2 = cache.generateCacheKey("s2", "p", "f2.md");
      await cache.set(key1, "c1", "sh1", "ph");
      await cache.set(key2, "c2", "sh2", "ph");

      const cleared = await cache.clear();
      expect(cleared).toBe(2);

      expect(await cache.has(key1)).toBe(false);
      expect(await cache.has(key2)).toBe(false);
    });

    test("reports cache size", async () => {
      const cache = new BuildCache(outputDir);
      await cache.init();

      // Empty cache
      let size = await cache.getSize();
      expect(size.entries).toBe(0);
      expect(size.totalBytes).toBe(0);

      // Add entries
      const key1 = cache.generateCacheKey("s1", "p", "f1.md");
      await cache.set(key1, "content here", "sh1", "ph");

      size = await cache.getSize();
      expect(size.entries).toBe(1);
      expect(size.totalBytes).toBeGreaterThan(0);
    });

    test("prunes old cache entries", async () => {
      const cache = new BuildCache(outputDir);
      await cache.init();

      // Add entry
      const key = cache.generateCacheKey("s", "p", "f.md");
      await cache.set(key, "content", "sh", "ph");

      // Prune with 0 maxAge (everything older than now)
      // Wait a tiny bit to ensure the entry is "old"
      await new Promise((resolve) => setTimeout(resolve, 10));
      const pruned = await cache.prune(1); // 1ms maxAge

      expect(pruned).toBe(1);
      expect(await cache.has(key)).toBe(false);
    });

    test("uses custom cache directory", async () => {
      const customCacheDir = join(tempDir, "custom-cache");
      const cache = new BuildCache(outputDir, customCacheDir);
      await cache.init();

      const key = cache.generateCacheKey("s", "p", "f.md");
      await cache.set(key, "content", "sh", "ph");

      // Verify it's in the custom location
      const entries = await readdir(customCacheDir);
      expect(entries.length).toBeGreaterThan(0);
    });
  });

  describe("calculatePatchesHashForCache", () => {
    test("generates consistent hash for same patches", () => {
      const patches = [
        { op: "replace", old: "foo", new: "bar" },
        { op: "remove-section", id: "test" },
      ];
      const hash1 = calculatePatchesHashForCache(patches);
      const hash2 = calculatePatchesHashForCache(patches);
      expect(hash1).toBe(hash2);
    });

    test("generates same hash regardless of patch order", () => {
      const patches1 = [
        { op: "replace", old: "a", new: "b" },
        { op: "replace", old: "c", new: "d" },
      ];
      const patches2 = [
        { op: "replace", old: "c", new: "d" },
        { op: "replace", old: "a", new: "b" },
      ];
      expect(calculatePatchesHashForCache(patches1)).toBe(
        calculatePatchesHashForCache(patches2)
      );
    });

    test("generates different hash for different patches", () => {
      const patches1 = [{ op: "replace", old: "foo", new: "bar" }];
      const patches2 = [{ op: "replace", old: "foo", new: "baz" }];
      expect(calculatePatchesHashForCache(patches1)).not.toBe(
        calculatePatchesHashForCache(patches2)
      );
    });
  });

  describe("formatBytes", () => {
    test("formats zero bytes", () => {
      expect(formatBytes(0)).toBe("0 B");
    });

    test("formats bytes", () => {
      expect(formatBytes(500)).toBe("500 B");
    });

    test("formats kilobytes", () => {
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(1536)).toBe("1.5 KB");
    });

    test("formats megabytes", () => {
      expect(formatBytes(1024 * 1024)).toBe("1 MB");
    });

    test("formats gigabytes", () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe("1 GB");
    });
  });
});
