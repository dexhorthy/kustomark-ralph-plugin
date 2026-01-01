import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { explainConfig, explainFile } from "../src/core/explain.js";

describe("Explain", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "kustomark-explain-test-"));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("explainConfig", () => {
    test("returns config info for simple config", async () => {
      const baseDir = join(testDir, "simple");
      await mkdir(baseDir, { recursive: true });

      await writeFile(join(baseDir, "doc.md"), "# Doc\n\nContent.\n");
      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ./output
resources:
  - "*.md"
patches:
  - op: replace
    old: foo
    new: bar
`
      );

      const result = await explainConfig(join(baseDir, "kustomark.yaml"));

      expect(result.output).toBe("./output");
      expect(result.chain.length).toBeGreaterThan(0);
      expect(result.totalPatches).toBe(1);
    });

    test("returns chain for nested configs", async () => {
      const baseDir = join(testDir, "base");
      const overlayDir = join(testDir, "overlay");
      await mkdir(baseDir, { recursive: true });
      await mkdir(overlayDir, { recursive: true });

      // Base config
      await writeFile(join(baseDir, "doc.md"), "# Doc\n\nContent.\n");
      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ./output
resources:
  - "*.md"
patches:
  - op: replace
    old: foo
    new: bar
`
      );

      // Overlay config
      await writeFile(
        join(overlayDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ./output
resources:
  - ../base/
patches:
  - op: replace
    old: baz
    new: qux
`
      );

      const result = await explainConfig(join(overlayDir, "kustomark.yaml"));

      expect(result.chain.length).toBe(2);
      expect(result.totalPatches).toBe(2);
    });

    test("handles config without patches", async () => {
      const baseDir = join(testDir, "no-patches");
      await mkdir(baseDir, { recursive: true });

      await writeFile(join(baseDir, "doc.md"), "# Doc\n");
      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ./output
resources:
  - "*.md"
`
      );

      const result = await explainConfig(join(baseDir, "kustomark.yaml"));

      expect(result.totalPatches).toBe(0);
    });
  });

  describe("explainFile", () => {
    test("returns patches that apply to specific file", async () => {
      const baseDir = join(testDir, "file-explain");
      await mkdir(baseDir, { recursive: true });

      await writeFile(join(baseDir, "doc.md"), "# Doc\n\nContent.\n");
      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ./output
resources:
  - "*.md"
patches:
  - op: replace
    old: foo
    new: bar
  - op: remove-section
    id: deprecated
`
      );

      const result = await explainFile(
        join(baseDir, "kustomark.yaml"),
        "doc.md"
      );

      expect(result.file).toBe("doc.md");
      expect(result.patches.length).toBe(2);
      expect(result.patches[0].op).toBe("replace");
      expect(result.patches[1].op).toBe("remove-section");
    });

    test("excludes patches that dont match file", async () => {
      const baseDir = join(testDir, "file-exclude");
      await mkdir(baseDir, { recursive: true });

      await writeFile(join(baseDir, "doc.md"), "# Doc\n");
      await writeFile(join(baseDir, "other.md"), "# Other\n");
      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ./output
resources:
  - "*.md"
patches:
  - op: replace
    old: foo
    new: bar
    include:
      - "doc.md"
  - op: replace
    old: baz
    new: qux
    include:
      - "other.md"
`
      );

      const result = await explainFile(
        join(baseDir, "kustomark.yaml"),
        "doc.md"
      );

      expect(result.patches.length).toBe(1);
      expect(result.patches[0].old).toBe("foo");
    });

    test("includes patch details in result", async () => {
      const baseDir = join(testDir, "patch-details");
      await mkdir(baseDir, { recursive: true });

      await writeFile(join(baseDir, "doc.md"), "# Doc\n");
      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ./output
resources:
  - "*.md"
patches:
  - op: replace
    old: foo
    new: bar
  - op: set-frontmatter
    key: title
    value: New Title
`
      );

      const result = await explainFile(
        join(baseDir, "kustomark.yaml"),
        "doc.md"
      );

      expect(result.patches[0].op).toBe("replace");
      expect(result.patches[0].old).toBe("foo");
      expect(result.patches[0].new).toBe("bar");

      expect(result.patches[1].op).toBe("set-frontmatter");
      expect(result.patches[1].key).toBe("title");
      expect(result.patches[1].value).toBe("New Title");
    });
  });
});
