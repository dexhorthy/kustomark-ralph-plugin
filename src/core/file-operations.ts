import { minimatch } from "minimatch";
import type {
  Patch,
  CopyFilePatch,
  RenameFilePatch,
  DeleteFilePatch,
  MoveFilePatch,
} from "./config.js";

/**
 * Result of applying file operations
 */
export interface FileOperationResult {
  /** Files to add (path -> content) */
  addedFiles: Map<string, string>;
  /** Files to delete (relative paths) */
  deletedFiles: Set<string>;
  /** Files that were renamed (old path -> new path) */
  renamedFiles: Map<string, string>;
  /** Warnings generated during processing */
  warnings: string[];
  /** Number of operations applied */
  operationsApplied: number;
}

/**
 * Resource file with path and content
 */
export interface ResourceFile {
  relativePath: string;
  content: string;
}

/**
 * Check if a patch is a file operation
 */
export function isFileOperationPatch(patch: Patch): patch is CopyFilePatch | RenameFilePatch | DeleteFilePatch | MoveFilePatch {
  return patch.op === "copy-file" || patch.op === "rename-file" || patch.op === "delete-file" || patch.op === "move-file";
}

/**
 * Apply copy-file operation.
 * Copies content from a source resource to a new destination path.
 */
function applyCopyFile(
  patch: CopyFilePatch,
  resources: ResourceFile[],
  result: FileOperationResult
): void {
  const { src, dest } = patch;

  // Find the source file in resources
  const sourceFile = resources.find(r => r.relativePath === src);

  if (!sourceFile) {
    result.warnings.push(`copy-file: Source file '${src}' not found in resources`);
    return;
  }

  // Add the file to the added files map
  result.addedFiles.set(dest, sourceFile.content);
  result.operationsApplied++;
}

/**
 * Apply rename-file operation.
 * Renames files matching a glob pattern.
 */
function applyRenameFile(
  patch: RenameFilePatch,
  resources: ResourceFile[],
  result: FileOperationResult
): void {
  const { match: pattern, rename: newName } = patch;

  let matchCount = 0;

  for (const resource of resources) {
    if (minimatch(resource.relativePath, pattern, { matchBase: true })) {
      // Calculate new path - replace just the filename
      const pathParts = resource.relativePath.split("/");
      pathParts[pathParts.length - 1] = newName;
      const newPath = pathParts.join("/");

      result.renamedFiles.set(resource.relativePath, newPath);
      matchCount++;
    }
  }

  if (matchCount === 0) {
    result.warnings.push(`rename-file: No files matched pattern '${pattern}'`);
  } else {
    result.operationsApplied++;
  }
}

/**
 * Apply delete-file operation.
 * Deletes files matching a glob pattern.
 */
function applyDeleteFile(
  patch: DeleteFilePatch,
  resources: ResourceFile[],
  result: FileOperationResult
): void {
  const { match: pattern } = patch;

  let matchCount = 0;

  for (const resource of resources) {
    if (minimatch(resource.relativePath, pattern, { matchBase: true })) {
      result.deletedFiles.add(resource.relativePath);
      matchCount++;
    }
  }

  if (matchCount === 0) {
    result.warnings.push(`delete-file: No files matched pattern '${pattern}'`);
  } else {
    result.operationsApplied++;
  }
}

/**
 * Apply move-file operation.
 * Moves files matching a glob pattern to a new directory.
 */
function applyMoveFile(
  patch: MoveFilePatch,
  resources: ResourceFile[],
  result: FileOperationResult
): void {
  const { match: pattern, dest } = patch;

  let matchCount = 0;

  for (const resource of resources) {
    if (minimatch(resource.relativePath, pattern, { matchBase: true })) {
      // Get the filename from the current path
      const filename = resource.relativePath.split("/").pop() || resource.relativePath;

      // Calculate new path - move to dest directory
      const newPath = dest.endsWith("/")
        ? dest + filename
        : dest + "/" + filename;

      result.renamedFiles.set(resource.relativePath, newPath);
      matchCount++;
    }
  }

  if (matchCount === 0) {
    result.warnings.push(`move-file: No files matched pattern '${pattern}'`);
  } else {
    result.operationsApplied++;
  }
}

/**
 * Apply file operations from patches to a set of resources.
 * Returns information about files to add, delete, and rename.
 *
 * @param patches - Array of patches (will filter to file operations)
 * @param resources - Array of resource files to operate on
 * @returns FileOperationResult with add/delete/rename information
 */
export function applyFileOperations(
  patches: Patch[],
  resources: ResourceFile[]
): FileOperationResult {
  const result: FileOperationResult = {
    addedFiles: new Map(),
    deletedFiles: new Set(),
    renamedFiles: new Map(),
    warnings: [],
    operationsApplied: 0,
  };

  for (const patch of patches) {
    switch (patch.op) {
      case "copy-file":
        applyCopyFile(patch, resources, result);
        break;
      case "rename-file":
        applyRenameFile(patch, resources, result);
        break;
      case "delete-file":
        applyDeleteFile(patch, resources, result);
        break;
      case "move-file":
        applyMoveFile(patch, resources, result);
        break;
      default:
        // Not a file operation, skip
        break;
    }
  }

  return result;
}

/**
 * Apply file operation results to a list of resources.
 * Returns the modified list of resources after applying operations.
 *
 * @param resources - Original resource files
 * @param operations - File operation results to apply
 * @returns Modified list of resources
 */
export function applyFileOperationResults(
  resources: ResourceFile[],
  operations: FileOperationResult
): ResourceFile[] {
  const result: ResourceFile[] = [];

  // Process existing resources
  for (const resource of resources) {
    // Check if file is deleted
    if (operations.deletedFiles.has(resource.relativePath)) {
      continue;
    }

    // Check if file is renamed/moved
    const newPath = operations.renamedFiles.get(resource.relativePath);
    if (newPath) {
      result.push({
        relativePath: newPath,
        content: resource.content,
      });
    } else {
      result.push(resource);
    }
  }

  // Add new files from copy operations
  for (const [path, content] of operations.addedFiles) {
    result.push({
      relativePath: path,
      content,
    });
  }

  return result;
}
