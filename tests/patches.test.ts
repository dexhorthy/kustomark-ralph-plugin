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
});
