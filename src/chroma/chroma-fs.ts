/**
 * ChromaFs — just-bash IFileSystem backed by a ChromaDB collection.
 *
 * Implements the Mintlify ChromaFs algorithm:
 * - Bootstrap directory tree from a single `__path_tree__` document (~100ms)
 * - Reassemble pages from chunks on cat
 * - Optimize recursive grep via Chroma coarse filter + in-memory fine filter
 * - All writes throw EROFS
 */

import { IncludeEnum } from "chromadb";
import type { Collection } from "chromadb";
import { defineCommand, type Command } from "just-bash";
import yargsParser from "yargs-parser";

import { ContentCache } from "../cache.js";
import { PathTree, normalizePath } from "../path-tree.js";
import { ReadOnlyVirtualFs } from "../read-only-fs.js";
import {
  bulkPrefetch,
  fetchPage,
  findMatchingSlugs,
  fineFilter,
  toChromaFilter,
  type GrepMatch,
} from "./grep.js";

export const PATH_TREE_ID = "__path_tree__";

export interface ChromaFsOptions {
  /** Groups the current user belongs to (for RBAC pruning). */
  userGroups?: Set<string> | string[];
  /** Metadata field for page slug (default: page_slug). */
  slugField?: string;
  /** Metadata field for chunk order (default: chunk_index). */
  chunkIndexField?: string;
  /** Optional shared content cache. */
  cache?: ContentCache;
  /** Lazy content resolvers for paths not stored as Chroma chunks (e.g. S3). */
  lazyFiles?: Record<string, () => string | Promise<string>>;
}

export class ChromaFs extends ReadOnlyVirtualFs {
  private readonly collection: Collection;
  private readonly slugField: string;
  private readonly chunkIndexField: string;
  private readonly lazyFiles: Map<string, () => string | Promise<string>>;

  private constructor(
    collection: Collection,
    tree: PathTree,
    options: ChromaFsOptions,
  ) {
    super(tree, options.cache);
    this.collection = collection;
    this.slugField = options.slugField ?? "page_slug";
    this.chunkIndexField = options.chunkIndexField ?? "chunk_index";
    this.lazyFiles = new Map(
      Object.entries(options.lazyFiles ?? {}).map(([k, v]) => [
        normalizePath(k.startsWith("/") ? k : `/${k}`),
        v,
      ]),
    );
  }

  /**
   * Create and bootstrap a ChromaFs instance.
   * Fetches `__path_tree__` from Chroma and builds the in-memory directory index.
   */
  static async create(
    collection: Collection,
    options: ChromaFsOptions = {},
  ): Promise<ChromaFs> {
    const tree = await ChromaFs.bootstrapTree(collection, options);

    // Ensure lazy file paths appear in the tree even if absent from __path_tree__
    if (options.lazyFiles && Object.keys(options.lazyFiles).length > 0) {
      const slugs = [
        ...tree.getAllPaths().filter((p) => tree.isFile(p)).map((p) => tree.pathToSlug(p)),
        ...Object.keys(options.lazyFiles).map((p) => p.replace(/^\/+/, "")),
      ];
      return new ChromaFs(collection, PathTree.fromSlugs(slugs), options);
    }

    return new ChromaFs(collection, tree, options);
  }

  private static async bootstrapTree(
    collection: Collection,
    options: ChromaFsOptions,
  ): Promise<PathTree> {
    const userGroups = options.userGroups
      ? options.userGroups instanceof Set
        ? options.userGroups
        : new Set(options.userGroups)
      : undefined;

    const results = await collection.get({
      ids: [PATH_TREE_ID],
      include: [IncludeEnum.Documents],
    });
    const documents = results.documents ?? [];
    const first = documents[0];
    if (!first) return PathTree.empty();
    return PathTree.fromJson(first, userGroups);
  }

  protected async loadContent(path: string): Promise<string> {
    const normalised = normalizePath(path);
    const lazy = this.lazyFiles.get(normalised);
    if (lazy) return await lazy();

    const slug = this.tree.pathToSlug(normalised);
    return fetchPage(this.collection, slug, {
      slugField: this.slugField,
      chunkIndexField: this.chunkIndexField,
    });
  }

