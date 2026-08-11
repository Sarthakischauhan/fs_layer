import { describe, expect, it } from "vitest";
import { Neo4jFs } from "../src/neo4j/neo4j-fs.js";
import { PathTree } from "../src/path-tree.js";

function mockDriver(handlers: {
  run: (cypher: string, params?: Record<string, unknown>) => Promise<{ records: Array<{ get: (k: string) => unknown }> }>;
}) {
  return {
    session: () => ({
      run: handlers.run,
      close: async () => {},
    }),
  };
}

describe("Neo4jFs document mode", () => {
  it("bootstraps from FsPathTree node and reads content", async () => {
    const treeJson = JSON.stringify({
      "docs/intro.md": { isPublic: true, groups: [] },
    });

    const driver = mockDriver({
      async run(cypher, params) {
        if (cypher.includes("FsPathTree")) {
          return {
            records: [{ get: (k: string) => (k === "tree" ? treeJson : null) }],
          };
        }
        if (cypher.includes("RETURN n.`content`")) {
          expect(params?.path).toBe("docs/intro.md");
          return {
            records: [
              {
                get: (k: string) =>
                  k === "content"
                    ? "# Intro\nWelcome to Neo4jFs."
                    : { fs_path: "docs/intro.md", content: "# Intro\nWelcome to Neo4jFs." },
              },
            ],
          };
        }
        return { records: [] };
      },
    });

    const fs = await Neo4jFs.create(driver as never, { mode: "document" });
    expect(await fs.readdir("/docs")).toEqual(["intro.md"]);
    const body = await fs.readFile("/docs/intro.md");
    expect(body).toContain("Welcome to Neo4jFs");
    await expect(fs.mkdir("/x")).rejects.toMatchObject({ code: "EROFS" });
  });

  it("falls back to scanning fs_path properties", async () => {
    const driver = mockDriver({
      async run(cypher) {
        if (cypher.includes("FsPathTree")) {
          return { records: [] };
        }
        if (cypher.includes("DISTINCT")) {
          return {
            records: [
              { get: () => "people/alice.json" },
              { get: () => "people/bob.json" },
            ],
          };
        }
        return { records: [] };
      },
    });

    const fs = await Neo4jFs.create(driver as never);
    expect(fs.getAllPaths()).toContain("/people/alice.json");
    expect(await fs.readdir("/people")).toEqual(["alice.json", "bob.json"]);
  });
});

describe("Neo4jFs labels mode", () => {
  it("maps labels to directories", async () => {
    const driver = mockDriver({
      async run(cypher) {
        if (cypher.includes("db.labels")) {
          return { records: [{ get: () => "Person" }] };
        }
        if (cypher.includes("db.relationshipTypes")) {
          return { records: [{ get: () => "KNOWS" }] };
        }
        if (cypher.includes("elementId(n)")) {
          return {
            records: [
              { get: () => "4:abc:0" },
              { get: () => "4:abc:1" },
            ],
          };
        }
        return { records: [] };
      },
    });

    const fs = await Neo4jFs.create(driver as never, { mode: "labels" });
    expect(await fs.readdir("/")).toEqual(["Person", "_rels"]);
    expect(await fs.readdir("/Person")).toEqual(["4:abc:0.json", "4:abc:1.json"]);
    expect(await fs.exists("/_rels/KNOWS/index.json")).toBe(true);
  });
});

describe("PathTree.fromSlugs", () => {
  it("builds nested dirs", () => {
    const tree = PathTree.fromSlugs(["a/b/c.md", "a/d.md"]);
    expect(tree.lsNames("/a").sort()).toEqual(["b", "d.md"]);
  });
});
