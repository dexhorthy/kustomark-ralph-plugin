import { minimatch } from "minimatch";
import GithubSlugger from "github-slugger";
import type {
  Patch,
  ReplacePatch,
  ReplaceRegexPatch,
  RemoveSectionPatch,
  ReplaceSectionPatch,
  PrependToSectionPatch,
  AppendToSectionPatch,
  OnNoMatch,
} from "./config.js";

/**
 * Result of applying patches to content
 */
export interface PatchResult {
  content: string;
  applied: number;
  warnings: string[];
}

/**
 * Represents a parsed markdown section
 */
interface Section {
  id: string;
  level: number;
  startLine: number;
  endLine: number;
  headerLine: number;
  title: string;
}

/**
 * Header regex pattern - matches markdown headers from # to ######
 */
const HEADER_REGEX = /^(#{1,6})\s+(.+)$/;

/**
 * Explicit ID pattern - matches {#custom-id} at the end of a header
 */
const EXPLICIT_ID_REGEX = /\s*\{#([a-zA-Z0-9_-]+)\}\s*$/;

/**
 * Generate a GitHub-style slug from a header title.
 * Uses github-slugger for compatibility with GitHub's slug generation.
 */
function generateSlug(title: string, slugger: GithubSlugger): string {
  // Check for explicit ID first
  const explicitMatch = title.match(EXPLICIT_ID_REGEX);
  if (explicitMatch) {
    return explicitMatch[1];
  }

  // Use github-slugger for standard slug generation
  return slugger.slug(title);
}

/**
 * Parse markdown content and extract all sections with their boundaries.
 * Returns sections sorted by their start line.
 */
function parseSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  const slugger = new GithubSlugger();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(HEADER_REGEX);

    if (match) {
      const level = match[1].length;
      const rawTitle = match[2];

      // Extract title without explicit ID for display
      const title = rawTitle.replace(EXPLICIT_ID_REGEX, "").trim();
      const id = generateSlug(rawTitle, slugger);

      sections.push({
        id,
        level,
        startLine: i,
        headerLine: i,
        endLine: lines.length - 1, // Will be adjusted below
        title,
      });
    }
  }

  // Adjust end lines - a section ends when a section of equal or higher level starts
  // or at the end of the document
  for (let i = 0; i < sections.length; i++) {
    const currentSection = sections[i];

    // Find the next section of equal or lower level (fewer #)
    for (let j = i + 1; j < sections.length; j++) {
      if (sections[j].level <= currentSection.level) {
        currentSection.endLine = sections[j].startLine - 1;
        break;
      }
    }
  }

  return sections;
}

/**
 * Find a section by its ID.
 */
function findSectionById(sections: Section[], id: string): Section | undefined {
  return sections.find((s) => s.id === id);
}

/**
 * Get the end line of a section, optionally including children.
 * Children are sections with a higher level (more #) than the parent.
 */
function getSectionEndLine(
  sections: Section[],
  section: Section,
  includeChildren: boolean
): number {
  if (!includeChildren) {
    // Find the start of the next section at any level
    const sectionIndex = sections.findIndex((s) => s.id === section.id);
    if (sectionIndex < sections.length - 1) {
      return sections[sectionIndex + 1].startLine - 1;
    }
    return section.endLine;
  }

  // Include children: find the next section at same or higher level
  return section.endLine;
}

/**
 * Check if a patch should be applied to a given file based on include/exclude patterns.
 */
export function shouldApplyPatch(patch: Patch, filePath: string): boolean {
  const { include, exclude } = patch;

  // If include patterns are specified, file must match at least one
  if (include && include.length > 0) {
    const matches = include.some((pattern) =>
      minimatch(filePath, pattern, { matchBase: true })
    );
    if (!matches) {
      return false;
    }
  }

  // If exclude patterns are specified, file must not match any
  if (exclude && exclude.length > 0) {
    const excluded = exclude.some((pattern) =>
      minimatch(filePath, pattern, { matchBase: true })
    );
    if (excluded) {
      return false;
    }
  }

  return true;
}

/**
 * Handle no-match condition based on onNoMatch setting.
 */
function handleNoMatch(
  onNoMatch: OnNoMatch | undefined,
  message: string,
  warnings: string[]
): void {
  const behavior = onNoMatch ?? "warn";

  switch (behavior) {
    case "skip":
      // Silently skip
      break;
    case "warn":
      warnings.push(message);
      break;
    case "error":
      throw new Error(message);
  }
}

/**
 * Apply a replace patch - simple string replacement (all occurrences).
 */
