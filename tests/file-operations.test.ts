import { describe, test, expect } from "bun:test";
import {
  applyFileOperations,
  applyFileOperationResults,
  isFileOperationPatch,
  type ResourceFile,
} from "../src/core/file-operations.js";
import type { Patch } from "../src/core/config.js";

describe("File Operations", () => {
  describe("isFileOperationPatch", () => {
    test("returns true for copy-file", () => {
      const patch: Patch = { op: "copy-file", src: "a.md", dest: "b.md" };
      expect(isFileOperationPatch(patch)).toBe(true);
    });

    test("returns true for rename-file", () => {
      const patch: Patch = { op: "rename-file", match: "*.md", rename: "doc.md" };
      expect(isFileOperationPatch(patch)).toBe(true);
    });

    test("returns true for delete-file", () => {
      const patch: Patch = { op: "delete-file", match: "*.md" };
      expect(isFileOperationPatch(patch)).toBe(true);
    });

    test("returns true for move-file", () => {
      const patch: Patch = { op: "move-file", match: "*.md", dest: "docs/" };
      expect(isFileOperationPatch(patch)).toBe(true);
    });

    test("returns false for content patches", () => {
      const patch: Patch = { op: "replace", old: "a", new: "b" };
      expect(isFileOperationPatch(patch)).toBe(false);
    });
  });

  describe("applyFileOperations", () => {
    describe("copy-file", () => {
      test("copies file to new destination", () => {
        const resources: ResourceFile[] = [
          { relativePath: "templates/header.md", content: "# Header" },
        ];
        const patches: Patch[] = [
          { op: "copy-file", src: "templates/header.md", dest: "shared/header.md" },
        ];

        const result = applyFileOperations(patches, resources);

        expect(result.addedFiles.get("shared/header.md")).toBe("# Header");
        expect(result.operationsApplied).toBe(1);
      });

      test("warns when source file not found", () => {
        const resources: ResourceFile[] = [];
        const patches: Patch[] = [
          { op: "copy-file", src: "missing.md", dest: "copy.md" },
        ];

        const result = applyFileOperations(patches, resources);

        expect(result.addedFiles.size).toBe(0);
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0]).toContain("not found");
      });
    });

    describe("rename-file", () => {
      test("renames files matching pattern", () => {
        const resources: ResourceFile[] = [
          { relativePath: "skills/SKILL.md", content: "# Skill" },
          { relativePath: "other/README.md", content: "# Readme" },
        ];
        const patches: Patch[] = [
          { op: "rename-file", match: "**/SKILL.md", rename: "skill.md" },
        ];

        const result = applyFileOperations(patches, resources);

        expect(result.renamedFiles.get("skills/SKILL.md")).toBe("skills/skill.md");
        expect(result.renamedFiles.has("other/README.md")).toBe(false);
        expect(result.operationsApplied).toBe(1);
      });

      test("warns when no files match", () => {
        const resources: ResourceFile[] = [
          { relativePath: "file.txt", content: "text" },
        ];
        const patches: Patch[] = [
          { op: "rename-file", match: "*.md", rename: "doc.md" },
        ];

        const result = applyFileOperations(patches, resources);

        expect(result.renamedFiles.size).toBe(0);
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0]).toContain("No files matched");
      });
    });

    describe("delete-file", () => {
      test("marks files for deletion", () => {
        const resources: ResourceFile[] = [
          { relativePath: "DEPRECATED-old.md", content: "old" },
          { relativePath: "keep.md", content: "keep" },
        ];
        const patches: Patch[] = [
          { op: "delete-file", match: "**/DEPRECATED-*.md" },
        ];

        const result = applyFileOperations(patches, resources);

        expect(result.deletedFiles.has("DEPRECATED-old.md")).toBe(true);
        expect(result.deletedFiles.has("keep.md")).toBe(false);
        expect(result.operationsApplied).toBe(1);
      });

      test("deletes multiple matching files", () => {
        const resources: ResourceFile[] = [
          { relativePath: "a.tmp", content: "a" },
          { relativePath: "b.tmp", content: "b" },
          { relativePath: "c.md", content: "c" },
        ];
        const patches: Patch[] = [
          { op: "delete-file", match: "*.tmp" },
        ];

        const result = applyFileOperations(patches, resources);

        expect(result.deletedFiles.has("a.tmp")).toBe(true);
        expect(result.deletedFiles.has("b.tmp")).toBe(true);
        expect(result.deletedFiles.size).toBe(2);
      });

      test("warns when no files match", () => {
        const resources: ResourceFile[] = [];
        const patches: Patch[] = [
          { op: "delete-file", match: "*.md" },
        ];

        const result = applyFileOperations(patches, resources);

        expect(result.deletedFiles.size).toBe(0);
        expect(result.warnings.length).toBe(1);
      });
    });

    describe("move-file", () => {
      test("moves files to new directory", () => {
        const resources: ResourceFile[] = [
          { relativePath: "old/references/doc.md", content: "doc" },
        ];
        const patches: Patch[] = [
          { op: "move-file", match: "**/references/*.md", dest: "docs/references/" },
        ];

        const result = applyFileOperations(patches, resources);

        expect(result.renamedFiles.get("old/references/doc.md")).toBe("docs/references/doc.md");
        expect(result.operationsApplied).toBe(1);
      });

      test("handles dest without trailing slash", () => {
        const resources: ResourceFile[] = [
          { relativePath: "src/file.md", content: "content" },
        ];
        const patches: Patch[] = [
          { op: "move-file", match: "src/*.md", dest: "dest" },
        ];

        const result = applyFileOperations(patches, resources);

        expect(result.renamedFiles.get("src/file.md")).toBe("dest/file.md");
      });

      test("warns when no files match", () => {
        const resources: ResourceFile[] = [];
        const patches: Patch[] = [
          { op: "move-file", match: "*.md", dest: "docs/" },
        ];

        const result = applyFileOperations(patches, resources);

        expect(result.renamedFiles.size).toBe(0);
        expect(result.warnings.length).toBe(1);
      });
    });
  });

  describe("applyFileOperationResults", () => {
    test("removes deleted files", () => {
      const resources: ResourceFile[] = [
        { relativePath: "keep.md", content: "keep" },
        { relativePath: "delete.md", content: "delete" },
      ];

      const operations = {
        addedFiles: new Map(),
        deletedFiles: new Set(["delete.md"]),
        renamedFiles: new Map(),
        warnings: [],
        operationsApplied: 1,
      };

      const result = applyFileOperationResults(resources, operations);

      expect(result.length).toBe(1);
      expect(result[0].relativePath).toBe("keep.md");
    });

    test("renames files", () => {
      const resources: ResourceFile[] = [
        { relativePath: "old.md", content: "content" },
      ];

      const operations = {
        addedFiles: new Map(),
        deletedFiles: new Set<string>(),
        renamedFiles: new Map([["old.md", "new.md"]]),
        warnings: [],
        operationsApplied: 1,
      };

      const result = applyFileOperationResults(resources, operations);

      expect(result.length).toBe(1);
      expect(result[0].relativePath).toBe("new.md");
      expect(result[0].content).toBe("content");
    });

    test("adds copied files", () => {
      const resources: ResourceFile[] = [
        { relativePath: "original.md", content: "original" },
      ];

      const operations = {
        addedFiles: new Map([["copy.md", "original"]]),
        deletedFiles: new Set<string>(),
        renamedFiles: new Map<string, string>(),
        warnings: [],
        operationsApplied: 1,
      };

      const result = applyFileOperationResults(resources, operations);

      expect(result.length).toBe(2);
      expect(result.find(r => r.relativePath === "original.md")).toBeDefined();
      expect(result.find(r => r.relativePath === "copy.md")).toBeDefined();
    });

    test("handles multiple operations", () => {
      const resources: ResourceFile[] = [
        { relativePath: "delete-me.md", content: "delete" },
        { relativePath: "rename-me.md", content: "rename" },
        { relativePath: "keep.md", content: "keep" },
      ];

      const operations = {
        addedFiles: new Map([["added.md", "new content"]]),
        deletedFiles: new Set(["delete-me.md"]),
        renamedFiles: new Map([["rename-me.md", "renamed.md"]]),
        warnings: [],
        operationsApplied: 3,
      };

      const result = applyFileOperationResults(resources, operations);

      expect(result.length).toBe(3);
      expect(result.find(r => r.relativePath === "delete-me.md")).toBeUndefined();
      expect(result.find(r => r.relativePath === "renamed.md")).toBeDefined();
      expect(result.find(r => r.relativePath === "keep.md")).toBeDefined();
      expect(result.find(r => r.relativePath === "added.md")).toBeDefined();
    });
  });

  describe("integration with content patches", () => {
    test("file operations don't count as content patches", () => {
      const resources: ResourceFile[] = [
        { relativePath: "file.md", content: "# Content" },
      ];
      const patches: Patch[] = [
        { op: "copy-file", src: "file.md", dest: "copy.md" },
        { op: "replace", old: "Content", new: "New Content" },
      ];

      const fileOpsResult = applyFileOperations(patches, resources);

      // Only copy-file should be counted as file operation
      expect(fileOpsResult.operationsApplied).toBe(1);
      expect(fileOpsResult.addedFiles.size).toBe(1);
    });
  });
});
