# Milestone 1: MVP

> Local sources, core patches, CLI with machine-readable output

## Architecture

Two layers with clean separation:

```
┌──────────────────────────────────────────────────────────────┐
│                           CLI                                │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐  │
│  │  read   │  │  invoke │  │  write  │  │ format output   │  │
│  │  files  │  │  core   │  │  files  │  │ (text/json)     │  │
│  └─────────┘  └─────────┘  └─────────┘  └─────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                      Core Library                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │   config    │  │   patch     │  │   diff              │   │
│  │   parsing   │  │   engine    │  │   generation        │   │
│  └─────────────┘  └─────────────┘  └─────────────────────┘   │
│                                                              │
│  No I/O - pure transforms on content                         │
└──────────────────────────────────────────────────────────────┘
```

- **Core library**: Config parsing, patch engine, diff generation. No I/O.
- **CLI**: Reads files, invokes core, writes output, formats results.

## Config Schema

```yaml
apiVersion: kustomark/v1
kind: Kustomization

output: ./out

resources:
  - "**/*.md"           # glob
  - "!**/README.md"     # negation
  - ../base/            # other kustomark config

patches:
  - op: replace
    old: "foo"
    new: "bar"

onNoMatch: warn  # skip | warn | error
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `apiVersion` | yes | `kustomark/v1` |
| `kind` | yes | `Kustomization` |
| `output` | yes* | Output directory (*required for build target) |
| `resources` | yes | Globs, paths, or other kustomark configs |
| `patches` | no | Ordered patch list |
| `onNoMatch` | no | Default: `warn` |

### Resource Types

| Pattern | Description |
|---------|-------------|
| `"**/*.md"` | Glob |
| `"!pattern"` | Exclude |
| `./path.md` | File |
| `../base/` | Kustomark config |

## CLI

### Commands

```
kustomark build [path]     # Build and write output
kustomark diff [path]      # Show what would change (exit 0=no diff, 1=has diff)
kustomark validate [path]  # Validate config (exit 0=valid, 1=invalid)
```

### Flags

| Flag | Description |
|------|-------------|
| `--format` | `text` (default) or `json` |
| `--clean` | Remove output files not in source |
| `-v` | Verbose (repeat for more: -vv, -vvv) |
| `-q` | Quiet (errors only) |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success (for diff: no changes) |
| `1` | Error or changes detected |

### JSON Output

All commands support `--format=json`:

```
kustomark build ./team/ --format=json
```

```json
{
  "success": true,
  "filesWritten": 15,
  "patchesApplied": 48,
  "warnings": ["Patch 'replace foo' matched 0 times in file.md"]
}
```

```
kustomark diff ./team/ --format=json
```

```json
{
  "hasChanges": true,
  "files": [
    {
      "path": "skills/commit.md",
      "status": "modified",
      "diff": "--- a/...\n+++ b/..."
    }
  ]
}
```

```
kustomark validate ./team/ --format=json
```

```json
{
  "valid": true,
  "errors": [],
  "warnings": []
}
```

## Patch Operations

### Common Fields

All patches support:

| Field | Description |
|-------|-------------|
| `include` | Glob(s) to filter files |
| `exclude` | Glob(s) to exclude |
| `onNoMatch` | Override error handling |

### `replace`

```yaml
- op: replace
  old: "rpi/tasks/"
  new: "thoughts/tasks/"
```

### `replace-regex`

```yaml
- op: replace-regex
  pattern: "Run `rpi (\\w+)`"
  replacement: "Run `thoughts $1`"
  flags: "gi"  # g=global, i=case-insensitive, m=multiline, s=dotall
```

### `remove-section`

```yaml
- op: remove-section
  id: section-slug
  includeChildren: true  # default
```

Section IDs are GitHub-style slugs from headers, or explicit `{#custom-id}`.

### `replace-section`

```yaml
- op: replace-section
  id: github-links
  content: |
    New section content here.
```

### `prepend-to-section` / `append-to-section`

```yaml
- op: prepend-to-section
  id: steps
  content: |
    **Note**: Read files first.
```

## Resource Resolution

Resources resolve recursively. Patches accumulate (base → overlay → overlay).

```
                    Resolution Order
                    ════════════════

team/kustomark.yaml ─────────────────────────────────────┐
  │                                                      │
  └─▶ resources: [../company/]                           │
        │                                                │
        ▼                                                │
      company/kustomark.yaml ──────────────────────┐     │
        │                                          │     │
        └─▶ resources: [../base/]                  │     │
              │                                    │     │
              ▼                                    │     │
            base/kustomark.yaml ─────────┐         │     │
              │                          │         │     │
              └─▶ resources: ["**/*.md"] │         │     │
                                         │         │     │
                                         ▼         ▼     ▼
                    Patch Application: base ─▶ company ─▶ team
```

```
                    Overlay Example
                    ═══════════════

     base/                    company/                  team/
  ┌──────────┐             ┌──────────┐             ┌──────────┐
  │ *.md     │             │ patches: │             │ patches: │
  │ files    │────────────▶│  +header │────────────▶│  +footer │
  │          │             │  -section│             │  replace │
  └──────────┘             └──────────┘             └──────────┘
                                                         │
                                                         ▼
                                                    ┌──────────┐
                                                    │  output/ │
                                                    │  *.md    │
                                                    └──────────┘
```

Multiple resources merge in order (last wins for conflicts).

## Testing

Integration tests should:
- Create temp directories with test fixtures
- Run CLI commands
- Assert exit codes
- Parse JSON output for verification
- Compare output files against expected

Example test flow:
```
1. mkdir -p /tmp/test/{base,overlay,output}
2. write test markdown to base/
3. write kustomark.yaml to overlay/
4. kustomark build overlay/ --format=json
5. assert exit code 0
6. assert output files match expected
```
