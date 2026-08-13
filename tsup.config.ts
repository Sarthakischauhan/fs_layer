import { defineConfig } from "tsup";

export default defineConfig({
  entry: { main: "src/main.tsx" },
  format: ["esm"],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: "es2022",
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: [
    "chromadb",
    "neo4j-driver",
    "just-bash",
    "langchain",
    "@langchain/core",
    "@langchain/langgraph",
    "@langchain/openai",
    "zod",
    "@sarchauhan/chat-tui",
    "@sarchauhan/adapter",
    "@sarchauhan/protocol",
    "ink",
    "react",
  ],
});
