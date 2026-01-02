import { minimatch } from "minimatch";
import GithubSlugger from "github-slugger";
import yaml from "yaml";
import type {
  Patch,
  ReplacePatch,
  ReplaceRegexPatch,
  RemoveSectionPatch,
  ReplaceSectionPatch,
  PrependToSectionPatch,
  AppendToSectionPatch,
  SetFrontmatterPatch,
  RemoveFrontmatterPatch,
  RenameFrontmatterPatch,
  MergeFrontmatterPatch,
  InsertAfterLinePatch,
  InsertBeforeLinePatch,
  ReplaceLinePatch,
  DeleteBetweenPatch,
  ReplaceBetweenPatch,
  RenameHeaderPatch,
  MoveSectionPatch,
  ChangeSectionLevelPatch,
  OnNoMatch,
} from "./config.js";
import { isFileOperationPatch } from "./file-operations.js";

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
 * Frontmatter regex - matches YAML frontmatter at the start of a file
 */
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

/**
 * Parse frontmatter from markdown content.
 * Returns the frontmatter object and the rest of the content.
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown> | null;
  body: string;
  hasFrontmatter: boolean;
} {
  const match = content.match(FRONTMATTER_REGEX);

  if (!match) {
    return { frontmatter: null, body: content, hasFrontmatter: false };
  }

  const frontmatterStr = match[1];
  const body = content.slice(match[0].length);

  try {
    const frontmatter = yaml.parse(frontmatterStr) as Record<string, unknown>;
    return { frontmatter: frontmatter || {}, body, hasFrontmatter: true };
  } catch {
    // If YAML parsing fails, treat as no frontmatter
    return { frontmatter: null, body: content, hasFrontmatter: false };
  }
}

/**
 * Serialize frontmatter back to markdown format.
 */
function serializeFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string
): string {
  const frontmatterStr = yaml.stringify(frontmatter).trim();
  // Handle body that might start with newline or not
  const normalizedBody = body.startsWith("\n") ? body : "\n" + body;
  return `---\n${frontmatterStr}\n---${normalizedBody}`;
}

/**
 * Get a nested value from an object using dot notation.
 */
function getNestedValue(
  obj: Record<string, unknown>,
  path: string
): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Set a nested value in an object using dot notation.
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Delete a nested value from an object using dot notation.
 */
function deleteNestedValue(
  obj: Record<string, unknown>,
  path: string
): boolean {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object" || current[part] === null) {
      return false;
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];
  if (lastPart in current) {
    delete current[lastPart];
    return true;
  }

  return false;
}

/**
 * Apply a set-frontmatter patch.
 */
function applySetFrontmatter(
  content: string,
  patch: SetFrontmatterPatch,
  _warnings: string[],
  _filePath: string
): { content: string; applied: boolean } {
  const { key, value } = patch;

  const { frontmatter, body, hasFrontmatter } = parseFrontmatter(content);

  // Create frontmatter if it doesn't exist
  const fm = frontmatter || {};

  // Set the value using dot notation support
  setNestedValue(fm, key, value);

  // Serialize back
  const result = serializeFrontmatter(fm, hasFrontmatter ? body : "\n" + content);

  return { content: result, applied: true };
}

/**
 * Apply a remove-frontmatter patch.
 */
