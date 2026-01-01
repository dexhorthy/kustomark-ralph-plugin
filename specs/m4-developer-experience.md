# Milestone 4: Developer Experience

> Watch, explain, lint, init

**Depends on**: M1, M2, M3

All commands are non-interactive and support `--format=json`.

## Watch Mode

Rebuild on file changes. Runs until interrupted (SIGINT).

```
kustomark watch ./team/
kustomark watch ./team/ --debounce 500
```

Progress written to stderr, build results to stdout.

```
kustomark watch ./team/ --format=json
```

Emits newline-delimited JSON for each build:
```json
{"event": "build", "success": true, "filesWritten": 15, "timestamp": "..."}
{"event": "build", "success": false, "error": "...", "timestamp": "..."}
```

## Explain Command

Show resolution chain and patch details.

```
kustomark explain ./team/
kustomark explain ./team/ --format=json
```

```json
{
  "config": "./team/kustomark.yaml",
  "output": ".claude/skills/",
  "chain": [
    {"config": "base/kustomark.yaml", "resources": 15, "patches": 3},
    {"config": "company/kustomark.yaml", "resources": 0, "patches": 5},
    {"config": "team/kustomark.yaml", "resources": 0, "patches": 4}
  ],
  "totalFiles": 15,
  "totalPatches": 12
}
```

### File lineage

```
kustomark explain ./team/ --file skills/commit.md --format=json
```

```json
{
  "file": "skills/commit.md",
  "source": "base/skills/commit.md",
  "patches": [
    {"config": "base", "op": "replace", "old": "upstream", "new": "local"},
    {"config": "company", "op": "remove-section", "id": "internal"},
    {"config": "team", "op": "replace", "old": "Company", "new": "Team"}
  ]
}
```

## Lint Command

Check for common issues.

```
kustomark lint ./team/
kustomark lint ./team/ --format=json
```

Checks:
- Unreachable patches (patterns match nothing)
- Redundant patches (same op twice)
- Overlapping patches (multiple patches on same content)

```json
{
  "issues": [
    {"level": "warning", "line": 15, "message": "Patch matches 0 files"},
    {"level": "info", "line": 30, "message": "Consider combining replaces"}
  ],
  "errorCount": 0,
  "warningCount": 1
}
```

Exit codes: 0=no errors, 1=has errors (warnings don't fail by default).

```
kustomark lint ./team/ --strict  # warnings become errors
```

## Init Command

Scaffold a new config. Non-interactive with explicit flags.

```
kustomark init                              # create kustomark.yaml in cwd
kustomark init ./overlays/team/             # create in directory
kustomark init --base ../company/           # overlay referencing base
kustomark init --output ../../.claude/skills
```

```
kustomark init --format=json
```

```json
{
  "created": "./kustomark.yaml",
  "type": "base"
}
```

## Schema Command

Export JSON Schema for editor integration.

```
kustomark schema
kustomark schema > kustomark.schema.json
```

## Stats

Build statistics for profiling.

```
kustomark build ./team/ --stats --format=json
```

```json
{
  "success": true,
  "duration": 245,
  "files": {"processed": 15, "written": 15},
  "patches": {"applied": 48, "skipped": 2},
  "bytes": 156000,
  "byOperation": {
    "replace": 32,
    "replace-regex": 8,
    "remove-section": 4
  }
}
```
