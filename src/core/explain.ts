import { dirname, join, resolve, relative } from "path";
import { loadConfigFile } from "./config.js";
import { resolveResources } from "./resources.js";
import { resolveExtends } from "./patches.js";

/**
 * A config in the resolution chain
 */
export interface ChainEntry {
  config: string;
  resources: number;
  patches: number;
}

/**
 * Result of explaining a kustomark configuration
 */
export interface ExplainResult {
  config: string;
  output: string;
  chain: ChainEntry[];
  totalFiles: number;
  totalPatches: number;
}

/**
 * Information about a patch applied to a file
 */
export interface FilePatchInfo {
  config: string;
  op: string;
  [key: string]: unknown;
}

/**
 * Result of explaining a specific file's lineage
 */
export interface FileLineageResult {
  file: string;
  source: string;
  patches: FilePatchInfo[];
}

/**
 * Track visited configs to detect circular references
 */
type VisitedSet = Set<string>;

/**
 * Build the resolution chain for a config
 */
async function buildChain(
  configPath: string,
  visited: VisitedSet
): Promise<ChainEntry[]> {
  const resolvedPath = resolve(configPath);

  // Detect circular references
  if (visited.has(resolvedPath)) {
    return [];
  }
  visited.add(resolvedPath);

  try {
    const config = await loadConfigFile(resolvedPath);
    const configDir = dirname(resolvedPath);

    // Count resources that are files (not other configs)
    let resourceCount = 0;
    const subChains: ChainEntry[] = [];

    for (const resource of config.resources) {
      // Check if this is a reference to another kustomark config
      const resourcePath = resolve(configDir, resource);

      // If it's a directory, look for kustomark.yaml
      try {
        const stat = await import("fs").then((m) =>
          m.promises.stat(resourcePath)
        );
        if (stat.isDirectory()) {
          const subConfigPath = join(resourcePath, "kustomark.yaml");
          try {
            await import("fs").then((m) =>
              m.promises.access(subConfigPath)
            );
            // It's another kustomark config - recurse
            const subChain = await buildChain(subConfigPath, visited);
            subChains.push(...subChain);
          } catch {
            // Not a kustomark config directory - count as resources
            try {
              const resources = await resolveResources(resolvedPath, [resource]);
              resourceCount += resources.length;
            } catch {
              // Ignore resolution errors
            }
          }
        } else {
          // It's a file pattern
          try {
            const resources = await resolveResources(resolvedPath, [resource]);
            resourceCount += resources.length;
          } catch {
            // Ignore resolution errors
          }
        }
      } catch {
        // Path doesn't exist - try as a glob pattern
        try {
          const resources = await resolveResources(resolvedPath, [resource]);
          resourceCount += resources.length;
        } catch {
          // Ignore resolution errors
        }
      }
    }

    const patchCount = config.patches?.length || 0;

    // Add sub-chains first (base configs)
    const chain: ChainEntry[] = [...subChains];

    // Then add this config
    chain.push({
      config: relative(process.cwd(), resolvedPath) || resolvedPath,
      resources: resourceCount,
      patches: patchCount,
    });

    return chain;
  } catch {
    return [];
  }
}

/**
 * Explain a kustomark configuration
 */
export async function explainConfig(
  configPath: string
): Promise<ExplainResult> {
  const resolvedPath = resolve(configPath);
  const config = await loadConfigFile(resolvedPath);

  const visited: VisitedSet = new Set();
  const chain = await buildChain(resolvedPath, visited);

  const totalFiles = chain.reduce((sum, entry) => sum + entry.resources, 0);
  const totalPatches = chain.reduce((sum, entry) => sum + entry.patches, 0);

  return {
    config: relative(process.cwd(), resolvedPath) || resolvedPath,
    output: config.output,
    chain,
    totalFiles,
    totalPatches,
  };
}

/**
 * Find patches that apply to a specific file
 */
