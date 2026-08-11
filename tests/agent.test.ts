import { describe, expect, it, beforeAll } from "vitest";
import { FakeToolCallingModel } from "langchain";
import { ChromaFs } from "../src/chroma/chroma-fs.js";
import {
  createAgentBash,
  createBashTool,
  createFsTools,
  createFsAgent,
  createFsAgentTools,
} from "../src/agent/index.js";

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
      entries = entries.filter(([, v]) => {
        for (const [key, cond] of Object.entries(args.where!)) {
          const value = v.metadata[key];
          if (cond && typeof cond === "object" && "$in" in (cond as object)) {
            const list = (cond as { $in: unknown[] }).$in.map(String);
            if (!list.includes(String(value))) return false;
          } else if (String(value) !== String(cond)) {
            return false;
          }
        }
        return true;
      });
    }
    if (args.whereDocument && "$contains" in args.whereDocument) {
      const needle = String(args.whereDocument.$contains);
      entries = entries.filter(([, v]) => v.document.includes(needle));
    }
    return {
      ids: entries.map(([id]) => id),
      documents: entries.map(([, v]) => v.document),
      metadatas: entries.map(([, v]) => v.metadata),
    };
  }
}

describe("LangChain tools + createFsAgent", () => {
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
      ids: ["oauth-0", "qs-0"],
      documents: [
        "# OAuth\nUse the access_token from the OAuth flow.",
        "# Quickstart\nGenerate an access_token using the OAuth guide.",
      ],
      metadatas: [
        { page_slug: "auth/oauth.md", chunk_index: 0 },
        { page_slug: "guides/quickstart.md", chunk_index: 0 },
      ],
    });
    fs = await ChromaFs.create(collection as never);
  });

  it("createBashTool invokes via LangChain tool API", async () => {
    const bash = createAgentBash({ fs });
    const bashTool = createBashTool(bash);
    expect(bashTool.name).toBe("bash");
    const out = await bashTool.invoke({ command: "ls /guides" });
    expect(String(out)).toContain("quickstart.md");
  });

  it("createFsTools exposes ls/read_file/grep/glob", async () => {
    const [ls, readFile, grep, glob] = createFsTools(fs);
    expect(await ls.invoke({ path: "/auth" })).toContain("oauth.md");
    expect(await readFile.invoke({ path: "/auth/oauth.md" })).toContain("OAuth");
    expect(await grep.invoke({ pattern: "access_token", path: "/", ignoreCase: true })).toContain(
      "access_token",
    );
    expect(await glob.invoke({ pattern: "**/*.md", path: "/" })).toContain("/auth/oauth.md");
  });

  it("createFsAgent runs a ReAct loop with FakeToolCallingModel", async () => {
    const model = new FakeToolCallingModel({
      toolCalls: [
        [{ name: "ls", args: { path: "/" }, id: "call_1" }],
        [{ name: "read_file", args: { path: "/auth/oauth.md" }, id: "call_2" }],
        [],
      ],
    });

    const agent = createFsAgent({
      model,
      fs,
      bashOptions: { customCommands: [fs.createGrepCommand()] },
    });

    const result = await agent.invoke({
      messages: [{ role: "user", content: "Explain OAuth from the docs" }],
    });

    const toolMessages = result.messages.filter(
      (m) => (m as { getType?: () => string }).getType?.() === "tool",
    );
    expect(toolMessages.length).toBeGreaterThanOrEqual(2);
    const contents = toolMessages.map((m) => String((m as { content: unknown }).content));
    expect(contents.some((c) => c.includes("auth") || c.includes("guides"))).toBe(true);
    expect(contents.some((c) => c.includes("OAuth") || c.includes("access_token"))).toBe(true);
  });

  it("createFsAgentTools returns bash plus structured tools", () => {
    const bash = createAgentBash({ fs });
    const tools = createFsAgentTools({ bash, fs });
    expect(tools.map((t) => t.name).sort()).toEqual([
      "bash",
      "glob",
      "grep",
      "ls",
      "read_file",
    ]);
  });
});
