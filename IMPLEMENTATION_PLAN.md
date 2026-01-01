# Kustomark Implementation Plan

## Priority Order

Based on the specs, M1 MVP must be completed first as all other milestones depend on it.

### Phase 1: Project Setup (COMPLETE)
- [x] Create IMPLEMENTATION_PLAN.md
- [x] Initialize project with package.json, tsconfig.json
- [x] Set up linting (ESLint) and formatting (Prettier)
- [x] Create project structure (src/core, src/cli, tests)

### Phase 2: Core Library (M1) (COMPLETE)
- [x] Config schema validation (Zod)
- [x] Config parsing (YAML with apiVersion, kind, output, resources, patches)
- [x] Resource resolution (globs, paths, other kustomark configs)
- [x] Patch operations:
  - [x] `replace` - string replacement
  - [x] `replace-regex` - regex replacement
  - [x] `remove-section` - remove markdown section by slug
  - [x] `replace-section` - replace section content
  - [x] `prepend-to-section` / `append-to-section`
- [x] Diff generation
- [x] onNoMatch handling (skip, warn, error)

### Phase 3: CLI (M1) (COMPLETE)
- [x] `kustomark build [path]` - build and write output
- [x] `kustomark diff [path]` - show what would change
- [x] `kustomark validate [path]` - validate config
- [x] Common flags: --format, --clean, -v, -q
- [x] Exit codes (0=success, 1=error/changes)
- [x] JSON output format

### Phase 4: Testing (M1) (COMPLETE)
- [x] Unit tests for core library
- [x] Integration tests for CLI
- [x] Test fixtures

## Current Status

**M1 MVP is complete!** All core features implemented and tested:
- 38 tests passing
- TypeScript type checking passes
- ESLint linting passes

## Next Milestones

### Phase 5: Enhanced Operations (M2)
- [x] Frontmatter operations (set-frontmatter, remove-frontmatter, rename-frontmatter, merge-frontmatter)
- [x] Line operations (insert-after-line, insert-before-line, replace-line, delete-between, replace-between)
- [ ] Additional section operations (rename-header, move-section, change-section-level)
- [ ] Per-patch validation
- [ ] Global validators

### Phase 6: Remote Sources (M3)
- [ ] Git remote resources
- [ ] HTTP remote resources
- [ ] Version pinning
- [ ] Lock file support
- [ ] Caching
- [ ] File operations (copy-file, rename-file, delete-file, move-file)

### Phase 7: Developer Experience (M4)
- [ ] Watch mode
- [ ] Explain command
- [ ] Lint command
- [ ] Init command
- [ ] Schema command
- [ ] Build stats

## Progress Log

- Initial planning complete
- M1 MVP fully implemented with all patch operations, CLI commands, and tests
- M2 Frontmatter operations implemented: set-frontmatter, remove-frontmatter, rename-frontmatter, merge-frontmatter (50 tests passing)
- M2 Line operations implemented: insert-after-line, insert-before-line, replace-line, delete-between, replace-between (64 tests passing)