function applyRemoveFrontmatter(
  content: string,
  patch: RemoveFrontmatterPatch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  const { key, onNoMatch } = patch;

  const { frontmatter, body, hasFrontmatter } = parseFrontmatter(content);

  if (!hasFrontmatter || !frontmatter) {
    handleNoMatch(
      onNoMatch,
      `Patch 'remove-frontmatter' did not match: no frontmatter in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  // Check if key exists
  if (getNestedValue(frontmatter, key) === undefined) {
    handleNoMatch(
      onNoMatch,
      `Patch 'remove-frontmatter' did not match: key "${key}" not found in frontmatter of ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  // Delete the key
  deleteNestedValue(frontmatter, key);

  // Serialize back
  const result = serializeFrontmatter(frontmatter, body);

  return { content: result, applied: true };
}

/**
 * Apply a rename-frontmatter patch.
 */
function applyRenameFrontmatter(
  content: string,
  patch: RenameFrontmatterPatch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  const { old: oldKey, new: newKey, onNoMatch } = patch;

  const { frontmatter, body, hasFrontmatter } = parseFrontmatter(content);

  if (!hasFrontmatter || !frontmatter) {
    handleNoMatch(
      onNoMatch,
      `Patch 'rename-frontmatter' did not match: no frontmatter in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  // Check if old key exists
  const value = getNestedValue(frontmatter, oldKey);
  if (value === undefined) {
    handleNoMatch(
      onNoMatch,
      `Patch 'rename-frontmatter' did not match: key "${oldKey}" not found in frontmatter of ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  // Delete old key and set new key
  deleteNestedValue(frontmatter, oldKey);
  setNestedValue(frontmatter, newKey, value);

  // Serialize back
  const result = serializeFrontmatter(frontmatter, body);

  return { content: result, applied: true };
}

/**
 * Deep merge two objects. Arrays are replaced, not concatenated.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (
      sourceValue !== null &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else {
      result[key] = sourceValue;
    }
  }

  return result;
}

/**
 * Apply a merge-frontmatter patch.
 */
function applyMergeFrontmatter(
  content: string,
  patch: MergeFrontmatterPatch,
  _warnings: string[],
  _filePath: string
): { content: string; applied: boolean } {
  const { values } = patch;

  const { frontmatter, body, hasFrontmatter } = parseFrontmatter(content);

  // Create frontmatter if it doesn't exist
  const fm = frontmatter || {};

  // Deep merge the values
  const merged = deepMerge(fm, values as Record<string, unknown>);

  // Serialize back
  const result = serializeFrontmatter(merged, hasFrontmatter ? body : "\n" + content);

  return { content: result, applied: true };
}

/**
 * Find the line number that matches the given pattern.
 * Returns -1 if no match is found.
 */
function findMatchingLine(
  lines: string[],
  match: string | undefined,
  pattern: string | undefined,
  regex: boolean | undefined
): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (pattern !== undefined) {
      // Use pattern (always regex)
      const re = new RegExp(pattern);
      if (re.test(line)) {
        return i;
      }
    } else if (match !== undefined) {
      if (regex) {
        // Treat match as regex
        const re = new RegExp(match);
        if (re.test(line)) {
          return i;
        }
      } else {
        // Exact match (line contains the string)
        if (line.includes(match)) {
          return i;
        }
      }
    }
  }

  return -1;
}

/**
 * Apply an insert-after-line patch.
 */
function applyInsertAfterLine(
  content: string,
  patch: InsertAfterLinePatch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  const { match, pattern, regex, content: insertContent, onNoMatch } = patch;

  const lines = content.split("\n");
  const lineIndex = findMatchingLine(lines, match, pattern, regex);

  if (lineIndex === -1) {
    handleNoMatch(
      onNoMatch,
      `Patch 'insert-after-line' did not match: pattern not found in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  // Insert content after the matched line
  const trimmedContent = insertContent.replace(/\n$/, "");
  const before = lines.slice(0, lineIndex + 1);
  const after = lines.slice(lineIndex + 1);

  const result = [...before, trimmedContent, ...after].join("\n");

  return { content: result, applied: true };
}

/**
 * Apply an insert-before-line patch.
 */
function applyInsertBeforeLine(
  content: string,
  patch: InsertBeforeLinePatch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  const { match, pattern, regex, content: insertContent, onNoMatch } = patch;

  const lines = content.split("\n");
  const lineIndex = findMatchingLine(lines, match, pattern, regex);

  if (lineIndex === -1) {
    handleNoMatch(
      onNoMatch,
      `Patch 'insert-before-line' did not match: pattern not found in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  // Insert content before the matched line
  const trimmedContent = insertContent.replace(/\n$/, "");
  const before = lines.slice(0, lineIndex);
  const after = lines.slice(lineIndex);

  const result = [...before, trimmedContent, ...after].join("\n");

  return { content: result, applied: true };
}

/**
 * Apply a replace-line patch.
 */
function applyReplaceLine(
  content: string,
  patch: ReplaceLinePatch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  const { match, pattern, regex, replacement, onNoMatch } = patch;

  const lines = content.split("\n");
  const lineIndex = findMatchingLine(lines, match, pattern, regex);

  if (lineIndex === -1) {
    handleNoMatch(
      onNoMatch,
      `Patch 'replace-line' did not match: pattern not found in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  // Replace the matched line
  lines[lineIndex] = replacement;

  return { content: lines.join("\n"), applied: true };
}

/**
 * Find the line indices for start and end markers.
 */
function findBetweenMarkers(
  lines: string[],
  start: string,
  end: string
): { startIndex: number; endIndex: number } | null {
  let startIndex = -1;
  let endIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (startIndex === -1 && lines[i].includes(start)) {
      startIndex = i;
    } else if (startIndex !== -1 && lines[i].includes(end)) {
      endIndex = i;
      break;
    }
  }

  if (startIndex === -1 || endIndex === -1) {
    return null;
  }

  return { startIndex, endIndex };
}

/**
 * Apply a delete-between patch.
 */
function applyDeleteBetween(
  content: string,
  patch: DeleteBetweenPatch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  const { start, end, inclusive, onNoMatch } = patch;

  const lines = content.split("\n");
  const markers = findBetweenMarkers(lines, start, end);

  if (!markers) {
    handleNoMatch(
      onNoMatch,
      `Patch 'delete-between' did not match: markers not found in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  const { startIndex, endIndex } = markers;

  // Delete lines between (and optionally including) the markers
  const deleteStart = inclusive ? startIndex : startIndex + 1;
  const deleteEnd = inclusive ? endIndex + 1 : endIndex;

  const before = lines.slice(0, deleteStart);
  const after = lines.slice(deleteEnd);

  let result = [...before, ...after].join("\n");

  // Clean up multiple consecutive blank lines
  result = result.replace(/\n{3,}/g, "\n\n");

  return { content: result, applied: true };
}

/**
 * Apply a replace-between patch.
 */
function applyReplaceBetween(
  content: string,
  patch: ReplaceBetweenPatch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  const { start, end, content: newContent, inclusive, onNoMatch } = patch;

  const lines = content.split("\n");
  const markers = findBetweenMarkers(lines, start, end);

  if (!markers) {
    handleNoMatch(
      onNoMatch,
      `Patch 'replace-between' did not match: markers not found in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  const { startIndex, endIndex } = markers;
  const trimmedContent = newContent.replace(/\n$/, "");

  // Replace lines between (and optionally including) the markers
  if (inclusive) {
    // Replace including markers
    const before = lines.slice(0, startIndex);
    const after = lines.slice(endIndex + 1);
    return { content: [...before, trimmedContent, ...after].join("\n"), applied: true };
  } else {
    // Replace content between markers, keep markers
    const before = lines.slice(0, startIndex + 1);
    const after = lines.slice(endIndex);
    return { content: [...before, trimmedContent, ...after].join("\n"), applied: true };
  }
}

/**
 * Apply a rename-header patch.
 */
function applyRenameHeader(
  content: string,
  patch: RenameHeaderPatch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  const { id, new: newTitle, onNoMatch } = patch;

  const sections = parseSections(content);
  const section = findSectionById(sections, id);

  if (!section) {
    handleNoMatch(
      onNoMatch,
      `Patch 'rename-header' did not match: section "${id}" not found in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  const lines = content.split("\n");
  const headerLine = lines[section.headerLine];

  // Preserve the header level (number of #)
  const levelMatch = headerLine.match(/^(#{1,6})\s+/);
  if (!levelMatch) {
    return { content, applied: false };
  }

  const level = levelMatch[1];
  lines[section.headerLine] = `${level} ${newTitle}`;

  return { content: lines.join("\n"), applied: true };
}

/**
 * Apply a move-section patch.
 */
function applyMoveSection(
  content: string,
  patch: MoveSectionPatch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  const { id, after, before, onNoMatch } = patch;

  const sections = parseSections(content);
  const section = findSectionById(sections, id);

  if (!section) {
    handleNoMatch(
      onNoMatch,
      `Patch 'move-section' did not match: section "${id}" not found in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  // Find target section
  const targetId = after || before;
  if (!targetId) {
    handleNoMatch(
      onNoMatch,
      `Patch 'move-section' requires either 'after' or 'before' to be specified`,
      warnings
    );
    return { content, applied: false };
  }

  const targetSection = findSectionById(sections, targetId);
  if (!targetSection) {
    handleNoMatch(
      onNoMatch,
      `Patch 'move-section' did not match: target section "${targetId}" not found in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  const lines = content.split("\n");

  // Extract the section content (including header and children)
  const sectionLines = lines.slice(section.startLine, section.endLine + 1);

  // Remove the section from its original position
  const withoutSection = [
    ...lines.slice(0, section.startLine),
    ...lines.slice(section.endLine + 1),
  ];

  // Recalculate target position after removal
  let targetLine: number;
  if (section.startLine < targetSection.startLine) {
    // Section was before target, adjust for removal
    const removedLines = section.endLine - section.startLine + 1;
    if (after) {
      targetLine = targetSection.endLine - removedLines + 1;
    } else {
      targetLine = targetSection.startLine - removedLines;
    }
  } else {
    // Section was after target, no adjustment needed
    if (after) {
      targetLine = targetSection.endLine + 1;
    } else {
      targetLine = targetSection.startLine;
    }
  }

  // Insert section at new position
  const result = [
    ...withoutSection.slice(0, targetLine),
    ...sectionLines,
    ...withoutSection.slice(targetLine),
  ];

  return { content: result.join("\n"), applied: true };
}

/**
 * Apply a change-section-level patch.
 */
function applyChangeSectionLevel(
  content: string,
  patch: ChangeSectionLevelPatch,
  warnings: string[],
  filePath: string
): { content: string; applied: boolean } {
  const { id, delta, onNoMatch } = patch;

  const sections = parseSections(content);
  const section = findSectionById(sections, id);

  if (!section) {
    handleNoMatch(
      onNoMatch,
      `Patch 'change-section-level' did not match: section "${id}" not found in ${filePath}`,
      warnings
    );
    return { content, applied: false };
  }

  const lines = content.split("\n");

  // Change the level of this section and all its children
  for (let i = section.startLine; i <= section.endLine; i++) {
    const line = lines[i];
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headerMatch) {
      const currentLevel = headerMatch[1].length;
      const title = headerMatch[2];
      const newLevel = Math.max(1, Math.min(6, currentLevel + delta));
      lines[i] = "#".repeat(newLevel) + " " + title;
    }
  }

  return { content: lines.join("\n"), applied: true };
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
  // File operations are handled separately by file-operations.ts
  if (isFileOperationPatch(patch)) {
    return { content, applied: false };
  }

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
    case "set-frontmatter":
      return applySetFrontmatter(content, patch, warnings, filePath);
    case "remove-frontmatter":
      return applyRemoveFrontmatter(content, patch, warnings, filePath);
    case "rename-frontmatter":
      return applyRenameFrontmatter(content, patch, warnings, filePath);
    case "merge-frontmatter":
      return applyMergeFrontmatter(content, patch, warnings, filePath);
    case "insert-after-line":
      return applyInsertAfterLine(content, patch, warnings, filePath);
    case "insert-before-line":
      return applyInsertBeforeLine(content, patch, warnings, filePath);
    case "replace-line":
      return applyReplaceLine(content, patch, warnings, filePath);
    case "delete-between":
      return applyDeleteBetween(content, patch, warnings, filePath);
    case "replace-between":
      return applyReplaceBetween(content, patch, warnings, filePath);
    case "rename-header":
      return applyRenameHeader(content, patch, warnings, filePath);
    case "move-section":
      return applyMoveSection(content, patch, warnings, filePath);
    case "change-section-level":
      return applyChangeSectionLevel(content, patch, warnings, filePath);
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = patch;
      throw new Error(`Unknown patch operation: ${(_exhaustive as Patch).op}`);
    }
  }
}

/**
 * Run per-patch validation on content.
 * Returns an error message if validation fails, null if it passes.
 */
function runPatchValidation(
  content: string,
  validation: {
    notContains?: string;
    contains?: string;
    matches?: string;
    notMatches?: string;
  } | undefined
): string | null {
  if (!validation) {
    return null;
  }

  // notContains check
  if (validation.notContains !== undefined) {
    if (content.includes(validation.notContains)) {
      return `Contains '${validation.notContains}'`;
    }
  }

  // contains check
  if (validation.contains !== undefined) {
    if (!content.includes(validation.contains)) {
      return `Does not contain '${validation.contains}'`;
    }
  }

  // matches check (regex)
  if (validation.matches !== undefined) {
    const regex = new RegExp(validation.matches);
    if (!regex.test(content)) {
      return `Does not match pattern '${validation.matches}'`;
    }
  }

  // notMatches check (regex)
  if (validation.notMatches !== undefined) {
    const regex = new RegExp(validation.notMatches);
    if (regex.test(content)) {
      return `Matches forbidden pattern '${validation.notMatches}'`;
    }
  }

  return null;
}

/**
 * Options for filtering patches by group.
 */
export interface GroupOptions {
  enableGroups?: string[];
  disableGroups?: string[];
}

/**
 * Check if a patch should be applied based on group filtering.
 *
 * @param patch - The patch to check
 * @param groupOptions - Group filtering options
 * @returns true if the patch should be applied based on group rules
 */
function shouldApplyByGroup(patch: Patch, groupOptions?: GroupOptions): boolean {
  if (!groupOptions) return true;

  const { enableGroups, disableGroups } = groupOptions;
  const patchGroup = patch.group;

  // If enable-groups is specified, only patches in those groups (or ungrouped) are applied
  if (enableGroups && enableGroups.length > 0) {
    // Ungrouped patches are always applied when enable-groups is used
    if (!patchGroup) return true;
    // Only apply if patch's group is in the enabled list
    return enableGroups.includes(patchGroup);
  }

  // If disable-groups is specified, patches in those groups are skipped
  if (disableGroups && disableGroups.length > 0) {
    if (patchGroup && disableGroups.includes(patchGroup)) {
      return false;
    }
  }

  return true;
}

/**
 * Apply an array of patches to markdown content.
 *
 * @param content - The markdown content to patch
 * @param patches - Array of patches to apply in order
 * @param filePath - Path of the file being patched (for include/exclude matching)
 * @param groupOptions - Optional group filtering options
 * @returns PatchResult with patched content, count of applied patches, and warnings
 */
export function applyPatches(
  content: string,
  patches: Patch[],
  filePath: string,
  groupOptions?: GroupOptions
): PatchResult {
  let currentContent = content;
  let applied = 0;
  const warnings: string[] = [];

  for (const patch of patches) {
    // Check if patch should be applied to this file
    if (!shouldApplyPatch(patch, filePath)) {
      continue;
    }

    // Check if patch should be applied based on group filtering
    if (!shouldApplyByGroup(patch, groupOptions)) {
      continue;
    }

    const result = applySinglePatch(currentContent, patch, warnings, filePath);
    currentContent = result.content;
    if (result.applied) {
      applied++;

      // Run per-patch validation if specified
      if (patch.validate) {
        const validationError = runPatchValidation(currentContent, patch.validate);
        if (validationError) {
          warnings.push(`Validation failed for patch '${patch.op}' on ${filePath}: ${validationError}`);
        }
      }
    }
  }

  return {
    content: currentContent,
    applied,
    warnings,
  };
}