function applyReplace(
  content: string,
  patch: ReplacePatch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  const { old: oldStr, new: newStr, onNoMatch } = patch;

  if (!content.includes(oldStr)) {
    handleNoMatch(
      onNoMatch,
      `Patch 'replace' did not match: "${oldStr}" not found in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  // Replace all occurrences
  const result = content.split(oldStr).join(newStr);
  return { content: result, applied: true };
}

/**
 * Apply a replace-regex patch with flag support.
 */
function applyReplaceRegex(
  content: string,
  patch: ReplaceRegexPatch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  const { pattern, replacement, flags = "g", onNoMatch } = patch;

  // Build regex with supported flags
  const regex = new RegExp(pattern, flags);

  // Check if pattern matches
  const testRegex = new RegExp(pattern, flags.replace("g", ""));
  if (!testRegex.test(content)) {
    handleNoMatch(
      onNoMatch,
      `Patch 'replace-regex' did not match: pattern "${pattern}" not found in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  const result = content.replace(regex, replacement);
  return { content: result, applied: true };
}

/**
 * Apply a remove-section patch.
 */
function applyRemoveSection(
  content: string,
  patch: RemoveSectionPatch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  const { id, includeChildren, onNoMatch } = patch;

  const sections = parseSections(content);
  const section = findSectionById(sections, id);

  if (!section) {
    handleNoMatch(
      onNoMatch,
      `Patch 'remove-section' did not match: section "${id}" not found in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  const lines = content.split("\n");
  const endLine = getSectionEndLine(sections, section, includeChildren);

  // Remove lines from startLine to endLine (inclusive)
  const before = lines.slice(0, section.startLine);
  const after = lines.slice(endLine + 1);

  // Join and clean up extra blank lines
  let result = [...before, ...after].join("\n");

  // Clean up multiple consecutive blank lines
  result = result.replace(/\n{3,}/g, "\n\n");

  return { content: result, applied: true };
}

/**
 * Apply a replace-section patch.
 */
function applyReplaceSection(
  content: string,
  patch: ReplaceSectionPatch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  const { id, content: newContent, onNoMatch } = patch;

  const sections = parseSections(content);
  const section = findSectionById(sections, id);

  if (!section) {
    handleNoMatch(
      onNoMatch,
      `Patch 'replace-section' did not match: section "${id}" not found in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  const lines = content.split("\n");

  // Keep the header line, replace everything until section end
  const before = lines.slice(0, section.headerLine + 1);
  const after = lines.slice(section.endLine + 1);

  // Ensure newContent doesn't have trailing newline issues
  const trimmedContent = newContent.replace(/\n$/, "");

  const result = [...before, "", trimmedContent, ...after].join("\n");

  return { content: result, applied: true };
}

/**
 * Apply a prepend-to-section patch.
 */
function applyPrependToSection(
  content: string,
  patch: PrependToSectionPatch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  const { id, content: prependContent, onNoMatch } = patch;

  const sections = parseSections(content);
  const section = findSectionById(sections, id);

  if (!section) {
    handleNoMatch(
      onNoMatch,
      `Patch 'prepend-to-section' did not match: section "${id}" not found in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  const lines = content.split("\n");

  // Insert after the header line
  const before = lines.slice(0, section.headerLine + 1);
  const after = lines.slice(section.headerLine + 1);

  // Ensure content is properly formatted
  const trimmedContent = prependContent.replace(/\n$/, "");

  const result = [...before, "", trimmedContent, ...after].join("\n");

  return { content: result, applied: true };
}

/**
 * Apply an append-to-section patch.
 */
function applyAppendToSection(
  content: string,
  patch: AppendToSectionPatch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  const { id, content: appendContent, onNoMatch } = patch;

  const sections = parseSections(content);
  const section = findSectionById(sections, id);

  if (!section) {
    handleNoMatch(
      onNoMatch,
      `Patch 'append-to-section' did not match: section "${id}" not found in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  const lines = content.split("\n");

  // Insert before the end of the section
  const before = lines.slice(0, section.endLine + 1);
  const after = lines.slice(section.endLine + 1);

  // Ensure content is properly formatted
  const trimmedContent = appendContent.replace(/\n$/, "");

  const result = [...before, "", trimmedContent, ...after].join("\n");

  return { content: result, applied: true };
}

/**
 * Apply a single patch to content.
 */
function applySinglePatch(
  content: string,
  patch: Patch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  switch (patch.op) {
    case "replace":
      return applyReplace(content, patch, warnings, filePath);
    case "replace-regex":
      return applyReplaceRegex(content, patch, warnings, filePath);
    case "remove-section":
      return applyRemoveSection(content, patch, warnings, filePath);
    case "replace-section":
      return applyReplaceSection(content, patch, warnings, filePath);
    case "prepend-to-section":
      return applyPrependToSection(content, patch, warnings, filePath);
    case "append-to-section":
      return applyAppendToSection(content, patch, warnings, filePath);
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = patch;
      throw new Error(`Unknown patch operation: ${(_exhaustive as Patch).op}`);
    }
  }
}

/**
 * Apply an array of patches to markdown content.
 *
 * @param content - The markdown content to patch
 * @param patches - Array of patches to apply in order
 * @param filePath - Path of the file being patched (for include/exclude matching)
 * @returns PatchResult with patched content, count of applied patches, and warnings
 */
export function applyPatches(
  content: string,
  patches: Patch[],
  filePath: string
): PatchResult {
  let currentContent = content;
  let applied = 0;
  const warnings: string[] = [];

  for (const patch of patches) {
    // Check if patch should be applied to this file
    if (!shouldApplyPatch(patch, filePath)) {
      continue;
    }

    const result = applySinglePatch(currentContent, patch, warnings, filePath);
    currentContent = result.content;
    if (result.applied) {
      applied++;
    }
  }

  return {
    content: currentContent,
    applied,
    warnings,
  };
}