async function findPatchesForFile(
  configPath: string,
  filePath: string,
  visited: VisitedSet
): Promise<FilePatchInfo[]> {
  const resolvedPath = resolve(configPath);

  if (visited.has(resolvedPath)) {
    return [];
  }
  visited.add(resolvedPath);

  try {
    const config = await loadConfigFile(resolvedPath);
    const configDir = dirname(resolvedPath);
    const configName =
      relative(process.cwd(), dirname(resolvedPath)) || "root";

    const patches: FilePatchInfo[] = [];

    // First, check sub-configs
    for (const resource of config.resources) {
      const resourcePath = resolve(configDir, resource);
      try {
        const stat = await import("fs").then((m) =>
          m.promises.stat(resourcePath)
        );
        if (stat.isDirectory()) {
          const subConfigPath = join(resourcePath, "kustomark.yaml");
          try {
            await import("fs").then((m) =>
              m.promises.access(subConfigPath)
            );
            const subPatches = await findPatchesForFile(
              subConfigPath,
              filePath,
              visited
            );
            patches.push(...subPatches);
          } catch {
            // Not a kustomark config directory
          }
        }
      } catch {
        // Path doesn't exist
      }
    }

    // Then check this config's patches
    if (config.patches) {
      const { minimatch } = await import("minimatch");
      const resolvedPatches = resolveExtends(config.patches);

      for (const patch of resolvedPatches) {
        const include = patch.include || ["**/*"];
        const exclude = patch.exclude || [];

        const matchesInclude = include.some((pattern) =>
          minimatch(filePath, pattern)
        );
        const matchesExclude = exclude.some((pattern) =>
          minimatch(filePath, pattern)
        );

        if (matchesInclude && !matchesExclude) {
          // Create a clean patch info object
          const patchInfo: FilePatchInfo = {
            config: configName,
            op: patch.op,
          };

          // Add relevant patch properties based on op type
          switch (patch.op) {
            case "replace":
              patchInfo.old = patch.old;
              patchInfo.new = patch.new;
              break;
            case "replace-regex":
              patchInfo.pattern = patch.pattern;
              patchInfo.replacement = patch.replacement;
              break;
            case "remove-section":
            case "replace-section":
            case "prepend-to-section":
            case "append-to-section":
            case "rename-header":
            case "move-section":
            case "change-section-level":
              patchInfo.id = patch.id;
              break;
            case "set-frontmatter":
              patchInfo.key = patch.key;
              patchInfo.value = patch.value;
              break;
            case "remove-frontmatter":
              patchInfo.key = patch.key;
              break;
          }

          patches.push(patchInfo);
        }
      }
    }

    return patches;
  } catch {
    return [];
  }
}

/**
 * Find the source file path for a given output file
 */
async function findSourceFile(
  configPath: string,
  filePath: string,
  visited: VisitedSet
): Promise<string | null> {
  const resolvedPath = resolve(configPath);

  if (visited.has(resolvedPath)) {
    return null;
  }
  visited.add(resolvedPath);

  try {
    const config = await loadConfigFile(resolvedPath);
    const configDir = dirname(resolvedPath);

    for (const resource of config.resources) {
      const resourcePath = resolve(configDir, resource);

      // Check if it's a directory with a kustomark config
      try {
        const stat = await import("fs").then((m) =>
          m.promises.stat(resourcePath)
        );
        if (stat.isDirectory()) {
          const subConfigPath = join(resourcePath, "kustomark.yaml");
          try {
            await import("fs").then((m) =>
              m.promises.access(subConfigPath)
            );
            const source = await findSourceFile(subConfigPath, filePath, visited);
            if (source) {
              return source;
            }
          } catch {
            // Not a kustomark config - check if file exists here
            const possibleSource = join(resourcePath, filePath);
            try {
              await import("fs").then((m) =>
                m.promises.access(possibleSource)
              );
              return relative(process.cwd(), possibleSource);
            } catch {
              // File doesn't exist here
            }
          }
        }
      } catch {
        // Try as a glob pattern
        try {
          const resources = await resolveResources(resolvedPath, [resource]);
          const matchingResource = resources.find(
            (r) => r.relativePath === filePath
          );
          if (matchingResource) {
            // This resource matches the file
            const sourcePath = join(configDir, resource.replace(/\*.*$/, ""), filePath);
            return relative(process.cwd(), sourcePath);
          }
        } catch {
          // Ignore resolution errors
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Explain a specific file's lineage
 */
export async function explainFile(
  configPath: string,
  filePath: string
): Promise<FileLineageResult> {
  const resolvedPath = resolve(configPath);

  const patches = await findPatchesForFile(resolvedPath, filePath, new Set());

  // Try to find the source
  const source = await findSourceFile(resolvedPath, filePath, new Set());

  return {
    file: filePath,
    source: source || filePath,
    patches,
  };
}
