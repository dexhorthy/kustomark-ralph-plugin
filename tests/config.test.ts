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
