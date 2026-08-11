/**
 * Seed a Chroma collection and explore it with just-bash via ChromaFs.
 *
 *   npx tsx examples/chroma-quickstart.ts
 */

import { ChromaClient } from "chromadb";
import {
  ChromaFs,
  createAgentBash,
  createBashTool,
  FS_LAYER_SYSTEM_PROMPT,
  PATH_TREE_ID,
} from "../src/index.js";

async function main() {
  const client = new ChromaClient();
  const collection = await client.getOrCreateCollection({ name: "fs_layer_demo" });

  // Reset demo docs
  try {
    const existing = await collection.get();
    if (existing.ids.length) await collection.delete({ ids: existing.ids });
  } catch {
    // empty collection
  }

  const tree = {
    "auth/oauth.md": { isPublic: true, groups: [] },
    "guides/quickstart.md": { isPublic: true, groups: [] },
  };

  await collection.add({
    ids: [PATH_TREE_ID, "c0", "c1", "c2"],
    documents: [
      JSON.stringify(tree),
      "# OAuth\nUse the access_token from the OAuth flow to authenticate.",
      "Refresh tokens are optional for public clients.",
      "# Quickstart\nGenerate an access_token using the OAuth guide, then call the API.",
    ],
    embeddings: [
      [0, 0, 0],
      [0.1, 0.2, 0.3],
      [0.2, 0.1, 0.4],
      [0.3, 0.3, 0.1],
    ],
    metadatas: [
      { _system: true },
      { page_slug: "auth/oauth.md", chunk_index: 0 },
      { page_slug: "auth/oauth.md", chunk_index: 1 },
      { page_slug: "guides/quickstart.md", chunk_index: 0 },
    ],
  });

  const fs = await ChromaFs.create(collection);
  const bash = createAgentBash({
    fs,
    customCommands: [fs.createGrepCommand()],
  });

  console.log("--- system prompt fragment ---");
  console.log(FS_LAYER_SYSTEM_PROMPT);

  for (const cmd of ["ls /", "ls /auth", "cat /auth/oauth.md", 'grep -ri access_token /']) {
    const result = await bash.exec(cmd);
    console.log(`\n$ ${cmd}`);
    process.stdout.write(result.stdout || result.stderr);
  }

  const tool = createBashTool(bash);
  const toolResult = await tool.invoke({ command: "find / -name '*.md'" });
  console.log("\n[tool]", toolResult);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
