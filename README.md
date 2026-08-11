# fs-layer

Virtual filesystem layer for ReAct / plan-observe-act agents. Agents talk to low-latency stores like **ChromaDB** and **Neo4j** through [just-bash](https://github.com/vercel-labs/just-bash) — so retrieval looks like ordinary shell exploration (`ls`, `cat`, `grep`, `find`).

Inspired by [Mintlify ChromaFs](https://www.mintlify.com/blog/how-we-built-a-virtual-filesystem-for-our-assistant): the agent does not need a real sandbox filesystem, only the illusion of one. Session bootstrap drops from tens of seconds to ~100ms by loading a single path-tree document.

## Why

| Approach | Boot | Marginal cost | Interface |
| --- | --- | --- | --- |
| Container sandbox + clone | ~tens of seconds | per-session compute | real UNIX |
| Classic RAG top-K | fast | embedding/query | opaque chunks |
| **fs-layer** | ~100ms | reuse existing DB | `ls` / `cat` / `grep` |

Agents already know how to explore codebases with a shell. Point that shell at your knowledge base.

## Install

```bash
npm install fs-layer just-bash
# optional backends
npm install chromadb neo4j-driver
```

## Quick start — ChromaFs

Index docs into Chroma with a `__path_tree__` document and chunked pages:

```ts
import { ChromaClient } from "chromadb";
import { ChromaFs, createAgentBash, createBashTool, FS_LAYER_SYSTEM_PROMPT } from "fs-layer";

const client = new ChromaClient();
const collection = await client.getOrCreateCollection({ name: "docs" });

const fs = await ChromaFs.create(collection);
const bash = createAgentBash({
  fs,
  customCommands: [fs.createGrepCommand()], // Chroma-accelerated grep
});

await bash.exec("ls /auth");
await bash.exec("cat /auth/oauth.md");
await bash.exec('grep -ri "access_token" /');

// Hand to any ReAct / tool-calling agent
const tool = createBashTool(bash);
```

### Chroma schema

| Piece | How it is stored |
| --- | --- |
| Path tree | Document id `__path_tree__` — JSON map of slug → `{ isPublic, groups }` (optionally gzip+base64) |
| Page body | Chunks with metadata `page_slug` + `chunk_index` |

```json
{
  "auth/oauth.md": { "isPublic": true, "groups": [] },
  "internal/billing.md": { "isPublic": false, "groups": ["admin"] }
}
```

On init, fs-layer loads the tree into memory. `ls` / `cd` / `find` never hit the network. `cat` fetches chunks for one slug, joins them, and caches. Recursive `grep` uses Chroma `$contains` / `$regex` as a coarse filter, bulk-prefetches hits, then runs an in-memory fine filter.

Writes always throw `EROFS` — the view is stateless and safe to share across agents.

## Quick start — Neo4jFs

### Document mode (ChromaFs-shaped)

Nodes carry `fs_path` + `content`, or a single `:FsPathTree` node holds the tree JSON:

```ts
import neo4j from "neo4j-driver";
import { Neo4jFs, createAgentBash } from "fs-layer";

const driver = neo4j.driver(
  process.env.NEO4J_URI!,
  neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
);

const fs = await Neo4jFs.create(driver, { mode: "document" });
const bash = createAgentBash({ fs });

await bash.exec("ls /docs");
await bash.exec("cat /docs/intro.md");
```

### Labels mode (graph exploration)

Browse labels and relationships as directories:

```text
/Person/<elementId>.json
/_rels/KNOWS/index.json
```

```ts
const fs = await Neo4jFs.create(driver, { mode: "labels" });
const bash = createAgentBash({ fs });
await bash.exec("ls /Person");
await bash.exec("cat /Person/4:abc:0.json");
```

## Mount both backends

```ts
import { MountableFs, Bash } from "just-bash";
import { ChromaFs, Neo4jFs } from "fs-layer";

const chroma = await ChromaFs.create(collection);
const graph = await Neo4jFs.create(driver, { mode: "labels" });

const fs = new MountableFs({
  mounts: [
    { mountPoint: "/docs", fs: chroma },
    { mountPoint: "/graph", fs: graph },
  ],
});

const bash = new Bash({
  fs,
  cwd: "/",
  customCommands: [chroma.createGrepCommand()],
});
```

## Agent loop

```ts
import { createAgentBash, createBashTool, FS_LAYER_SYSTEM_PROMPT } from "fs-layer";

const bash = createAgentBash({ fs });
const tool = createBashTool(bash);

// system: FS_LAYER_SYSTEM_PROMPT
// tools:  [tool]
// loop:   plan → tool.execute({ command }) → observe → act
```

## API

| Export | Role |
| --- | --- |
| `ChromaFs` | `IFileSystem` over ChromaDB |
| `Neo4jFs` | `IFileSystem` over Neo4j |
| `createAgentBash` | just-bash bound to a virtual FS |
| `createBashTool` | ReAct-friendly `{ name, description, parameters, execute }` |
| `PathTree` / `ContentCache` | shared bootstrap + session cache |
| `FS_LAYER_SYSTEM_PROMPT` | system prompt fragment for agents |

## Development

```bash
npm install
npm test
npm run build
```

## License

MIT © Sarthak Chauhan
