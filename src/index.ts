/**
 * fs-layer — virtual filesystem for ReAct / plan-observe-act agents.
 *
 * Back ChromaDB and Neo4j with just-bash so agents retrieve data using
 * familiar shell commands (ls, cat, grep, find) instead of custom retrieval APIs.
 */

export { ContentCache } from "./cache.js";
export { PathTree, normalizePath, basename, dirname } from "./path-tree.js";
export type { PathInfo, PathInfoData } from "./path-tree.js";
export { ReadOnlyVirtualFs } from "./read-only-fs.js";
export { FsError, erofs, enoent, eisdir, enotdir, eexist } from "./errors.js";

export { ChromaFs, PATH_TREE_ID } from "./chroma/index.js";
export type { ChromaFsOptions, ChromaFilter, GrepMatch } from "./chroma/index.js";
export {
  toChromaFilter,
  findMatchingSlugs,
  fetchPage,
  bulkPrefetch,
  fineFilter,
  escapeRegex,
} from "./chroma/index.js";

export { Neo4jFs } from "./neo4j/index.js";
export type { Neo4jFsOptions, Neo4jFsMode } from "./neo4j/index.js";

export {
  createAgentBash,
  createBashTool,
  FS_LAYER_SYSTEM_PROMPT,
} from "./agent/index.js";
export type { CreateAgentBashOptions, BashToolResult } from "./agent/index.js";
