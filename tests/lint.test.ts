import { describe, test, expect } from "bun:test";
import { lintConfig } from "../src/core/lint.js";
import type { KustomarkConfig, Patch } from "../src/core/config.js";

describe("Lint", () => {
  const baseConfig: KustomarkConfig = {
    apiVersion: "kustomark/v1",
    kind: "Kustomization",
    output: "./output",
    resources: ["*.md"],
  };

  describe("checkUnreachablePatches", () => {
    test("warns when patch matches no files", () => {
      const config: KustomarkConfig = {
        ...baseConfig,
        patches: [
          {
            op: "replace",
            old: "foo",
            new: "bar",
            include: ["nonexistent/*.md"],
          } as Patch,
        ],
      };

      const resources = [
        { relativePath: "docs/readme.md", content: "# README" },
        { relativePath: "docs/guide.md", content: "# Guide" },
      ];

      const result = lintConfig(config, resources);
      expect(result.warningCount).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.message.includes("matches 0 files"))).toBe(true);
    });

    test("no warning when patch matches files", () => {
      const config: KustomarkConfig = {
        ...baseConfig,
        patches: [
          {
            op: "replace",
            old: "foo",
            new: "bar",
            include: ["docs/*.md"],
          } as Patch,
        ],
      };

      const resources = [
        { relativePath: "docs/readme.md", content: "# README" },
      ];

      const result = lintConfig(config, resources);
      const unreachableIssues = result.issues.filter((i) =>
        i.message.includes("matches 0 files")
      );
      expect(unreachableIssues.length).toBe(0);
    });

    test("no warning when no resources provided", () => {
      const config: KustomarkConfig = {
        ...baseConfig,
        patches: [
          {
            op: "replace",
            old: "foo",
            new: "bar",
            include: ["nonexistent/*.md"],
          } as Patch,
        ],
      };

      const result = lintConfig(config, []);
      const unreachableIssues = result.issues.filter((i) =>
        i.message.includes("matches 0 files")
      );
      expect(unreachableIssues.length).toBe(0);
    });
  });

  describe("checkRedundantPatches", () => {
    test("warns when same replace patch is used twice", () => {
      const config: KustomarkConfig = {
        ...baseConfig,
        patches: [
          { op: "replace", old: "foo", new: "bar" } as Patch,
          { op: "replace", old: "foo", new: "bar" } as Patch,
        ],
      };

      const result = lintConfig(config);
      expect(result.warningCount).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.message.includes("redundant"))).toBe(true);
    });

    test("no warning when patches are different", () => {
      const config: KustomarkConfig = {
        ...baseConfig,
        patches: [
          { op: "replace", old: "foo", new: "bar" } as Patch,
          { op: "replace", old: "baz", new: "qux" } as Patch,
        ],
      };

      const result = lintConfig(config);
      const redundantIssues = result.issues.filter((i) =>
        i.message.includes("redundant")
      );
      expect(redundantIssues.length).toBe(0);
    });

    test("no warning for same op on different file patterns", () => {
      const config: KustomarkConfig = {
        ...baseConfig,
        patches: [
          { op: "replace", old: "foo", new: "bar", include: ["docs/*.md"] } as Patch,
          { op: "replace", old: "foo", new: "bar", include: ["guides/*.md"] } as Patch,
        ],
      };

      const result = lintConfig(config);
      const redundantIssues = result.issues.filter((i) =>
        i.message.includes("redundant")
      );
      expect(redundantIssues.length).toBe(0);
    });
  });

  describe("checkOverlappingPatches", () => {
    test("warns when section is removed and also modified", () => {
      const config: KustomarkConfig = {
        ...baseConfig,
        patches: [
          { op: "remove-section", id: "intro" } as Patch,
          { op: "append-to-section", id: "intro", content: "More content" } as Patch,
        ],
      };

      const result = lintConfig(config);
      expect(result.warningCount).toBeGreaterThan(0);
      expect(
        result.issues.some((i) => i.message.includes("removed but also modified"))
      ).toBe(true);
    });

    test("warns when frontmatter key is both set and removed", () => {
      const config: KustomarkConfig = {
        ...baseConfig,
        patches: [
          { op: "set-frontmatter", key: "title", value: "New Title" } as Patch,
          { op: "remove-frontmatter", key: "title" } as Patch,
        ],
      };

      const result = lintConfig(config);
      expect(result.warningCount).toBeGreaterThan(0);
      expect(
        result.issues.some((i) => i.message.includes("both set and removed"))
      ).toBe(true);
    });

    test("info when frontmatter key is set multiple times", () => {
      const config: KustomarkConfig = {
        ...baseConfig,
        patches: [
          { op: "set-frontmatter", key: "title", value: "Title 1" } as Patch,
          { op: "set-frontmatter", key: "title", value: "Title 2" } as Patch,
        ],
      };

      const result = lintConfig(config);
      expect(result.infoCount).toBeGreaterThan(0);
      expect(
        result.issues.some((i) => i.message.includes("set multiple times"))
      ).toBe(true);
    });

    test("no issue when different sections are modified", () => {
      const config: KustomarkConfig = {
        ...baseConfig,
        patches: [
          { op: "remove-section", id: "intro" } as Patch,
          { op: "append-to-section", id: "outro", content: "More content" } as Patch,
        ],
      };

      const result = lintConfig(config);
      const overlapIssues = result.issues.filter(
        (i) =>
          i.message.includes("removed but also modified") ||
          i.message.includes("consider combining")
      );
      expect(overlapIssues.length).toBe(0);
    });
  });

  describe("lintConfig", () => {
    test("returns correct issue counts", () => {
      const config: KustomarkConfig = {
        ...baseConfig,
        patches: [
          { op: "replace", old: "foo", new: "bar" } as Patch,
          { op: "replace", old: "foo", new: "bar" } as Patch, // redundant
          { op: "set-frontmatter", key: "title", value: "A" } as Patch,
          { op: "set-frontmatter", key: "title", value: "B" } as Patch, // multiple sets - also detected as redundant
        ],
      };

      const result = lintConfig(config);
      // Both redundant patches are detected, plus the redundant set-frontmatter
      expect(result.warningCount).toBe(2); // both redundant patches
      expect(result.infoCount).toBe(1); // multiple sets
      expect(result.errorCount).toBe(0);
    });

    test("returns empty result for clean config", () => {
      const config: KustomarkConfig = {
        ...baseConfig,
        patches: [
          { op: "replace", old: "foo", new: "bar" } as Patch,
          { op: "replace", old: "baz", new: "qux" } as Patch,
        ],
      };

      const result = lintConfig(config, [
        { relativePath: "doc.md", content: "content" },
      ]);

      // The patches match the default **/* pattern
      expect(result.issues.length).toBe(0);
    });

    test("handles config without patches", () => {
      const config: KustomarkConfig = {
        ...baseConfig,
      };

      const result = lintConfig(config);
      expect(result.issues.length).toBe(0);
    });
  });
});
