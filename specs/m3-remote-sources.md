# Milestone 3: Remote Sources

> Git, HTTP, caching, file operations

**Depends on**: M1, M2

## Remote Resources

### Git

```yaml
resources:
  # GitHub shorthand
  - github.com/org/repo//path?ref=v1.2.0

  # Full git URL
  - git::https://github.com/org/repo.git//subdir?ref=main

  # SSH
  - git::git@github.com:org/repo.git//path?ref=abc1234
```

Format: `git::<url>//<path>?ref=<branch|tag|sha>`

### HTTP

```yaml
resources:
  - https://example.com/releases/v1.0.0/skills.tar.gz
  - https://example.com/release.tar.gz//subdir/
```

Supports: `.tar.gz`, `.tgz`, `.tar`, `.zip`

## Version Pinning

Always pin in production:

```yaml
resources:
  - github.com/org/repo//path?ref=v1.2.0      # tag (good)
  - github.com/org/repo//path?ref=a1b2c3d4    # sha (good)
  - github.com/org/repo//path?ref=main        # floating (dev only)
```

## Lock File

Location: `kustomark.lock.yaml` in same directory as config. Commit to git.

```yaml
version: 1
resources:
  - url: github.com/org/repo//path?ref=v1.2.0
    resolved: a1b2c3d4e5f6...
    integrity: sha256-abc123...
    fetched: 2025-01-15T10:30:00Z
```

## Caching

Cache location: `~/.cache/kustomark/`

```
kustomark cache list                          # list cached
kustomark cache clear                         # clear all
kustomark cache clear github.com/org/repo     # clear specific
```

All cache commands support `--format=json`.

## File Operations

### `copy-file`

```yaml
- op: copy-file
  src: ./templates/header.md
  dest: shared/header.md
```

### `rename-file`

```yaml
- op: rename-file
  match: "**/SKILL.md"
  rename: "skill.md"
```

### `delete-file`

```yaml
- op: delete-file
  match: "**/DEPRECATED-*.md"
```

### `move-file`

```yaml
- op: move-file
  match: "**/references/*.md"
  dest: docs/references/
```

## Authentication

Uses system credentials (SSH keys, git credential helpers).

For HTTP with auth:
```yaml
resources:
  - url: https://private.example.com/skills.tar.gz
    auth:
      type: bearer
      tokenEnv: PRIVATE_REPO_TOKEN
```

## CLI Additions

```
kustomark fetch [path]       # fetch remotes only (no build)
kustomark build --offline    # fail if fetch needed
kustomark build --update     # update lock file
kustomark build --no-lock    # ignore lock file
```

### JSON Output

```
kustomark fetch ./team/ --format=json
```

```json
{
  "success": true,
  "fetched": [
    {"url": "github.com/org/repo//path?ref=v1.2.0", "cached": false}
  ]
}
```

## Security

Optional allowlist:

```yaml
security:
  allowedHosts: [github.com, internal.company.com]
  allowedProtocols: [https, git]
```

Checksum verification:

```yaml
resources:
  - url: https://example.com/v1.0.0.tar.gz
    sha256: abc123def456...
```
