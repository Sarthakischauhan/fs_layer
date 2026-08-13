/**
 * fs-layer Ink shell on top of @sarchauhan/chat-tui.
 */

import {
  ChatComposer,
  ChatContextProvider,
  HelpOverlay,
  ModelPicker,
  Spinner,
  StatusBar,
  useChat,
  type ChatAdapter,
  type ModelOption,
  type ChatMessage,
} from "@sarchauhan/chat-tui";
import { normalizeAgentParts } from "@sarchauhan/protocol";
import { Box, Text, useStdout } from "ink";
import type { ReactElement } from "react";

import { FsMessagePart } from "./grep-card.js";

function MessageItem({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming?: boolean;
}): ReactElement {
  const parts = normalizeAgentParts(message.parts);
  const label = message.role === "user" ? "you" : "fs-layer";
  const color = message.role === "user" ? "green" : "white";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box gap={1}>
        <Text bold color={color}>
          {label}
        </Text>
        {streaming && message.role === "assistant" ? <Spinner /> : null}
      </Box>
      {parts.length === 0 && streaming ? (
        <Text dimColor>waiting…</Text>
      ) : (
        parts.map((part, index) => (
          <Box key={`${message.id}-${index}`} flexDirection="column">
            <FsMessagePart part={part} />
          </Box>
        ))
      )}
    </Box>
  );
}

function MessageViewport(): ReactElement {
  const { messages, isLoadingThread, isSending, scrollOffset, focus } = useChat();
  const { stdout } = useStdout();
  const viewport = Math.max(8, (stdout?.rows ?? 24) - 10);

  if (isLoadingThread) {
    return <Text dimColor>Loading conversation…</Text>;
  }

  if (messages.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={focus === "messages" ? "cyan" : "gray"}
        height={viewport}
        paddingX={1}
      >
        <Text bold>fs-layer</Text>
        <Text dimColor>
          Ask about the knowledge base. The agent uses bash + grep over ChromaFs.
        </Text>
        <Text dimColor>Try: &quot;grep for access_token and cite paths&quot;</Text>
      </Box>
    );
  }

  const visible = messages.slice(Math.max(0, messages.length - viewport + scrollOffset));

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={focus === "messages" ? "cyan" : "gray"}
      height={viewport}
      paddingX={1}
      overflowY="hidden"
    >
      {visible.map((message, index) => (
        <MessageItem
          key={message.id}
          message={message}
          streaming={
            isSending &&
            index === visible.length - 1 &&
            message.role === "assistant"
          }
        />
      ))}
    </Box>
  );
}

function AppLayout(): ReactElement {
  return (
    <Box flexDirection="column" width="100%">
      <StatusBar />
      <MessageViewport />
      <ChatComposer />
      <ModelPicker />
      <HelpOverlay />
    </Box>
  );
}

export function FsLayerApp({
  adapter,
  models,
  defaultModel,
  defaultProvider,
}: {
  adapter: ChatAdapter;
  models: ModelOption[];
  defaultModel?: string;
  defaultProvider?: string;
}): ReactElement {
  return (
    <ChatContextProvider
      adapter={adapter}
      models={models}
      defaultModel={defaultModel}
      defaultProvider={defaultProvider}
    >
      <AppLayout />
    </ChatContextProvider>
  );
}
