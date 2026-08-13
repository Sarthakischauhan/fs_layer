/**
 * fs-layer TUI entry — @sarchauhan/chat-tui over ChromaFs + createFsAgent.
 *
 *   npm run tui
 */

import { render } from "@sarchauhan/chat-tui";
import { CloudClient, OpenAIEmbeddingFunction } from "chromadb";
import { ChatOpenAI } from "@langchain/openai";

import { createFsAgent, ChromaFs } from "./index.js";
import { createFsLayerAdapter } from "./tui/adapter.js";
import { FsLayerApp } from "./tui/app.js";

process.env.OPENAI_API_KEY ??= process.env.OPENAI_KEY;

async function main() {
  const apiKey = process.env.CHROMA_API_KEY;
  if (!apiKey) {
    throw new Error("CHROMA_API_KEY is required");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required");
  }

  const modelName = process.env.MODEL ?? "gpt-5.6-luna";
  const model = new ChatOpenAI({
    model: modelName,
    apiKey: process.env.OPENAI_API_KEY,
    useResponsesApi: true,
  });

  const client = new CloudClient({
    apiKey,
    tenant: process.env.CHROMA_TENANT,
    database: process.env.CHROMA_DATABASE,
  });

  const embeddingFunction = new OpenAIEmbeddingFunction({
    openai_api_key: process.env.OPENAI_API_KEY!,
    openai_model: "text-embedding-3-small",
  });

  const collection = await client.getOrCreateCollection({
    name: process.env.CHROMA_COLLECTION ?? "fs_layer",
    embeddingFunction,
  });

  const fs = await ChromaFs.create(collection);
  const agent = createFsAgent({
    model,
    fs,
    bashOptions: {
      customCommands: [fs.createGrepCommand()],
    },
  });

  const adapter = createFsLayerAdapter({ agent, modelLabel: modelName });
  const models = [
    {
      id: modelName,
      label: modelName,
      provider: "openai",
    },
  ];

  render(
    <FsLayerApp
      adapter={adapter}
      models={models}
      defaultModel={modelName}
      defaultProvider="openai"
    />,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
