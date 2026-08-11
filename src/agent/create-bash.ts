/**
 * Agent helpers — wire virtual filesystems into just-bash and LangChain
 * createAgent (LangGraph runtime).
 */

import { Bash, type BashOptions, type CustomCommand, type IFileSystem } from "just-bash";

export interface CreateAgentBashOptions extends Omit<BashOptions, "fs" | "customCommands"> {
  fs: IFileSystem;
  /** Extra custom commands (e.g. ChromaFs.createGrepCommand()). */
  customCommands?: CustomCommand[];
  /** Initial working directory. Default: / */
  cwd?: string;
}

/**
 * Create a just-bash instance bound to a virtual filesystem backend.
 * The agent talks to Chroma / Neo4j with ordinary shell commands.
 */
export function createAgentBash(options: CreateAgentBashOptions): Bash {
  const { fs, customCommands, cwd, ...rest } = options;
  return new Bash({
    ...rest,
    fs,
    cwd: cwd ?? "/",
    customCommands,
  });
}

export type { BashToolResult } from "./tools.js";
