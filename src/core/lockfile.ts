import { readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { createHash } from "crypto";
import yaml from "yaml";
import { z } from "zod";

/**
 * Schema for a single locked resource entry
 */
const lockedResourceSchema = z.object({
  url: z.string(),
  resolved: z.string(),
  integrity: z.string(),
  fetched: z.string(),
});

/**
 * Schema for the lock file
 */
const lockFileSchema = z.object({
  version: z.literal(1),
  resources: z.array(lockedResourceSchema),
});

/**
 * Type for a locked resource
 */
export type LockedResource = z.infer<typeof lockedResourceSchema>;

/**
 * Type for the lock file
 */
export type LockFile = z.infer<typeof lockFileSchema>;

/**
 * Lock file name
 */
export const LOCK_FILE_NAME = "kustomark.lock.yaml";

/**
 * Get the lock file path for a given config path
 */
export function getLockFilePath(configPath: string): string {
  return join(dirname(configPath), LOCK_FILE_NAME);
}

/**
 * Read and parse a lock file
 * Returns null if the file doesn't exist or is invalid
 */
export async function readLockFile(lockFilePath: string): Promise<LockFile | null> {
  try {
    const content = await readFile(lockFilePath, "utf-8");
    const parsed = yaml.parse(content);
    return lockFileSchema.parse(parsed);
  } catch {
    return null;
  }
}

/**
 * Write a lock file
 */
export async function writeLockFile(lockFilePath: string, lockFile: LockFile): Promise<void> {
  const content = yaml.stringify(lockFile);
  await writeFile(lockFilePath, content, "utf-8");
}

/**
 * Calculate SHA256 integrity hash for content
 */
export function calculateIntegrity(content: string | Buffer): string {
  const hash = createHash("sha256");
  hash.update(content);
  return `sha256-${hash.digest("hex")}`;
}

/**
 * Calculate integrity for a set of files
 */
export function calculateFilesIntegrity(
  files: Array<{ relativePath: string; content: string }>
): string {
  // Sort files by path for deterministic hashing
  const sortedFiles = [...files].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  );

  const hash = createHash("sha256");

  for (const file of sortedFiles) {
    // Include both path and content in hash
    hash.update(file.relativePath);
    hash.update("\0"); // null separator
    hash.update(file.content);
    hash.update("\0");
  }

  return `sha256-${hash.digest("hex")}`;
}

/**
 * Verify integrity of fetched files against a locked resource
 */
export function verifyIntegrity(
  files: Array<{ relativePath: string; content: string }>,
  lockedResource: LockedResource
): boolean {
  const calculatedIntegrity = calculateFilesIntegrity(files);
  return calculatedIntegrity === lockedResource.integrity;
}

/**
 * Find a locked resource by URL
 */
export function findLockedResource(
  lockFile: LockFile,
  url: string
): LockedResource | undefined {
  return lockFile.resources.find((r) => r.url === url);
}

/**
 * Create a new locked resource entry
 */
export function createLockedResource(
  url: string,
  resolvedRef: string,
  files: Array<{ relativePath: string; content: string }>
): LockedResource {
  return {
    url,
    resolved: resolvedRef,
    integrity: calculateFilesIntegrity(files),
    fetched: new Date().toISOString(),
  };
}

/**
 * Update or add a resource in the lock file
 */
export function updateLockFile(
  lockFile: LockFile | null,
  resource: LockedResource
): LockFile {
  if (!lockFile) {
    return {
      version: 1,
      resources: [resource],
    };
  }

  const existingIndex = lockFile.resources.findIndex(
    (r) => r.url === resource.url
  );

  if (existingIndex !== -1) {
    // Update existing
    const newResources = [...lockFile.resources];
    newResources[existingIndex] = resource;
    return { ...lockFile, resources: newResources };
  } else {
    // Add new
    return {
      ...lockFile,
      resources: [...lockFile.resources, resource],
    };
  }
}

/**
 * Remove a resource from the lock file
 */
export function removeFromLockFile(
  lockFile: LockFile,
  url: string
): LockFile {
  return {
    ...lockFile,
    resources: lockFile.resources.filter((r) => r.url !== url),
  };
}

/**
 * Create an empty lock file
 */
export function createEmptyLockFile(): LockFile {
  return {
    version: 1,
    resources: [],
  };
}
