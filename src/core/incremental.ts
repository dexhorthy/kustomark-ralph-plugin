import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";
import yaml from "yaml";
import { z } from "zod";

/**
 * Schema for a single file entry in the manifest
 */
const manifestFileSchema = z.object({
  source: z.string(),
  output: z.string(),
  sourceHash: z.string(),
  outputHash: z.string(),
  patchesApplied: z.number(),
});

/**
 * Schema for the build manifest
 */
const buildManifestSchema = z.object({
  version: z.literal(1),
  configHash: z.string(),
  patchesHash: z.string(),
  buildTime: z.string(),
  files: z.array(manifestFileSchema),
});

/**
 * Type for a manifest file entry
 */
export type ManifestFile = z.infer<typeof manifestFileSchema>;

/**
 * Type for the build manifest
 */
export type BuildManifest = z.infer<typeof buildManifestSchema>;

/**
 * Manifest file name
 */
export const MANIFEST_FILE_NAME = ".kustomark.manifest.yaml";

/**
 * Calculate SHA256 hash for content
 */
export function calculateHash(content: string): string {
  const hash = createHash("sha256");
  hash.update(content);
  return hash.digest("hex");
}

/**
 * Calculate hash for an array of patches
 */
export function calculatePatchesHash(patches: unknown[]): string {
  const hash = createHash("sha256");
  // Sort patches by their JSON representation for deterministic hashing
  const patchStrings = patches.map((p) => JSON.stringify(p)).sort();
  for (const patchStr of patchStrings) {
    hash.update(patchStr);
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Get the manifest file path for a given output directory
 */
export function getManifestPath(outputDir: string): string {
  return join(outputDir, MANIFEST_FILE_NAME);
}

/**
 * Read and parse a build manifest
 * Returns null if the file doesn't exist or is invalid
 */
export async function readManifest(manifestPath: string): Promise<BuildManifest | null> {
  try {
    const content = await readFile(manifestPath, "utf-8");
    const parsed = yaml.parse(content);
    return buildManifestSchema.parse(parsed);
  } catch {
    return null;
  }
}

/**
 * Write a build manifest
 */
export async function writeManifest(manifestPath: string, manifest: BuildManifest): Promise<void> {
  const content = yaml.stringify(manifest);
  await writeFile(manifestPath, content, "utf-8");
}

/**
 * Create a new build manifest
 */
export function createManifest(
  configHash: string,
  patchesHash: string,
  files: ManifestFile[]
): BuildManifest {
  return {
    version: 1,
    configHash,
    patchesHash,
    buildTime: new Date().toISOString(),
    files,
  };
}

/**
 * Result of checking if a file needs rebuilding
 */
export interface FileChangeStatus {
  source: string;
  needsRebuild: boolean;
  reason: "new" | "source-changed" | "unchanged";
}

/**
 * Result of incremental build analysis
 */
export interface IncrementalAnalysis {
  configChanged: boolean;
  patchesChanged: boolean;
  fullRebuildRequired: boolean;
  filesToRebuild: string[];
  filesToSkip: string[];
  deletedFiles: string[];
}

/**
 * Analyze what needs to be rebuilt
 */
export function analyzeChanges(
  manifest: BuildManifest | null,
  currentConfigHash: string,
  currentPatchesHash: string,
  currentSources: Array<{ relativePath: string; content: string }>
): IncrementalAnalysis {
  // If no manifest, rebuild everything
  if (!manifest) {
    return {
      configChanged: true,
      patchesChanged: true,
      fullRebuildRequired: true,
      filesToRebuild: currentSources.map((s) => s.relativePath),
      filesToSkip: [],
      deletedFiles: [],
    };
  }

  const configChanged = manifest.configHash !== currentConfigHash;
  const patchesChanged = manifest.patchesHash !== currentPatchesHash;

  // If config or patches changed, rebuild everything
  if (configChanged || patchesChanged) {
    return {
      configChanged,
      patchesChanged,
      fullRebuildRequired: true,
      filesToRebuild: currentSources.map((s) => s.relativePath),
      filesToSkip: [],
      deletedFiles: [],
    };
  }

  // Check individual files
  const manifestFileMap = new Map<string, ManifestFile>();
  for (const file of manifest.files) {
    manifestFileMap.set(file.source, file);
  }

  const currentSourcePaths = new Set(currentSources.map((s) => s.relativePath));
  const filesToRebuild: string[] = [];
  const filesToSkip: string[] = [];
  const deletedFiles: string[] = [];

  // Check each current source
  for (const source of currentSources) {
    const manifestEntry = manifestFileMap.get(source.relativePath);
    if (!manifestEntry) {
      // New file
      filesToRebuild.push(source.relativePath);
    } else {
      const currentHash = calculateHash(source.content);
      if (currentHash !== manifestEntry.sourceHash) {
        // Source changed
        filesToRebuild.push(source.relativePath);
      } else {
        // Unchanged
        filesToSkip.push(source.relativePath);
      }
    }
  }

  // Check for deleted files (in manifest but not in current sources)
  for (const file of manifest.files) {
    if (!currentSourcePaths.has(file.source)) {
      deletedFiles.push(file.output);
    }
  }

  return {
    configChanged: false,
    patchesChanged: false,
    fullRebuildRequired: false,
    filesToRebuild,
    filesToSkip,
    deletedFiles,
  };
}

/**
 * Create a manifest file entry
 */
export function createManifestFile(
  source: string,
  output: string,
  sourceContent: string,
  outputContent: string,
  patchesApplied: number
): ManifestFile {
  return {
    source,
    output,
    sourceHash: calculateHash(sourceContent),
    outputHash: calculateHash(outputContent),
    patchesApplied,
  };
}
