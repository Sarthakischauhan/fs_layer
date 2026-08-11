/**
 * createFsAgent — LangChain `createAgent` (LangGraph runtime) wired to
 * a just-bash virtual filesystem.
 */

import { createAgent, type CreateAgentParams, type ReactAgent } from "langchain";
import type { Bash, IFileSystem } from "just-bash";

import { createAgentBash, type CreateAgentBashOptions } from "./create-bash.js";
import { FS_LAYER_SYSTEM_PROMPT } from "./prompt.js";
import { createFsAgentTools } from "./tools.js";

export interface CreateFsAgentOptions {
  /** Language model: `"openai:gpt-4o"`, a chat model instance, etc. */
  model: CreateAgentParams["model"];
  /**
   * Virtual filesystem (ChromaFs, Neo4jFs, MountableFs, …).
   * Used both for just-bash and structured tools.
   */
  fs: IFileSystem;
  /** Optional prebuilt Bash; otherwise created from `fs` + bashOptions. */
  bash?: Bash;
  /** Options passed to createAgentBash when `bash` is omitted. */
  bashOptions?: Omit<CreateAgentBashOptions, "fs">;
  /** Extra LangChain tools merged after the filesystem tools. */
  extraTools?: CreateAgentParams["tools"];
  /** Override system prompt (defaults to FS_LAYER_SYSTEM_PROMPT). */
  systemPrompt?: CreateAgentParams["systemPrompt"];
  /** Include structured ls/read_file/grep/glob tools. Default: true */
  includeStructuredTools?: boolean;
  /** Forwarded to createAgent (middleware, responseFormat, …). */
  agentOptions?: Omit<
    CreateAgentParams,
    "model" | "tools" | "systemPrompt"
  >;
}

/**
 * Build a ReAct agent that explores Chroma / Neo4j through filesystem tools.
 *
 * @example
 * ```ts
 * import { ChromaFs, createFsAgent } from "fs-layer";
 *
 * const fs = await ChromaFs.create(collection);
 * const agent = createFsAgent({
 *   model: "openai:gpt-4o-mini",
 *   fs,
 * });
 *
 * const result = await agent.invoke({
 *   messages: [{ role: "user", content: "How does OAuth work in these docs?" }],
 * });
 * ```
 */
export function createFsAgent(options: CreateFsAgentOptions): ReactAgent {
  const bash =
    options.bash ??
    createAgentBash({
      fs: options.fs,
      ...options.bashOptions,
    });

  const fsTools = createFsAgentTools({
    bash,
    fs: options.fs,
    includeStructured: options.includeStructuredTools,
  });

  const tools = [
    ...fsTools,
    ...((options.extraTools as unknown[] | undefined) ?? []),
  ] as CreateAgentParams["tools"];

  return createAgent({
    model: options.model,
    tools,
    systemPrompt: options.systemPrompt ?? FS_LAYER_SYSTEM_PROMPT,
    ...options.agentOptions,
  });
}