  /**
   * Optimized grep using Chroma as a coarse filter, then in-memory fine filter.
   * Prefer this (or the custom just-bash grep command) over naive recursive scans.
   */
  async grep(
    pattern: string,
    options: {
      path?: string;
      glob?: string;
      fixedString?: boolean;
      ignoreCase?: boolean;
    } = {},
  ): Promise<GrepMatch[]> {
    const searchRoot = normalizePath(options.path ?? "/");
    const candidatePaths = options.glob
      ? this.tree.globMatch(searchRoot, options.glob)
      : this.tree.filesUnder(searchRoot);
    const candidateSlugs = candidatePaths.map((p) => this.tree.pathToSlug(p));

    const chromaFilter = toChromaFilter(pattern, {
      fixedString: options.fixedString ?? true,
      ignoreCase: options.ignoreCase ?? false,
    });

    const matchedSlugs = await findMatchingSlugs(
      this.collection,
      chromaFilter,
      candidateSlugs,
      { slugField: this.slugField },
    );

    if (matchedSlugs.length === 0) return [];

    await bulkPrefetch(this.collection, matchedSlugs, this.cache, {
      slugField: this.slugField,
      chunkIndexField: this.chunkIndexField,
    });

    return fineFilter(pattern, matchedSlugs, this.cache, {
      fixedString: options.fixedString ?? true,
      ignoreCase: options.ignoreCase ?? false,
      slugToPath: (s) => this.tree.slugToPath(s),
    });
  }

  /** just-bash custom command that intercepts grep for Chroma acceleration. */
  createGrepCommand(): Command {
    const self = this;
    return defineCommand("grep", async (args, ctx) => {
      const parsed = yargsParser(args, {
        boolean: ["i", "r", "R", "n", "H", "h", "F", "w", "v", "l", "c", "q", "E"],
        alias: {
          i: "ignore-case",
          r: "recursive",
          R: "recursive",
          n: "line-number",
          F: "fixed-strings",
          E: "extended-regexp",
        },
        configuration: {
          "short-option-groups": true,
          "camel-case-expansion": false,
        },
      });

      const positional = (parsed._ as Array<string | number>).map(String);
      const pattern = positional[0];
      if (!pattern) {
        return {
          stdout: "",
          stderr: "grep: missing pattern\n",
          exitCode: 2,
        };
      }

      const targets = positional.slice(1);
      const recursive = Boolean(parsed.r || parsed.R || parsed.recursive);
      const ignoreCase = Boolean(parsed.i || parsed["ignore-case"]);
      const fixedString = Boolean(parsed.F || parsed["fixed-strings"]) || !parsed.E;

      if (targets.length > 1 || (targets.length === 1 && !recursive)) {
        const matches: GrepMatch[] = [];
        for (const t of targets) {
          const abs = ctx.fs.resolvePath(ctx.cwd, String(t));
          if (!(await ctx.fs.exists(abs))) continue;
          const st = await ctx.fs.stat(abs);
          if (!st.isFile) continue;
          const content = await ctx.fs.readFile(abs);
          self.cache.put(self.tree.pathToSlug(abs), content);
          matches.push(
            ...fineFilter(pattern, [self.tree.pathToSlug(abs)], self.cache, {
              fixedString,
              ignoreCase,
              slugToPath: (s) => self.tree.slugToPath(s),
            }),
          );
        }
        return formatGrepOutput(matches, {
          showPath: targets.length !== 1,
          showLineNumber: true,
        });
      }

      const searchPath =
        targets.length === 1
          ? ctx.fs.resolvePath(ctx.cwd, targets[0]!)
          : ctx.cwd;

      const matches = await self.grep(pattern, {
        path: searchPath,
        fixedString,
        ignoreCase,
      });
      return formatGrepOutput(matches, {
        showPath: true,
        showLineNumber: true,
      });
    });
  }
}

function formatGrepOutput(
  matches: GrepMatch[],
  options: { showPath: boolean; showLineNumber: boolean },
): { stdout: string; stderr: string; exitCode: number } {
  if (matches.length === 0) {
    return { stdout: "", stderr: "", exitCode: 1 };
  }

  const lines = matches.map((m) => {
    const parts: string[] = [];
    if (options.showPath) parts.push(m.path);
    if (options.showLineNumber) parts.push(String(m.line));
    parts.push(m.text);
    return parts.join(":");
  });

  return {
    stdout: lines.join("\n") + "\n",
    stderr: "",
    exitCode: 0,
  };
}
