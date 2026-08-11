# fs-layer

An agentic knowledge-base explorer. One agent gets one `bash` tool, and that
tool operates on a read-only virtual filesystem backed by ChromaDB.

```text
agent → bash → ChromaFs → Chroma Cloud
```

The agent explores the collection with `ls`, `cat`, `grep`, `find`, and pipes.
This is the virtual-filesystem pattern described in
[Mintlify's ChromaFs article](https://www.mintlify.com/blog/how-we-built-a-virtual-filesystem-for-our-assistant).

## Run

Create `.env`:

```env
CHROMA_API_KEY=your-chroma-api-key
CHROMA_TENANT=028159bb-a271-4972-aa23-7a6da3a60264
CHROMA_DATABASE=fs_layer
CHROMA_COLLECTION=fs_layer
OPENAI_API_KEY=your-openai-api-key
MODEL=gpt-5.6-luna
```

Install and run one question:

```bash
npm install
npm run dev -- "How does OAuth work? Cite the file paths."
```

Or build and run:

```bash
npm run build
npm start -- "Summarize the knowledge base."
```

The application creates the Chroma Cloud client, opens the configured
collection, maps it through `ChromaFs`, and starts one agent with one bash
tool. It also accepts `OPENAI_KEY` as an alias for `OPENAI_API_KEY`. It does
not seed, delete, or modify Chroma data.

## Chroma data shape

The collection must contain a path-tree document with id `__path_tree__`:

```json
{
  "auth/oauth.md": { "isPublic": true, "groups": [] },
  "guides/quickstart.md": { "isPublic": true, "groups": [] }
}
```

Document chunks use `page_slug` and `chunk_index` metadata. `ChromaFs` loads
the tree into memory, fetches page chunks for `cat`, and uses Chroma to narrow
recursive `grep` searches.

## Development

```bash
npm run lint
npm run build
```

MIT © Sarthak Chauhan
