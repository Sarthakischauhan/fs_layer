/**
 * Neo4jFs — just-bash IFileSystem backed by a Neo4j graph database.
 *
 * Two exploration modes:
 *
 * 1. **document** (default) — nodes with `fs_path` (+ optional `content`) mirror
 *    a ChromaFs-style virtual tree. A single `:FsPathTree` node may hold the
 *    full tree JSON for instant bootstrap.
 *
 * 2. **labels** — browse the graph as `/<Label>/<elementId>.json` with
 *    relationship edges exposed under `/_rels/<type>/...`.
 *
 * All writes throw EROFS.
 */

import type { Driver, Session } from "neo4j-driver";
import neo4j from "neo4j-driver";

import { ContentCache } from "../cache.js";
import { PathTree, normalizePath } from "../path-tree.js";
import { ReadOnlyVirtualFs } from "../read-only-fs.js";

export type Neo4jFsMode = "document" | "labels";

export interface Neo4jFsOptions {
  mode?: Neo4jFsMode;
  database?: string;
  /** Property that stores the virtual path (document mode). Default: fs_path */
  pathProperty?: string;
  /** Property that stores file body (document mode). Default: content */
  contentProperty?: string;
  /** Label of the optional path-tree bootstrap node. Default: FsPathTree */
  pathTreeLabel?: string;
  /** Groups for RBAC when bootstrapping from path tree JSON. */
  userGroups?: Set<string> | string[];
  cache?: ContentCache;
  /** Max nodes listed per label in labels mode. Default: 500 */
  labelLimit?: number;
}

export class Neo4jFs extends ReadOnlyVirtualFs {
  private readonly driver: Driver;
  private readonly mode: Neo4jFsMode;
  private readonly database?: string;
  private readonly pathProperty: string;
  private readonly contentProperty: string;
  private readonly pathTreeLabel: string;
  private readonly labelLimit: number;

  private constructor(
    driver: Driver,
    tree: PathTree,
    options: Neo4jFsOptions,
  ) {
    super(tree, options.cache);
    this.driver = driver;
    this.mode = options.mode ?? "document";
    this.database = options.database;
    this.pathProperty = options.pathProperty ?? "fs_path";
    this.contentProperty = options.contentProperty ?? "content";
    this.pathTreeLabel = options.pathTreeLabel ?? "FsPathTree";
    this.labelLimit = options.labelLimit ?? 500;
  }

  static async create(
    driver: Driver,
    options: Neo4jFsOptions = {},
  ): Promise<Neo4jFs> {
    const mode = options.mode ?? "document";
    const tree =
      mode === "labels"
        ? await Neo4jFs.bootstrapLabelTree(driver, options)
        : await Neo4jFs.bootstrapDocumentTree(driver, options);
    return new Neo4jFs(driver, tree, options);
  }

  private session(): Session {
    return this.driver.session(
      this.database ? { database: this.database } : undefined,
    );
  }

  private static async bootstrapDocumentTree(
    driver: Driver,
    options: Neo4jFsOptions,
  ): Promise<PathTree> {
    const pathTreeLabel = options.pathTreeLabel ?? "FsPathTree";
    const pathProperty = options.pathProperty ?? "fs_path";
    const userGroups = options.userGroups
      ? options.userGroups instanceof Set
        ? options.userGroups
        : new Set(options.userGroups)
      : undefined;

    const session = driver.session(
      options.database ? { database: options.database } : undefined,
    );
    try {
      // Prefer a dedicated path-tree node (ChromaFs-compatible JSON)
      const treeResult = await session.run(
        `MATCH (t:\`${pathTreeLabel}\`)
         RETURN t.tree AS tree
         LIMIT 1`,
      );
      const treeJson = treeResult.records[0]?.get("tree");
      if (typeof treeJson === "string" && treeJson.length > 0) {
        return PathTree.fromJson(treeJson, userGroups);
      }

      // Fall back to scanning nodes that declare fs_path
      const pathsResult = await session.run(
        `MATCH (n)
         WHERE n.\`${pathProperty}\` IS NOT NULL
         RETURN DISTINCT n.\`${pathProperty}\` AS path`,
      );
      const slugs = pathsResult.records
        .map((r) => String(r.get("path") ?? ""))
        .filter(Boolean)
        .map((p) => p.replace(/^\/+/, ""));
      return PathTree.fromSlugs(slugs);
    } finally {
      await session.close();
    }
  }

