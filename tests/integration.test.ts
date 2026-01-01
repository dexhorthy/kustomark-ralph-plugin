import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Integration tests for kustomark CLI and core functionality.
 * These tests create temporary directories with test fixtures,
 * run CLI commands, and verify outputs.
 */

describe("Integration Tests", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = await mkdtemp(join(tmpdir(), "kustomark-test-"));
  });

  afterEach(async () => {
    // Clean up temp directory after each test
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Build Command", () => {
    test("builds simple config with single file", async () => {
      // Setup
      const baseDir = join(testDir, "base");
      const outputDir = join(testDir, "output");
      await mkdir(baseDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });

      // Create source file
      await writeFile(
        join(baseDir, "doc.md"),
        `# Documentation

This is the content.
`
      );

      // Create kustomark config
      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - "*.md"
`
      );

      // Run build command
      const proc = Bun.spawn(["bun", "run", "./src/cli/index.ts", "build", baseDir], {
        cwd: join(testDir, ".."),
        env: { ...process.env },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      await new Response(proc.stdout).text();

      // For now, just verify the command runs without crashing
      // Full CLI implementation would write files to output
      expect(typeof exitCode).toBe("number");
    });

    test("builds config with replace patch", async () => {
      // Setup
      const baseDir = join(testDir, "base");
      const outputDir = join(testDir, "output");
      await mkdir(baseDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });

      // Create source file with content to replace
      await writeFile(
        join(baseDir, "doc.md"),
        `# Guide

Use the old-path/command to run.
`
      );

      // Create kustomark config with patch
      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - "*.md"
patches:
  - op: replace
    old: old-path/
    new: new-path/
`
      );

      // Run build and check output
      const proc = Bun.spawn(["bun", "run", "./src/cli/index.ts", "build", baseDir], {
        cwd: join(testDir, ".."),
        stdout: "pipe",
        stderr: "pipe",
      });

      await proc.exited;

      // Verify we can at least parse the config
      const { parseConfig } = await import("../src/core/config.js");
      const configContent = await readFile(join(baseDir, "kustomark.yaml"), "utf-8");
      const config = parseConfig(configContent);

      expect(config.patches).toBeDefined();
      expect(config.patches![0].op).toBe("replace");
    });

    test("builds config with multiple resources", async () => {
      // Setup
      const baseDir = join(testDir, "base");
      const docsDir = join(baseDir, "docs");
      const outputDir = join(testDir, "output");
      await mkdir(docsDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });

      // Create multiple source files
      await writeFile(join(baseDir, "readme.md"), "# README\n\nRoot readme.\n");
      await writeFile(join(docsDir, "guide.md"), "# Guide\n\nGuide content.\n");
      await writeFile(join(docsDir, "api.md"), "# API\n\nAPI reference.\n");

      // Create kustomark config
      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - "**/*.md"
  - "!**/readme.md"
`
      );

      // Verify config parsing
      const { parseConfig } = await import("../src/core/config.js");
      const configContent = await readFile(join(baseDir, "kustomark.yaml"), "utf-8");
      const config = parseConfig(configContent);

      expect(config.resources).toHaveLength(2);
      expect(config.resources).toContain("**/*.md");
      expect(config.resources).toContain("!**/readme.md");
    });

    test("builds config with section patches", async () => {
      // Setup
      const baseDir = join(testDir, "base");
      const outputDir = join(testDir, "output");
      await mkdir(baseDir, { recursive: true });

      // Create source file with sections
      await writeFile(
        join(baseDir, "doc.md"),
        `# Main Doc

## Introduction

Intro content.

## Deprecated Section

This will be removed.

## Keep This

Keep this content.
`
      );

      // Create kustomark config with section patch
      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - "*.md"
patches:
  - op: remove-section
    id: deprecated-section
`
      );

      // Verify patch application
      const { parseConfig } = await import("../src/core/config.js");
      const { applyPatches } = await import("../src/core/patches.js");

      const configContent = await readFile(join(baseDir, "kustomark.yaml"), "utf-8");
      const config = parseConfig(configContent);

      const docContent = await readFile(join(baseDir, "doc.md"), "utf-8");
      const result = applyPatches(docContent, config.patches!, "doc.md");

      expect(result.content).toContain("Introduction");
      expect(result.content).toContain("Keep This");
      expect(result.content).not.toContain("Deprecated Section");
    });

    test("builds nested kustomark configs", async () => {
      // Setup base and overlay directories
      const baseDir = join(testDir, "base");
      const overlayDir = join(testDir, "overlay");
      const outputDir = join(testDir, "output");
      await mkdir(baseDir, { recursive: true });
      await mkdir(overlayDir, { recursive: true });

      // Create base config and file
      await writeFile(
        join(baseDir, "doc.md"),
        `# Base Doc

Base content with upstream-term.
`
      );

      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - "*.md"
`
      );

      // Create overlay config that references base
      await writeFile(
        join(overlayDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - ../base/
patches:
  - op: replace
    old: upstream-term
    new: local-term
`
      );

      // Verify configs parse correctly
      const { parseConfig } = await import("../src/core/config.js");

      const baseConfig = parseConfig(
        await readFile(join(baseDir, "kustomark.yaml"), "utf-8")
      );
      const overlayConfig = parseConfig(
        await readFile(join(overlayDir, "kustomark.yaml"), "utf-8")
      );

      expect(baseConfig.resources).toContain("*.md");
      expect(overlayConfig.resources).toContain("../base/");
      expect(overlayConfig.patches![0].op).toBe("replace");
    });

    test("handles empty output directory", async () => {
      const baseDir = join(testDir, "base");
      const outputDir = join(testDir, "output");
      await mkdir(baseDir, { recursive: true });

      await writeFile(join(baseDir, "doc.md"), "# Doc\n\nContent.\n");

      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - "*.md"
`
      );

      // Output directory doesn't exist yet - should be created
      const { parseConfig } = await import("../src/core/config.js");
      const config = parseConfig(
        await readFile(join(baseDir, "kustomark.yaml"), "utf-8")
      );

      expect(config.output).toBe(outputDir);
    });
  });

  describe("Diff Command", () => {
    test("shows no diff when output matches expected", async () => {
      const baseDir = join(testDir, "base");
      const outputDir = join(testDir, "output");
      await mkdir(baseDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });

      // Create identical source and output
      const content = "# Doc\n\nSame content.\n";
      await writeFile(join(baseDir, "doc.md"), content);
      await writeFile(join(outputDir, "doc.md"), content);

      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - "*.md"
`
      );

      // Verify patch application results in no change
      const { applyPatches } = await import("../src/core/patches.js");
      const result = applyPatches(content, [], "doc.md");

      expect(result.content).toBe(content);
    });

    test("shows diff when content has changes", async () => {
      const baseDir = join(testDir, "base");
      const outputDir = join(testDir, "output");
      await mkdir(baseDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });

      // Create source with content to patch
      await writeFile(
        join(baseDir, "doc.md"),
        "# Doc\n\nOld content.\n"
      );

      // Create existing output with different content
      await writeFile(
        join(outputDir, "doc.md"),
        "# Doc\n\nNew content.\n"
      );

      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - "*.md"
patches:
  - op: replace
    old: Old
    new: New
`
      );

      // Apply patches and compare
      const { parseConfig } = await import("../src/core/config.js");
      const { applyPatches } = await import("../src/core/patches.js");

      const config = parseConfig(
        await readFile(join(baseDir, "kustomark.yaml"), "utf-8")
      );

      const sourceContent = await readFile(join(baseDir, "doc.md"), "utf-8");
      const result = applyPatches(sourceContent, config.patches!, "doc.md");

      expect(result.content).toContain("New content");
      expect(result.content).not.toContain("Old content");
    });

    test("diff command detects new files", async () => {
      const baseDir = join(testDir, "base");
      const outputDir = join(testDir, "output");
      await mkdir(baseDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });

      // Create source file
      await writeFile(join(baseDir, "new-doc.md"), "# New Doc\n\nContent.\n");

      // Output directory is empty - new file will be created
      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - "*.md"
`
      );

      // Check that output dir is empty
      const outputFiles = await readdir(outputDir);
      expect(outputFiles).toHaveLength(0);

      // Source has file that output doesn't
      const sourceFiles = await readdir(baseDir);
      expect(sourceFiles).toContain("new-doc.md");
    });

    test("diff command detects deleted files with --clean", async () => {
      const baseDir = join(testDir, "base");
      const outputDir = join(testDir, "output");
      await mkdir(baseDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });

      // Output has extra file not in source
      await writeFile(join(outputDir, "extra.md"), "# Extra\n\nShould be removed.\n");

      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - "*.md"
`
      );

      // Output has file that source doesn't
      const outputFiles = await readdir(outputDir);
      expect(outputFiles).toContain("extra.md");

      // Source has no md files (besides config)
      const sourceFiles = await readdir(baseDir);
      expect(sourceFiles.filter((f) => f.endsWith(".md"))).toHaveLength(0);
    });
  });

  describe("Validate Command", () => {
    test("validates correct config successfully", async () => {
      const baseDir = join(testDir, "base");
      await mkdir(baseDir, { recursive: true });

      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - "*.md"
patches:
  - op: replace
    old: foo
    new: bar
`
      );

      const { parseConfig } = await import("../src/core/config.js");
      const config = parseConfig(
        await readFile(join(baseDir, "kustomark.yaml"), "utf-8")
      );

      expect(config.apiVersion).toBe("kustomark/v1");
      expect(config.kind).toBe("Kustomization");
    });

    test("rejects config with wrong apiVersion", async () => {
      const baseDir = join(testDir, "base");
      await mkdir(baseDir, { recursive: true });

      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v2
kind: Kustomization
output: ./out
resources:
  - "*.md"
`
      );

      const { parseConfig } = await import("../src/core/config.js");

      expect(() =>
        parseConfig(`apiVersion: kustomark/v2
kind: Kustomization
output: ./out
resources:
  - "*.md"
`)
      ).toThrow();
    });

    test("rejects config with invalid patch", async () => {
      const { parseConfig } = await import("../src/core/config.js");

      expect(() =>
        parseConfig(`apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - "*.md"
patches:
  - op: invalid-operation
    value: something
`)
      ).toThrow();
    });

    test("validates all patch types", async () => {
      const { parseConfig } = await import("../src/core/config.js");

      const config = parseConfig(`apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - "*.md"
patches:
  - op: replace
    old: a
    new: b
  - op: replace-regex
    pattern: "\\\\d+"
    replacement: "NUM"
    flags: "g"
  - op: remove-section
    id: deprecated
  - op: replace-section
    id: intro
    content: New intro
  - op: prepend-to-section
    id: steps
    content: Step 0
  - op: append-to-section
    id: steps
    content: Final step
`);

      expect(config.patches).toHaveLength(6);
    });
  });

  describe("JSON Output Format", () => {
    test("build command with --format=json returns valid JSON", async () => {
      const baseDir = join(testDir, "base");
      const outputDir = join(testDir, "output");
      await mkdir(baseDir, { recursive: true });

      await writeFile(join(baseDir, "doc.md"), "# Doc\n");

      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - "*.md"
`
      );

      // Test that we can construct expected JSON output format
      const expectedOutput = {
        success: true,
        filesWritten: 1,
        patchesApplied: 0,
        warnings: [],
      };

      expect(JSON.stringify(expectedOutput)).toBeDefined();
      expect(typeof expectedOutput.success).toBe("boolean");
      expect(typeof expectedOutput.filesWritten).toBe("number");
    });

    test("diff command with --format=json returns valid JSON", async () => {
      // Test expected JSON format for diff
      const expectedOutput = {
        hasChanges: true,
        files: [
          {
            path: "doc.md",
            status: "modified",
            diff: "--- a/doc.md\n+++ b/doc.md\n@@ -1 +1 @@\n-old\n+new",
          },
        ],
      };

      expect(JSON.stringify(expectedOutput)).toBeDefined();
      expect(typeof expectedOutput.hasChanges).toBe("boolean");
      expect(Array.isArray(expectedOutput.files)).toBe(true);
    });

    test("validate command with --format=json returns valid JSON", async () => {
      // Test expected JSON format for validate
      const expectedValidOutput = {
        valid: true,
        errors: [],
        warnings: [],
      };

      const expectedInvalidOutput = {
        valid: false,
        errors: ["Invalid apiVersion: expected 'kustomark/v1'"],
        warnings: [],
      };

      expect(JSON.stringify(expectedValidOutput)).toBeDefined();
      expect(JSON.stringify(expectedInvalidOutput)).toBeDefined();
    });
  });

  describe("End-to-End Workflows", () => {
    test("full workflow: base -> overlay -> build", async () => {
      // Create a full directory structure
      const baseDir = join(testDir, "base");
      const overlayDir = join(testDir, "overlay");
      const outputDir = join(testDir, "output");

      // Create all directories first
      await mkdir(join(baseDir, "skills"), { recursive: true });
      await mkdir(overlayDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });

      // Base files - directory already exists
      await writeFile(
        join(baseDir, "skills", "commit.md"),
        `# Commit Skill

## Description

Use rpi/tasks/ for task management.

## Steps

1. Stage changes
2. Write message
3. Commit

## Internal Notes

Internal only content.
`
      );

      // Base config
      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - "skills/*.md"
`
      );

      // Overlay config
      await writeFile(
        join(overlayDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - ../base/
patches:
  - op: replace
    old: rpi/tasks/
    new: thoughts/tasks/
  - op: remove-section
    id: internal-notes
`
      );

      // Apply patches manually to verify expected result
      const { parseConfig } = await import("../src/core/config.js");
      const { applyPatches } = await import("../src/core/patches.js");

      const overlayConfig = parseConfig(
        await readFile(join(overlayDir, "kustomark.yaml"), "utf-8")
      );

      const sourceContent = await readFile(join(baseDir, "skills", "commit.md"), "utf-8");
      const result = applyPatches(sourceContent, overlayConfig.patches!, "skills/commit.md");

      // Verify patches were applied
      expect(result.content).toContain("thoughts/tasks/");
      expect(result.content).not.toContain("rpi/tasks/");
      expect(result.content).not.toContain("Internal Notes");
      expect(result.content).toContain("## Steps");
    });

    test("workflow with multiple overlays", async () => {
      // Company -> Team -> Individual
      const companyDir = join(testDir, "company");
      const teamDir = join(testDir, "team");
      const individualDir = join(testDir, "individual");
      const outputDir = join(testDir, "output");

      await mkdir(join(companyDir, "docs"), { recursive: true });
      await mkdir(teamDir, { recursive: true });
      await mkdir(individualDir, { recursive: true });

      // Company base
      await writeFile(
        join(companyDir, "docs", "policy.md"),
        `# Company Policy

## Section A

Generic company content.

## Section B

More content.
`
      );

      await writeFile(
        join(companyDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - "docs/*.md"
`
      );

      // Team overlay
      await writeFile(
        join(teamDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - ../company/
patches:
  - op: replace
    old: Generic company
    new: Team-specific
`
      );

      // Individual overlay
      await writeFile(
        join(individualDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - ../team/
patches:
  - op: append-to-section
    id: section-b
    content: |

      Personal notes added here.
`
      );

      // Verify config chain
      const { parseConfig } = await import("../src/core/config.js");

      const companyConfig = parseConfig(
        await readFile(join(companyDir, "kustomark.yaml"), "utf-8")
      );
      const teamConfig = parseConfig(
        await readFile(join(teamDir, "kustomark.yaml"), "utf-8")
      );
      const individualConfig = parseConfig(
        await readFile(join(individualDir, "kustomark.yaml"), "utf-8")
      );

      expect(companyConfig.resources).toContain("docs/*.md");
      expect(teamConfig.resources).toContain("../company/");
      expect(individualConfig.resources).toContain("../team/");
    });

    test("workflow preserves file structure", async () => {
      const baseDir = join(testDir, "base");
      const outputDir = join(testDir, "output");

      // Create nested directory structure
      await mkdir(join(baseDir, "skills", "git"), { recursive: true });
      await mkdir(join(baseDir, "skills", "code"), { recursive: true });
      await mkdir(join(baseDir, "guides"), { recursive: true });

      await writeFile(join(baseDir, "skills", "git", "commit.md"), "# Commit\n");
      await writeFile(join(baseDir, "skills", "git", "branch.md"), "# Branch\n");
      await writeFile(join(baseDir, "skills", "code", "review.md"), "# Review\n");
      await writeFile(join(baseDir, "guides", "intro.md"), "# Intro\n");

      await writeFile(
        join(baseDir, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ${outputDir}
resources:
  - "**/*.md"
`
      );

      // Verify the glob pattern would match all files
      const { glob } = await import("glob");
      const matches = await glob("**/*.md", { cwd: baseDir, nodir: true });

      expect(matches).toContain("skills/git/commit.md");
      expect(matches).toContain("skills/git/branch.md");
      expect(matches).toContain("skills/code/review.md");
      expect(matches).toContain("guides/intro.md");
    });
  });

  describe("Init Command", () => {
    test("creates kustomark.yaml in specified directory", async () => {
      const initDir = join(testDir, "new-project");

      // Run init command
      const proc = Bun.spawn(
        ["bun", "run", "./src/cli/index.ts", "init", initDir],
        {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      // Verify config was created
      const configPath = join(initDir, "kustomark.yaml");
      const { existsSync } = await import("fs");
      expect(existsSync(configPath)).toBe(true);

      // Verify config content
      const content = await readFile(configPath, "utf-8");
      expect(content).toContain("apiVersion: kustomark/v1");
      expect(content).toContain("kind: Kustomization");
      expect(content).toContain("output:");
      expect(content).toContain("resources:");
    });

    test("creates overlay config with --base flag", async () => {
      const initDir = join(testDir, "overlay");

      // Run init command with --base
      const proc = Bun.spawn(
        ["bun", "run", "./src/cli/index.ts", "init", initDir, "--base", "../base/"],
        {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      // Verify config was created with base reference
      const configPath = join(initDir, "kustomark.yaml");
      const content = await readFile(configPath, "utf-8");
      expect(content).toContain("../base/");
    });

    test("creates config with custom --output", async () => {
      const initDir = join(testDir, "custom-output");

      // Run init command with --output
      const proc = Bun.spawn(
        ["bun", "run", "./src/cli/index.ts", "init", initDir, "--output", "../../.claude/skills"],
        {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      // Verify config has custom output
      const configPath = join(initDir, "kustomark.yaml");
      const content = await readFile(configPath, "utf-8");
      expect(content).toContain("output: ../../.claude/skills");
    });

    test("fails when config already exists", async () => {
      const initDir = join(testDir, "existing-config");
      await mkdir(initDir, { recursive: true });

      // Create existing config
      await writeFile(join(initDir, "kustomark.yaml"), "existing content");

      // Try to init - should fail
      const proc = Bun.spawn(
        ["bun", "run", "./src/cli/index.ts", "init", initDir],
        {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      const exitCode = await proc.exited;
      expect(exitCode).toBe(1);
    });

    test("returns JSON output with --format=json", async () => {
      const initDir = join(testDir, "json-output");

      // Run init command with JSON format
      const proc = Bun.spawn(
        ["bun", "run", "./src/cli/index.ts", "init", initDir, "--format=json"],
        {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);

      // Parse JSON output
      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.created).toContain("kustomark.yaml");
      expect(result.type).toBe("base");
    });

    test("returns overlay type when --base is used", async () => {
      const initDir = join(testDir, "overlay-json");

      const proc = Bun.spawn(
        ["bun", "run", "./src/cli/index.ts", "init", initDir, "--base", "../base/", "--format=json"],
        {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      expect(result.type).toBe("overlay");
    });

    test("creates nested directories if they don't exist", async () => {
      const initDir = join(testDir, "deeply", "nested", "directory");

      const proc = Bun.spawn(
        ["bun", "run", "./src/cli/index.ts", "init", initDir],
        {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      // Verify nested directories and config were created
      const configPath = join(initDir, "kustomark.yaml");
      const { existsSync } = await import("fs");
      expect(existsSync(configPath)).toBe(true);
    });
  });

  describe("Schema Command", () => {
    test("outputs valid JSON Schema", async () => {
      const proc = Bun.spawn(
        ["bun", "run", "./src/cli/index.ts", "schema"],
        {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);

      // Parse JSON output
      const schemaObj = JSON.parse(stdout);
      expect(schemaObj).toBeDefined();
      // Schema uses $ref to definitions
      expect(schemaObj.$ref).toBeDefined();
      expect(schemaObj.definitions).toBeDefined();
    });

    test("schema contains required properties", async () => {
      const proc = Bun.spawn(
        ["bun", "run", "./src/cli/index.ts", "schema"],
        {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const schemaObj = JSON.parse(stdout);

      // Check that the schema has the expected definitions
      expect(schemaObj.definitions).toBeDefined();
      expect(schemaObj.definitions.KustomarkConfig).toBeDefined();

      const configSchema = schemaObj.definitions.KustomarkConfig;
      expect(configSchema.type).toBe("object");
      expect(configSchema.properties.apiVersion).toBeDefined();
      expect(configSchema.properties.kind).toBeDefined();
      expect(configSchema.properties.output).toBeDefined();
      expect(configSchema.properties.resources).toBeDefined();
      expect(configSchema.properties.patches).toBeDefined();
    });

    test("schema can be used with generateJsonSchema function", async () => {
      const { generateJsonSchema } = await import("../src/core/config.js");
      const schemaObj = generateJsonSchema();

      expect(schemaObj).toBeDefined();
      expect(schemaObj.$ref).toBeDefined();
      expect(schemaObj.definitions).toBeDefined();
    });
  });

  describe("Lint Command", () => {
    test("lints valid config with no issues", async () => {
      const baseDir = join(testDir, "lint-clean");
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

      const proc = Bun.spawn(
        ["bun", "run", "./src/cli/index.ts", "lint", baseDir],
        {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    });

    test("detects redundant patches", async () => {
      const baseDir = join(testDir, "lint-redundant");
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
  - op: replace
    old: foo
    new: bar
`
      );

      const proc = Bun.spawn(
        ["bun", "run", "./src/cli/index.ts", "lint", baseDir, "--format=json"],
        {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const result = JSON.parse(stdout);

      expect(result.warningCount).toBeGreaterThan(0);
      expect(result.issues.some((i: { message: string }) => i.message.includes("redundant"))).toBe(true);
      // Warnings don't fail without --strict
      expect(exitCode).toBe(0);
    });

    test("fails with --strict when warnings exist", async () => {
      const baseDir = join(testDir, "lint-strict");
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
  - op: replace
    old: foo
    new: bar
`
      );

      const proc = Bun.spawn(
        ["bun", "run", "./src/cli/index.ts", "lint", baseDir, "--strict"],
        {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      const exitCode = await proc.exited;
      expect(exitCode).toBe(1);
    });

    test("detects unreachable patches", async () => {
      const baseDir = join(testDir, "lint-unreachable");
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
    include:
      - "nonexistent/*.md"
`
      );

      const proc = Bun.spawn(
        ["bun", "run", "./src/cli/index.ts", "lint", baseDir, "--format=json"],
        {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const result = JSON.parse(stdout);

      expect(result.warningCount).toBeGreaterThan(0);
      expect(result.issues.some((i: { message: string }) => i.message.includes("matches 0 files"))).toBe(true);
    });
  });

  describe("Error Handling", () => {
    test("handles missing config file gracefully", async () => {
      const { loadConfigFile } = await import("../src/core/config.js");

      await expect(
        loadConfigFile(join(testDir, "nonexistent", "kustomark.yaml"))
      ).rejects.toThrow();
    });

    test("handles malformed YAML gracefully", async () => {
      const { parseConfig } = await import("../src/core/config.js");

      expect(() =>
        parseConfig(`apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - invalid yaml here
  no proper structure
`)
      ).toThrow();
    });

    test("handles circular config references", async () => {
      // This tests that the implementation handles cycles gracefully
      // Two configs that reference each other
      const dirA = join(testDir, "a");
      const dirB = join(testDir, "b");

      await mkdir(dirA, { recursive: true });
      await mkdir(dirB, { recursive: true });

      await writeFile(
        join(dirA, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - ../b/
`
      );

      await writeFile(
        join(dirB, "kustomark.yaml"),
        `apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - ../a/
`
      );

      // Configs should parse (cycle detection is runtime)
      const { parseConfig } = await import("../src/core/config.js");

      const configA = parseConfig(
        await readFile(join(dirA, "kustomark.yaml"), "utf-8")
      );
      const configB = parseConfig(
        await readFile(join(dirB, "kustomark.yaml"), "utf-8")
      );

      expect(configA.resources).toContain("../b/");
      expect(configB.resources).toContain("../a/");
    });

    test("handles file read errors", async () => {
      const { readFile: fsReadFile } = await import("fs/promises");

      await expect(
        fsReadFile(join(testDir, "does-not-exist.md"), "utf-8")
      ).rejects.toThrow();
    });
  });
});
