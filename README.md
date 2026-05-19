# AgoraBabel

AgoraBabel is a Vite/React demo for turning local-language source material into a validated prediction-market artifact. The judged path is deterministic and centered on one shareable artifact route:

```text
/ -> /create -> Use sample source -> Open final artifact -> /markets/turkey-emergency-rate-intervention-2026
```

Refresh or open `/markets/turkey-emergency-rate-intervention-2026` directly to load the bundled Turkey artifact.

## Demo Path

1. Open `/`.
2. Click through to `/create`.
3. Click **Use sample source**.
4. Wait for `/api/analyze` to produce the accepted market.
5. Click **Open final artifact**.
6. Refresh the artifact route and confirm it still renders.

The default sample is the Turkey emergency central-bank intervention article. The app also includes Argentina currency-control and Chile lithium-permit examples in `src/app/sampleArticleData.ts`.

## What Is Real

- React + Vite + TypeScript frontend.
- `/api/analyze` endpoint with deterministic local analysis by default.
- Optional Groq/OpenAI/Ollama provider switching.
- URL extraction for readable article pages through Jina Reader.
- LocalStorage persistence for completed market artifacts.
- Local trace hash that fingerprints the validated artifact JSON.
- Runtime status endpoint at `/api/runtime-status` showing provider, model, tool, and runtime.

## What Is Simulated Or Pending

- Arc commit is pending; the UI reports `Local trace hash, Arc commit pending`.
- No Circle rewards.
- No payouts.
- No balances.
- No settlement flow.
- No database, auth, queues, wallet flow, or chain writes.

## Running Locally

Install dependencies:

```bash
pnpm install
```

Run the deterministic local demo:

```bash
ANALYSIS_PROVIDER=local pnpm dev
```

Enable paced stages for judging:

```bash
VITE_DEMO_PACING=true ANALYSIS_PROVIDER=local pnpm dev --host 127.0.0.1
```

Build:

```bash
pnpm build
```

Optional smoke test after the dev server is running on `127.0.0.1:5173`:

```bash
pnpm test:smoke
```

## Providers

Local deterministic analysis is the reliable default and requires no keys:

```bash
ANALYSIS_PROVIDER=local
```

Groq is deploy-ready:

```bash
ANALYSIS_PROVIDER=groq
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-20b
```

OpenAI and Ollama remain supported:

```bash
ANALYSIS_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
```

```bash
ANALYSIS_PROVIDER=ollama
OLLAMA_MODEL=llama3.2:3b-32k
```

## Vercel Deployment

1. Import the repository into Vercel.
2. Keep the build command as `pnpm build`.
3. Keep the output directory as `dist`.
4. For the production hackathon deployment, set:

```text
ANALYSIS_PROVIDER=groq
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-20b
VITE_DEMO_PACING=true
```

Local deterministic deployments may use `ANALYSIS_PROVIDER=local`, but the submitted production demo is intended to run with Groq.

`vercel.json` rewrites `/create`, `/markets/:slug`, `/api/analyze`, and `/api/runtime-status` so direct artifact links work.

## Key Files

- `src/app/App.tsx`: app routing and artifact persistence.
- `src/app/components/ProcessingScreen.tsx`: `/create` workflow.
- `src/app/components/MarketScreen.tsx`: final market artifact.
- `src/server/analyze.ts`: source preparation, local analysis, provider switching, and API errors.
- `src/app/pipeline/analysisSchema.ts`: validated market schema.
- `src/app/pipeline/guardrails.ts`: accepted-market quality rules.
- `transition-check.spec.js`: Playwright smoke test for the judged path.
