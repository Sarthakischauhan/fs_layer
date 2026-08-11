import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "chroma/index": "src/chroma/index.ts",
    "neo4j/index": "src/neo4j/index.ts",
    "agent/index": "src/agent/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["chromadb", "neo4j-driver", "just-bash"],
});
