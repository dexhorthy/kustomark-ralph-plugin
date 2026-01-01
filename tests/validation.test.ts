import { describe, test, expect } from "bun:test";
import { runGlobalValidators, validateFiles } from "../src/core/validation.js";
import type { Validator } from "../src/core/config.js";

describe("Global Validators", () => {
  describe("runGlobalValidators", () => {
    test("notContains validator fails when string is present", () => {
      const content = `# Title

Contains rpi/ path here`;
      const validators: Validator[] = [{
        name: "no-rpi",
        notContains: "rpi/"
      }];

      const errors = runGlobalValidators(content, "test.md", validators);

      expect(errors.length).toBe(1);
      expect(errors[0].validator).toBe("no-rpi");
      expect(errors[0].file).toBe("test.md");
      expect(errors[0].message).toContain("rpi/");
    });

    test("notContains validator passes when string is not present", () => {
      const content = `# Title

Clean content here`;
      const validators: Validator[] = [{
        name: "no-rpi",
        notContains: "rpi/"
      }];

      const errors = runGlobalValidators(content, "test.md", validators);

      expect(errors.length).toBe(0);
    });

    test("contains validator fails when string is missing", () => {
      const content = `# Title

Some content`;
      const validators: Validator[] = [{
        name: "has-copyright",
        contains: "Copyright 2024"
      }];

      const errors = runGlobalValidators(content, "test.md", validators);

      expect(errors.length).toBe(1);
      expect(errors[0].validator).toBe("has-copyright");
    });

    test("contains validator passes when string is present", () => {
      const content = `# Title

Copyright 2024 by Company`;
      const validators: Validator[] = [{
        name: "has-copyright",
        contains: "Copyright 2024"
      }];

      const errors = runGlobalValidators(content, "test.md", validators);

      expect(errors.length).toBe(0);
    });

    test("matches validator fails when pattern does not match", () => {
      const content = `# Title

version: abc`;
      const validators: Validator[] = [{
        name: "valid-version",
        matches: "version: \\d+\\.\\d+\\.\\d+"
      }];

      const errors = runGlobalValidators(content, "test.md", validators);

      expect(errors.length).toBe(1);
      expect(errors[0].validator).toBe("valid-version");
    });

    test("matches validator passes when pattern matches", () => {
      const content = `# Title

version: 1.2.3`;
      const validators: Validator[] = [{
        name: "valid-version",
        matches: "version: \\d+\\.\\d+\\.\\d+"
      }];

      const errors = runGlobalValidators(content, "test.md", validators);

      expect(errors.length).toBe(0);
    });

    test("notMatches validator fails when pattern matches", () => {
      const content = `# Title

TODO: fix this later`;
      const validators: Validator[] = [{
        name: "no-todos",
        notMatches: "TODO:"
      }];

      const errors = runGlobalValidators(content, "test.md", validators);

      expect(errors.length).toBe(1);
      expect(errors[0].validator).toBe("no-todos");
    });

    test("frontmatterRequired validator fails when frontmatter is missing", () => {
      const content = `# Title

Content without frontmatter`;
      const validators: Validator[] = [{
        name: "has-frontmatter",
        frontmatterRequired: ["name", "description"]
      }];

      const errors = runGlobalValidators(content, "test.md", validators);

      expect(errors.length).toBe(1);
      expect(errors[0].validator).toBe("has-frontmatter");
      expect(errors[0].message).toContain("name");
      expect(errors[0].message).toContain("description");
    });

    test("frontmatterRequired validator fails when required fields are missing", () => {
      const content = `---
name: Test
---

# Title`;
      const validators: Validator[] = [{
        name: "has-frontmatter",
        frontmatterRequired: ["name", "description"]
      }];

      const errors = runGlobalValidators(content, "test.md", validators);

      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain("description");
      expect(errors[0].message).not.toContain("name");
    });

    test("frontmatterRequired validator passes when all fields are present", () => {
      const content = `---
name: Test
description: A test file
---

# Title`;
      const validators: Validator[] = [{
        name: "has-frontmatter",
        frontmatterRequired: ["name", "description"]
      }];

      const errors = runGlobalValidators(content, "test.md", validators);

      expect(errors.length).toBe(0);
    });

    test("multiple validators can all run", () => {
      const content = `# Title

Contains rpi/ and TODO: fix`;
      const validators: Validator[] = [
        { name: "no-rpi", notContains: "rpi/" },
        { name: "no-todos", notMatches: "TODO:" }
      ];

      const errors = runGlobalValidators(content, "test.md", validators);

      expect(errors.length).toBe(2);
    });
  });

  describe("validateFiles", () => {
    test("validates multiple files", () => {
      const files = [
        { path: "good.md", content: "# Good file\n\nClean content" },
        { path: "bad.md", content: "# Bad file\n\nContains rpi/ path" }
      ];
      const validators: Validator[] = [{
        name: "no-rpi",
        notContains: "rpi/"
      }];

      const result = validateFiles(files, validators);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].file).toBe("bad.md");
    });

    test("returns valid when all files pass", () => {
      const files = [
        { path: "file1.md", content: "# File 1\n\nClean content" },
        { path: "file2.md", content: "# File 2\n\nAlso clean" }
      ];
      const validators: Validator[] = [{
        name: "no-rpi",
        notContains: "rpi/"
      }];

      const result = validateFiles(files, validators);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });
});
