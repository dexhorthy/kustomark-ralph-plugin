import { describe, test, expect } from "bun:test";
import {
  isRemoteResource,
  parseRemoteUrl,
  getCacheKey,
  fetchHttpResource,
} from "../src/core/remote.js";

describe("Remote Resources", () => {
  describe("isRemoteResource", () => {
    test("returns true for git:: prefixed URLs", () => {
      expect(isRemoteResource("git::https://github.com/org/repo.git//path")).toBe(true);
      expect(isRemoteResource("git::git@github.com:org/repo.git//path")).toBe(true);
    });

    test("returns true for github.com shorthand with //", () => {
      expect(isRemoteResource("github.com/org/repo//path?ref=v1.0.0")).toBe(true);
      expect(isRemoteResource("github.com/org/repo//skills/")).toBe(true);
    });

    test("returns true for HTTP/HTTPS URLs", () => {
      expect(isRemoteResource("https://example.com/release.tar.gz")).toBe(true);
      expect(isRemoteResource("http://example.com/file.md")).toBe(true);
    });

    test("returns false for local paths", () => {
      expect(isRemoteResource("./local/path")).toBe(false);
      expect(isRemoteResource("../relative/path")).toBe(false);
      expect(isRemoteResource("/absolute/path")).toBe(false);
      expect(isRemoteResource("path/to/file.md")).toBe(false);
    });

    test("returns false for github.com without //", () => {
      // This could be a local directory named github.com
      expect(isRemoteResource("github.com/something")).toBe(false);
    });
  });

  describe("parseRemoteUrl", () => {
    describe("GitHub shorthand", () => {
      test("parses basic GitHub shorthand URL", () => {
        const parsed = parseRemoteUrl("github.com/org/repo//path?ref=v1.0.0");

        expect(parsed.type).toBe("git");
        expect(parsed.fetchUrl).toBe("https://github.com/org/repo.git");
        expect(parsed.subpath).toBe("path");
        expect(parsed.ref).toBe("v1.0.0");
        expect(parsed.isGitHubShorthand).toBe(true);
      });

      test("parses GitHub shorthand without ref", () => {
        const parsed = parseRemoteUrl("github.com/org/repo//skills/");

        expect(parsed.type).toBe("git");
        expect(parsed.fetchUrl).toBe("https://github.com/org/repo.git");
        expect(parsed.subpath).toBe("skills/");
        expect(parsed.ref).toBeUndefined();
      });

      test("parses GitHub shorthand with empty subpath", () => {
        const parsed = parseRemoteUrl("github.com/org/repo//?ref=main");

        expect(parsed.type).toBe("git");
        expect(parsed.subpath).toBe("");
        expect(parsed.ref).toBe("main");
      });

      test("parses GitHub shorthand with SHA ref", () => {
        const parsed = parseRemoteUrl("github.com/org/repo//path?ref=abc123def");

        expect(parsed.ref).toBe("abc123def");
      });
    });

    describe("git:: explicit URLs", () => {
      test("parses HTTPS git URL", () => {
        const parsed = parseRemoteUrl("git::https://github.com/org/repo.git//subdir?ref=main");

        expect(parsed.type).toBe("git");
        expect(parsed.fetchUrl).toBe("https://github.com/org/repo.git");
        expect(parsed.subpath).toBe("subdir");
        expect(parsed.ref).toBe("main");
        expect(parsed.isGitHubShorthand).toBeUndefined();
      });

      test("parses SSH git URL", () => {
        const parsed = parseRemoteUrl("git::git@github.com:org/repo.git//path?ref=abc1234");

        expect(parsed.type).toBe("git");
        expect(parsed.fetchUrl).toBe("git@github.com:org/repo.git");
        expect(parsed.subpath).toBe("path");
        expect(parsed.ref).toBe("abc1234");
      });

      test("parses git URL without ref", () => {
        const parsed = parseRemoteUrl("git::https://gitlab.com/org/repo.git//docs");

        expect(parsed.type).toBe("git");
        expect(parsed.fetchUrl).toBe("https://gitlab.com/org/repo.git");
        expect(parsed.subpath).toBe("docs");
        expect(parsed.ref).toBeUndefined();
      });

      test("parses git URL without subpath", () => {
        const parsed = parseRemoteUrl("git::https://github.com/org/repo.git?ref=v2.0.0");

        expect(parsed.type).toBe("git");
        expect(parsed.subpath).toBe("");
        expect(parsed.ref).toBe("v2.0.0");
      });
    });

    describe("HTTP URLs", () => {
      test("parses simple HTTP URL", () => {
        const parsed = parseRemoteUrl("https://example.com/releases/v1.0.0/skills.tar.gz");

        expect(parsed.type).toBe("http");
        expect(parsed.fetchUrl).toBe("https://example.com/releases/v1.0.0/skills.tar.gz");
        expect(parsed.subpath).toBe("");
      });

      test("parses HTTP URL with subpath", () => {
        const parsed = parseRemoteUrl("https://example.com/release.tar.gz//subdir/");

        expect(parsed.type).toBe("http");
        expect(parsed.fetchUrl).toBe("https://example.com/release.tar.gz");
        expect(parsed.subpath).toBe("subdir/");
      });
    });

    describe("local paths", () => {
      test("returns local type for relative paths", () => {
        const parsed = parseRemoteUrl("./local/path");

        expect(parsed.type).toBe("local");
        expect(parsed.fetchUrl).toBe("./local/path");
      });

      test("returns local type for absolute paths", () => {
        const parsed = parseRemoteUrl("/absolute/path/file.md");

        expect(parsed.type).toBe("local");
        expect(parsed.fetchUrl).toBe("/absolute/path/file.md");
      });
    });
  });

  describe("getCacheKey", () => {
    test("generates cache key for git resources", () => {
      const parsed = parseRemoteUrl("github.com/org/repo//path?ref=v1.0.0");
      const key = getCacheKey(parsed);

      expect(key).toContain("github_com");
      expect(key).toContain("v1_0_0");
    });

    test("generates different keys for different refs", () => {
      const parsed1 = parseRemoteUrl("github.com/org/repo//path?ref=v1.0.0");
      const parsed2 = parseRemoteUrl("github.com/org/repo//path?ref=v2.0.0");

      const key1 = getCacheKey(parsed1);
      const key2 = getCacheKey(parsed2);

      expect(key1).not.toBe(key2);
    });

    test("generates same key for same URL", () => {
      const parsed1 = parseRemoteUrl("github.com/org/repo//path?ref=v1.0.0");
      const parsed2 = parseRemoteUrl("github.com/org/repo//path?ref=v1.0.0");

      const key1 = getCacheKey(parsed1);
      const key2 = getCacheKey(parsed2);

      expect(key1).toBe(key2);
    });

    test("handles URLs without refs", () => {
      const parsed = parseRemoteUrl("https://example.com/file.tar.gz");
      const key = getCacheKey(parsed);

      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    });

    test("generates key for HTTP archive URLs", () => {
      const parsed = parseRemoteUrl("https://example.com/release.tar.gz//subdir");
      const key = getCacheKey(parsed);

      expect(typeof key).toBe("string");
      expect(key).toContain("example_com");
    });
  });

  describe("fetchHttpResource", () => {
    test("returns error for invalid URL", async () => {
      const parsed = parseRemoteUrl("https://nonexistent.invalid/file.tar.gz");
      const result = await fetchHttpResource(parsed, { noCache: true });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("parses archive types correctly", () => {
      // Test that we correctly identify archive types from URLs
      const tarGz = parseRemoteUrl("https://example.com/file.tar.gz");
      const tgz = parseRemoteUrl("https://example.com/file.tgz");
      const tar = parseRemoteUrl("https://example.com/file.tar");
      const zip = parseRemoteUrl("https://example.com/file.zip");
      const md = parseRemoteUrl("https://example.com/file.md");

      expect(tarGz.type).toBe("http");
      expect(tgz.type).toBe("http");
      expect(tar.type).toBe("http");
      expect(zip.type).toBe("http");
      expect(md.type).toBe("http");
    });
  });
});
