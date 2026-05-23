import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { AnalysisResultSchema, analyzeRequestSchema, type AnalysisResult, type PipelineStage } from '../app/pipeline/analysisSchema';
import { commitArcTrace } from './arcTrace';
import { getCircleAgentWalletStatus } from './circleWallet';
import { getMissingProductionConfig, getRuntimeStatus } from './config';
import { enforceCritic } from './criticReview';
import { handleEventsRequest } from './events';
import { methodNotAllowed, readJson, sendError, sendJson } from './http';
import { analyzeWithConfiguredLlm, type LlmDraft } from './llmStructured';
import { normalizeCandidateMarkets } from './marketDrafting';
import { compareMarketNovelty } from './marketComparison';
import { discoverOfficialResolver, verifyResolver, type ResolverDiscoveryResult } from './resolverVerification';
import { extractSource } from './sourceExtraction';
import { handleMarketIntelligenceRequest, publishX402Artifact } from './x402';

type PipelineProgressEvent =
  | { type: 'run-started'; runId: string }
  | { type: 'step-started'; runId: string; stage: PipelineStage; message: string }
  | { type: 'step-note'; runId: string; stage: PipelineStage; message: string }
  | { type: 'step-completed'; runId: string; stage: PipelineStage; message: string; artifact?: unknown }
  | { type: 'trace-committed'; runId: string; trace: NonNullable<AnalysisResult['arcTrace']> }
  | { type: 'run-completed'; runId: string; analysis: AnalysisResult }
  | { type: 'run-failed'; runId?: string; stage: PipelineStage | 'request-validation'; error: string; likelyCause: string; details: string[] };

type PipelineProgressEmitter = (event: PipelineProgressEvent) => void;

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

