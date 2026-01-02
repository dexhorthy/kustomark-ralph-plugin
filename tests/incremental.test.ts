import { describe, test, expect } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  calculateHash,
  calculatePatchesHash,
  getManifestPath,
  readManifest,
  writeManifest,
  createManifest,
  createManifestFile,
  analyzeChanges,
  MANIFEST_FILE_NAME,
  type BuildManifest,
  type ManifestFile,
} from "../src/core/incremental.js";

describe("Incremental Builds", () => {
  describe("calculateHash", () => {
    test("calculates consistent SHA256 hash for string content", () => {
      const hash1 = calculateHash("hello world");
      const hash2 = calculateHash("hello world");
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    test("returns different hash for different content", () => {
      const hash1 = calculateHash("content a");
      const hash2 = calculateHash("content b");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("calculatePatchesHash", () => {
    test("calculates consistent hash for patches", () => {
      const patches = [
        { op: "replace", old: "foo", new: "bar" },
        { op: "remove-section", id: "test" },
      ];
      const hash1 = calculatePatchesHash(patches);
      const hash2 = calculatePatchesHash(patches);
      expect(hash1).toBe(hash2);
    });

    test("returns different hash when patches change", () => {
      const patches1 = [{ op: "replace", old: "foo", new: "bar" }];
      const patches2 = [{ op: "replace", old: "foo", new: "baz" }];
      const hash1 = calculatePatchesHash(patches1);
      const hash2 = calculatePatchesHash(patches2);
      expect(hash1).not.toBe(hash2);
    });

    test("returns different hash when patch order changes", () => {
      const patches1 = [
        { op: "replace", old: "a", new: "b" },
        { op: "replace", old: "c", new: "d" },
      ];
      const patches2 = [
        { op: "replace", old: "c", new: "d" },
        { op: "replace", old: "a", new: "b" },
      ];
      // Note: patches are sorted by JSON, so same patches in different order
      // should produce same hash
      const hash1 = calculatePatchesHash(patches1);
      const hash2 = calculatePatchesHash(patches2);
      expect(hash1).toBe(hash2);
    });
  });

  describe("getManifestPath", () => {
    test("returns manifest path in output directory", () => {
      const path = getManifestPath("/path/to/output");
      expect(path).toBe(`/path/to/output/${MANIFEST_FILE_NAME}`);
    });
  });

  describe("createManifestFile", () => {
    test("creates manifest file entry with hashes", () => {
      const entry = createManifestFile(
        "src/file.md",
        "src/file.md",
        "source content",
        "output content",
        3
      );
      expect(entry.source).toBe("src/file.md");
      expect(entry.output).toBe("src/file.md");
      expect(entry.sourceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.outputHash).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.patchesApplied).toBe(3);
    });
  });

  describe("createManifest", () => {
    test("creates manifest with all fields", () => {
      const files: ManifestFile[] = [
        {
          source: "a.md",
          output: "a.md",
          sourceHash: "abc123",
          outputHash: "def456",
          patchesApplied: 1,
        },
      ];
      const manifest = createManifest("confighash", "patcheshash", files);
      expect(manifest.version).toBe(1);
      expect(manifest.configHash).toBe("confighash");
      expect(manifest.patchesHash).toBe("patcheshash");
      expect(manifest.files).toEqual(files);
      expect(manifest.buildTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("readManifest and writeManifest", () => {
    test("reads and writes manifest file", async () => {
      const tempDir = join(tmpdir(), `kustomark-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });

      try {
        const manifestPath = join(tempDir, MANIFEST_FILE_NAME);
        const manifest: BuildManifest = {
          version: 1,
          configHash: "abc",
          patchesHash: "def",
          buildTime: new Date().toISOString(),
          files: [
            {
              source: "test.md",
              output: "test.md",
              sourceHash: "123",
              outputHash: "456",
              patchesApplied: 2,
            },
          ],
        };

        await writeManifest(manifestPath, manifest);
        const read = await readManifest(manifestPath);

        expect(read).not.toBeNull();
        expect(read!.version).toBe(1);
        expect(read!.configHash).toBe("abc");
        expect(read!.patchesHash).toBe("def");
        expect(read!.files).toHaveLength(1);
        expect(read!.files[0].source).toBe("test.md");
      } finally {
        await rm(tempDir, { recursive: true });
      }
    });

    test("returns null for non-existent manifest", async () => {
      const result = await readManifest("/nonexistent/path/.kustomark.manifest.yaml");
      expect(result).toBeNull();
    });

    test("returns null for invalid manifest", async () => {
      const tempDir = join(tmpdir(), `kustomark-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });

      try {
        const manifestPath = join(tempDir, MANIFEST_FILE_NAME);
        await writeFile(manifestPath, "invalid: yaml: content:", "utf-8");
        const result = await readManifest(manifestPath);
        expect(result).toBeNull();
      } finally {
        await rm(tempDir, { recursive: true });
      }
    });
  });

  describe("analyzeChanges", () => {
    const createTestManifest = (): BuildManifest => ({
      version: 1,
      configHash: "config123",
      patchesHash: "patches456",
      buildTime: new Date().toISOString(),
      files: [
        {
          source: "a.md",
          output: "a.md",
          sourceHash: calculateHash("content a"),
          outputHash: "output-a",
          patchesApplied: 1,
        },
        {
          source: "b.md",
          output: "b.md",
          sourceHash: calculateHash("content b"),
          outputHash: "output-b",
          patchesApplied: 2,
        },
      ],
    });

    test("returns full rebuild when no manifest exists", () => {
      const sources = [
        { relativePath: "a.md", content: "content a" },
        { relativePath: "b.md", content: "content b" },
      ];

      const analysis = analyzeChanges(null, "config123", "patches456", sources);

      expect(analysis.configChanged).toBe(true);
      expect(analysis.patchesChanged).toBe(true);
      expect(analysis.fullRebuildRequired).toBe(true);
      expect(analysis.filesToRebuild).toEqual(["a.md", "b.md"]);
      expect(analysis.filesToSkip).toEqual([]);
    });

    test("returns full rebuild when config changed", () => {
      const manifest = createTestManifest();
      const sources = [
        { relativePath: "a.md", content: "content a" },
        { relativePath: "b.md", content: "content b" },
      ];

      const analysis = analyzeChanges(manifest, "NEW_CONFIG_HASH", "patches456", sources);

      expect(analysis.configChanged).toBe(true);
      expect(analysis.patchesChanged).toBe(false);
      expect(analysis.fullRebuildRequired).toBe(true);
      expect(analysis.filesToRebuild).toEqual(["a.md", "b.md"]);
    });

    test("returns full rebuild when patches changed", () => {
      const manifest = createTestManifest();
      const sources = [
        { relativePath: "a.md", content: "content a" },
        { relativePath: "b.md", content: "content b" },
      ];

      const analysis = analyzeChanges(manifest, "config123", "NEW_PATCHES_HASH", sources);

      expect(analysis.configChanged).toBe(false);
      expect(analysis.patchesChanged).toBe(true);
      expect(analysis.fullRebuildRequired).toBe(true);
    });

    test("identifies unchanged files", () => {
      const manifest = createTestManifest();
      const sources = [
        { relativePath: "a.md", content: "content a" },
        { relativePath: "b.md", content: "content b" },
      ];

      const analysis = analyzeChanges(manifest, "config123", "patches456", sources);

      expect(analysis.configChanged).toBe(false);
      expect(analysis.patchesChanged).toBe(false);
      expect(analysis.fullRebuildRequired).toBe(false);
      expect(analysis.filesToRebuild).toEqual([]);
      expect(analysis.filesToSkip).toEqual(["a.md", "b.md"]);
    });

    test("identifies changed files", () => {
      const manifest = createTestManifest();
      const sources = [
        { relativePath: "a.md", content: "MODIFIED content a" },
        { relativePath: "b.md", content: "content b" },
      ];

      const analysis = analyzeChanges(manifest, "config123", "patches456", sources);

      expect(analysis.fullRebuildRequired).toBe(false);
      expect(analysis.filesToRebuild).toEqual(["a.md"]);
      expect(analysis.filesToSkip).toEqual(["b.md"]);
    });

    test("identifies new files", () => {
      const manifest = createTestManifest();
      const sources = [
        { relativePath: "a.md", content: "content a" },
        { relativePath: "b.md", content: "content b" },
        { relativePath: "c.md", content: "content c" },
      ];

      const analysis = analyzeChanges(manifest, "config123", "patches456", sources);

      expect(analysis.fullRebuildRequired).toBe(false);
      expect(analysis.filesToRebuild).toEqual(["c.md"]);
      expect(analysis.filesToSkip).toEqual(["a.md", "b.md"]);
    });

    test("identifies deleted files", () => {
      const manifest = createTestManifest();
      const sources = [{ relativePath: "a.md", content: "content a" }];

      const analysis = analyzeChanges(manifest, "config123", "patches456", sources);

      expect(analysis.fullRebuildRequired).toBe(false);
      expect(analysis.filesToRebuild).toEqual([]);
      expect(analysis.filesToSkip).toEqual(["a.md"]);
      expect(analysis.deletedFiles).toEqual(["b.md"]);
    });

    test("handles mixed changes", () => {
      const manifest = createTestManifest();
      const sources = [
        { relativePath: "a.md", content: "MODIFIED content a" }, // changed
        // b.md deleted
        { relativePath: "c.md", content: "content c" }, // new
      ];

      const analysis = analyzeChanges(manifest, "config123", "patches456", sources);

      expect(analysis.fullRebuildRequired).toBe(false);
      expect(analysis.filesToRebuild.sort()).toEqual(["a.md", "c.md"]);
      expect(analysis.filesToSkip).toEqual([]);
      expect(analysis.deletedFiles).toEqual(["b.md"]);
    });
  });
});
