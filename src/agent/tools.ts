/**
 * LangChain tools for exploring a just-bash virtual filesystem.
 */

import { tool } from "langchain";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { Bash, IFileSystem } from "just-bash";
import { z } from "zod";

import { createGrepTool } from "./grep-tool.js";

export interface BashToolResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export {
  createGrepTool,
  formatGrepResult,
  parseGrepResult,
  GREP_RESULT_MARKER,
} from "./grep-tool.js";
export type { GrepHit, GrepToolResult } from "./grep-tool.js";

function formatExec(result: BashToolResult): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push(result.stderr);
  if (result.exitCode !== 0) {
    parts.push(`[exit ${result.exitCode}]`);
  }
  return parts.join("").trimEnd() || "(empty)";
}

/**
 * Primary exploration tool: run a bash command against the virtual FS.
 */
export function createBashTool(bash: Bash) {
  return tool(
    async ({ command }): Promise<string> => {
      const result = await bash.exec(command);
      return formatExec({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    },
    {
      name: "bash",
      description:
        "Run a bash command against the read-only knowledge filesystem. " +
        "Use ls, cat, find, head, wc, and pipes to explore. " +
        "For recursive search prefer the dedicated grep tool. " +
        "Examples: `ls /auth`, `cat /guides/quickstart.md`, `find / -name '*.md'`.",
      schema: z.object({
        command: z
          .string()
          .describe(
            "Bash command to execute (e.g. ls /auth, cat /guides/quickstart.md)",
          ),
      }),
    },
  );
}

/**
 * Structured filesystem tools (no shell parsing).
 */
export function createFsTools(fs: IFileSystem) {
  const ls = tool(
    async ({ path }) => {
      const entries = await fs.readdir(path);
      if (entries.length === 0) return "(empty)";
      const lines: string[] = [];
      for (const name of entries) {
        const full = path === "/" ? `/${name}` : `${path.replace(/\/$/, "")}/${name}`;
        const st = await fs.stat(full);
        lines.push(`${st.isDirectory ? "d" : "-"} ${name}`);
      }
      return lines.join("\n");
    },
    {
      name: "ls",
      description: "List files and directories at a path in the virtual filesystem.",
      schema: z.object({
        path: z
          .string()
          .default("/")
          .describe("Absolute directory path to list (e.g. /, /auth)"),
      }),
    },
  );

  const readFile = tool(
    async ({ path }) => {
      return await fs.readFile(path);
    },
    {
      name: "read_file",
      description:
        "Read the full contents of a file in the virtual filesystem (like cat).",
      schema: z.object({
        path: z
          .string()
          .describe("Absolute file path to read (e.g. /auth/oauth.md)"),
      }),
    },
  );

  const grep = createGrepTool(fs);

  const glob = tool(
    async ({ pattern, path }) => {
      const bashLike = new RegExp(
        "^" +
          pattern
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*\*/g, "<<<GLOBSTAR>>>")
            .replace(/\*/g, "[^/]*")
            .replace(/<<<GLOBSTAR>>>/g, ".*")
            .replace(/\?/g, ".") +
          "$",
      );
      const root = path.replace(/\/+$/, "") || "/";
      const allPaths =
        typeof fs.getAllPaths === "function" ? fs.getAllPaths() : [];
      const matches: string[] = [];
      for (const p of allPaths) {
        if (!(await fs.exists(p))) continue;
        const st = await fs.stat(p);
        if (!st.isFile) continue;
        if (root !== "/" && p !== root && !p.startsWith(root + "/")) continue;
        const relative =
          root === "/" ? p.replace(/^\//, "") : p.slice(root.length + 1);
        if (bashLike.test(relative) || bashLike.test(p.replace(/^\//, ""))) {
          matches.push(p);
        }
      }
      return matches.length ? matches.join("\n") : "No matches.";
    },
    {
      name: "glob",
      description: "Find file paths matching a glob pattern (e.g. **/*.md).",
      schema: z.object({
        pattern: z.string().describe("Glob pattern such as **/*.md or auth/*"),
        path: z
          .string()
          .default("/")
          .describe("Base directory for the search"),
      }),
    },
  );

  return [ls, readFile, grep, glob] as const;
}

/**
 * Default tool set: bash + first-class grep. Other structured tools are opt-in.
 */
export function createFsAgentTools(options: {
  bash: Bash;
  fs?: IFileSystem;
  /** Include ls/read_file/glob in addition to bash+grep. Default false. */
  includeStructured?: boolean;
}): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = [createBashTool(options.bash)];

  if (options.fs) {
    tools.push(createGrepTool(options.fs));
  }

  if (options.includeStructured && options.fs) {
    const [ls, readFile, , glob] = createFsTools(options.fs);
    tools.push(ls, readFile, glob);
  }

  return tools;
}
