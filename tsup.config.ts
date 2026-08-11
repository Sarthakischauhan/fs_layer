import { defineConfig } from "tsup";

export default defineConfig({
  entry: { main: "src/main.ts" },
  format: ["esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["chromadb", "neo4j-driver", "just-bash", "langchain", "@langchain/core", "@langchain/langgraph", "zod"],
});
