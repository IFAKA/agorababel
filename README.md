# AgoraBabel

AgoraBabel is an Arc/Circle hackathon product demo that turns local-language news into paid, verifiable prediction-market intelligence.

The core idea: an agent should not just draft a market. It should prove where the source came from, verify the official resolver, reject weak inputs, commit the final artifact hash on Arc Testnet, and expose the intelligence through an x402 paid API.

## Hackathon Submission Links

- **Main product repo:** this repository, `AgoraBabel-SaaS`
- **Arc OSS starter repo:** [IFAKA/arc-paid-agent-artifact-starter](https://github.com/IFAKA/arc-paid-agent-artifact-starter)
- **Reusable starter purpose:** forkable infrastructure for paid, verifiable Arc-native agent artifacts
- **Runtime readiness endpoint:** `GET /api/runtime-status`
- **Primary product flow:** source article -> verified market intelligence -> Arc trace -> x402 publication

The standalone starter is attached here so judges and Arc builders can see the reusable infrastructure extracted from AgoraBabel without confusing it with the main submitted product.

## What Was Built

AgoraBabel runs a strict nine-stage agent pipeline:

1. Source extraction from pasted text or public readable URLs
2. Claim extraction through a configured remote LLM provider
3. Official resolver verification
4. Public-market comparison
5. YES/NO market drafting
6. Critic review with rejection paths
7. Circle ARC-TESTNET wallet readiness check
8. Arc Testnet trace commit
9. x402 paid publication metadata and unlock API

A run either produces a complete accepted artifact with evidence, resolver, Circle wallet proof, Arc transaction data, artifact/source hashes, and x402 metadata, or it fails at a named stage with no accepted market.

## Why It Fits The Hackathon

- **Agentic sophistication:** the agent has explicit source, claim, resolver, scout, drafter, critic, Circle, Arc, and x402 stages. It rejects weak or under-specified inputs instead of silently filling gaps.
- **Traction instrumentation:** shareable artifact routes, copy/share actions, feedback buttons, and telemetry events for starts, failures, accepted artifacts, opens, copies, shares, x402 unlock attempts, and feedback.
- **Circle integration:** Circle Developer-Controlled `ARC-TESTNET` wallet readiness plus x402/Circle nanopayment metadata for paid artifact access.
- **Arc innovation:** reasoning artifacts are converted into deterministic hashes and committed through `TraceRegistry.commitTrace` on Arc Testnet.
- **Open-source builder value:** the extracted starter repo lets other Arc builders reuse the trace, hashing, Circle, x402, and proof-panel primitives for their own agent artifacts.

## Arc OSS Starter

The Arc OSS companion repo is live here:

https://github.com/IFAKA/arc-paid-agent-artifact-starter

It extracts AgoraBabel's reusable primitives into a generic starter kit:

- Arc Testnet trace commits
- deterministic canonical JSON artifact hashing
- minimal `TraceRegistry.sol`
- Circle ARC-TESTNET wallet readiness
- x402 protected artifact APIs
- demo buyer unlock flow
- React proof/payment panel
- generic `AgentArtifact` schema

Arc CLI update submitted:

```text
ArcOSS: shipped a standalone starter kit for Arc builders: https://github.com/IFAKA/arc-paid-agent-artifact-starter

It extracts AgoraBabel’s reusable primitives into a forkable paid-agent-artifact template: Arc Testnet trace commits, deterministic artifact hashing, Circle ARC-TESTNET wallet readiness, x402 protected artifact APIs, demo buyer unlock flow, and a React proof/payment panel.
```

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

Unit tests:

```bash
pnpm test:unit
```

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

## Demo Script For Judges

1. Open the app and submit a weak paragraph with no deadline; show a named-stage failure.
2. Submit a stronger local-language source that names actors, official resolver, evidence, and deadline.
3. Show resolver verification and market comparison stages.
4. Open the final artifact and show YES/NO criteria, deadline, official resolver URL, evidence snippets, similar-market result, and rejected candidates.
5. Show Circle wallet ID/address/blockchain.
6. Show Arc transaction hash, artifact hash, source hash, chain ID, and Arcscan link.
7. Click x402 unlock; without payment proof it returns `402 Payment Required` when enabled.
8. Click copy/share/feedback and use `/api/events` counts or server logs to summarize traction.

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
