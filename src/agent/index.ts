export { createAgentBash } from "./create-bash.js";
export type { CreateAgentBashOptions } from "./create-bash.js";

export { FS_LAYER_SYSTEM_PROMPT } from "./prompt.js";

export {
  createBashTool,
  createFsTools,
  createFsAgentTools,
  createGrepTool,
  formatGrepResult,
  parseGrepResult,
  GREP_RESULT_MARKER,
} from "./tools.js";
export type { BashToolResult, GrepHit, GrepToolResult } from "./tools.js";

export { createFsAgent } from "./create-fs-agent.js";
export type { CreateFsAgentOptions } from "./create-fs-agent.js";
