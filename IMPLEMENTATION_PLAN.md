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

### Phase 5: Enhanced Operations (M2) (COMPLETE)
- [x] Frontmatter operations (set-frontmatter, remove-frontmatter, rename-frontmatter, merge-frontmatter)
- [x] Line operations (insert-after-line, insert-before-line, replace-line, delete-between, replace-between)
- [x] Additional section operations (rename-header, move-section, change-section-level)
- [x] Per-patch validation
- [x] Global validators

### Phase 6: Remote Sources (M3) (COMPLETE)
- [x] Git remote resources (URL parsing, fetching, caching)
- [x] HTTP remote resources (download, archive extraction: tar.gz, tgz, tar, zip)
- [x] Version pinning (refs supported in git URLs)
- [x] Lock file support (read/write, integrity verification, SHA256)
- [x] Caching (cache layer for git and http resources)
- [x] File operations (copy-file, rename-file, delete-file, move-file)

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
- M2 Section operations implemented: rename-header, move-section, change-section-level (76 tests passing)
- M2 Validation implemented: per-patch validation and global validators (95 tests passing) - M2 COMPLETE!
- M3 File operations implemented: copy-file, rename-file, delete-file, move-file (115 tests passing)
- M3 Git remote resources implemented: URL parsing (GitHub shorthand, git::, SSH), fetching via git clone, caching layer (136 tests passing)
- M3 HTTP remote resources implemented: download, archive extraction (tar.gz, tgz, tar, zip), caching (139 tests passing)
- M3 Lock file support implemented: schema, read/write, integrity verification with SHA256 (163 tests passing) - M3 COMPLETE!
