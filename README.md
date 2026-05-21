# AgoraBabel

AgoraBabel turns local-language news into paid prediction-market intelligence. The product is intentionally strict: a run either produces verified evidence, an official resolver, market-comparison output, Circle ARC-TESTNET wallet proof, an Arc Testnet trace transaction, and x402 publication metadata, or it fails at a named stage with no accepted market.

## What Is Real Now

- Remote LLM analysis through one configured provider: `groq` by default, or `openai`.
- Source extraction for pasted text and public readable URLs; URL strings are never treated as article content.
- Strict Zod validation with no default deadlines, fabricated resolvers, hardcoded confidence scores, or heuristic accepted markets.
- Resolver verification by fetching the exact official resolver URL.
- Market comparison hooks for configured public market sources.
- Circle Developer-Controlled Wallet readiness proof for an `ARC-TESTNET` agent wallet.
- Arc Testnet trace commits through `TraceRegistry.commitTrace`, returning transaction hash, artifact hash, source hash, chain ID `5042002`, and Arcscan URL.
- x402-protected market intelligence API at `/api/markets/:id/intelligence`; without a valid payment proof it returns `402 Payment Required` when enabled, or explicit `503` when disabled.
- Telemetry endpoint at `/api/events` for run, artifact, x402, sharing, and feedback events. It stores only event names, IDs, stages, source type, timestamps, and anonymous session IDs.

## Required Production Env

```text
ANALYSIS_PROVIDER=groq
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-20b

ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
ARC_TRACE_REGISTRY_ADDRESS=0x...
ARC_COMMITTER_PRIVATE_KEY=0x...

CIRCLE_API_KEY=...
CIRCLE_ENTITY_SECRET=...
CIRCLE_WALLET_SET_ID=...
CIRCLE_AGENT_WALLET_ID=...
CIRCLE_AGENT_WALLET_ADDRESS=0x...

X402_ENABLED=true
X402_PRICE_USDC_MICRO=10000
X402_PAY_TO_ADDRESS=0x...
X402_FACILITATOR_URL=https://...
```

`GET /api/runtime-status` reports whether the LLM, Arc RPC, trace registry, Circle wallet, and x402 layer are ready. `POST /api/analyze` fails at `runtime-config` before source processing when required production variables are missing.

## Running Locally

```bash
pnpm install
pnpm dev
pnpm build
```

Optional smoke test after the dev server is running on `127.0.0.1:5173`:

```bash
pnpm test:smoke
```

## Pipeline

1. Source extraction
2. Claim extraction
3. Resolver verification
4. Market comparison
5. Market drafting
6. Critic review
7. Circle wallet readiness
8. Arc trace commit
9. x402 publication

Every failure returns `acceptedMarket: null` semantics through a named stage and no Arc commit. The UI displays the failed stage and the exact backend reason.

## Hackathon Rubric Mapping

- **30% agentic sophistication:** explicit source, claim, resolver, scout, drafter, critic, Circle, Arc, and x402 stages; the agent rejects weak or under-specified inputs instead of filling gaps.
- **30% traction:** shareable artifact routes, copy/share actions, feedback buttons, and telemetry events for starts, failures, accepted artifacts, opens, copies, shares, x402 unlock attempts, and feedback.
- **20% Circle:** Circle Developer-Controlled `ARC-TESTNET` wallet proof plus x402/Circle nanopayment metadata for paid artifact access.
- **20% innovation:** local-language alpha is transformed into paid agent-consumable market intelligence, with reasoning artifacts committed as Arc trace hashes.

## Demo Script

1. Open `/create` and submit a weak paragraph with no deadline; show failure at claim extraction or critic review.
2. Submit a strong local-language source that names actors, official resolver, evidence, and a deadline.
3. Show resolver verification and market comparison stages.
4. Open the final artifact and show YES/NO criteria, deadline, official resolver URL, evidence snippets, similar-market result, and rejected candidates.
5. Show Circle wallet ID/address/blockchain.
6. Show Arc transaction hash, artifact hash, source hash, chain ID, and Arcscan link.
7. Click x402 unlock; without payment proof it must return `402 Payment Required` when enabled.
8. Click copy/share/feedback and use `/api/events` counts or server logs to summarize traction: users, runs, accepted artifacts, failures by stage, shares, feedback, and paid unlock attempts.

## Key Files

- `src/server/analyze.ts`: no-fallback pipeline orchestration.
- `src/server/sourceExtraction.ts`: pasted text and URL extraction.
- `src/server/llmStructured.ts`: strict LLM JSON calls.
- `src/server/resolverVerification.ts`: official resolver fetch checks.
- `src/server/marketComparison.ts`: configured public-market search hooks.
- `src/server/circleWallet.ts`: Circle ARC-TESTNET wallet readiness.
- `src/server/arcTrace.ts`: Arc Testnet trace commit.
- `src/server/x402.ts`: paid intelligence endpoint.
- `src/server/events.ts`: traction telemetry endpoint.
- `src/app/pipeline/analysisSchema.ts`: strict artifact schema.
- `src/app/components/ProcessingScreen.tsx`: nine-stage workflow UI.
- `src/app/components/MarketScreen.tsx`: final artifact and proof panels.
- `contracts/TraceRegistry.sol`: minimal trace registry contract.
