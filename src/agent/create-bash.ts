/**
 * Agent helpers — wire virtual filesystems into just-bash for ReAct /
 * plan-observe-act agents.
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

export interface BashToolResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Minimal tool schema for ReAct / plan-observe-act loops.
 * Expose `bash` as the agent's only retrieval tool.
 */
export function createBashTool(bash: Bash) {
  return {
    name: "bash" as const,
    description:
      "Run a bash command against the documentation / knowledge filesystem. " +
      "Use ls, cat, find, grep, head, wc, and pipes to explore. The filesystem is read-only.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Bash command to execute (e.g. `ls /auth`, `grep -ri oauth /`, `cat /guides/quickstart.md`)",
        },
      },
      required: ["command"],
    },
    async execute(input: { command: string }): Promise<BashToolResult> {
      const result = await bash.exec(input.command);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    },
  };
}

/**
 * System prompt fragment teaching the agent how to use the virtual filesystem.
 */
export const FS_LAYER_SYSTEM_PROMPT = `You explore a read-only virtual filesystem that mirrors a knowledge base
(documentation in ChromaDB and/or a Neo4j graph). Prefer filesystem tools over guessing:

- \`ls\` / \`find\` — discover structure
- \`cat\` / \`head\` / \`tail\` — read full pages or nodes
- \`grep -ri\` — search for exact strings or patterns across the tree
- pipes and composition (\`grep ... | head\`) are available

Do not try to write, create, or delete files — the filesystem is read-only (EROFS).
When answering, cite the paths you read.`;
