# Kustomark Specification

> Declarative markdown patching pipeline. Like kustomize, but for markdown.

## Problem

The "upstream fork problem" for markdown: you want to consume markdown from upstream sources but need local customizations without forking.

## Solution

```yaml
# kustomark.yaml
apiVersion: kustomark/v1
kind: Kustomization
output: .claude/skills
resources:
  - github.com/org/repo//skills?ref=v1.0
patches:
  - op: replace
    old: "upstream-path/"
    new: "local-path/"
```

```
kustomark build ./team/
```

## Design Principles

1. **Determinism**: Same inputs → same outputs
2. **Machine-readable**: All commands support `--format=json`
3. **Non-interactive**: No PTY required, all flags explicit
4. **Testable**: Every feature verifiable via CLI exit codes and output

## Milestones

| Milestone | Focus |
|-----------|-------|
| [M1: MVP](./m1-mvp.md) | Local sources, core patches, CLI |
| [M2: Enhanced Ops](./m2-enhanced-operations.md) | Frontmatter, line ops, validation |
| [M3: Remote Sources](./m3-remote-sources.md) | Git, HTTP, caching |
| [M4: DX](./m4-developer-experience.md) | Watch, explain, lint |

## Reference

- [Future & Deferred](./out-of-scope.md) - Features not in current roadmap
