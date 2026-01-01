# Milestone 2: Enhanced Operations

> Frontmatter, line ops, validation

**Depends on**: M1

## Frontmatter Operations

### `set-frontmatter`

```yaml
- op: set-frontmatter
  key: version
  value: "2.0"
```

Nested keys with dot notation:
```yaml
- op: set-frontmatter
  key: metadata.author
  value: "kustomark"
```

### `remove-frontmatter`

```yaml
- op: remove-frontmatter
  key: deprecated_field
```

### `rename-frontmatter`

```yaml
- op: rename-frontmatter
  old: name
  new: skill_name
```

### `merge-frontmatter`

```yaml
- op: merge-frontmatter
  values:
    version: "2.0"
    tags: [patched, team]
```

## Line Operations

### `insert-after-line` / `insert-before-line`

```yaml
- op: insert-after-line
  match: "## Steps"
  content: |
    **Prerequisites**: Setup required.
```

With regex:
```yaml
- op: insert-before-line
  pattern: "^##\\s+Output"
  regex: true
  content: |
    ## Validation
    Check paths.
```

### `replace-line`

```yaml
- op: replace-line
  match: "old description line"
  replacement: "new description line"
```

### `delete-between` / `replace-between`

```yaml
- op: delete-between
  start: "<!-- BEGIN -->"
  end: "<!-- END -->"
  inclusive: true
```

```yaml
- op: replace-between
  start: "<!-- CONFIG -->"
  end: "<!-- /CONFIG -->"
  content: |
    new content
  inclusive: false
```

## Section Operations

### `rename-header`

```yaml
- op: rename-header
  id: old-slug
  new: "New Header Text"
```

### `move-section`

```yaml
- op: move-section
  id: validation
  after: output
```

### `change-section-level`

```yaml
- op: change-section-level
  id: subsection
  delta: -1  # promote ### → ##
```

## Validation

### Per-patch validation

```yaml
- op: replace
  old: "rpi/"
  new: "thoughts/"
  validate:
    notContains: "rpi/"
```

### Global validators

```yaml
validators:
  - name: no-rpi
    notContains: "rpi/"
  - name: has-frontmatter
    frontmatterRequired: [name, description]
```

## CLI Additions

```
kustomark validate ./team/ --strict  # treat warnings as errors
```

JSON output includes validation results:
```json
{
  "valid": false,
  "errors": [
    {"file": "skill.md", "validator": "no-rpi", "message": "Contains 'rpi/'"}
  ]
}
```
