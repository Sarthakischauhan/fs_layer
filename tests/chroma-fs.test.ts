import { describe, expect, it, beforeAll } from "vitest";
import { Bash } from "just-bash";
import { ChromaFs } from "../src/chroma/chroma-fs.js";
import { ContentCache } from "../src/cache.js";
import { fineFilter, toChromaFilter } from "../src/chroma/grep.js";
import { createAgentBash, createBashTool } from "../src/agent/create-bash.js";

/** Minimal in-memory Chroma collection stand-in. */
class FakeCollection {
  private docs = new Map<
    string,
    { document: string; metadata: Record<string, string | number | boolean> }
  >();

  add(args: {
    ids: string[];
    documents: string[];
    metadatas?: Array<Record<string, string | number | boolean>>;
  }) {
    for (let i = 0; i < args.ids.length; i++) {
      this.docs.set(args.ids[i]!, {
        document: args.documents[i]!,
        metadata: args.metadatas?.[i] ?? {},
      });
    }
  }

  async get(args: {
    ids?: string[];
    where?: Record<string, unknown>;
    whereDocument?: Record<string, unknown>;
    include?: string[];
  }) {
    let entries = [...this.docs.entries()];

    if (args.ids) {
      const idSet = new Set(args.ids);
      entries = entries.filter(([id]) => idSet.has(id));
    }

    if (args.where) {
      entries = entries.filter(([, v]) => matchWhere(v.metadata, args.where!));
    }

    if (args.whereDocument) {
      entries = entries.filter(([, v]) =>
        matchWhereDocument(v.document, args.whereDocument!),
      );
    }

    return {
      ids: entries.map(([id]) => id),
      documents: entries.map(([, v]) => v.document),
      metadatas: entries.map(([, v]) => v.metadata),
    };
  }
}

function matchWhere(
  meta: Record<string, string | number | boolean>,
  where: Record<string, unknown>,
): boolean {
  for (const [key, cond] of Object.entries(where)) {
    const value = meta[key];
    if (cond && typeof cond === "object" && "$in" in (cond as object)) {
      const list = (cond as { $in: unknown[] }).$in.map(String);
      if (!list.includes(String(value))) return false;
    } else if (String(value) !== String(cond)) {
      return false;
    }
  }
  return true;
}

function matchWhereDocument(
  document: string,
  whereDocument: Record<string, unknown>,
): boolean {
  if ("$contains" in whereDocument) {
    return document.includes(String(whereDocument.$contains));
  }
  if ("$regex" in whereDocument) {
    const raw = String(whereDocument.$regex);
    const ignoreCase = raw.startsWith("(?i)");
    const body = ignoreCase ? raw.slice(4) : raw;
    return new RegExp(body, ignoreCase ? "i" : "").test(document);
  }
  return true;
}

describe("ChromaFs + just-bash", () => {
  let fs: ChromaFs;

  beforeAll(async () => {
    const collection = new FakeCollection();
    collection.add({
      ids: ["__path_tree__"],
      documents: [
        JSON.stringify({
          "auth/oauth.md": { isPublic: true, groups: [] },
          "guides/quickstart.md": { isPublic: true, groups: [] },
        }),
      ],
    });
    collection.add({
      ids: ["oauth-0", "oauth-1", "qs-0"],
      documents: [
        "# OAuth\nUse the access_token from the OAuth flow.",
        "Refresh tokens are optional.",
        "# Quickstart\nGenerate an access_token using the OAuth guide.",
      ],
      metadatas: [
        { page_slug: "auth/oauth.md", chunk_index: 0 },
        { page_slug: "auth/oauth.md", chunk_index: 1 },
        { page_slug: "guides/quickstart.md", chunk_index: 0 },
      ],
    });

    fs = await ChromaFs.create(collection as never);
  });

  it("lists directories without network after bootstrap", async () => {
    expect(await fs.readdir("/")).toEqual(["auth", "guides"]);
    expect(await fs.readdir("/auth")).toEqual(["oauth.md"]);
  });

  it("reassembles chunked pages on cat", async () => {
    const content = await fs.readFile("/auth/oauth.md");
    expect(content).toContain("access_token");
    expect(content).toContain("Refresh tokens");
  });

  it("throws EROFS on writes", async () => {
    await expect(fs.writeFile("/auth/oauth.md", "x")).rejects.toMatchObject({
      code: "EROFS",
    });
  });

  it("runs through just-bash", async () => {
    const bash = createAgentBash({
      fs,
      customCommands: [fs.createGrepCommand()],
    });

    const ls = await bash.exec("ls /auth");
    expect(ls.stdout.trim()).toBe("oauth.md");

    const cat = await bash.exec("cat /auth/oauth.md");
    expect(cat.stdout).toContain("OAuth");

    const grep = await bash.exec('grep -ri access_token /');
    expect(grep.exitCode).toBe(0);
    expect(grep.stdout).toContain("access_token");
  });

  it("exposes a ReAct bash tool", async () => {
    const bash = createAgentBash({ fs });
    const tool = createBashTool(bash);
    const result = await tool.execute({ command: "ls /guides" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("quickstart.md");
  });
});

describe("grep helpers", () => {
  it("builds contains filters for fixed strings", () => {
    expect(toChromaFilter("token")).toEqual({ $contains: "token" });
  });

  it("fine-filters cached content", () => {
    const cache = new ContentCache();
    cache.put("a.md", "hello\nworld\nhello again");
    const matches = fineFilter("hello", ["a.md"], cache, { fixedString: true });
    expect(matches).toEqual([
      { path: "/a.md", line: 1, text: "hello" },
      { path: "/a.md", line: 3, text: "hello again" },
    ]);
  });
});

describe("Bash import smoke", () => {
  it("constructs default bash", () => {
    const bash = new Bash();
    expect(bash).toBeTruthy();
  });
});