export async function handleAnalyzeStreamRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST') {
    methodNotAllowed(request, response, 'request', 'POST');
    return;
  }

  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/event-stream;charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders?.();

  const emit = (event: PipelineProgressEvent) => {
    response.write(`event: ${event.type}\n`);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    failIfRuntimeNotReady();
    const body = await readJson(request);
    const parsedRequest = analyzeRequestSchema.safeParse(body);

    if (!parsedRequest.success) {
      throw new StageError('request-validation', parsedRequest.error.issues[0]?.message ?? 'Invalid source input.', parsedRequest.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`));
    }

    await runPipeline(parsedRequest.data.sourceText, emit);
  } catch (error) {
    const stage = error instanceof StageError ? error.stage : inferStage(error);
    const message = error instanceof Error ? error.message : 'Analysis failed.';
    emit({
      type: 'run-failed',
      stage,
      error: message,
      likelyCause: likelyCause(stage),
      details: error instanceof StageError ? error.details : [],
    });
  } finally {
    response.end();
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

async function runPipeline(sourceInput: string, emit?: PipelineProgressEmitter): Promise<AnalysisResult> {
  const runId = `run-${createHash('sha1').update(`${Date.now()}:${sourceInput}`).digest('hex').slice(0, 12)}`;
  emit?.({ type: 'run-started', runId });

  try {
    const extracted = await atStage('source-extraction', runId, emit, () => extractSource(sourceInput), {
      start: 'reading the submitted source',
      heartbeat: ['fetching source content', 'preparing source details', 'creating source proof hash'],
      complete: 'source text is ready',
      artifact: (value) => ({
        inputType: value.inputType,
        title: value.title,
        url: value.url,
        domain: value.domain,
        outboundUrls: value.outboundUrls,
        extractedTextHash: value.extractedTextHash,
      }),
    });
    const draft = await atStage('claim-extraction', runId, emit, () => analyzeWithConfiguredLlm(extracted.text, {
      onNote: (message) => emit?.({ type: 'step-note', runId, stage: 'claim-extraction', message }),
    }), {
      start: 'finding the main claim',
      heartbeat: ['drafting the claim fields', 'waiting for model response', 'checking that required fields are present'],
      complete: 'main claim and market drafts parsed',
      artifact: (value) => ({
        source: {
          language: value.source.language,
          publishedAt: normalizeDateTimeOrNull(value.source.publishedAt),
        },
        claim: normalizeClaim(value),
      }),
    });
    requireDeadline(draft);
    const resolverDiscovery = await atStage('resolver-discovery', runId, emit, () => discoverOfficialResolver({
      draft,
      sourceUrl: extracted.url,
      outboundUrls: extracted.outboundUrls,
      sourceText: extracted.text,
    }), {
      start: 'finding official source candidates',
      heartbeat: ['checking outbound source links', 'searching official domains', 'screening official source candidates'],
      complete: 'official source search completed',
      artifact: (value) => value,
    });

    if (resolverDiscovery.status === 'not-found') {
      const result = createResolverDiscoveryRejection(runId, extracted, draft, resolverDiscovery);
      const validated = AnalysisResultSchema.safeParse(result);

      if (!validated.success) {
        throw new StageError('resolver-discovery', 'Resolver discovery rejection failed strict artifact schema validation.', validated.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`));
      }

      emit?.({ type: 'run-completed', runId, analysis: validated.data });
      return validated.data;
    }

    const resolver = await atStage('resolver-verification', runId, emit, () => verifyResolver(resolverDiscovery.candidate, draft), {
      start: `opening official source ${resolverDiscovery.candidate.url}`,
      heartbeat: ['checking official source response', 'matching official body, date, and event signals'],
      complete: 'official source verified',
      artifact: (value) => value,
    });
    const marketComparison = await atStage('market-comparison', runId, emit, () => compareMarketNovelty(draft), {
      start: 'checking existing betting questions',
      heartbeat: ['querying question search sources', 'scanning actor and event overlap'],
      complete: 'question overlap check completed',
      artifact: (value) => value,
    });
    const candidateMarkets = atStageSync('market-drafting', runId, emit, () => normalizeCandidateMarkets(draft, resolver), {
      start: 'writing the YES/NO market',
      complete: 'accepted market and rejected alternatives prepared',
      artifact: (value) => ({
        candidateMarkets: value,
        rejectedMarkets: draft.rejectedMarkets,
      }),
    });
    const criticOutcome = atStageSync('critic-review', runId, emit, () => enforceCritic(draft, marketComparison.noveltyVerdict), {
      start: 'checking wording, deadline, official source, question overlap, and placeholders',
      complete: 'quality decision recorded',
      artifact: (value) => ({
        criticVerdict: value.criticVerdict,
        acceptedMarket: value.status === 'accepted' ? candidateMarkets[0] : null,
        rejectionReason: value.status === 'rejected' ? value.rejectionReason : null,
      }),
    });

    if (criticOutcome.status === 'rejected') {
      const result = {
        runId,
        status: 'rejected' as const,
        stage: 'critic-review' as const,
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
        criticVerdict: criticOutcome.criticVerdict,
        acceptedMarket: null,
        arcTrace: null,
        circleAgentWallet: createNotRunCircleWalletStatus(),
        x402: null,
        rejectionReason: criticOutcome.rejectionReason,
      };
      const validated = AnalysisResultSchema.safeParse(result);

      if (!validated.success) {
        throw new StageError('critic-review', 'Rejected pipeline output failed strict artifact schema validation.', validated.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`));
      }

      emit?.({ type: 'run-completed', runId, analysis: validated.data });
      return validated.data;
    }

    const criticVerdict = criticOutcome.criticVerdict;
    const circleAgentWallet = await atStage('circle-wallet', runId, emit, () => getCircleAgentWalletStatus(), {
      start: 'checking Circle test-wallet proof',
      heartbeat: ['requesting Circle wallet status', 'checking configured agent wallet address'],
      complete: 'Circle wallet proof checked',
      artifact: (value) => value,
    });

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
    const arcTrace = await atStage('arc-trace-commit', runId, emit, () => commitArcTrace({
      runId,
      sourceHash: extracted.extractedTextHash,
      acceptedMarket,
      artifact: baseArtifact,
    }), {
      start: 'saving proof on Arc Testnet',
      heartbeat: ['waiting for Arc transaction hash', 'waiting for Arc transaction receipt'],
      complete: 'Arc proof saved',
      artifact: (value) => value,
    });
    emit?.({ type: 'trace-committed', runId, trace: arcTrace });
    const artifactWithTrace = { ...baseArtifact, arcTrace, stage: 'x402-publication' as const };
    const x402 = atStageSync('x402-publication', runId, emit, () => publishX402Artifact(artifactWithTrace as AnalysisResult), {
      start: 'publishing paid-access details',
      complete: 'paid-access details ready',
      artifact: (value) => value,
    });

    const result = {
      ...artifactWithTrace,
      stage: 'complete',
      x402,
    };
    const validated = AnalysisResultSchema.safeParse(result);

    if (!validated.success) {
      throw new StageError('critic-review', 'Pipeline output failed strict artifact schema validation.', validated.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`));
    }

    emit?.({ type: 'run-completed', runId, analysis: validated.data });
    return validated.data;
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

