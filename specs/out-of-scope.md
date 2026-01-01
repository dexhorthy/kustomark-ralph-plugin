# Future & Deferred Features

Features not in the current roadmap, with rationale.

## Deferred: Interactive Features

Current focus is non-interactive CLI for automation. Interactive features may come later.

### Interactive Debug Mode

Step-through patch application with keyboard input.

**Current alternative**: Use `--format=json` with verbose flags.

### Interactive Init Wizard

Prompt-based config creation.

**Current alternative**: Use explicit flags: `kustomark init --base ../company/`

### Watch Hooks

Shell commands triggered on build events.

```yaml
watch:
  onBuild: ["echo done"]
  onError: ["notify-send failed"]
```

**Current alternative**: Parse JSON output from `kustomark watch --format=json`.

## Deferred: Complexity

### Conditional Patches

```yaml
- op: replace
  old: "foo"
  new: "bar"
  when:
    fileContains: "production"
```

**Rationale**: Hard to debug, combinatorial testing burden.

**Current alternative**: Use `include`/`exclude` globs. Use multiple configs.

### Script Hooks

```yaml
- op: exec
  command: "./transform.sh"
```

**Rationale**: Non-deterministic, security considerations, portability.

### Plugin System

User-defined patch operations.

**Rationale**: API design complexity, security, ecosystem maintenance.

**Current alternative**: Request operations via issues; add to core if common.

### Full AST Parsing

Parse markdown into full AST for semantic manipulation.

**Rationale**: Complexity, fragility, overkill for most patches.

**Current approach**: Parse headers for sections; string ops for rest.

## Not Planned

Features that conflict with core design principles.

### AI/LLM Transforms

```yaml
- op: ai-transform
  prompt: "Rewrite in TypeScript"
```

**Rationale**: Non-deterministic by nature. Conflicts with core principle.

**Alternative**: Use AI to author deterministic patches once.

### Environment Variable Templating

```yaml
- op: replace
  old: "${OLD_VALUE}"
  new: "${NEW_VALUE}"
```

**Rationale**: Hidden dependencies, breaks determinism.

**Alternative**: Use separate config files per environment.

### Bidirectional Sync

Push changes back to upstream.

**Rationale**: Violates the consumption model; unclear semantics.

### Multi-Format Support

Patch YAML, JSON, TOML.

**Rationale**: Scope creep. Tools exist (yq, jq). Kustomark is markdown-specific.

## Future Candidates

| Feature | Complexity | Notes |
|---------|------------|-------|
| Interactive debug mode | Medium | PTY-based step-through |
| Interactive init wizard | Low | Prompt-based setup |
| Patch inheritance (extend by ID) | Medium | |
| Patch groups (enable/disable) | Medium | |
| Parallel builds | Medium | |
| Incremental builds | High | |
| Build cache | High | |
| LSP server | High | IDE integration |
| Web UI | High | Visual patch editor |