  private static async bootstrapLabelTree(
    driver: Driver,
    options: Neo4jFsOptions,
  ): Promise<PathTree> {
    const limit = options.labelLimit ?? 500;
    const session = driver.session(
      options.database ? { database: options.database } : undefined,
    );
    try {
      const labelsResult = await session.run(`CALL db.labels() YIELD label RETURN label`);
      const labels = labelsResult.records.map((r) => String(r.get("label")));

      const slugs: string[] = [];
      for (const label of labels) {
        const nodes = await session.run(
          `MATCH (n:\`${label}\`)
           RETURN elementId(n) AS id
           LIMIT $limit`,
          { limit: neo4j.int(limit) },
        );
        for (const record of nodes.records) {
          const id = String(record.get("id"));
          slugs.push(`${label}/${id}.json`);
        }
      }

      // Relationship index files
      const relTypes = await session.run(
        `CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType`,
      );
      for (const record of relTypes.records) {
        const type = String(record.get("relationshipType"));
        slugs.push(`_rels/${type}/index.json`);
      }

      return PathTree.fromSlugs(slugs);
    } finally {
      await session.close();
    }
  }

  protected async loadContent(path: string): Promise<string> {
    const normalised = normalizePath(path);
    if (this.mode === "labels") {
      return this.loadLabelContent(normalised);
    }
    return this.loadDocumentContent(normalised);
  }

  private async loadDocumentContent(path: string): Promise<string> {
    const slug = this.tree.pathToSlug(path);
    const session = this.session();
    try {
      const result = await session.run(
        `MATCH (n)
         WHERE n.\`${this.pathProperty}\` = $path OR n.\`${this.pathProperty}\` = $slashPath
         RETURN n.\`${this.contentProperty}\` AS content, properties(n) AS props
         LIMIT 1`,
        { path: slug, slashPath: path },
      );
      const record = result.records[0];
      if (!record) return "";

      const content = record.get("content");
      if (typeof content === "string") return content;

      const props = record.get("props") as Record<string, unknown>;
      return JSON.stringify(sanitizeProps(props), null, 2) + "\n";
    } finally {
      await session.close();
    }
  }