function createResolverDiscoveryRejection(
  runId: string,
  extracted: Awaited<ReturnType<typeof extractSource>>,
  draft: LlmDraft,
  discovery: Extract<ResolverDiscoveryResult, { status: 'not-found' }>,
): AnalysisResult {
  const checkedCandidates = discovery.checkedCandidates.map((candidate) => candidate.url).slice(0, 5);
  const rejectionReason = [
    'Source analyzed, but no official resolver found.',
    discovery.reason,
    checkedCandidates.length ? `Candidate URLs checked: ${checkedCandidates.join(', ')}` : '',
  ].filter(Boolean).join(' ');

  return {
    runId,
    status: 'rejected',
    stage: 'resolver-discovery',
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
    resolver: null,
    marketComparison: null,
    candidateMarkets: [],
    rejectedMarkets: draft.rejectedMarkets.slice(0, 4),
    criticVerdict: {
      ...draft.criticVerdict,
      decision: 'rejected',
      checks: {
        ...draft.criticVerdict.checks,
        resolver: 'fail',
      },
      failedRules: Array.from(new Set([...draft.criticVerdict.failedRules, 'resolver-discovery'])),
      reasoning: rejectionReason,
    },
    acceptedMarket: null,
    arcTrace: null,
    circleAgentWallet: createNotRunCircleWalletStatus(),
    x402: null,
    rejectionReason,
  };
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

function createNotRunCircleWalletStatus(): AnalysisResult['circleAgentWallet'] {
  return {
    status: 'unconfigured',
    walletId: null,
    walletSetId: null,
    address: null,
    blockchain: 'ARC-TESTNET',
    checkedAt: new Date().toISOString(),
    error: 'Circle wallet check skipped because critic review rejected the candidate before acceptance.',
  };
}

async function atStage<T>(
  stage: PipelineStage,
  runId: string,
  emit: PipelineProgressEmitter | undefined,
  operation: () => Promise<T>,
  progress?: {
    start?: string;
    heartbeat?: string[];
    complete?: string;
    artifact?: (value: T) => unknown;
  },
): Promise<T> {
  if (progress?.start) {
    emit?.({ type: 'step-started', runId, stage, message: progress.start });
  }

  let heartbeatIndex = 0;
  const heartbeat = progress?.heartbeat?.length
    ? setInterval(() => {
      const message = progress.heartbeat![heartbeatIndex % progress.heartbeat!.length];
      heartbeatIndex += 1;
      emit?.({ type: 'step-note', runId, stage, message });
    }, 2500)
    : undefined;

  try {
    const value = await operation();
    if (heartbeat) clearInterval(heartbeat);
    emit?.({
      type: 'step-completed',
      runId,
      stage,
      message: progress?.complete ?? `Completed ${stage}.`,
      artifact: progress?.artifact?.(value),
    });
    return value;
  } catch (error) {
    if (heartbeat) clearInterval(heartbeat);
    if (error instanceof StageError) throw error;
    throw new StageError(stage, error instanceof Error ? error.message : `Pipeline failed at ${stage}.`);
  }
}

function atStageSync<T>(
  stage: PipelineStage,
  runId: string,
  emit: PipelineProgressEmitter | undefined,
  operation: () => T,
  progress?: {
    start?: string;
    complete?: string;
    artifact?: (value: T) => unknown;
  },
): T {
  if (progress?.start) {
    emit?.({ type: 'step-started', runId, stage, message: progress.start });
  }

  try {
    const value = operation();
    emit?.({
      type: 'step-completed',
      runId,
      stage,
      message: progress?.complete ?? `Completed ${stage}.`,
      artifact: progress?.artifact?.(value),
    });
    return value;
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
  readonly stage: PipelineStage | 'request-validation';
  readonly details: string[];

  constructor(stage: PipelineStage | 'request-validation', message: string, details: string[] = []) {
    super(message);
    this.name = 'StageError';
    this.stage = stage;
    this.details = details;
  }
}

function inferStage(error: unknown): PipelineStage {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('circle')) return 'circle-wallet';
  if (message.includes('arc')) return 'arc-trace-commit';
  if (message.includes('discovery')) return 'resolver-discovery';
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
    'resolver-discovery': 'No fetchable official resolver could be discovered from the source, outbound links, official domains, or search candidates.',
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
