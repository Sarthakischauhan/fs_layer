/**
 * Chat adapter bridging createFsAgent (LangGraph) → @sarchauhan/chat-tui.
 */

import {
  defineAdapter,
  createAssistantMessage,
  createMessageId,
  type ChatAdapter,
  type ChatMessage,
  type ChatThread,
} from "@sarchauhan/adapter";
import type { ReactAgent } from "langchain";
import type { BaseMessage } from "@langchain/core/messages";

import { parseGrepResult } from "../agent/grep-tool.js";

export interface CreateFsLayerAdapterOptions {
  agent: ReactAgent;
  /** Optional model label shown in the TUI status bar. */
  modelLabel?: string;
}

type ToolCallLike = {
  id?: string;
  name?: string;
  args?: unknown;
};

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content ? JSON.stringify(content) : "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text: unknown }).text);
      }
      return "";
    })
    .join("");
}

function chatMessagesToLangChain(messages: ChatMessage[]): Array<{ role: string; content: string }> {
  return messages
    .filter((m: ChatMessage) => m.role === "user" || m.role === "assistant")
    .map((m: ChatMessage) => ({
      role: m.role,
      content: m.parts
        .filter((p) => p.type === "text")
        .map((p) => ("text" in p ? String(p.text) : ""))
        .join("\n"),
    }))
    .filter((m: { content: string }) => m.content.trim().length > 0);
}

function formatGrepOutputForUi(raw: unknown): string {
  const parsed = parseGrepResult(raw);
  if (!parsed) {
    return typeof raw === "string" ? raw : JSON.stringify(raw);
  }
  if (parsed.count === 0) {
    return `no matches for ${JSON.stringify(parsed.pattern)} under ${parsed.path}`;
  }
  const lines = parsed.matches.map(
    (m) => `${m.path}:${m.line}  ${m.text.trim()}`,
  );
  const head = `${parsed.count} match${parsed.count === 1 ? "" : "es"} · ${JSON.stringify(parsed.pattern)} in ${parsed.path}`;
  return [head, ...lines].join("\n");
}

function toolTitle(name: string, input: unknown): string | undefined {
  if (name !== "grep" || !input || typeof input !== "object") return undefined;
  const pattern = (input as { pattern?: unknown }).pattern;
  const path = (input as { path?: unknown }).path ?? "/";
  if (typeof pattern !== "string") return undefined;
  return `grep ${JSON.stringify(pattern)} ${String(path)}`;
}

/**
 * Stream a LangGraph agent run into chat-tui ChatMessage snapshots.
 */
export function createFsLayerAdapter(
  options: CreateFsLayerAdapterOptions,
): ChatAdapter {
  const threads = new Map<string, ChatThread>();
  const history = new Map<string, ChatMessage[]>();

  const ensureThread = (id?: string): ChatThread => {
    if (id && threads.has(id)) return threads.get(id)!;
    const thread: ChatThread = {
      id: id ?? createMessageId("thread"),
      title: "fs-layer",
    };
    threads.set(thread.id, thread);
    if (!history.has(thread.id)) history.set(thread.id, []);
    return thread;
  };

  return defineAdapter({
    async listThreads() {
      return [...threads.values()];
    },

    async createThread() {
      return ensureThread();
    },

    async deleteThread(threadId) {
      threads.delete(threadId);
      history.delete(threadId);
    },

    async loadMessages(threadId) {
      return history.get(threadId) ?? [];
    },

    async *sendMessage({ threadId, message, messages, signal }) {
      const thread = ensureThread(threadId);
      const prior = history.get(thread.id) ?? [];
      const nextHistory = [...prior, message];
      history.set(thread.id, nextHistory);

      const assistantId = createMessageId("assistant");
      let snapshot = createAssistantMessage([], assistantId);
      yield snapshot;

      const lcMessages = chatMessagesToLangChain(
        messages.length ? [...messages, message] : nextHistory,
      );

      try {
        const stream = await options.agent.stream(
          { messages: lcMessages },
          {
            signal,
            streamMode: "updates",
          },
        );

        const parts: ChatMessage["parts"] = [];
        const pendingTools = new Map<
          string,
          { toolName: string; input?: unknown; title?: string }
        >();

        for await (const update of stream) {
          if (signal?.aborted) {
            yield snapshot;
            return;
          }

          const chunk = update as Record<string, { messages?: BaseMessage[] }>;

          for (const node of Object.values(chunk)) {
            const nodeMessages = node?.messages ?? [];
            for (const msg of nodeMessages) {
              const type =
                typeof (msg as { getType?: () => string }).getType === "function"
                  ? (msg as { getType: () => string }).getType()
                  : (msg as { _getType?: () => string })._getType?.();

              if (type === "ai") {
                const toolCalls =
                  ((msg as { tool_calls?: ToolCallLike[] }).tool_calls ?? []) as ToolCallLike[];
                const text = contentToText((msg as { content?: unknown }).content);

                if (toolCalls.length > 0) {
                  parts.push({ type: "step-start" });
                  for (const call of toolCalls) {
                    const id = call.id ?? createMessageId("tool");
                    const toolName = call.name ?? "tool";
                    const title = toolTitle(toolName, call.args);
                    pendingTools.set(id, {
                      toolName,
                      input: call.args,
                      title,
                    });
                    parts.push({
                      type: "dynamic-tool",
                      toolCallId: id,
                      toolName,
                      state: "input-available",
                      input: call.args,
                      title,
                    });
                  }
                } else if (text.trim()) {
                  parts.push({
                    type: "text",
                    text,
                    state: "done",
                  });
                }
              }

              if (type === "tool") {
                const toolCallId =
                  (msg as { tool_call_id?: string }).tool_call_id ??
                  createMessageId("tool");
                const name =
                  (msg as { name?: string }).name ??
                  pendingTools.get(toolCallId)?.toolName ??
                  "tool";
                const rawOutput = contentToText((msg as { content?: unknown }).content);
                const output =
                  name === "grep" ? formatGrepOutputForUi(rawOutput) : rawOutput;
                const pending = pendingTools.get(toolCallId);

                const existing = parts.findIndex(
                  (p) =>
                    (p.type === "dynamic-tool" || p.type === "tool") &&
                    "toolCallId" in p &&
                    p.toolCallId === toolCallId,
                );
                const toolPart = {
                  type: "dynamic-tool" as const,
                  toolCallId,
                  toolName: name,
                  state: "output-available" as const,
                  input: pending?.input,
                  output,
                  title: pending?.title ?? toolTitle(name, pending?.input),
                };
                if (existing >= 0) {
                  parts[existing] = toolPart;
                } else {
                  parts.push(toolPart);
                }
              }
            }
          }

          snapshot = {
            ...snapshot,
            parts: [...parts],
          };
          yield snapshot;
        }

        history.set(thread.id, [...nextHistory, snapshot]);
      } catch (err) {
        const errorText = err instanceof Error ? err.message : String(err);
        snapshot = createAssistantMessage(
          [{ type: "text", text: `Error: ${errorText}` }],
          assistantId,
        );
        yield snapshot;
        history.set(thread.id, [...nextHistory, snapshot]);
      }
    },
  });
}
