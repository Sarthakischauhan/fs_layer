/**
 * Custom Ink parts — dedicated grep tool card for chat-tui.
 */

import type { AgentPart } from "@sarchauhan/protocol";
import { MessagePart as DefaultMessagePart } from "@sarchauhan/chat-tui";
import { Box, Text } from "ink";
import type { ReactElement, ReactNode } from "react";

import { parseGrepResult } from "../agent/grep-tool.js";

function highlightPattern(
  text: string,
  pattern: string,
  ignoreCase: boolean,
): ReactNode[] {
  if (!pattern) return [text];
  try {
    const flags = ignoreCase ? "gi" : "g";
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, flags);
    const nodes: ReactNode[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    let i = 0;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > last) nodes.push(text.slice(last, match.index));
      nodes.push(
        <Text key={`h-${i++}`} color="yellow" bold>
          {match[0]}
        </Text>,
      );
      last = match.index + match[0].length;
      if (match[0].length === 0) regex.lastIndex += 1;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes.length ? nodes : [text];
  } catch {
    return [text];
  }
}

function GrepToolCard({
  part,
}: {
  part: Extract<AgentPart, { type: "tool" }>;
}): ReactElement {
  const parsed =
    parseGrepResult(typeof part.output === "string" ? part.output : null) ??
    (typeof part.output === "object" && part.output !== null
      ? (part.output as ReturnType<typeof parseGrepResult>)
      : null);

  const input = (part.input ?? {}) as {
    pattern?: string;
    path?: string;
    ignoreCase?: boolean;
  };
  const pattern = parsed?.pattern ?? input.pattern ?? "";
  const path = parsed?.path ?? input.path ?? "/";
  const ignoreCase = parsed?.ignoreCase ?? input.ignoreCase ?? true;
  const count = parsed?.count;
  const stateLabel =
    part.state === "output-available"
      ? count != null
        ? `${count} match${count === 1 ? "" : "es"}`
        : "done"
      : part.state;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginY={0}
    >
      <Text color="cyan" bold>
        {`grep  ${JSON.stringify(pattern)}  ${path}  ·  ${stateLabel}`}
      </Text>
      {part.state === "input-available" || part.state === "input-streaming" ? (
        <Text dimColor>searching…</Text>
      ) : null}
      {part.errorText ? <Text color="red">{part.errorText}</Text> : null}
      {parsed && parsed.matches.length > 0
        ? parsed.matches.slice(0, 12).map((hit, index) => (
            <Box
              key={`${hit.path}:${hit.line}:${index}`}
              flexDirection="column"
            >
              <Text color="green">{`${hit.path}:${hit.line}`}</Text>
              <Text>
                {"  "}
                {highlightPattern(hit.text.trim(), pattern, ignoreCase)}
              </Text>
            </Box>
          ))
        : null}
      {parsed && parsed.count === 0 ? <Text dimColor>no matches</Text> : null}
      {part.output != null && !parsed ? (
        <Text dimColor>{String(part.output).slice(0, 400)}</Text>
      ) : null}
      {parsed?.truncated ? (
        <Text dimColor>
          {`… showing ${parsed.matches.length} of ${parsed.count}`}
        </Text>
      ) : null}
    </Box>
  );
}

export function FsMessagePart({ part }: { part: AgentPart }): ReactElement | null {
  if (part.type === "tool" && part.toolName === "grep") {
    return <GrepToolCard part={part} />;
  }
  return <DefaultMessagePart part={part} />;
}
