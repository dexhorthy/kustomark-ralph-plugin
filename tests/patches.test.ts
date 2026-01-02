import { describe, test, expect } from "bun:test";
import { applyPatches, resolveExtends } from "../src/core/patches.js";
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

  describe("set-frontmatter", () => {
    test("adds frontmatter to file without existing frontmatter", () => {
      const content = `# Title

Some content`;
      const patches: Patch[] = [{
        op: "set-frontmatter",
        key: "version",
        value: "2.0"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("---");
      expect(result.content).toContain("version: \"2.0\"");
      expect(result.applied).toBe(1);
    });

    test("updates existing frontmatter key", () => {
      const content = `---
version: "1.0"
name: test
---

# Title`;
      const patches: Patch[] = [{
        op: "set-frontmatter",
        key: "version",
        value: "2.0"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("version: \"2.0\"");
      expect(result.content).toContain("name: test");
    });

    test("supports dot notation for nested keys", () => {
      const content = `---
name: test
---

# Title`;
      const patches: Patch[] = [{
        op: "set-frontmatter",
        key: "metadata.author",
        value: "kustomark"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("metadata:");
      expect(result.content).toContain("author: kustomark");
    });

    test("supports array values", () => {
      const content = `---
name: test
---

# Title`;
      const patches: Patch[] = [{
        op: "set-frontmatter",
        key: "tags",
        value: ["foo", "bar"]
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("tags:");
      expect(result.content).toContain("- foo");
      expect(result.content).toContain("- bar");
    });
  });

  describe("remove-frontmatter", () => {
    test("removes existing key", () => {
      const content = `---
version: "1.0"
deprecated: true
---

# Title`;
      const patches: Patch[] = [{
        op: "remove-frontmatter",
        key: "deprecated"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("version: \"1.0\"");
      expect(result.content).not.toContain("deprecated");
      expect(result.applied).toBe(1);
    });

    test("warns when key not found", () => {
      const content = `---
version: "1.0"
---

# Title`;
      const patches: Patch[] = [{
        op: "remove-frontmatter",
        key: "nonexistent"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.applied).toBe(0);
    });

    test("warns when no frontmatter exists", () => {
      const content = `# Title

Content`;
      const patches: Patch[] = [{
        op: "remove-frontmatter",
        key: "version"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.applied).toBe(0);
    });
  });

  describe("rename-frontmatter", () => {
    test("renames existing key", () => {
      const content = `---
name: "Test Skill"
version: "1.0"
---

# Title`;
      const patches: Patch[] = [{
        op: "rename-frontmatter",
        old: "name",
        new: "skill_name"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("skill_name: Test Skill");
      // Check that the original key "name" no longer exists as a top-level key
      expect(result.content).toMatch(/skill_name:/);
      expect(result.content).not.toMatch(/^name:/m);
      expect(result.applied).toBe(1);
    });

    test("warns when old key not found", () => {
      const content = `---
version: "1.0"
---

# Title`;
      const patches: Patch[] = [{
        op: "rename-frontmatter",
        old: "nonexistent",
        new: "new_key"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.applied).toBe(0);
    });
  });

  describe("merge-frontmatter", () => {
    test("merges values into existing frontmatter", () => {
      const content = `---
name: test
version: "1.0"
---

# Title`;
      const patches: Patch[] = [{
        op: "merge-frontmatter",
        values: {
          version: "2.0",
          tags: ["patched", "team"]
        }
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("name: test");
      expect(result.content).toContain("version: \"2.0\"");
      expect(result.content).toContain("tags:");
      expect(result.content).toContain("- patched");
      expect(result.applied).toBe(1);
    });

    test("creates frontmatter if none exists", () => {
      const content = `# Title

Content`;
      const patches: Patch[] = [{
        op: "merge-frontmatter",
        values: {
          version: "1.0",
          author: "test"
        }
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("---");
      expect(result.content).toContain("version: \"1.0\"");
      expect(result.content).toContain("author: test");
    });

    test("deep merges nested objects", () => {
      const content = `---
metadata:
  author: original
  date: "2024-01-01"
---

# Title`;
      const patches: Patch[] = [{
        op: "merge-frontmatter",
        values: {
          metadata: {
            author: "updated",
            version: "2.0"
          }
        }
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("author: updated");
      expect(result.content).toContain("date:");
      expect(result.content).toContain("version: \"2.0\"");
    });
  });

  describe("insert-after-line", () => {
    test("inserts content after matching line", () => {
      const content = `# Title

## Steps

Step 1
Step 2`;
      const patches: Patch[] = [{
        op: "insert-after-line",
        match: "## Steps",
        content: "**Prerequisites**: Setup required."
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("**Prerequisites**: Setup required.");
      const prereqIndex = result.content.indexOf("Prerequisites");
      const step1Index = result.content.indexOf("Step 1");
      expect(prereqIndex).toBeLessThan(step1Index);
      expect(result.applied).toBe(1);
    });

    test("supports regex pattern", () => {
      const content = `# Title

## Output

Content here`;
      const patches: Patch[] = [{
        op: "insert-after-line",
        pattern: "^##\\s+Output",
        content: "New line after output"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("New line after output");
      const newLineIndex = result.content.indexOf("New line after output");
      const contentIndex = result.content.indexOf("Content here");
      expect(newLineIndex).toBeLessThan(contentIndex);
    });

    test("warns when no match found", () => {
      const content = `# Title

Content`;
      const patches: Patch[] = [{
        op: "insert-after-line",
        match: "## Nonexistent",
        content: "New content"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.applied).toBe(0);
    });
  });

  describe("insert-before-line", () => {
    test("inserts content before matching line", () => {
      const content = `# Title

## Output

Output content`;
      const patches: Patch[] = [{
        op: "insert-before-line",
        match: "## Output",
        content: "## Validation\n\nCheck paths."
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("## Validation");
      const validationIndex = result.content.indexOf("## Validation");
      const outputIndex = result.content.indexOf("## Output");
      expect(validationIndex).toBeLessThan(outputIndex);
      expect(result.applied).toBe(1);
    });

    test("supports regex pattern with regex flag", () => {
      const content = `# Title

## Output

Content`;
      const patches: Patch[] = [{
        op: "insert-before-line",
        pattern: "^##\\s+Output",
        regex: true,
        content: "Inserted before"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("Inserted before");
    });
  });

  describe("replace-line", () => {
    test("replaces matching line", () => {
      const content = `# Title

old description line

More content`;
      const patches: Patch[] = [{
        op: "replace-line",
        match: "old description line",
        replacement: "new description line"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("new description line");
      expect(result.content).not.toContain("old description line");
      expect(result.applied).toBe(1);
    });

    test("supports regex pattern", () => {
      const content = `# Title

version: 1.0.0

Content`;
      const patches: Patch[] = [{
        op: "replace-line",
        pattern: "^version: \\d+\\.\\d+\\.\\d+$",
        replacement: "version: 2.0.0"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("version: 2.0.0");
      expect(result.content).not.toContain("version: 1.0.0");
    });

    test("warns when no match found", () => {
      const content = `# Title

Content`;
      const patches: Patch[] = [{
        op: "replace-line",
        match: "nonexistent line",
        replacement: "new line"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.applied).toBe(0);
    });
  });

  describe("delete-between", () => {
    test("deletes content between markers inclusive", () => {
      const content = `# Title

<!-- BEGIN -->
Content to delete
More content
<!-- END -->

Keep this`;
      const patches: Patch[] = [{
        op: "delete-between",
        start: "<!-- BEGIN -->",
        end: "<!-- END -->",
        inclusive: true
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).not.toContain("BEGIN");
      expect(result.content).not.toContain("Content to delete");
      expect(result.content).not.toContain("END");
      expect(result.content).toContain("Keep this");
      expect(result.applied).toBe(1);
    });

    test("deletes content between markers exclusive", () => {
      const content = `# Title

<!-- BEGIN -->
Content to delete
<!-- END -->

Keep this`;
      const patches: Patch[] = [{
        op: "delete-between",
        start: "<!-- BEGIN -->",
        end: "<!-- END -->",
        inclusive: false
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("BEGIN");
      expect(result.content).toContain("END");
      expect(result.content).not.toContain("Content to delete");
      expect(result.content).toContain("Keep this");
    });

    test("warns when markers not found", () => {
      const content = `# Title

Content`;
      const patches: Patch[] = [{
        op: "delete-between",
        start: "<!-- BEGIN -->",
        end: "<!-- END -->",
        inclusive: true
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.applied).toBe(0);
    });
  });

  describe("replace-between", () => {
    test("replaces content between markers exclusive", () => {
      const content = `# Title

<!-- CONFIG -->
old config
<!-- /CONFIG -->

Content`;
      const patches: Patch[] = [{
        op: "replace-between",
        start: "<!-- CONFIG -->",
        end: "<!-- /CONFIG -->",
        content: "new config",
        inclusive: false
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("<!-- CONFIG -->");
      expect(result.content).toContain("<!-- /CONFIG -->");
      expect(result.content).toContain("new config");
      expect(result.content).not.toContain("old config");
      expect(result.applied).toBe(1);
    });

    test("replaces content between markers inclusive", () => {
      const content = `# Title

<!-- CONFIG -->
old config
<!-- /CONFIG -->

Content`;
      const patches: Patch[] = [{
        op: "replace-between",
        start: "<!-- CONFIG -->",
        end: "<!-- /CONFIG -->",
        content: "completely new content",
        inclusive: true
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).not.toContain("<!-- CONFIG -->");
      expect(result.content).not.toContain("<!-- /CONFIG -->");
      expect(result.content).toContain("completely new content");
    });

    test("warns when markers not found", () => {
      const content = `# Title

Content`;
      const patches: Patch[] = [{
        op: "replace-between",
        start: "<!-- START -->",
        end: "<!-- END -->",
        content: "new content",
        inclusive: false
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.applied).toBe(0);
    });
  });

  describe("rename-header", () => {
    test("renames section header by id", () => {
      const content = `# Title

## Old Section Name

Content here

## Another Section`;
      const patches: Patch[] = [{
        op: "rename-header",
        id: "old-section-name",
        new: "New Section Name"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("## New Section Name");
      expect(result.content).not.toContain("## Old Section Name");
      expect(result.applied).toBe(1);
    });

    test("preserves header level when renaming", () => {
      const content = `# Title

### Deep Header

Content`;
      const patches: Patch[] = [{
        op: "rename-header",
        id: "deep-header",
        new: "Renamed Deep Header"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("### Renamed Deep Header");
    });

    test("warns when section not found", () => {
      const content = `# Title

## Section`;
      const patches: Patch[] = [{
        op: "rename-header",
        id: "nonexistent",
        new: "New Name"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.applied).toBe(0);
    });
  });

  describe("move-section", () => {
    test("moves section after another section", () => {
      const content = `# Title

## First

First content

## Second

Second content

## Third

Third content`;
      const patches: Patch[] = [{
        op: "move-section",
        id: "first",
        after: "second"
      }];

      const result = applyPatches(content, patches, "test.md");

      const secondIndex = result.content.indexOf("## Second");
      const firstIndex = result.content.indexOf("## First");
      expect(secondIndex).toBeLessThan(firstIndex);
      expect(result.applied).toBe(1);
    });

    test("moves section before another section", () => {
      const content = `# Title

## First

First content

## Second

Second content

## Third

Third content`;
      const patches: Patch[] = [{
        op: "move-section",
        id: "third",
        before: "first"
      }];

      const result = applyPatches(content, patches, "test.md");

      const thirdIndex = result.content.indexOf("## Third");
      const firstIndex = result.content.indexOf("## First");
      expect(thirdIndex).toBeLessThan(firstIndex);
    });

    test("warns when source section not found", () => {
      const content = `# Title

## Section`;
      const patches: Patch[] = [{
        op: "move-section",
        id: "nonexistent",
        after: "section"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.applied).toBe(0);
    });

    test("warns when target section not found", () => {
      const content = `# Title

## Section`;
      const patches: Patch[] = [{
        op: "move-section",
        id: "section",
        after: "nonexistent"
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.applied).toBe(0);
    });
  });

  describe("change-section-level", () => {
    test("promotes section level with negative delta", () => {
      const content = `# Title

### Subsection

Content`;
      const patches: Patch[] = [{
        op: "change-section-level",
        id: "subsection",
        delta: -1
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("## Subsection");
      expect(result.content).not.toContain("### Subsection");
      expect(result.applied).toBe(1);
    });

    test("demotes section level with positive delta", () => {
      const content = `# Title

## Section

Content`;
      const patches: Patch[] = [{
        op: "change-section-level",
        id: "section",
        delta: 1
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("### Section");
      // Use regex to ensure exactly ### (not ##)
      expect(result.content).toMatch(/^### Section$/m);
    });

    test("changes level of section and its children", () => {
      const content = `# Title

## Parent

Parent content

### Child

Child content

## Other`;
      const patches: Patch[] = [{
        op: "change-section-level",
        id: "parent",
        delta: 1
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.content).toContain("### Parent");
      expect(result.content).toContain("#### Child");
    });

    test("clamps level to valid range", () => {
      const content = `# Title

###### Deep

Content`;
      const patches: Patch[] = [{
        op: "change-section-level",
        id: "deep",
        delta: 5
      }];

      const result = applyPatches(content, patches, "test.md");

      // Should still be ###### (max level 6)
      expect(result.content).toContain("###### Deep");
    });

    test("warns when section not found", () => {
      const content = `# Title

## Section`;
      const patches: Patch[] = [{
        op: "change-section-level",
        id: "nonexistent",
        delta: 1
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.applied).toBe(0);
    });
  });

  describe("per-patch validation", () => {
    test("warns when notContains validation fails", () => {
      const content = `# Title

Contains rpi/ path here`;
      const patches: Patch[] = [{
        op: "replace",
        old: "old",
        new: "new",
        validate: {
          notContains: "rpi/"
        }
      }];

      // Patch doesn't match, so validation isn't run
      const result = applyPatches(content, patches, "test.md");
      expect(result.applied).toBe(0);
    });

    test("warns when notContains validation fails after patch", () => {
      const content = `# Title

Contains old/ path here`;
      const patches: Patch[] = [{
        op: "replace",
        old: "old/",
        new: "rpi/",
        validate: {
          notContains: "rpi/"
        }
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.applied).toBe(1);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("rpi/");
    });

    test("passes when notContains validation succeeds", () => {
      const content = `# Title

Contains rpi/ path here`;
      const patches: Patch[] = [{
        op: "replace",
        old: "rpi/",
        new: "thoughts/",
        validate: {
          notContains: "rpi/"
        }
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.applied).toBe(1);
      expect(result.warnings.length).toBe(0);
    });

    test("warns when contains validation fails", () => {
      const content = `# Title

Some content`;
      const patches: Patch[] = [{
        op: "replace",
        old: "content",
        new: "text",
        validate: {
          contains: "required-string"
        }
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.applied).toBe(1);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("required-string");
    });

    test("warns when matches validation fails", () => {
      const content = `# Title

version: abc`;
      const patches: Patch[] = [{
        op: "replace",
        old: "abc",
        new: "xyz",
        validate: {
          matches: "^version: \\d+\\.\\d+\\.\\d+$"
        }
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.applied).toBe(1);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    test("warns when notMatches validation fails", () => {
      const content = `# Title

version: 1.0.0`;
      const patches: Patch[] = [{
        op: "replace",
        old: "Title",
        new: "Header",
        validate: {
          notMatches: "version: \\d+"
        }
      }];

      const result = applyPatches(content, patches, "test.md");

      expect(result.applied).toBe(1);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});

describe("Patch Groups", () => {
  test("applies all patches when no group options specified", () => {
    const content = "foo bar baz";
    const patches: Patch[] = [
      { op: "replace", old: "foo", new: "FOO", group: "a" },
      { op: "replace", old: "bar", new: "BAR", group: "b" },
      { op: "replace", old: "baz", new: "BAZ" }, // ungrouped
    ];

    const result = applyPatches(content, patches, "test.md");

    expect(result.content).toBe("FOO BAR BAZ");
    expect(result.applied).toBe(3);
  });

  test("enables only specific groups with enableGroups", () => {
    const content = "foo bar baz";
    const patches: Patch[] = [
      { op: "replace", old: "foo", new: "FOO", group: "a" },
      { op: "replace", old: "bar", new: "BAR", group: "b" },
      { op: "replace", old: "baz", new: "BAZ" }, // ungrouped
    ];

    const result = applyPatches(content, patches, "test.md", { enableGroups: ["a"] });

    expect(result.content).toBe("FOO bar BAZ"); // 'a' group and ungrouped applied
    expect(result.applied).toBe(2);
  });

  test("disables specific groups with disableGroups", () => {
    const content = "foo bar baz";
    const patches: Patch[] = [
      { op: "replace", old: "foo", new: "FOO", group: "a" },
      { op: "replace", old: "bar", new: "BAR", group: "b" },
      { op: "replace", old: "baz", new: "BAZ" }, // ungrouped
    ];

    const result = applyPatches(content, patches, "test.md", { disableGroups: ["a"] });

    expect(result.content).toBe("foo BAR BAZ"); // 'a' group skipped
    expect(result.applied).toBe(2);
  });

  test("enables multiple groups", () => {
    const content = "foo bar baz qux";
    const patches: Patch[] = [
      { op: "replace", old: "foo", new: "FOO", group: "a" },
      { op: "replace", old: "bar", new: "BAR", group: "b" },
      { op: "replace", old: "baz", new: "BAZ", group: "c" },
      { op: "replace", old: "qux", new: "QUX" }, // ungrouped
    ];

    const result = applyPatches(content, patches, "test.md", { enableGroups: ["a", "c"] });

    expect(result.content).toBe("FOO bar BAZ QUX"); // 'a', 'c' groups and ungrouped applied
    expect(result.applied).toBe(3);
  });

  test("disables multiple groups", () => {
    const content = "foo bar baz qux";
    const patches: Patch[] = [
      { op: "replace", old: "foo", new: "FOO", group: "a" },
      { op: "replace", old: "bar", new: "BAR", group: "b" },
      { op: "replace", old: "baz", new: "BAZ", group: "c" },
      { op: "replace", old: "qux", new: "QUX" }, // ungrouped
    ];

    const result = applyPatches(content, patches, "test.md", { disableGroups: ["a", "c"] });

    expect(result.content).toBe("foo BAR baz QUX"); // 'a', 'c' groups skipped
    expect(result.applied).toBe(2);
  });

  test("ungrouped patches always apply with enableGroups", () => {
    const content = "foo bar";
    const patches: Patch[] = [
      { op: "replace", old: "foo", new: "FOO", group: "a" },
      { op: "replace", old: "bar", new: "BAR" }, // ungrouped
    ];

    const result = applyPatches(content, patches, "test.md", { enableGroups: ["nonexistent"] });

    expect(result.content).toBe("foo BAR"); // only ungrouped applied
    expect(result.applied).toBe(1);
  });

  test("empty enableGroups applies all patches", () => {
    const content = "foo bar";
    const patches: Patch[] = [
      { op: "replace", old: "foo", new: "FOO", group: "a" },
      { op: "replace", old: "bar", new: "BAR", group: "b" },
    ];

    const result = applyPatches(content, patches, "test.md", { enableGroups: [] });

    expect(result.content).toBe("FOO BAR");
    expect(result.applied).toBe(2);
  });

  test("empty disableGroups applies all patches", () => {
    const content = "foo bar";
    const patches: Patch[] = [
      { op: "replace", old: "foo", new: "FOO", group: "a" },
      { op: "replace", old: "bar", new: "BAR", group: "b" },
    ];

    const result = applyPatches(content, patches, "test.md", { disableGroups: [] });

    expect(result.content).toBe("FOO BAR");
    expect(result.applied).toBe(2);
  });
});

describe("Patch Inheritance", () => {
  test("patch with extends inherits properties from base patch", () => {
    const content = "hello world";
    const patches: Patch[] = [
      { id: "base", op: "replace", old: "hello", new: "hi" },
      { extends: "base", old: "world", new: "there" } as Patch,
    ];

    const result = applyPatches(content, patches, "test.md");

    // First patch replaces "hello" -> "hi"
    // Second patch inherits op: "replace" and replaces "world" -> "there"
    expect(result.content).toBe("hi there");
    expect(result.applied).toBe(2);
  });

  test("extending patch overrides base properties", () => {
    const content = "foo bar baz";
    const patches: Patch[] = [
      { id: "base", op: "replace", old: "foo", new: "FOO", include: ["*.txt"] },
      { extends: "base", old: "bar", new: "BAR", include: ["*.md"] } as Patch,
    ];

    const result = applyPatches(content, patches, "test.md");

    // First patch doesn't apply (include is *.txt)
    // Second patch applies (include overridden to *.md)
    expect(result.content).toBe("foo BAR baz");
    expect(result.applied).toBe(1);
  });

  test("inherits include/exclude patterns from base", () => {
    const content = "foo bar";
    const patches: Patch[] = [
      { id: "base", op: "replace", old: "foo", new: "FOO", include: ["docs/**/*.md"] },
      { extends: "base", old: "bar", new: "BAR" } as Patch,
    ];

    // File doesn't match include pattern
    const result = applyPatches(content, patches, "test.md");

    expect(result.content).toBe("foo bar");
    expect(result.applied).toBe(0);
  });

  test("inherits group from base patch", () => {
    const content = "foo bar";
    const patches: Patch[] = [
      { id: "base", op: "replace", old: "foo", new: "FOO", group: "production" },
      { extends: "base", old: "bar", new: "BAR" } as Patch,
    ];

    const result = applyPatches(content, patches, "test.md", { disableGroups: ["production"] });

    // Both patches have group "production" (second inherits it), both skipped
    expect(result.content).toBe("foo bar");
    expect(result.applied).toBe(0);
  });

  test("extending patch can override group", () => {
    const content = "foo bar";
    const patches: Patch[] = [
      { id: "base", op: "replace", old: "foo", new: "FOO", group: "production" },
      { extends: "base", old: "bar", new: "BAR", group: "development" } as Patch,
    ];

    const result = applyPatches(content, patches, "test.md", { disableGroups: ["production"] });

    // First patch skipped (production), second applied (development)
    expect(result.content).toBe("foo BAR");
    expect(result.applied).toBe(1);
  });

  test("throws error for unknown extends id", () => {
    const patches: Patch[] = [
      { extends: "nonexistent", op: "replace", old: "foo", new: "bar" } as Patch,
    ];

    expect(() => resolveExtends(patches)).toThrow('Patch extends unknown id: "nonexistent"');
  });

  test("throws error for circular inheritance", () => {
    const patches: Patch[] = [
      { id: "a", extends: "b", op: "replace", old: "foo", new: "bar" } as Patch,
      { id: "b", extends: "a", op: "replace", old: "baz", new: "qux" } as Patch,
    ];

    expect(() => resolveExtends(patches)).toThrow("Circular patch inheritance detected");
  });

  test("throws error for duplicate patch ids", () => {
    const patches: Patch[] = [
      { id: "dup", op: "replace", old: "foo", new: "bar" },
      { id: "dup", op: "replace", old: "baz", new: "qux" },
    ];

    expect(() => resolveExtends(patches)).toThrow('Duplicate patch id: "dup"');
  });

  test("supports chain of extends", () => {
    const content = "aaa bbb ccc";
    const patches: Patch[] = [
      { id: "base", op: "replace", old: "aaa", new: "AAA", group: "test" },
      { id: "middle", extends: "base", old: "bbb", new: "BBB" } as Patch,
      { extends: "middle", old: "ccc", new: "CCC" } as Patch,
    ];

    const result = applyPatches(content, patches, "test.md");

    expect(result.content).toBe("AAA BBB CCC");
    expect(result.applied).toBe(3);
  });

  test("resolveExtends returns patches unchanged when no extends", () => {
    const patches: Patch[] = [
      { op: "replace", old: "foo", new: "bar" },
      { op: "replace", old: "baz", new: "qux" },
    ];

    const resolved = resolveExtends(patches);

    expect(resolved).toHaveLength(2);
    expect(resolved[0].op).toBe("replace");
    expect(resolved[1].op).toBe("replace");
  });
});
