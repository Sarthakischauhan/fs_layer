/**
 * LangChain createAgent exploring a Chroma-backed virtual filesystem.
 *
 *   OPENAI_API_KEY=... npx tsx examples/langgraph-agent.ts
 */

import { ChromaClient } from "chromadb";
import {
  ChromaFs,
  PATH_TREE_ID,
  createFsAgent,
} from "../src/index.js";

async function main() {
  const client = new ChromaClient();
  const collection = await client.getOrCreateCollection({ name: "fs_layer_agent_demo" });

  try {
    const existing = await collection.get();
    if (existing.ids.length) await collection.delete({ ids: existing.ids });
  } catch {
    // empty
  }

  await collection.add({
    ids: [PATH_TREE_ID, "c0", "c1"],
    documents: [
      JSON.stringify({
        "auth/oauth.md": { isPublic: true, groups: [] },
        "guides/quickstart.md": { isPublic: true, groups: [] },
      }),
      "# OAuth\nUse the access_token from the OAuth flow to authenticate API requests.",
      "# Quickstart\nGenerate an access_token, then call GET /users.",
    ],
    embeddings: [
      [0, 0, 0],
      [0.1, 0.2, 0.3],
      [0.2, 0.1, 0.4],
    ],
    metadatas: [
      { _system: true },
      { page_slug: "auth/oauth.md", chunk_index: 0 },
      { page_slug: "guides/quickstart.md", chunk_index: 0 },
    ],
  });

  const fs = await ChromaFs.create(collection);
  const agent = createFsAgent({
    model: process.env.MODEL ?? "openai:gpt-4o-mini",
    fs,
    bashOptions: { customCommands: [fs.createGrepCommand()] },
  });

  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content: "How do I get an access_token according to these docs? Cite paths.",
      },
    ],
  });

  const last = result.messages[result.messages.length - 1];
  console.log(typeof last?.content === "string" ? last.content : last);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
