import { z } from "zod";
import yaml from "yaml";
import { readFile } from "fs/promises";

// Common fields for all patch operations
const onNoMatchSchema = z.enum(["skip", "warn", "error"]).default("warn");

const patchBaseSchema = z.object({
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  onNoMatch: onNoMatchSchema.optional(),
});

// Replace operation schema
const replacePatchSchema = patchBaseSchema.extend({
  op: z.literal("replace"),
  old: z.string(),
  new: z.string(),
});

// Replace-regex operation schema
const replaceRegexPatchSchema = patchBaseSchema.extend({
  op: z.literal("replace-regex"),
  pattern: z.string(),
  replacement: z.string(),
  flags: z.string().optional(),
});

// Remove-section operation schema
const removeSectionPatchSchema = patchBaseSchema.extend({
  op: z.literal("remove-section"),
  id: z.string(),
  includeChildren: z.boolean().default(true),
});

// Replace-section operation schema
const replaceSectionPatchSchema = patchBaseSchema.extend({
  op: z.literal("replace-section"),
  id: z.string(),
  content: z.string(),
});

// Prepend-to-section operation schema
const prependToSectionPatchSchema = patchBaseSchema.extend({
  op: z.literal("prepend-to-section"),
  id: z.string(),
  content: z.string(),
});

// Append-to-section operation schema
const appendToSectionPatchSchema = patchBaseSchema.extend({
  op: z.literal("append-to-section"),
  id: z.string(),
  content: z.string(),
});

// Set-frontmatter operation schema (M2)
const setFrontmatterPatchSchema = patchBaseSchema.extend({
  op: z.literal("set-frontmatter"),
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.unknown()), z.record(z.unknown())]),
});

// Remove-frontmatter operation schema (M2)
const removeFrontmatterPatchSchema = patchBaseSchema.extend({
  op: z.literal("remove-frontmatter"),
  key: z.string(),
});

// Rename-frontmatter operation schema (M2)
const renameFrontmatterPatchSchema = patchBaseSchema.extend({
  op: z.literal("rename-frontmatter"),
  old: z.string(),
  new: z.string(),
});

// Merge-frontmatter operation schema (M2)
const mergeFrontmatterPatchSchema = patchBaseSchema.extend({
  op: z.literal("merge-frontmatter"),
  values: z.record(z.unknown()),
});

// Insert-after-line operation schema (M2)
// Note: Either 'match' or 'pattern' should be provided (validated at runtime)
const insertAfterLinePatchSchema = patchBaseSchema.extend({
  op: z.literal("insert-after-line"),
  match: z.string().optional(),
  pattern: z.string().optional(),
  regex: z.boolean().optional(),
  content: z.string(),
});

// Insert-before-line operation schema (M2)
// Note: Either 'match' or 'pattern' should be provided (validated at runtime)
const insertBeforeLinePatchSchema = patchBaseSchema.extend({
  op: z.literal("insert-before-line"),
  match: z.string().optional(),
  pattern: z.string().optional(),
  regex: z.boolean().optional(),
  content: z.string(),
});

// Replace-line operation schema (M2)
// Note: Either 'match' or 'pattern' should be provided (validated at runtime)
const replaceLinePatchSchema = patchBaseSchema.extend({
  op: z.literal("replace-line"),
  match: z.string().optional(),
  pattern: z.string().optional(),
  regex: z.boolean().optional(),
  replacement: z.string(),
});

// Delete-between operation schema (M2)
const deleteBetweenPatchSchema = patchBaseSchema.extend({
  op: z.literal("delete-between"),
  start: z.string(),
  end: z.string(),
  inclusive: z.boolean().default(true),
});

// Replace-between operation schema (M2)
const replaceBetweenPatchSchema = patchBaseSchema.extend({
  op: z.literal("replace-between"),
  start: z.string(),
  end: z.string(),
  content: z.string(),
  inclusive: z.boolean().default(false),
});

// Rename-header operation schema (M2)
const renameHeaderPatchSchema = patchBaseSchema.extend({
  op: z.literal("rename-header"),
  id: z.string(),
  new: z.string(),
});

// Move-section operation schema (M2)
const moveSectionPatchSchema = patchBaseSchema.extend({
  op: z.literal("move-section"),
  id: z.string(),
  after: z.string().optional(),
  before: z.string().optional(),
});

// Change-section-level operation schema (M2)
const changeSectionLevelPatchSchema = patchBaseSchema.extend({
  op: z.literal("change-section-level"),
  id: z.string(),
  delta: z.number(),
});

