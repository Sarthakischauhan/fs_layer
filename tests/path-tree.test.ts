import { describe, expect, it } from "vitest";
import { PathTree, normalizePath, basename, dirname } from "../src/path-tree.js";

describe("normalizePath", () => {
  it("collapses dots and slashes", () => {
    expect(normalizePath("/a/./b/../c")).toBe("/a/c");
    expect(normalizePath("///")).toBe("/");
    expect(normalizePath("/")).toBe("/");
  });
});

describe("basename/dirname", () => {
  it("splits paths", () => {
    expect(basename("/auth/oauth.md")).toBe("oauth.md");
    expect(dirname("/auth/oauth.md")).toBe("/auth");
    expect(dirname("/oauth.md")).toBe("/");
  });
});

describe("PathTree", () => {
  const tree = PathTree.fromJson(
    JSON.stringify({
      "auth/oauth.md": { isPublic: true, groups: [] },
      "auth/api-keys.md": { isPublic: true, groups: [] },
      "internal/billing.md": { isPublic: false, groups: ["admin"] },
    }),
  );

  it("builds directories from slugs", () => {
    expect(tree.isDir("/")).toBe(true);
    expect(tree.isDir("/auth")).toBe(true);
    expect(tree.isFile("/auth/oauth.md")).toBe(true);
    expect(tree.lsNames("/auth").sort()).toEqual(["api-keys.md", "oauth.md"]);
  });

  it("applies RBAC pruning", () => {
    const publicOnly = PathTree.fromJson(
      JSON.stringify({
        "auth/oauth.md": { isPublic: true, groups: [] },
        "internal/billing.md": { isPublic: false, groups: ["admin"] },
      }),
      new Set(),
    );
    expect(publicOnly.isFile("/auth/oauth.md")).toBe(true);
    expect(publicOnly.isFile("/internal/billing.md")).toBe(false);

    const admin = PathTree.fromJson(
      JSON.stringify({
        "auth/oauth.md": { isPublic: true, groups: [] },
        "internal/billing.md": { isPublic: false, groups: ["admin"] },
      }),
      new Set(["admin"]),
    );
    expect(admin.isFile("/internal/billing.md")).toBe(true);
  });

  it("supports glob matching", () => {
    expect(tree.globMatch("/", "**/*.md")).toEqual([
      "/auth/api-keys.md",
      "/auth/oauth.md",
    ]);
    expect(tree.globMatch("/auth", "*.md")).toEqual([
      "/auth/api-keys.md",
      "/auth/oauth.md",
    ]);
  });

  it("decodes gzip+base64 path trees", async () => {
    const { gzipSync } = await import("node:zlib");
    const json = JSON.stringify({
      "guides/start.md": { isPublic: true, groups: [] },
    });
    const encoded = gzipSync(Buffer.from(json, "utf8")).toString("base64");
    const t = PathTree.fromJson(encoded);
    expect(t.isFile("/guides/start.md")).toBe(true);
  });
});
