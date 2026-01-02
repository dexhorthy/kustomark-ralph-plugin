import { describe, test, expect } from "bun:test";
import { parseConfig } from "../src/core/config.js";

describe("Config Parsing", () => {
  test("parses minimal valid config", () => {
    const yaml = `
apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - "**/*.md"
`;
    const config = parseConfig(yaml);

    expect(config.apiVersion).toBe("kustomark/v1");
    expect(config.kind).toBe("Kustomization");
    expect(config.output).toBe("./out");
    expect(config.resources).toEqual(["**/*.md"]);
  });

  test("parses config with patches", () => {
    const yaml = `
apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - "*.md"
patches:
  - op: replace
    old: foo
    new: bar
`;
    const config = parseConfig(yaml);

    expect(config.patches).toBeDefined();
    expect(config.patches).toHaveLength(1);
    expect(config.patches![0].op).toBe("replace");
  });

  test("rejects config with wrong apiVersion", () => {
    const yaml = `
apiVersion: kustomark/v2
kind: Kustomization
output: ./out
resources:
  - "*.md"
`;
    expect(() => parseConfig(yaml)).toThrow();
  });

  test("parses all patch operation types", () => {
    const yaml = `
apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - "*.md"
patches:
  - op: replace
    old: foo
    new: bar
  - op: replace-regex
    pattern: "([0-9]+)"
    replacement: "[$1]"
  - op: remove-section
    id: deprecated
  - op: replace-section
    id: intro
    content: New intro
  - op: prepend-to-section
    id: steps
    content: Step 0
  - op: append-to-section
    id: steps
    content: Final step
`;
    const config = parseConfig(yaml);

    expect(config.patches).toHaveLength(6);
    expect(config.patches![0].op).toBe("replace");
    expect(config.patches![1].op).toBe("replace-regex");
    expect(config.patches![2].op).toBe("remove-section");
    expect(config.patches![3].op).toBe("replace-section");
    expect(config.patches![4].op).toBe("prepend-to-section");
    expect(config.patches![5].op).toBe("append-to-section");
  });
});

describe("Watch Hooks Config", () => {
  test("parses config with all watch hooks", () => {
    const yaml = `
apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - "*.md"
watch:
  onStart:
    - "echo starting"
  onBuild:
    - "echo build done"
    - "touch .build-complete"
  onError:
    - "notify-send failed"
`;
    const config = parseConfig(yaml);

    expect(config.watch).toBeDefined();
    expect(config.watch?.onStart).toEqual(["echo starting"]);
    expect(config.watch?.onBuild).toEqual(["echo build done", "touch .build-complete"]);
    expect(config.watch?.onError).toEqual(["notify-send failed"]);
  });

  test("parses config with partial watch hooks", () => {
    const yaml = `
apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - "*.md"
watch:
  onBuild:
    - "echo done"
`;
    const config = parseConfig(yaml);

    expect(config.watch).toBeDefined();
    expect(config.watch?.onStart).toBeUndefined();
    expect(config.watch?.onBuild).toEqual(["echo done"]);
    expect(config.watch?.onError).toBeUndefined();
  });

  test("parses config without watch hooks", () => {
    const yaml = `
apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - "*.md"
`;
    const config = parseConfig(yaml);

    expect(config.watch).toBeUndefined();
  });

  test("parses config with empty watch hooks", () => {
    const yaml = `
apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - "*.md"
watch:
  onBuild: []
`;
    const config = parseConfig(yaml);

    expect(config.watch).toBeDefined();
    expect(config.watch?.onBuild).toEqual([]);
  });
});

describe("Patch Groups Config", () => {
  test("parses patches with group field", () => {
    const yaml = `
apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - "*.md"
patches:
  - op: replace
    old: "debug=true"
    new: "debug=false"
    group: production
  - op: replace
    old: "localhost"
    new: "api.example.com"
    group: production
  - op: replace
    old: "foo"
    new: "bar"
`;
    const config = parseConfig(yaml);

    expect(config.patches).toBeDefined();
    expect(config.patches).toHaveLength(3);
    expect(config.patches![0].group).toBe("production");
    expect(config.patches![1].group).toBe("production");
    expect(config.patches![2].group).toBeUndefined();
  });

  test("parses patches without group field", () => {
    const yaml = `
apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - "*.md"
patches:
  - op: replace
    old: "foo"
    new: "bar"
`;
    const config = parseConfig(yaml);

    expect(config.patches).toBeDefined();
    expect(config.patches![0].group).toBeUndefined();
  });
});

describe("Patch Inheritance Config", () => {
  test("parses patches with id field", () => {
    const yaml = `
apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - "*.md"
patches:
  - id: my-base-patch
    op: replace
    old: "foo"
    new: "bar"
`;
    const config = parseConfig(yaml);

    expect(config.patches).toBeDefined();
    expect(config.patches![0].id).toBe("my-base-patch");
  });

  test("parses patches with extends field", () => {
    const yaml = `
apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - "*.md"
patches:
  - id: base
    op: replace
    old: "foo"
    new: "bar"
  - extends: base
    old: "baz"
    new: "qux"
`;
    const config = parseConfig(yaml);

    expect(config.patches).toBeDefined();
    expect(config.patches).toHaveLength(2);
    expect(config.patches![0].id).toBe("base");
    expect(config.patches![1].extends).toBe("base");
  });

  test("parses patches with both id and extends", () => {
    const yaml = `
apiVersion: kustomark/v1
kind: Kustomization
output: ./out
resources:
  - "*.md"
patches:
  - id: grandparent
    op: replace
    old: "a"
    new: "b"
  - id: parent
    extends: grandparent
    old: "c"
    new: "d"
  - extends: parent
    old: "e"
    new: "f"
`;
    const config = parseConfig(yaml);

    expect(config.patches).toBeDefined();
    expect(config.patches).toHaveLength(3);
    expect(config.patches![0].id).toBe("grandparent");
    expect(config.patches![1].id).toBe("parent");
    expect(config.patches![1].extends).toBe("grandparent");
    expect(config.patches![2].extends).toBe("parent");
  });
});
