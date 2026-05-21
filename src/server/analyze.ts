import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { AnalysisResultSchema, analyzeRequestSchema, type AnalysisResult, type PipelineStage } from '../app/pipeline/analysisSchema';
import { commitArcTrace } from './arcTrace';
import { getCircleAgentWalletStatus } from './circleWallet';
import { getMissingProductionConfig, getRuntimeStatus } from './config';
import { handleEventsRequest } from './events';
import { methodNotAllowed, readJson, sendError, sendJson } from './http';
import { analyzeWithConfiguredLlm, type LlmDraft } from './llmStructured';
import { compareMarketNovelty } from './marketComparison';
import { verifyResolver } from './resolverVerification';
import { extractSource } from './sourceExtraction';
import { handleMarketIntelligenceRequest, publishX402Artifact } from './x402';

export async function handleAnalyzeRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST') {
    methodNotAllowed(request, response, 'request', 'POST');
    return;
  }

  try {
    failIfRuntimeNotReady();
    const body = await readJson(request);
    const parsedRequest = analyzeRequestSchema.safeParse(body);

    if (!parsedRequest.success) {
      throw new StageError('request-validation', parsedRequest.error.issues[0]?.message ?? 'Invalid source input.', parsedRequest.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`));
    }

    const result = await runPipeline(parsedRequest.data.sourceText);
    const validated = AnalysisResultSchema.safeParse(result);

    if (!validated.success) {
      throw new StageError('critic-review', 'Pipeline output failed strict artifact schema validation.', validated.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`));
    }

    sendJson(response, 200, validated.data);
  } catch (error) {
    const stage = error instanceof StageError ? error.stage : inferStage(error);
    const message = error instanceof Error ? error.message : 'Analysis failed.';
    sendError(response, statusForStage(stage), message, stage, likelyCause(stage), error instanceof StageError ? error.details : []);
  }
}

export async function handleRuntimeStatusRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'GET') {
    methodNotAllowed(request, response, 'runtime-status', 'GET');
    return;
  }

  try {
    const status = await getRuntimeStatus();
    sendJson(response, status.status === 'ready' ? 200 : 503, status);
  } catch (error) {
    sendError(response, 503, error instanceof Error ? error.message : 'Runtime status failed.', 'runtime-config', 'Runtime configuration could not be parsed.');
  }
}

export { handleEventsRequest, handleMarketIntelligenceRequest };

async function runPipeline(sourceInput: string): Promise<AnalysisResult> {
  const runId = `run-${createHash('sha1').update(`${Date.now()}:${sourceInput}`).digest('hex').slice(0, 12)}`;

  try {
    const extracted = await atStage('source-extraction', () => extractSource(sourceInput));
    const draft = await atStage('claim-extraction', () => analyzeWithConfiguredLlm(extracted.text));
    requireDeadline(draft);
    const resolver = await atStage('resolver-verification', () => verifyResolver(draft));
    const marketComparison = await atStage('market-comparison', () => compareMarketNovelty(draft));
    const candidateMarkets = atStageSync('market-drafting', () => normalizeCandidateMarkets(draft, resolver));
    const criticVerdict = atStageSync('critic-review', () => enforceCritic(draft, marketComparison.noveltyVerdict));
    const circleAgentWallet = await atStage('circle-wallet', () => getCircleAgentWalletStatus());

    if (circleAgentWallet.status !== 'ready') {
      throw new StageError('circle-wallet', circleAgentWallet.error ?? 'Circle ARC-TESTNET wallet is not ready.');
    }

    const acceptedMarket = candidateMarkets[0];
    const baseArtifact = {
      runId,
      status: 'accepted' as const,
      stage: 'arc-trace-commit' as const,
      source: {
        inputType: extracted.inputType,
        title: extracted.title,
        url: extracted.url,
        domain: extracted.domain,
        language: draft.source.language,
        publishedAt: normalizeDateTimeOrNull(draft.source.publishedAt),
        extractedTextHash: extracted.extractedTextHash,
      },
      claim: normalizeClaim(draft),
      resolver,
      marketComparison,
      candidateMarkets,
      rejectedMarkets: draft.rejectedMarkets,
      criticVerdict,
      acceptedMarket,
      arcTrace: null,
      circleAgentWallet,
      x402: null,
      rejectionReason: null,
    };
    const arcTrace = await atStage('arc-trace-commit', () => commitArcTrace({
      runId,
      sourceHash: extracted.extractedTextHash,
      acceptedMarket,
      artifact: baseArtifact,
    }));
    const artifactWithTrace = { ...baseArtifact, arcTrace, stage: 'x402-publication' as const };
    const x402 = publishX402Artifact(artifactWithTrace as AnalysisResult);

    return {
      ...artifactWithTrace,
      stage: 'complete',
      x402,
    };
  } catch (error) {
    if (error instanceof StageError) throw error;
    throw new StageError(inferStage(error), error instanceof Error ? error.message : 'Pipeline failed.');
  }
}

function failIfRuntimeNotReady() {
  const missing = getMissingProductionConfig();

  if (missing.length > 0) {
    throw new StageError('runtime-config', 'AgoraBabel runtime is not ready for no-fallback analysis.', missing.map((item) => `Missing or invalid: ${item}`));
  }
}