// Union of all patch operation schemas
const patchSchema = z.discriminatedUnion("op", [
  replacePatchSchema,
  replaceRegexPatchSchema,
  removeSectionPatchSchema,
  replaceSectionPatchSchema,
  prependToSectionPatchSchema,
  appendToSectionPatchSchema,
  setFrontmatterPatchSchema,
  removeFrontmatterPatchSchema,
  renameFrontmatterPatchSchema,
  mergeFrontmatterPatchSchema,
  insertAfterLinePatchSchema,
  insertBeforeLinePatchSchema,
  replaceLinePatchSchema,
  deleteBetweenPatchSchema,
  replaceBetweenPatchSchema,
  renameHeaderPatchSchema,
  moveSectionPatchSchema,
  changeSectionLevelPatchSchema,
]);

// Main kustomark configuration schema
const kustomarkConfigSchema = z.object({
  apiVersion: z.literal("kustomark/v1"),
  kind: z.literal("Kustomization"),
  output: z.string(),
  resources: z.array(z.string()),
  patches: z.array(patchSchema).optional(),
  onNoMatch: onNoMatchSchema.optional(),
});

// Export TypeScript types derived from schemas
export type OnNoMatch = z.infer<typeof onNoMatchSchema>;
export type ReplacePatch = z.infer<typeof replacePatchSchema>;
export type ReplaceRegexPatch = z.infer<typeof replaceRegexPatchSchema>;
export type RemoveSectionPatch = z.infer<typeof removeSectionPatchSchema>;
export type ReplaceSectionPatch = z.infer<typeof replaceSectionPatchSchema>;
export type PrependToSectionPatch = z.infer<typeof prependToSectionPatchSchema>;
export type AppendToSectionPatch = z.infer<typeof appendToSectionPatchSchema>;
export type SetFrontmatterPatch = z.infer<typeof setFrontmatterPatchSchema>;
export type RemoveFrontmatterPatch = z.infer<typeof removeFrontmatterPatchSchema>;
export type RenameFrontmatterPatch = z.infer<typeof renameFrontmatterPatchSchema>;
export type MergeFrontmatterPatch = z.infer<typeof mergeFrontmatterPatchSchema>;
export type InsertAfterLinePatch = z.infer<typeof insertAfterLinePatchSchema>;
export type InsertBeforeLinePatch = z.infer<typeof insertBeforeLinePatchSchema>;
export type ReplaceLinePatch = z.infer<typeof replaceLinePatchSchema>;
export type DeleteBetweenPatch = z.infer<typeof deleteBetweenPatchSchema>;
export type ReplaceBetweenPatch = z.infer<typeof replaceBetweenPatchSchema>;
export type RenameHeaderPatch = z.infer<typeof renameHeaderPatchSchema>;
export type MoveSectionPatch = z.infer<typeof moveSectionPatchSchema>;
export type ChangeSectionLevelPatch = z.infer<typeof changeSectionLevelPatchSchema>;
export type Patch = z.infer<typeof patchSchema>;
export type KustomarkConfig = z.infer<typeof kustomarkConfigSchema>;

// Export schemas for external use
export {
  onNoMatchSchema,
  patchBaseSchema,
  replacePatchSchema,
  replaceRegexPatchSchema,
  removeSectionPatchSchema,
  replaceSectionPatchSchema,
  prependToSectionPatchSchema,
  appendToSectionPatchSchema,
  setFrontmatterPatchSchema,
  removeFrontmatterPatchSchema,
  renameFrontmatterPatchSchema,
  mergeFrontmatterPatchSchema,
  insertAfterLinePatchSchema,
  insertBeforeLinePatchSchema,
  replaceLinePatchSchema,
  deleteBetweenPatchSchema,
  replaceBetweenPatchSchema,
  renameHeaderPatchSchema,
  moveSectionPatchSchema,
  changeSectionLevelPatchSchema,
  patchSchema,
  kustomarkConfigSchema,
};

/**
 * Parse a YAML string and validate it as a kustomark configuration.
 * @param yamlString - The YAML content to parse
 * @returns A validated KustomarkConfig object
 * @throws Error if parsing or validation fails
 */
export function parseConfig(yamlString: string): KustomarkConfig {
  const parsed = yaml.parse(yamlString);
  return kustomarkConfigSchema.parse(parsed);
}

/**
 * Load and validate a kustomark configuration from a file.
 * @param filePath - Path to the YAML configuration file
 * @returns A validated KustomarkConfig object
 * @throws Error if file reading, parsing, or validation fails
 */
export async function loadConfigFile(filePath: string): Promise<KustomarkConfig> {
  const content = await readFile(filePath, "utf-8");
  return parseConfig(content);
}
