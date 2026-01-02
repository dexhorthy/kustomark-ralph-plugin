import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  Hover,
  MarkupKind,
  Position,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import yaml from "yaml";
import { kustomarkConfigSchema } from "../core/config.js";
import { lintConfig } from "../core/lint.js";

// Create connection for the server
const connection = createConnection(ProposedFeatures.all);

// Create document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Patch operation documentation for hover
const patchOpDocs: Record<string, { description: string; example: string }> = {
  replace: {
    description: "Replace exact string matches in the content",
    example: `- op: replace
  old: "original text"
  new: "replacement text"`,
  },
  "replace-regex": {
    description: "Replace text matching a regular expression pattern",
    example: `- op: replace-regex
  pattern: "v\\d+\\.\\d+\\.\\d+"
  replacement: "v2.0.0"`,
  },
  "remove-section": {
    description: "Remove a markdown section by its header slug",
    example: `- op: remove-section
  id: "section-to-remove"`,
  },
  "replace-section": {
    description: "Replace the content of a markdown section",
    example: `- op: replace-section
  id: "my-section"
  content: "New section content"`,
  },
  "prepend-to-section": {
    description: "Add content at the beginning of a section",
    example: `- op: prepend-to-section
  id: "my-section"
  content: "Content at start"`,
  },
  "append-to-section": {
    description: "Add content at the end of a section",
    example: `- op: append-to-section
  id: "my-section"
  content: "Content at end"`,
  },
  "set-frontmatter": {
    description: "Set or update a frontmatter field",
    example: `- op: set-frontmatter
  key: "author"
  value: "John Doe"`,
  },
  "remove-frontmatter": {
    description: "Remove a frontmatter field",
    example: `- op: remove-frontmatter
  key: "deprecated-field"`,
  },
  "rename-frontmatter": {
    description: "Rename a frontmatter field",
    example: `- op: rename-frontmatter
  from: "oldKey"
  to: "newKey"`,
  },
  "merge-frontmatter": {
    description: "Merge values into frontmatter",
    example: `- op: merge-frontmatter
  values:
    key1: value1
    key2: value2`,
  },
  "insert-after-line": {
    description: "Insert content after a line matching a pattern",
    example: `- op: insert-after-line
  pattern: "# Introduction"
  content: "Additional intro text"`,
  },
  "insert-before-line": {
    description: "Insert content before a line matching a pattern",
    example: `- op: insert-before-line
  pattern: "# Conclusion"
  content: "Before conclusion"`,
  },
  "replace-line": {
    description: "Replace an entire line matching a pattern",
    example: `- op: replace-line
  pattern: "OLD_VERSION=.*"
  replacement: "OLD_VERSION=2.0.0"`,
  },
  "delete-between": {
    description: "Delete content between two markers",
    example: `- op: delete-between
  start: "<!-- START -->"
  end: "<!-- END -->"`,
  },
  "replace-between": {
    description: "Replace content between two markers",
    example: `- op: replace-between
  start: "<!-- START -->"
  end: "<!-- END -->"
  content: "New content between markers"`,
  },
  "rename-header": {
    description: "Rename a markdown header",
    example: `- op: rename-header
  id: "old-header-slug"
  newHeader: "New Header Title"`,
  },
  "move-section": {
    description: "Move a section to a new location",
    example: `- op: move-section
  id: "section-to-move"
  after: "target-section"`,
  },
  "change-section-level": {
    description: "Change the heading level of a section",
    example: `- op: change-section-level
  id: "my-section"
  level: 2`,
  },
  "copy-file": {
    description: "Copy a file to a new location",
    example: `- op: copy-file
  from: "source.md"
  to: "destination.md"`,
  },
  "rename-file": {
    description: "Rename a file",
    example: `- op: rename-file
  from: "old-name.md"
  to: "new-name.md"`,
  },
  "delete-file": {
    description: "Delete a file from the output",
    example: `- op: delete-file
  path: "file-to-delete.md"`,
  },
  "move-file": {
    description: "Move a file to a new location",
    example: `- op: move-file
  from: "old/path.md"
  to: "new/path.md"`,
  },
};

connection.onInitialize((_params: InitializeParams) => {
  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: true,
    },
  };
  return result;
});

connection.onInitialized(() => {
  connection.console.log("Kustomark LSP server initialized");
});

// Validate document on change
documents.onDidChangeContent((change) => {
  validateTextDocument(change.document);
});

/**
 * Validate a kustomark.yaml document
 */
