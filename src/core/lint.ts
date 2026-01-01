import type { KustomarkConfig } from "./config.js";
import { minimatch } from "minimatch";

/**
 * Lint issue severity
 */
export type LintLevel = "error" | "warning" | "info";

/**
 * A lint issue found in a kustomark configuration
 */
export interface LintIssue {
  level: LintLevel;
  line?: number;
  message: string;
  patchIndex?: number;
}

/**
 * Result of linting a kustomark configuration
 */
export interface LintResult {
  issues: LintIssue[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

/**
 * Check for unreachable patches (patterns that match nothing)
 */
function checkUnreachablePatches(
  config: KustomarkConfig,
  resources: Array<{ relativePath: string; content: string }>
): LintIssue[] {
  const issues: LintIssue[] = [];
  const patches = config.patches || [];

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    const include = patch.include || ["**/*"];
    const exclude = patch.exclude || [];

    // Check if any resource matches this patch's include/exclude patterns
    let matchesAnyResource = false;

    for (const resource of resources) {
      // Simple glob matching for include
      const matchesInclude = include.some((pattern: string) =>
        minimatch(resource.relativePath, pattern)
      );
      const matchesExclude = exclude.some((pattern: string) =>
        minimatch(resource.relativePath, pattern)
      );

      if (matchesInclude && !matchesExclude) {
        matchesAnyResource = true;
        break;
      }
    }

    if (!matchesAnyResource && resources.length > 0) {
      issues.push({
        level: "warning",
        message: `Patch ${i + 1} (${patch.op}) matches 0 files`,
        patchIndex: i,
      });
    }
  }

  return issues;
}

/**
 * Check for redundant patches (same operation twice)
 */
function checkRedundantPatches(config: KustomarkConfig): LintIssue[] {
  const issues: LintIssue[] = [];
  const patches = config.patches || [];

  // Track patches by their key properties
  const seenPatches = new Map<string, number>();

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    let key = "";

    switch (patch.op) {
      case "replace":
        key = `replace:${patch.old}:${patch.new}`;
        break;
      case "replace-regex":
        key = `replace-regex:${patch.pattern}:${patch.replacement}:${patch.flags || ""}`;
        break;
      case "remove-section":
        key = `remove-section:${patch.id}`;
        break;
      case "replace-section":
        key = `replace-section:${patch.id}`;
        break;
      case "prepend-to-section":
        key = `prepend-to-section:${patch.id}:${patch.content}`;
        break;
      case "append-to-section":
        key = `append-to-section:${patch.id}:${patch.content}`;
        break;
      case "set-frontmatter":
        key = `set-frontmatter:${patch.key}`;
        break;
      case "remove-frontmatter":
        key = `remove-frontmatter:${patch.key}`;
        break;
      case "rename-frontmatter":
        key = `rename-frontmatter:${patch.old}:${patch.new}`;
        break;
      case "rename-header":
        key = `rename-header:${patch.id}`;
        break;
      case "move-section":
        key = `move-section:${patch.id}`;
        break;
      case "change-section-level":
        key = `change-section-level:${patch.id}`;
        break;
      case "copy-file":
        key = `copy-file:${patch.src}:${patch.dest}`;
        break;
      case "rename-file":
        key = `rename-file:${patch.match}`;
        break;
      case "delete-file":
        key = `delete-file:${patch.match}`;
        break;
      case "move-file":
        key = `move-file:${patch.match}`;
        break;
      default:
        // For other patches, use a general key
        key = `${patch.op}:${JSON.stringify(patch)}`;
    }

    // Add include/exclude to the key to differentiate patches with different file targets
    const includeKey = (patch.include || []).sort().join(",");
    const excludeKey = (patch.exclude || []).sort().join(",");
    key = `${key}:include=${includeKey}:exclude=${excludeKey}`;

    if (seenPatches.has(key)) {
      const prevIndex = seenPatches.get(key)!;
      issues.push({
        level: "warning",
        message: `Patch ${i + 1} (${patch.op}) is redundant with patch ${prevIndex + 1}`,
        patchIndex: i,
      });
    } else {
      seenPatches.set(key, i);
    }
  }

  return issues;
}

/**
 * Check for overlapping patches (multiple patches on same content)
 */
function checkOverlappingPatches(config: KustomarkConfig): LintIssue[] {
  const issues: LintIssue[] = [];
  const patches = config.patches || [];

  // Track section operations by section ID
  const sectionOps = new Map<string, Array<{ index: number; op: string }>>();

  // Track frontmatter operations by key
  const frontmatterOps = new Map<string, Array<{ index: number; op: string }>>();

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];

    // Check section operations
    if (
      patch.op === "remove-section" ||
      patch.op === "replace-section" ||
      patch.op === "prepend-to-section" ||
      patch.op === "append-to-section" ||
      patch.op === "rename-header" ||
      patch.op === "move-section" ||
      patch.op === "change-section-level"
    ) {
      const id = patch.id;
      if (!sectionOps.has(id)) {
        sectionOps.set(id, []);
      }
      sectionOps.get(id)!.push({ index: i, op: patch.op });
    }

    // Check frontmatter operations
    if (patch.op === "set-frontmatter" || patch.op === "remove-frontmatter") {
      const key = patch.key;
      if (!frontmatterOps.has(key)) {
        frontmatterOps.set(key, []);
      }
      frontmatterOps.get(key)!.push({ index: i, op: patch.op });
    }
  }

  // Report overlapping section operations
  for (const [id, ops] of sectionOps) {
    if (ops.length > 1) {
      // Check for conflicts
      const hasRemove = ops.some((o) => o.op === "remove-section");
      const hasOtherOps = ops.some((o) => o.op !== "remove-section");

      if (hasRemove && hasOtherOps) {
        issues.push({
          level: "warning",
          message: `Section '${id}' is removed but also modified by other patches`,
        });
      } else if (ops.length > 2) {
        issues.push({
          level: "info",
          message: `Section '${id}' has ${ops.length} patches - consider combining`,
        });
      }
    }
  }

  // Report overlapping frontmatter operations
  for (const [key, ops] of frontmatterOps) {
    if (ops.length > 1) {
      const hasRemove = ops.some((o) => o.op === "remove-frontmatter");
      const hasSet = ops.some((o) => o.op === "set-frontmatter");

      if (hasRemove && hasSet) {
        issues.push({
          level: "warning",
          message: `Frontmatter key '${key}' is both set and removed`,
        });
      } else if (ops.filter((o) => o.op === "set-frontmatter").length > 1) {
        issues.push({
          level: "info",
          message: `Frontmatter key '${key}' is set multiple times`,
        });
      }
    }
  }

  return issues;
}

/**
 * Lint a kustomark configuration for common issues
 */
export function lintConfig(
  config: KustomarkConfig,
  resources: Array<{ relativePath: string; content: string }> = []
): LintResult {
  const issues: LintIssue[] = [];

  // Run all lint checks
  issues.push(...checkUnreachablePatches(config, resources));
  issues.push(...checkRedundantPatches(config));
  issues.push(...checkOverlappingPatches(config));

  // Count issues by level
  const errorCount = issues.filter((i) => i.level === "error").length;
  const warningCount = issues.filter((i) => i.level === "warning").length;
  const infoCount = issues.filter((i) => i.level === "info").length;

  return {
    issues,
    errorCount,
    warningCount,
    infoCount,
  };
}
