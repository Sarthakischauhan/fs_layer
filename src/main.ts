import { CloudClient, OpenAIEmbeddingFunction } from "chromadb";
import { ChatOpenAI } from "@langchain/openai";
import { createFsAgent, ChromaFs } from "./index.js";

process.env.OPENAI_API_KEY ??= process.env.OPENAI_KEY;

const apiKey = process.env.CHROMA_API_KEY;
const collectionName = process.env.CHROMA_COLLECTION ?? "fs_layer";
const model = new ChatOpenAI({
  model: process.env.MODEL ?? "gpt-5.6-luna",
  apiKey: process.env.OPENAI_API_KEY,
  useResponsesApi: true,
});
const prompt = process.argv.slice(2).join(" ") || "Explore the knowledge base and summarize it.";

if (!apiKey) {
  throw new Error("CHROMA_API_KEY is required");
}

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
  name: collectionName,
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

const result = await agent.invoke({
  messages: [{ role: "user", content: prompt }],
});

type MessageLike = {
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id?: string;
    name?: string;
    args?: unknown;
  }>;
  getType?: () => string;
};

const messages = result.messages as unknown as MessageLike[];

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content ? JSON.stringify(content) : "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text: unknown }).text);
      }
      return JSON.stringify(part);
    })
    .join("\n");
}

const toolResults = new Map(
  messages
    .filter((message) => message.getType?.() === "tool" || message.tool_call_id)
    .map((message) => [message.tool_call_id, contentToText(message.content)]),
);

const toolCalls = messages.flatMap((message) =>
  (message.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: call.name,
    args: call.args,
    output: call.id ? toolResults.get(call.id) ?? null : null,
  })),
);

const finalMessage = [...messages]
  .reverse()
  .find((message) => message.getType?.() === "ai" && !message.tool_calls?.length);

console.log(
  JSON.stringify(
    {
      output: contentToText(finalMessage?.content),
      tool_calls: toolCalls,
    },
    null,
    2,
  ),
);
