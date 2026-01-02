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

**All milestones complete!** M1-M4 plus deferred features implemented and tested:
- 252 tests passing
- TypeScript type checking passes
- ESLint linting passes

## Milestones

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

### Phase 7: Developer Experience (M4) (COMPLETE)
- [x] Watch mode
- [x] Explain command
- [x] Lint command
- [x] Init command
- [x] Schema command
- [x] Build stats

### Phase 8: Deferred Features (COMPLETE)
- [x] Watch hooks (onStart, onBuild, onError shell commands triggered during watch mode)
  - Config schema extension with `watch` field
  - Hook execution with environment variables (KUSTOMARK_EVENT, KUSTOMARK_SUCCESS, KUSTOMARK_FILES_WRITTEN, KUSTOMARK_PATCHES_APPLIED, KUSTOMARK_ERROR)
  - Integration tests for hook execution
- [x] Patch groups (enable/disable groups of patches)
  - `group` field added to patch schema
  - `--enable-groups` and `--disable-groups` CLI flags for build and diff commands
  - Group filtering logic in patch application
  - Unit tests for group filtering
- [x] Parallel builds (process files concurrently)
  - `--parallel` and `--parallel=<n>` CLI flags for build and diff commands
  - Concurrency-limited parallel processing utility
  - Refactored build and diff commands for parallel file processing
  - Integration tests for parallel builds
- [x] Patch inheritance (extend by ID)
  - `id` and `extends` fields added to patch schema
  - `resolveExtends()` function to resolve inheritance at runtime
  - Support for chained inheritance (A extends B extends C)
  - Duplicate ID and circular reference detection with error messages
  - Extending patches can omit `op` when inheriting from base
  - Unit tests for patch inheritance resolution
- [x] Interactive init wizard
  - `-i` / `--interactive` flag for init command
  - Prompts for overlay vs base config
  - Prompts for base path, resource pattern, output directory
  - Option to add example patch to generated config
  - Uses readline for interactive input
- [x] Interactive debug mode
  - `--debug` flag for build command
  - Step-through patch application with interactive prompts
  - Keyboard controls: [n]ext, [s]kip, [d]iff, [q]uit, [h]elp
  - Shows patch details before each application
  - Diff preview shows what patch would change
  - Summary at end shows applied, skipped, and remaining patches
  - Forces sequential file processing in debug mode
- [x] Incremental builds
  - `--incremental` flag for build command
  - Build manifest (.kustomark.manifest.yaml) tracks file hashes
  - Detects config/patches changes for full rebuild
  - Only rebuilds files whose source content has changed
  - Tracks new, modified, and deleted files
  - SHA256 hashing for change detection
  - Unit tests for manifest and change analysis

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
- M4 Init command implemented: scaffolds kustomark.yaml with --base and --output flags, JSON output (170 tests passing)
- M4 Schema command implemented: exports JSON Schema for editor integration using zod-to-json-schema (173 tests passing)
- M4 Lint command implemented: checks for unreachable/redundant/overlapping patches, --strict flag (190 tests passing)
- M4 Explain command implemented: shows resolution chain, file lineage with --file flag (199 tests passing)
- M4 Watch mode implemented: rebuilds on file changes, --debounce flag, JSON event output (200 tests passing)
- M4 Build stats implemented: --stats flag for build command with duration, files, patches, bytes, byOperation metrics (202 tests passing) - M4 COMPLETE!
- Watch hooks implemented: onStart, onBuild, onError shell commands in config's `watch` field with environment variables (208 tests passing)
- Patch groups implemented: `group` field on patches, --enable-groups/--disable-groups CLI flags for selective patch application (218 tests passing)
- Parallel builds implemented: --parallel flag for concurrent file processing in build and diff commands (220 tests passing)
- Patch inheritance implemented: `id` and `extends` fields for DRY patch definitions with inheritance resolution (233 tests passing)
- Interactive init wizard implemented: `--interactive` flag for prompt-based config setup (233 tests passing)
- Interactive debug mode implemented: `--debug` flag for step-through patch application with keyboard controls (233 tests passing)
- Incremental builds implemented: `--incremental` flag with manifest-based change detection for faster rebuilds (252 tests passing)
