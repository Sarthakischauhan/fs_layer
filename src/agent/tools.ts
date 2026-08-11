/**
 * LangChain tools for exploring a just-bash virtual filesystem.
 *
 * Defined with `tool` + Zod schemas per LangChain docs so they plug into
 * `createAgent` (LangGraph runtime) without extra adapters.
 */

import { tool } from "langchain";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { Bash, IFileSystem } from "just-bash";
import { z } from "zod";

export interface BashToolResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

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
        "Use ls, cat, find, grep, head, wc, and pipes to explore. " +
        "Examples: `ls /auth`, `cat /guides/quickstart.md`, `grep -ri oauth /`.",
      schema: z.object({
        command: z
          .string()
          .describe(
            "Bash command to execute (e.g. ls /auth, grep -ri oauth /, cat /guides/quickstart.md)",
          ),
      }),
    },
  );
}

/**
 * Structured filesystem tools (no shell parsing). Useful when you want
 * narrower tool calls than a free-form bash session.
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

  const grep = tool(
    async ({ pattern, path, ignoreCase }) => {
      // Prefer ChromaFs/Neo4jFs optimized grep when available
      const maybeGrep = fs as IFileSystem & {
        grep?: (
          pattern: string,
          options?: { path?: string; ignoreCase?: boolean },
        ) => Promise<Array<{ path: string; line: number; text: string }>>;
      };

      if (typeof maybeGrep.grep === "function") {
        const matches = await maybeGrep.grep(pattern, {
          path,
          ignoreCase,
        });
        if (matches.length === 0) return "No matches.";
        return matches
          .map((m) => `${m.path}:${m.line}:${m.text}`)
          .join("\n");
      }

      const allPaths =
        typeof fs.getAllPaths === "function" ? fs.getAllPaths() : [];
      const root = path.replace(/\/+$/, "") || "/";
      const files: string[] = [];
      for (const p of allPaths) {
        if (!(await fs.exists(p))) continue;
        const st = await fs.stat(p);
        if (!st.isFile) continue;
        if (root === "/" || p === root || p.startsWith(root + "/")) {
          files.push(p);
        }
      }

      const flags = ignoreCase ? "i" : "";
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, flags);
      const out: string[] = [];
      for (const file of files) {
        const content = await fs.readFile(file);
        const lines = content.split(/\r\n|\r|\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          if (regex.test(line)) out.push(`${file}:${i + 1}:${line}`);
        }
      }
      return out.length ? out.join("\n") : "No matches.";
    },
    {
      name: "grep",
      description:
        "Search for a fixed string across files under a path in the virtual filesystem.",
      schema: z.object({
        pattern: z.string().describe("Fixed string to search for"),
        path: z
          .string()
          .default("/")
          .describe("Directory to search under (default /)"),
        ignoreCase: z
          .boolean()
          .default(true)
          .describe("Case-insensitive search"),
      }),
    },
  );

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
 * Default tool set for createAgent: one bash tool. Structured tools are opt-in.
 */
export function createFsAgentTools(options: {
  bash: Bash;
  fs?: IFileSystem;
  /** Include structured ls/read_file/grep/glob tools. Default false. */
  includeStructured?: boolean;
}): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = [createBashTool(options.bash)];
  const includeStructured = options.includeStructured ?? false;
  if (includeStructured && options.fs) {
    tools.push(...createFsTools(options.fs));
  }
  return tools;
}
