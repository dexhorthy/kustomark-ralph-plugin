import { describe, test, expect } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  readLockFile,
  writeLockFile,
  calculateIntegrity,
  calculateFilesIntegrity,
  verifyIntegrity,
  findLockedResource,
  createLockedResource,
  updateLockFile,
  removeFromLockFile,
  createEmptyLockFile,
  getLockFilePath,
  LOCK_FILE_NAME,
  type LockFile,
  type LockedResource,
} from "../src/core/lockfile.js";

describe("Lock File", () => {
  describe("getLockFilePath", () => {
    test("returns lock file path in same directory as config", () => {
      const lockPath = getLockFilePath("/path/to/kustomark.yaml");
      expect(lockPath).toBe(`/path/to/${LOCK_FILE_NAME}`);
    });

    test("handles nested config paths", () => {
      const lockPath = getLockFilePath("/a/b/c/kustomark.yaml");
      expect(lockPath).toBe(`/a/b/c/${LOCK_FILE_NAME}`);
    });
  });

  describe("calculateIntegrity", () => {
    test("calculates SHA256 hash for string content", () => {
      const hash = calculateIntegrity("hello world");
      expect(hash).toMatch(/^sha256-[a-f0-9]{64}$/);
    });

    test("returns consistent hash for same content", () => {
      const hash1 = calculateIntegrity("test content");
      const hash2 = calculateIntegrity("test content");
      expect(hash1).toBe(hash2);
    });

    test("returns different hash for different content", () => {
      const hash1 = calculateIntegrity("content a");
      const hash2 = calculateIntegrity("content b");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("calculateFilesIntegrity", () => {
    test("calculates integrity for multiple files", () => {
      const files = [
        { relativePath: "a.md", content: "content a" },
        { relativePath: "b.md", content: "content b" },
      ];
      const hash = calculateFilesIntegrity(files);
      expect(hash).toMatch(/^sha256-[a-f0-9]{64}$/);
    });

    test("returns consistent hash regardless of file order", () => {
      const files1 = [
        { relativePath: "a.md", content: "content a" },
        { relativePath: "b.md", content: "content b" },
      ];
      const files2 = [
        { relativePath: "b.md", content: "content b" },
        { relativePath: "a.md", content: "content a" },
      ];
      expect(calculateFilesIntegrity(files1)).toBe(calculateFilesIntegrity(files2));
    });

    test("returns different hash for different file content", () => {
      const files1 = [{ relativePath: "a.md", content: "original" }];
      const files2 = [{ relativePath: "a.md", content: "modified" }];
      expect(calculateFilesIntegrity(files1)).not.toBe(calculateFilesIntegrity(files2));
    });

    test("returns different hash for different file paths", () => {
      const files1 = [{ relativePath: "a.md", content: "same" }];
      const files2 = [{ relativePath: "b.md", content: "same" }];
      expect(calculateFilesIntegrity(files1)).not.toBe(calculateFilesIntegrity(files2));
    });
  });

  describe("createLockedResource", () => {
    test("creates locked resource with correct fields", () => {
      const files = [{ relativePath: "test.md", content: "test" }];
      const resource = createLockedResource(
        "github.com/org/repo//path?ref=v1.0.0",
        "abc123def456",
        files
      );

      expect(resource.url).toBe("github.com/org/repo//path?ref=v1.0.0");
      expect(resource.resolved).toBe("abc123def456");
      expect(resource.integrity).toMatch(/^sha256-/);
      expect(resource.fetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("verifyIntegrity", () => {
    test("returns true when integrity matches", () => {
      const files = [{ relativePath: "test.md", content: "test content" }];
      const resource = createLockedResource("test-url", "ref", files);

      expect(verifyIntegrity(files, resource)).toBe(true);
    });

    test("returns false when content has changed", () => {
      const originalFiles = [{ relativePath: "test.md", content: "original" }];
      const resource = createLockedResource("test-url", "ref", originalFiles);

      const modifiedFiles = [{ relativePath: "test.md", content: "modified" }];
      expect(verifyIntegrity(modifiedFiles, resource)).toBe(false);
    });
  });

  describe("createEmptyLockFile", () => {
    test("creates lock file with version 1 and empty resources", () => {
      const lockFile = createEmptyLockFile();
      expect(lockFile.version).toBe(1);
      expect(lockFile.resources).toEqual([]);
    });
  });

  describe("findLockedResource", () => {
    test("finds resource by URL", () => {
      const lockFile: LockFile = {
        version: 1,
        resources: [
          { url: "url-1", resolved: "ref-1", integrity: "sha256-abc", fetched: "2024-01-01" },
          { url: "url-2", resolved: "ref-2", integrity: "sha256-def", fetched: "2024-01-02" },
        ],
      };

      const found = findLockedResource(lockFile, "url-1");
      expect(found?.resolved).toBe("ref-1");
    });

    test("returns undefined for non-existent URL", () => {
      const lockFile: LockFile = {
        version: 1,
        resources: [
          { url: "url-1", resolved: "ref-1", integrity: "sha256-abc", fetched: "2024-01-01" },
        ],
      };

      const found = findLockedResource(lockFile, "non-existent");
      expect(found).toBeUndefined();
    });
  });

  describe("updateLockFile", () => {
    test("creates new lock file when given null", () => {
      const resource: LockedResource = {
        url: "test-url",
        resolved: "ref",
        integrity: "sha256-abc",
        fetched: "2024-01-01",
      };

      const lockFile = updateLockFile(null, resource);

      expect(lockFile.version).toBe(1);
      expect(lockFile.resources.length).toBe(1);
      expect(lockFile.resources[0].url).toBe("test-url");
    });

    test("adds new resource to existing lock file", () => {
      const existing: LockFile = {
        version: 1,
        resources: [
          { url: "url-1", resolved: "ref-1", integrity: "sha256-abc", fetched: "2024-01-01" },
        ],
      };
      const newResource: LockedResource = {
        url: "url-2",
        resolved: "ref-2",
        integrity: "sha256-def",
        fetched: "2024-01-02",
      };

      const updated = updateLockFile(existing, newResource);

      expect(updated.resources.length).toBe(2);
    });

    test("updates existing resource with same URL", () => {
      const existing: LockFile = {
        version: 1,
        resources: [
          { url: "url-1", resolved: "old-ref", integrity: "sha256-old", fetched: "2024-01-01" },
        ],
      };
      const updatedResource: LockedResource = {
        url: "url-1",
        resolved: "new-ref",
        integrity: "sha256-new",
        fetched: "2024-01-02",
      };

      const updated = updateLockFile(existing, updatedResource);

      expect(updated.resources.length).toBe(1);
      expect(updated.resources[0].resolved).toBe("new-ref");
    });
  });

  describe("removeFromLockFile", () => {
    test("removes resource by URL", () => {
      const lockFile: LockFile = {
        version: 1,
        resources: [
          { url: "url-1", resolved: "ref-1", integrity: "sha256-abc", fetched: "2024-01-01" },
          { url: "url-2", resolved: "ref-2", integrity: "sha256-def", fetched: "2024-01-02" },
        ],
      };

      const updated = removeFromLockFile(lockFile, "url-1");

      expect(updated.resources.length).toBe(1);
      expect(updated.resources[0].url).toBe("url-2");
    });

    test("keeps lock file unchanged when URL not found", () => {
      const lockFile: LockFile = {
        version: 1,
        resources: [
          { url: "url-1", resolved: "ref-1", integrity: "sha256-abc", fetched: "2024-01-01" },
        ],
      };

      const updated = removeFromLockFile(lockFile, "non-existent");

      expect(updated.resources.length).toBe(1);
    });
  });

  describe("readLockFile and writeLockFile", () => {
    const testDir = join(tmpdir(), `kustomark-lockfile-test-${Date.now()}`);

    test("reads and writes lock file correctly", async () => {
      await mkdir(testDir, { recursive: true });
      const lockFilePath = join(testDir, LOCK_FILE_NAME);

      const lockFile: LockFile = {
        version: 1,
        resources: [
          {
            url: "github.com/org/repo//path?ref=v1.0.0",
            resolved: "abc123def456",
            integrity: "sha256-abcdef123456",
            fetched: "2024-01-15T10:30:00.000Z",
          },
        ],
      };

      await writeLockFile(lockFilePath, lockFile);
      const read = await readLockFile(lockFilePath);

      expect(read).not.toBeNull();
      expect(read?.version).toBe(1);
      expect(read?.resources.length).toBe(1);
      expect(read?.resources[0].url).toBe("github.com/org/repo//path?ref=v1.0.0");
      expect(read?.resources[0].resolved).toBe("abc123def456");

      // Cleanup
      await rm(testDir, { recursive: true });
    });

    test("returns null for non-existent file", async () => {
      const result = await readLockFile("/non/existent/path/kustomark.lock.yaml");
      expect(result).toBeNull();
    });

    test("returns null for invalid YAML", async () => {
      await mkdir(testDir, { recursive: true });
      const lockFilePath = join(testDir, "invalid.lock.yaml");
      await writeFile(lockFilePath, "invalid: yaml: content: [", "utf-8");

      const result = await readLockFile(lockFilePath);
      expect(result).toBeNull();

      // Cleanup
      await rm(testDir, { recursive: true });
    });

    test("returns null for wrong schema version", async () => {
      await mkdir(testDir, { recursive: true });
      const lockFilePath = join(testDir, "wrong-version.lock.yaml");
      await writeFile(lockFilePath, "version: 2\nresources: []", "utf-8");

      const result = await readLockFile(lockFilePath);
      expect(result).toBeNull();

      // Cleanup
      await rm(testDir, { recursive: true });
    });
  });
});