  private async loadLabelContent(path: string): Promise<string> {
    const slug = this.tree.pathToSlug(path);
    const session = this.session();
    try {
      if (slug.startsWith("_rels/") && slug.endsWith("/index.json")) {
        const type = slug.slice("_rels/".length, -"/index.json".length);
        const result = await session.run(
          `MATCH (a)-[r:\`${type}\`]->(b)
           RETURN elementId(r) AS id, elementId(a) AS from, elementId(b) AS to,
                  labels(a) AS fromLabels, labels(b) AS toLabels, properties(r) AS props
           LIMIT $limit`,
          { limit: neo4j.int(this.labelLimit) },
        );
        const edges = result.records.map((r) => ({
          id: r.get("id"),
          from: r.get("from"),
          to: r.get("to"),
          fromLabels: r.get("fromLabels"),
          toLabels: r.get("toLabels"),
          properties: sanitizeProps(r.get("props") as Record<string, unknown>),
        }));
        return JSON.stringify(edges, null, 2) + "\n";
      }

      const match = /^([^/]+)\/(.+)\.json$/.exec(slug);
      if (!match) return "";
      const label = match[1]!;
      const id = match[2]!;

      const result = await session.run(
        `MATCH (n:\`${label}\`)
         WHERE elementId(n) = $id
         OPTIONAL MATCH (n)-[r]->(m)
         WITH n, collect({
           type: type(r),
           to: elementId(m),
           toLabels: labels(m),
           properties: properties(r)
         }) AS out
         OPTIONAL MATCH (p)-[rin]->(n)
         RETURN elementId(n) AS id, labels(n) AS labels, properties(n) AS props,
                out,
                collect({
                  type: type(rin),
                  from: elementId(p),
                  fromLabels: labels(p),
                  properties: properties(rin)
                }) AS inbound`,
        { id },
      );

      const record = result.records[0];
      if (!record) return "";

      const payload = {
        id: record.get("id"),
        labels: record.get("labels"),
        properties: sanitizeProps(record.get("props") as Record<string, unknown>),
        outbound: (record.get("out") as Array<Record<string, unknown>>)
          .filter((e) => e.type != null)
          .map((e) => ({
            ...e,
            properties: sanitizeProps(e.properties as Record<string, unknown>),
          })),
        inbound: (record.get("inbound") as Array<Record<string, unknown>>)
          .filter((e) => e.type != null)
          .map((e) => ({
            ...e,
            properties: sanitizeProps(e.properties as Record<string, unknown>),
          })),
      };

      return JSON.stringify(payload, null, 2) + "\n";
    } finally {
      await session.close();
    }
  }

  /**
   * Cypher-backed coarse search for document mode (CONTAINS on content).
   */
  async grep(
    pattern: string,
    options: { path?: string; ignoreCase?: boolean } = {},
  ): Promise<Array<{ path: string; line: number; text: string }>> {
    if (this.mode !== "document") {
      // Fall back to reading candidate files
      const files = this.tree.filesUnder(normalizePath(options.path ?? "/"));
      const matches: Array<{ path: string; line: number; text: string }> = [];
      const flags = options.ignoreCase ? "i" : "";
      const regex = new RegExp(escapeRegex(pattern), flags);
      for (const file of files) {
        const content = await this.getContent(file);
        const lines = content.split(/\r\n|\r|\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          if (regex.test(line)) {
            matches.push({ path: file, line: i + 1, text: line });
          }
        }
      }
      return matches;
    }

    const session = this.session();
    try {
      const cypher = options.ignoreCase
        ? `MATCH (n)
           WHERE n.\`${this.pathProperty}\` IS NOT NULL
             AND toLower(toString(n.\`${this.contentProperty}\`)) CONTAINS toLower($pattern)
           RETURN n.\`${this.pathProperty}\` AS path, n.\`${this.contentProperty}\` AS content`
        : `MATCH (n)
           WHERE n.\`${this.pathProperty}\` IS NOT NULL
             AND toString(n.\`${this.contentProperty}\`) CONTAINS $pattern
           RETURN n.\`${this.pathProperty}\` AS path, n.\`${this.contentProperty}\` AS content`;

      const result = await session.run(cypher, { pattern });
      const root = normalizePath(options.path ?? "/");
      const matches: Array<{ path: string; line: number; text: string }> = [];
      const flags = options.ignoreCase ? "i" : "";
      const regex = new RegExp(escapeRegex(pattern), flags);

      for (const record of result.records) {
        const rawPath = String(record.get("path") ?? "");
        const abs = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
        if (root !== "/" && abs !== root && !abs.startsWith(root + "/")) continue;
        const content = String(record.get("content") ?? "");
        this.cache.put(this.tree.pathToSlug(abs), content);
        const lines = content.split(/\r\n|\r|\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          if (regex.test(line)) {
            matches.push({ path: abs, line: i + 1, text: line });
          }
        }
      }
      return matches;
    } finally {
      await session.close();
    }
  }
}

function sanitizeProps(props: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!props) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = neo4j.isInt(v) ? v.toNumber() : v;
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
