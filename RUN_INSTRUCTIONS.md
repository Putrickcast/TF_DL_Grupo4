# Run instructions for the final demo

This ZIP contains the Angular demo, local data, real listing images, scoring code,
RAG server, and documentation. It does not include `node_modules`, Angular build
output, Ollama binaries, or Ollama model weights.

## What your computer needs

- Node.js 22 LTS, or Node.js 20.19+.
  - Angular 20 supports `^20.19.0 || ^22.12.0 || >=24.0.0`.
  - Node 22 LTS is the safest recommendation.
- pnpm package manager.
  - Install with `npm install -g pnpm`, or use Corepack if enabled.
- Ollama installed locally.
  - Download from `https://ollama.com/download`.
- Ollama model `llama3.1:8b`.
  - The model is several GB and is intentionally not included in the ZIP.

## First-time setup

Unzip the project, open a terminal in the unzipped folder, then install
JavaScript dependencies:

```bash
pnpm install
```

Download the local LLM model:

```bash
ollama pull llama3.1:8b
```

## Run the demo

Use three terminals.

Terminal 1: make sure Ollama is running.

```bash
ollama serve
```

If the Ollama desktop app is already running, this terminal may not be needed.

Terminal 2: start the local RAG API.

```bash
pnpm run rag
```

Expected API:

```text
http://127.0.0.1:8787/api/health
```

Terminal 3: start Angular.

```bash
pnpm start
```

Open:

```text
http://127.0.0.1:4200/
```

## If Ollama is not available

The app still opens, but the chatbot falls back to extractive responses based on
the review evidence. For the final demo, run Ollama so the chatbot can generate
natural-language answers grounded in the retrieved reviews.

## Useful project files

- `src/app/scoring.ts`: scoring rules for listing evaluation.
- `src/app/app.ts`: Angular state, chatbot flow, selected listing logic.
- `src/app/app.html`: rendered UI structure.
- `src/app/app.css`: UI styling.
- `server/rag-server.mjs`: local RAG endpoint and Ollama integration.
- `public/data/listings.json`: extracted listing and review data.
- `public/data/image-manifest.json`: mapping of downloaded real images.
- `public/img/`: real listing images used by the demo.
- `scripts/extract_dataset.py`: dataset extraction from Excel.
- `scripts/fetch_airbnb_images.py`: image download script.
- `docs/ENTREGABLES.md`: explanation of deliverables, scoring rules, images,
  reviews, chatbot/RAG, and evidence.

## Verification commands

```bash
pnpm run build
pnpm test -- --watch=false --browsers=ChromeHeadless
```