function requireDeadline(draft: LlmDraft) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.claim.deadline)) {
    throw new StageError('claim-extraction', 'Claim extraction failed: the source did not produce an explicit ISO deadline.');
  }
}

function normalizeClaim(draft: LlmDraft) {
  return {
    ...draft.claim,
    deadline: draft.claim.deadline,
    evidence: draft.claim.evidence.map((item) => ({ text: item.text, source: item.source })),
  };
}

function normalizeCandidateMarkets(draft: LlmDraft, resolver: Awaited<ReturnType<typeof verifyResolver>>) {
  const accepted = draft.candidateMarkets[0];
  if (!accepted) throw new StageError('market-drafting', 'Market drafting failed: no accepted candidate was produced.');

  if (accepted.resolverUrl !== resolver.url) {
    throw new StageError('market-drafting', 'Market drafting failed: candidate resolver URL does not match verified resolver URL.');
  }

  return [{
    ...accepted,
    deadline: draft.claim.deadline,
    resolverName: resolver.name,
    resolverUrl: resolver.url,
  }];
}

function enforceCritic(draft: LlmDraft, noveltyVerdict: 'new-opportunity' | 'duplicate' | 'too-close') {
  const candidate = draft.candidateMarkets[0];
  if (!candidate) throw new StageError('critic-review', 'Critic review failed: no candidate market exists.');
  if (draft.criticVerdict.decision !== 'accepted') {
    throw new StageError('critic-review', draft.rejectionReason ?? draft.criticVerdict.reasoning);
  }
  if (noveltyVerdict !== 'new-opportunity') {
    throw new StageError('critic-review', 'Critic review failed: market is duplicate or too close to an existing market.');
  }
  if (draft.rejectedMarkets.length < 2) {
    throw new StageError('critic-review', 'Critic review failed: at least two source-specific rejected candidates are required.');
  }

  const text = [candidate.question, candidate.yesCriteria, candidate.noCriteria, candidate.resolverName].join(' ');
  if (!/\bwill\b/i.test(candidate.question) || !/\?/.test(candidate.question)) {
    throw new StageError('critic-review', 'Critic review failed: accepted market must be a binary question.');
  }
  if (/\b(official sources|named authority|public authority|otherwise|market reaction|named public authority)\b/i.test(text)) {
    throw new StageError('critic-review', 'Critic review failed: accepted market contains placeholder wording.');
  }
  if (Object.values(draft.criticVerdict.checks).some((value) => value !== 'pass')) {
    throw new StageError('critic-review', `Critic review failed: ${draft.criticVerdict.failedRules.join(', ') || 'one or more checks failed'}.`);
  }

  return draft.criticVerdict;
}

async function atStage<T>(stage: PipelineStage, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof StageError) throw error;
    throw new StageError(stage, error instanceof Error ? error.message : `Pipeline failed at ${stage}.`);
  }
}

function atStageSync<T>(stage: PipelineStage, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof StageError) throw error;
    throw new StageError(stage, error instanceof Error ? error.message : `Pipeline failed at ${stage}.`);
  }
}

function normalizeDateTimeOrNull(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new StageError('claim-extraction', 'Claim extraction failed: source publication date was not parseable.');
  }
  return date.toISOString();
}

class StageError extends Error {
  constructor(
    readonly stage: PipelineStage | 'request-validation',
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'StageError';
  }
}

function inferStage(error: unknown): PipelineStage {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('circle')) return 'circle-wallet';
  if (message.includes('arc')) return 'arc-trace-commit';
  if (message.includes('resolver')) return 'resolver-verification';
  if (message.includes('comparison')) return 'market-comparison';
  if (message.includes('llm') || message.includes('groq') || message.includes('openai')) return 'claim-extraction';
  if (message.includes('url extraction') || message.includes('source')) return 'source-extraction';
  return 'runtime-config';
}

function likelyCause(stage: string) {
  const reasons: Record<string, string> = {
    'runtime-config': 'Required production services are not configured, so the no-fallback pipeline stopped before source processing.',
    'request-validation': 'The submitted request body is missing a usable sourceText field.',
    'source-extraction': 'The source could not be extracted into enough readable article text.',
    'claim-extraction': 'The LLM did not extract required event, evidence, publication, and deadline fields.',
    'resolver-verification': 'The resolver URL could not be fetched or did not look like an official resolver.',
    'market-comparison': 'Configured market search/comparison could not complete.',
    'critic-review': 'The candidate market failed strict binary, deadline, resolver, novelty, or placeholder checks.',
    'circle-wallet': 'Circle Developer-Controlled ARC-TESTNET wallet proof could not be confirmed.',
    'arc-trace-commit': 'The accepted artifact could not be committed to Arc Testnet.',
    'x402-publication': 'The x402 publication layer could not be configured or verified.',
  };

  return reasons[stage] ?? 'The strict pipeline stopped at a named stage.';
}

function statusForStage(stage: string) {
  if (stage === 'request-validation') return 400;
  if (stage === 'runtime-config') return 503;
  return 422;
}
