# fs-layer

An agentic knowledge-base explorer. The agent gets `bash` + a first-class
`grep` tool over a read-only ChromaFs virtual filesystem, rendered in
[`@sarchauhan/chat-tui`](https://www.npmjs.com/package/@sarchauhan/chat-tui).

```text
you → chat-tui → createFsAgent → bash / grep → ChromaFs → Chroma Cloud
```

## Run

Create `.env`:

```env
CHROMA_API_KEY=your-chroma-api-key
CHROMA_TENANT=your-tenant
CHROMA_DATABASE=fs_layer
CHROMA_COLLECTION=fs_layer
OPENAI_API_KEY=your-openai-api-key
MODEL=gpt-5.6-luna
```

```bash
npm install --legacy-peer-deps
npm run tui
```

## Grep tool

`createGrepTool(fs)` is a LangChain `tool()` with Zod schema:

| Field | Default | Meaning |
| --- | --- | --- |
| `pattern` | required | Literal string (or regex if `fixedString: false`) |
| `path` | `/` | Directory scope |
| `ignoreCase` | `true` | Case-insensitive |
| `fixedString` | `true` | Literal match |

Against ChromaFs it uses the Mintlify coarse-filter → prefetch → fine-filter
pipeline. The TUI renders matches as a bordered card with path:line rows and
highlighted hits.

## Development

```bash
npm run lint
npm run build
```

MIT © Sarthak Chauhan
