/**
 * Grep tool — structured search over the virtual filesystem.
 *
 * Output is both model-friendly text and a stable JSON envelope the TUI
 * can render as a dedicated grep card (path / line / snippet).
 */

import { tool } from "langchain";
import type { IFileSystem } from "just-bash";
import { z } from "zod";

export interface GrepHit {
  path: string;
  line: number;
  text: string;
}

export interface GrepToolResult {
  pattern: string;
  path: string;
  ignoreCase: boolean;
  fixedString: boolean;
  count: number;
  matches: GrepHit[];
  truncated: boolean;
}

export const GREP_RESULT_MARKER = "__fs_layer_grep_v1__";

const DEFAULT_MAX_MATCHES = 40;

export function formatGrepResult(result: GrepToolResult): string {
  const header = [
    GREP_RESULT_MARKER,
    JSON.stringify({
      pattern: result.pattern,
      path: result.path,
      ignoreCase: result.ignoreCase,
      fixedString: result.fixedString,
      count: result.count,
      truncated: result.truncated,
    }),
  ].join("\n");

  if (result.count === 0) {
    return `${header}\nNo matches for ${JSON.stringify(result.pattern)} under ${result.path}`;
  }

  const body = result.matches
    .map((m) => `${m.path}:${m.line}:${m.text}`)
    .join("\n");

  const footer = result.truncated
    ? `\n… truncated to ${result.matches.length} of ${result.count} matches`
    : `\n${result.count} match${result.count === 1 ? "" : "es"}`;

  return `${header}\n${body}${footer}`;
}

export function parseGrepResult(raw: unknown): GrepToolResult | null {
  if (raw == null) return null;
  if (typeof raw === "object" && raw !== null && "matches" in raw) {
    return raw as GrepToolResult;
  }
  if (typeof raw !== "string") return null;
  if (!raw.startsWith(GREP_RESULT_MARKER)) return null;

  const lines = raw.split("\n");
  const metaLine = lines[1];
  if (!metaLine) return null;

  try {
    const meta = JSON.parse(metaLine) as {
      pattern: string;
      path: string;
      ignoreCase: boolean;
      fixedString: boolean;
      count: number;
      truncated: boolean;
    };
    const matches: GrepHit[] = [];
    for (const line of lines.slice(2)) {
      if (!line || line.startsWith("…") || line.startsWith("No matches") || /^\d+ match/.test(line)) {
        continue;
      }
      const match = /^(.+?):(\d+):(.*)$/.exec(line);
      if (!match) continue;
      matches.push({
        path: match[1]!,
        line: Number(match[2]),
        text: match[3] ?? "",
      });
    }
    return {
      pattern: meta.pattern,
      path: meta.path,
      ignoreCase: meta.ignoreCase,
      fixedString: meta.fixedString,
      count: meta.count,
      truncated: meta.truncated,
      matches,
    };
  } catch {
    return null;
  }
}

async function fallbackScan(
  fs: IFileSystem,
  pattern: string,
  options: { path: string; ignoreCase: boolean; fixedString: boolean; maxMatches: number },
): Promise<GrepToolResult> {
  const root = options.path.replace(/\/+$/, "") || "/";
  const allPaths = typeof fs.getAllPaths === "function" ? fs.getAllPaths() : [];
  const flags = options.ignoreCase ? "i" : "";
  const source = options.fixedString
    ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    : pattern;
  let regex: RegExp;
  try {
    regex = new RegExp(source, flags);
  } catch {
    return {
      pattern,
      path: root,
      ignoreCase: options.ignoreCase,
      fixedString: options.fixedString,
      count: 0,
      matches: [],
      truncated: false,
    };
  }

  const matches: GrepHit[] = [];
  let count = 0;

  for (const p of allPaths) {
    if (!(await fs.exists(p))) continue;
    const st = await fs.stat(p);
    if (!st.isFile) continue;
    if (root !== "/" && p !== root && !p.startsWith(root + "/")) continue;

    const content = await fs.readFile(p);
    const lines = content.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i] ?? "";
      if (!regex.test(text)) continue;
      count += 1;
      if (matches.length < options.maxMatches) {
        matches.push({ path: p, line: i + 1, text });
      }
    }
  }

  return {
    pattern,
    path: root,
    ignoreCase: options.ignoreCase,
    fixedString: options.fixedString,
    count,
    matches,
    truncated: count > matches.length,
  };
}

/**
 * First-class grep tool for createAgent / chat-tui.
 * Prefers ChromaFs/Neo4jFs `.grep()` when available.
 */
export function createGrepTool(
  fs: IFileSystem,
  options: { maxMatches?: number } = {},
) {
  const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;

  return tool(
    async ({ pattern, path, ignoreCase, fixedString }) => {
      const searchPath = path || "/";
      const caseInsensitive = ignoreCase ?? true;
      const fixed = fixedString ?? true;

      const maybeGrep = fs as IFileSystem & {
        grep?: (
          pattern: string,
          options?: {
            path?: string;
            ignoreCase?: boolean;
            fixedString?: boolean;
          },
        ) => Promise<GrepHit[]>;
      };

      let result: GrepToolResult;

      if (typeof maybeGrep.grep === "function") {
        const hits = await maybeGrep.grep(pattern, {
          path: searchPath,
          ignoreCase: caseInsensitive,
          fixedString: fixed,
        });
        result = {
          pattern,
          path: searchPath,
          ignoreCase: caseInsensitive,
          fixedString: fixed,
          count: hits.length,
          matches: hits.slice(0, maxMatches),
          truncated: hits.length > maxMatches,
        };
      } else {
        result = await fallbackScan(fs, pattern, {
          path: searchPath,
          ignoreCase: caseInsensitive,
          fixedString: fixed,
          maxMatches,
        });
      }

      return formatGrepResult(result);
    },
    {
      name: "grep",
      description:
        "Search the read-only knowledge filesystem for a string or regex. " +
        "Returns matching file paths with line numbers and snippets. " +
        "Prefer this over bash grep for recursive search — it uses Chroma coarse filtering when available.",
      schema: z.object({
        pattern: z
          .string()
          .describe("Search string (or regex when fixedString is false)"),
        path: z
          .string()
          .default("/")
          .describe("Directory to search under (default /)"),
        ignoreCase: z
          .boolean()
          .default(true)
          .describe("Case-insensitive match (default true)"),
        fixedString: z
          .boolean()
          .default(true)
          .describe("Treat pattern as a literal string (default true)"),
      }),
    },
  );
}
