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

// Union of all patch operation schemas
const patchSchema = z.discriminatedUnion("op", [
  replacePatchSchema,
  replaceRegexPatchSchema,
  removeSectionPatchSchema,
  replaceSectionPatchSchema,
  prependToSectionPatchSchema,
  appendToSectionPatchSchema,
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
