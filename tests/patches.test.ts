import { describe, test, expect } from "bun:test";
import { applyPatches } from "../src/core/patches.js";
import type { Patch } from "../src/core/config.js";

describe("Patch Operations", () => {
  describe("replace", () => {
    test("replaces all occurrences", () => {
      const content = "foo bar foo baz foo";
      const patches: Patch[] = [{ op: "replace", old: "foo", new: "qux" }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toBe("qux bar qux baz qux");
      expect(result.applied).toBe(1);
    });

    test("handles no match with warning", () => {
      const content = "hello world";
      const patches: Patch[] = [{ op: "replace", old: "foo", new: "bar" }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toBe("hello world");
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("replace-regex", () => {
    test("applies regex replacement with capture groups", () => {
      const content = "version 1.2.3";
      const patches: Patch[] = [{
        op: "replace-regex",
        pattern: "version (\\d+\\.\\d+\\.\\d+)",
        replacement: "v$1",
        flags: "g"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toBe("v1.2.3");
    });

    test("respects case-insensitive flag", () => {
      const content = "Hello HELLO hello";
      const patches: Patch[] = [{
        op: "replace-regex",
        pattern: "hello",
        replacement: "hi",
        flags: "gi"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toBe("hi hi hi");
    });
  });

  describe("remove-section", () => {
    test("removes section by slug", () => {
      const content = `# Main

Content

## Deprecated

Old content

## Keep

Keep this`;
      const patches: Patch[] = [{
        op: "remove-section",
        id: "deprecated",
        includeChildren: true
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).not.toContain("Deprecated");
      expect(result.content).not.toContain("Old content");
      expect(result.content).toContain("Keep this");
    });

    test("handles custom id syntax", () => {
      const content = `# Main

## Custom Section {#my-id}

Content here

## Another`;
      const patches: Patch[] = [{
        op: "remove-section",
        id: "my-id",
        includeChildren: true
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).not.toContain("Custom Section");
      expect(result.content).not.toContain("Content here");
      expect(result.content).toContain("Another");
    });
  });

  describe("prepend-to-section", () => {
    test("adds content at section start", () => {
      const content = `# Main

## Steps

Step 1
Step 2`;
      const patches: Patch[] = [{
        op: "prepend-to-section",
        id: "steps",
        content: "**Prerequisites**: Setup first."
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("**Prerequisites**: Setup first.");
      const prereqIndex = result.content.indexOf("Prerequisites");
      const step1Index = result.content.indexOf("Step 1");
      expect(prereqIndex).toBeLessThan(step1Index);
    });
  });

  describe("append-to-section", () => {
    test("adds content at section end", () => {
      const content = `# Main

## Steps

Step 1
Step 2

## Next`;
      const patches: Patch[] = [{
        op: "append-to-section",
        id: "steps",
        content: "Step 3"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("Step 3");
      const step3Index = result.content.indexOf("Step 3");
      const nextIndex = result.content.indexOf("## Next");
      expect(step3Index).toBeLessThan(nextIndex);
    });
  });

  describe("include/exclude filters", () => {
    test("applies patch only to included files", () => {
      const content = "foo";
      const patches: Patch[] = [{
        op: "replace",
        old: "foo",
        new: "bar",
        include: ["docs/*.md"]
      }];

      // File doesn't match include pattern
      const result1 = applyPatches(content, patches, "readme.md");
      expect(result1.content).toBe("foo");

      // File matches include pattern
      const result2 = applyPatches(content, patches, "docs/guide.md");
      expect(result2.content).toBe("bar");
    });

    test("excludes files matching exclude pattern", () => {
      const content = "foo";
      const patches: Patch[] = [{
        op: "replace",
        old: "foo",
        new: "bar",
        exclude: ["**/README.md"]
      }];

      // File matches exclude pattern
      const result1 = applyPatches(content, patches, "README.md");
      expect(result1.content).toBe("foo");

      // File doesn't match exclude pattern
      const result2 = applyPatches(content, patches, "guide.md");
      expect(result2.content).toBe("bar");
    });
  });
});
