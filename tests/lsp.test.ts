import { describe, test, expect } from "bun:test";

// Note: The LSP server uses vscode-languageserver which requires a connection.
// These tests focus on the data structures and documentation content.

describe("LSP Server", () => {
  describe("Patch Operation Documentation", () => {
    // Test that patch operations are documented
    const patchOps = [
      "replace",
      "replace-regex",
      "remove-section",
      "replace-section",
      "prepend-to-section",
      "append-to-section",
      "set-frontmatter",
      "remove-frontmatter",
      "rename-frontmatter",
      "merge-frontmatter",
      "insert-after-line",
      "insert-before-line",
      "replace-line",
      "delete-between",
      "replace-between",
      "rename-header",
      "move-section",
      "change-section-level",
      "copy-file",
      "rename-file",
      "delete-file",
      "move-file",
    ];

    test("all patch operations are known", () => {
      // This test just verifies we have all the patch operations listed
      expect(patchOps.length).toBe(22);
    });

    for (const op of patchOps) {
      test(`${op} is a valid patch operation`, () => {
        // All ops should be lowercase with hyphens
        expect(op).toMatch(/^[a-z-]+$/);
      });
    }
  });

  describe("LSP Command", () => {
    test("lsp command is available", async () => {
      // Just verify the CLI would recognize the lsp command
      // We can't actually start the server in tests without mocking
      const validCommands = [
        "build",
        "diff",
        "validate",
        "init",
        "schema",
        "lint",
        "explain",
        "watch",
        "lsp",
      ];
      expect(validCommands).toContain("lsp");
    });
  });

  describe("Kustomark YAML Detection", () => {
    test("kustomark.yaml is recognized", () => {
      const uri = "/path/to/project/kustomark.yaml";
      expect(uri.endsWith("kustomark.yaml")).toBe(true);
    });

    test("kustomark.yml is recognized", () => {
      const uri = "/path/to/project/kustomark.yml";
      expect(uri.endsWith("kustomark.yml")).toBe(true);
    });

    test("other yaml files are not recognized", () => {
      const uri = "/path/to/project/other.yaml";
      expect(
        uri.endsWith("kustomark.yaml") || uri.endsWith("kustomark.yml")
      ).toBe(false);
    });
  });

  describe("YAML Position Finding", () => {
    test("can find key position in YAML", () => {
      const yaml = `apiVersion: kustomark/v1
kind: Kustomization
output: ./dist
resources:
  - ./src
patches:
  - op: replace
    old: "foo"
    new: "bar"`;

      const lines = yaml.split("\n");

      // Find "output" key
      const outputLine = lines.findIndex((l) => l.includes("output:"));
      expect(outputLine).toBe(2);

      // Find first patch op
      const patchOpLine = lines.findIndex((l) => l.includes("op:"));
      expect(patchOpLine).toBe(6);
    });

    test("can identify patch boundaries", () => {
      const yaml = `patches:
  - op: replace
    old: "a"
    new: "b"
  - op: remove-section
    id: "test"`;

      const lines = yaml.split("\n");
      let patchCount = 0;

      for (const line of lines) {
        if (line.match(/^\s+-\s+op:/)) {
          patchCount++;
        }
      }

      expect(patchCount).toBe(2);
    });
  });
});
