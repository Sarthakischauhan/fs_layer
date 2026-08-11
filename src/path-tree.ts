/**
 * PathTree: in-memory virtual filesystem tree.
 *
 * Bootstrapped once from a `__path_tree__` document (Chroma) or path metadata
 * (Neo4j), then used for ls / cd / find / glob with zero network calls.
 *
 * Document format:
 *   {
 *     "auth/oauth.md": { "isPublic": true, "groups": [] },
 *     "internal/billing.md": { "isPublic": false, "groups": ["admin"] }
 *   }
 */

import { gunzipSync } from "node:zlib";
import micromatch from "micromatch";

export interface PathInfoData {
  isPublic?: boolean;
  groups?: string[];
}

export interface PathInfo {
  isPublic: boolean;
  groups: Set<string>;
}

function parsePathInfo(data: PathInfoData): PathInfo {
  const rawGroups = Array.isArray(data.groups) ? data.groups : [];
  return {
    isPublic: data.isPublic !== false,
    groups: new Set(rawGroups.map(String)),
  };
}

function isAccessible(info: PathInfo, userGroups: Set<string>): boolean {
  if (info.isPublic) return true;
  for (const g of info.groups) {
    if (userGroups.has(g)) return true;
  }
  return false;
}

function decompressTreeDocument(raw: string): string {
  const stripped = raw.trim();
  if (stripped.startsWith("{")) return stripped;
  try {
    const compressed = Buffer.from(stripped, "base64");
    return gunzipSync(compressed).toString("utf-8");
  } catch (err) {
    throw new Error(`Cannot decode path tree document: ${String(err)}`);
  }
}

export function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  const parts = path.split("/").filter(Boolean);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.length === 0 ? "/" : "/" + stack.join("/");
}

export function basename(path: string): string {
  const normalised = normalizePath(path);
  if (normalised === "/") return "/";
  const parts = normalised.split("/");
  return parts[parts.length - 1] ?? normalised;
}

export function dirname(path: string): string {
  const normalised = normalizePath(path);
  if (normalised === "/") return "/";
  const parts = normalised.split("/").filter(Boolean);
  parts.pop();
  return parts.length === 0 ? "/" : "/" + parts.join("/");
}

export class PathTree {
  private readonly filePaths: Set<string>;
  private readonly dirChildren: Map<string, string[]>;

  private constructor(filePaths: Set<string>, dirChildren: Map<string, string[]>) {
    this.filePaths = filePaths;
    this.dirChildren = dirChildren;
  }

  static empty(): PathTree {
    return new PathTree(new Set(), new Map([["/", []]]));
  }

  static fromSlugs(slugs: Iterable<string>): PathTree {
    const filePaths = new Set<string>();
    for (const slug of slugs) {
      const clean = String(slug).replace(/^\/+/, "");
      if (clean) filePaths.add("/" + clean);
    }
    return PathTree._build(filePaths);
  }

  static fromJson(raw: string, userGroups?: Set<string>): PathTree {
    const jsonStr = decompressTreeDocument(raw);
    const data = JSON.parse(jsonStr) as Record<string, PathInfoData>;
    const effectiveGroups = userGroups ?? new Set<string>();

    const filePaths = new Set<string>();
    for (const [slug, infoData] of Object.entries(data)) {
      const info = parsePathInfo(infoData ?? {});
      if (isAccessible(info, effectiveGroups)) {
        const cleanSlug = slug.replace(/^\/+/, "");
        if (cleanSlug) filePaths.add("/" + cleanSlug);
      }
    }

    return PathTree._build(filePaths);
  }

  private static _build(filePaths: Set<string>): PathTree {
    const dirChildren = new Map<string, string[]>();
    dirChildren.set("/", []);

    for (const filePath of filePaths) {
      const parts = filePath.split("/").filter(Boolean);
      for (let depth = 0; depth < parts.length; depth++) {
        const parent = depth === 0 ? "/" : "/" + parts.slice(0, depth).join("/");
        const child = "/" + parts.slice(0, depth + 1).join("/");
        if (!dirChildren.has(parent)) dirChildren.set(parent, []);
        const children = dirChildren.get(parent)!;
        if (!children.includes(child)) children.push(child);
      }
    }

    for (const children of dirChildren.values()) {
      children.sort();
    }

    return new PathTree(filePaths, dirChildren);
  }

  isFile(path: string): boolean {
    return this.filePaths.has(normalizePath(path));
  }

  isDir(path: string): boolean {
    const normalised = normalizePath(path);
    return this.dirChildren.has(normalised);
  }

  exists(path: string): boolean {
    const normalised = normalizePath(path);
    return this.isFile(normalised) || this.isDir(normalised);
  }

  lsChildren(path: string): string[] {
    const normalised = normalizePath(path);
    return [...(this.dirChildren.get(normalised) ?? [])];
  }

  lsNames(path: string): string[] {
    return this.lsChildren(path).map((child) => basename(child));
  }

  filesUnder(path: string): string[] {
    const normalised = normalizePath(path);
    const prefix = normalised === "/" ? "/" : normalised + "/";

    const results: string[] = [];
    for (const fp of this.filePaths) {
      if (normalised === "/" || fp.startsWith(prefix) || fp === normalised) {
        if (fp !== normalised || this.isFile(fp)) {
          if (normalised === "/" || fp.startsWith(prefix)) {
            results.push(fp);
          } else if (fp === normalised && this.isFile(fp)) {
            results.push(fp);
          }
        }
      }
    }
    return results.sort();
  }

  globMatch(path: string, pattern: string): string[] {
    const base = normalizePath(path);
    const candidates = this.filesUnder(base);
    const basePrefix = base === "/" ? "" : base;

    const matches: string[] = [];
    for (const fp of candidates) {
      const relative = fp.slice(basePrefix.length).replace(/^\//, "");
      if (micromatch.isMatch(relative, pattern)) {
        matches.push(fp);
      }
    }
    return matches;
  }

  getAllPaths(): string[] {
    const paths = new Set<string>(["/"]);
    for (const dir of this.dirChildren.keys()) paths.add(dir);
    for (const file of this.filePaths) paths.add(file);
    return [...paths].sort();
  }

  pathToSlug(path: string): string {
    return normalizePath(path).replace(/^\/+/, "");
  }

  slugToPath(slug: string): string {
    return "/" + slug.replace(/^\/+/, "");
  }
}