async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  // Only validate kustomark.yaml files
  const uri = textDocument.uri;
  if (!uri.endsWith("kustomark.yaml") && !uri.endsWith("kustomark.yml")) {
    return;
  }

  const text = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  try {
    // Parse YAML
    const parsed = yaml.parse(text);

    // Validate against schema
    const result = kustomarkConfigSchema.safeParse(parsed);

    if (!result.success) {
      for (const error of result.error.errors) {
        const path = error.path.join(".");
        const position = findPositionForPath(text, error.path);

        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: position,
            end: { line: position.line, character: position.character + 20 },
          },
          message: `${path}: ${error.message}`,
          source: "kustomark",
        });
      }
    } else {
      // Run linting (without resources - just structural lint)
      try {
        const lintResult = lintConfig(result.data, []);

        for (const issue of lintResult.issues) {
          const severity =
            issue.level === "error"
              ? DiagnosticSeverity.Error
              : issue.level === "warning"
                ? DiagnosticSeverity.Warning
                : DiagnosticSeverity.Information;

          // Try to find position for the patch
          let position: Position = { line: 0, character: 0 };
          if (issue.patchIndex !== undefined && result.data.patches) {
            position = findPatchPosition(text, issue.patchIndex);
          } else if (issue.line !== undefined) {
            position = { line: issue.line, character: 0 };
          }

          diagnostics.push({
            severity,
            range: {
              start: position,
              end: { line: position.line, character: 1000 },
            },
            message: issue.message,
            source: "kustomark-lint",
          });
        }
      } catch {
        // Linting might fail
        // That's OK, just skip lint diagnostics
      }
    }
  } catch (e) {
    // YAML parse error
    const error = e as Error;
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 100 },
      },
      message: `YAML parse error: ${error.message}`,
      source: "kustomark",
    });
  }

  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

/**
 * Find position in YAML for a path
 */
function findPositionForPath(text: string, path: (string | number)[]): Position {
  const lines = text.split("\n");

  // Simple heuristic: search for the key name
  if (path.length > 0) {
    const searchKey = String(path[path.length - 1]);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`${searchKey}:`)) {
        return { line: i, character: lines[i].indexOf(searchKey) };
      }
    }
  }

  return { line: 0, character: 0 };
}

/**
 * Find position of a patch in the YAML
 */
function findPatchPosition(text: string, patchIndex: number): Position {
  const lines = text.split("\n");
  let patchCount = -1;
  let inPatches = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.match(/^patches:/)) {
      inPatches = true;
      continue;
    }

    if (inPatches) {
      // Check for new patch (starts with "- ")
      if (line.match(/^\s*-\s+op:/)) {
        patchCount++;
        if (patchCount === patchIndex) {
          return { line: i, character: line.indexOf("-") };
        }
      }
      // Exit patches section if we hit another top-level key
      if (line.match(/^\w+:/) && !line.match(/^\s/)) {
        inPatches = false;
      }
    }
  }

  return { line: 0, character: 0 };
}

/**
 * Provide hover information
 */
connection.onHover((params): Hover | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  // Only for kustomark.yaml files
  const uri = params.textDocument.uri;
  if (!uri.endsWith("kustomark.yaml") && !uri.endsWith("kustomark.yml")) {
    return null;
  }

  const text = document.getText();
  const lines = text.split("\n");
  const line = lines[params.position.line];

  if (!line) {
    return null;
  }

  // Check if hovering over an op value
  const opMatch = line.match(/^\s*op:\s*["']?([a-z-]+)["']?/);
  if (opMatch) {
    const opName = opMatch[1];
    const opDoc = patchOpDocs[opName];

    if (opDoc) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `## \`${opName}\`\n\n${opDoc.description}\n\n### Example\n\n\`\`\`yaml\n${opDoc.example}\n\`\`\``,
        },
      };
    }
  }

  // Check if hovering over a patch key
  const keyMatch = line.match(/^\s*(include|exclude|group|id|extends|onNoMatch):/);
  if (keyMatch) {
    const key = keyMatch[1];
    const keyDocs: Record<string, string> = {
      include: "Glob patterns to match files for this patch. Default: `**/*`",
      exclude: "Glob patterns to exclude from this patch",
      group: "Assign this patch to a named group for selective application",
      id: "Unique identifier for this patch (for inheritance with `extends`)",
      extends: "Inherit from another patch by its `id`",
      onNoMatch:
        "Behavior when pattern doesn't match: `skip` (default), `warn`, or `error`",
    };

    if (keyDocs[key]) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**${key}**\n\n${keyDocs[key]}`,
        },
      };
    }
  }

  // Check for top-level keys
  const topLevelMatch = line.match(/^(apiVersion|kind|output|resources|patches|watch):/);
  if (topLevelMatch) {
    const key = topLevelMatch[1];
    const topLevelDocs: Record<string, string> = {
      apiVersion: "API version for the kustomark config. Currently: `kustomark/v1`",
      kind: "Config kind. Use `Kustomization` for standard config",
      output: "Output directory for built files (relative to config location)",
      resources:
        "List of resources to include. Can be file globs, directories, or other kustomark configs",
      patches: "List of patch operations to apply to resources",
      watch: "Watch mode configuration with hooks: `onStart`, `onBuild`, `onError`",
    };

    if (topLevelDocs[key]) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**${key}**\n\n${topLevelDocs[key]}`,
        },
      };
    }
  }

  return null;
});

// Make the text document manager listen on the connection
documents.listen(connection);

// Listen on the connection
connection.listen();

export { connection, documents };
