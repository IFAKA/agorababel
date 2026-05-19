# Groq E2E Verification

Verified on 2026-05-19 with `ANALYSIS_PROVIDER=groq` and `GROQ_MODEL=openai/gpt-oss-20b`.

## Commands

Build:

```bash
pnpm build
```

Run the full smoke test against Groq:

```bash
VITE_DEMO_PACING=true \
ANALYSIS_PROVIDER=groq \
GROQ_API_KEY=your_groq_key \
pnpm dev --host 127.0.0.1
```

In another terminal:

```bash
pnpm test:smoke
```

Or run both with the local test helper:

```bash
python3 /Users/faka/.agents/skills/webapp-testing/scripts/with_server.py \
  --server "VITE_DEMO_PACING=true ANALYSIS_PROVIDER=groq GROQ_API_KEY=your_groq_key pnpm dev --host 127.0.0.1" \
  --port 5173 \
  -- pnpm test:smoke
```

## Expected Result

The smoke test should pass:

```text
1 passed
```

The tested flow covers:

- `/` landing page.
- `/create` source input.
- `Use sample source` through Groq-backed `/api/analyze`.
- Final artifact creation.
- Stable share route: `/markets/turkey-emergency-rate-intervention-2026`.
- Refresh persistence.
- Direct artifact-route load without localStorage.
- Spanish-language custom source analysis.
- Mobile layout.
- Reduced-motion layout.
- Runtime status showing Groq provider/model/tool.

## Notes

- The app does not write the Groq key to source files.
- Groq strict structured output can fail intermittently for this model, so the backend retries through Groq JSON-object mode and then validates/normalizes the response with the same schema.
- Direct artifact route fallback is deterministic and does not depend on a fresh Groq call.
- Language labels are normalized from common ISO codes, so Groq outputs such as `tr`, `es`, or `fr` display as readable language names.
