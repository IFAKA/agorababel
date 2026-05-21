import { AnalysisResultSchema, type AnalysisResult, type PipelineStage } from './analysisSchema';
import { createPendingPipelineRun, createSubmission } from './simulatedProvider';
import type {
  AcceptedMarket,
  ActivityEvent,
  ArcTrace,
  ContextAnalysis,
  PipelineInput,
  PipelineErrorBrief,
  PipelineProvider,
  PipelineRun,
  PipelineRunUpdate,
  PipelineStep,
  PipelineStepStatus,
  SourceAnalysis,
} from './types';

const STAGE_PACING_ENABLED = import.meta.env.VITE_DEMO_PACING === 'true';
const STAGE_MIN_MS = 850;
let activitySequence = 0;

const stageOrder: PipelineStep[] = [
  createStep('extraction', 'Source Extraction', 'Source Extractor', 'Extract readable source text. URL inputs must produce real article text.', 'Waiting for submitted evidence.', 'No source extracted yet.', 'source-extraction'),
  createStep('claim', 'Claim Extraction', 'Claim Extractor', 'Extract event claim, actors, source language, evidence snippets, and deadline.', 'Waiting for source extraction.', 'No claim extracted yet.', 'claim-extraction'),
  createStep('resolver', 'Resolver Verification', 'Resolver Verifier', 'Fetch and verify the exact official resolver URL.', 'Waiting for claim extraction.', 'No resolver verified yet.', 'resolver-verification'),
  createStep('comparison', 'Market Comparison', 'Market Scout', 'Check configured market sources for similar existing markets.', 'Waiting for resolver verification.', 'No novelty check completed yet.', 'market-comparison'),
  createStep('market-creator', 'Market Drafting', 'Market Drafter', 'Draft one supported candidate and source-specific rejected alternatives.', 'Waiting for market comparison.', 'No market drafted yet.', 'market-drafting'),
  createStep('critic', 'Critic Review', 'Critic', 'Enforce binary wording, deadline, official resolver, novelty, and placeholder checks.', 'Waiting for drafted candidates.', 'No critic verdict yet.', 'critic-review'),
  createStep('circle', 'Circle Wallet', 'Circle Wallet Agent', 'Verify the configured Circle Developer-Controlled ARC-TESTNET wallet.', 'Waiting for accepted critic verdict.', 'No Circle wallet proof yet.', 'circle-wallet'),
  createStep('settlement', 'Arc Trace Commit', 'Arc Committer', 'Commit the accepted artifact hash to the Arc Testnet trace registry.', 'Waiting for Circle readiness.', 'No Arc transaction yet.', 'arc-trace-commit'),
  createStep('x402', 'x402 Publication', 'x402 Publisher', 'Publish paid intelligence metadata for agent-to-agent artifact access.', 'Waiting for Arc commit.', 'No x402 publication yet.', 'x402-publication'),
];

export class ApiPipelineProvider implements PipelineProvider {
  async *run(input: PipelineInput): AsyncGenerator<PipelineRunUpdate> {
    const startedAt = performance.now();
    const submission = createSubmission(input.sourceText);
    let run = updateRun(createPendingPipelineRun(submission.sourceText, submission), {
      status: 'running',
      steps: stageOrder,
    });

    emitProductEvent('source_submitted', { runId: run.id, sourceType: looksLikeUrl(input.sourceText) ? 'url' : 'text' });
    run = appendActivity(run, 'Source Queue', 'running', 'No-fallback analysis started.', 'The API must return verified evidence, Circle wallet proof, Arc commit, and x402 metadata before accepting a market.');
    yield { type: 'run-started', run };

    try {
      const apiStartedAt = performance.now();
      let analysis: AnalysisResult;

      try {
        analysis = await analyzeSource(submission.sourceText);
      } catch (error) {
        const brief = createPipelineErrorBrief(error, submission.sourceText);
        const failedStepId = stepIdForStage(brief.stage);

        await paceStage(apiStartedAt);
        run = markStepsThroughFailure(run, failedStepId);
        run = updateRun(run, { status: 'failed', error: brief.message, errorBrief: brief, analyzedInMs: elapsedMs(startedAt) });
        run = appendActivity(run, labelForStep(failedStepId), 'failed', brief.message, brief.likelyCause);
        emitProductEvent('analysis_failed', { runId: run.id, stage: String(brief.stage), sourceType: looksLikeUrl(input.sourceText) ? 'url' : 'text' });
        yield { type: 'step-completed', run, step: run.steps.find((step) => step.id === failedStepId)! };
        yield { type: 'run-failed', run, error: brief.message };
        return;
      }

      const resolvedRun = createRunFromAnalysis(run, analysis, elapsedMs(startedAt));

      for (const step of resolvedRun.steps) {
        run = hydrateStep(run, step);
        run = updateStep(run, step.id, 'running');
        run = appendActivity(run, step.agentName, 'running', step.action, step.reasoningSnippet);
        const stageStartedAt = performance.now();
        yield { type: 'step-started', run, step: run.steps.find((item) => item.id === step.id)! };

        await paceStage(stageStartedAt);

        run = revealStepArtifacts(run, resolvedRun, step.id);
        run = updateStep(run, step.id, step.status);
        run = appendActivity(run, step.agentName, step.status, step.outputSummary, step.reasoningSnippet);
        yield { type: 'step-completed', run, step: run.steps.find((item) => item.id === step.id)! };

        if (step.status === 'failed') {
          break;
        }
      }

      if (analysis.status !== 'accepted' || !resolvedRun.acceptedMarket || !resolvedRun.trace || resolvedRun.trace.status !== 'committed') {
        const message = analysis.rejectionReason ?? 'The API rejected the market before acceptance.';
        const brief = createRejectionBrief(message, analysis.stage, submission.sourceText);
        run = updateRun(run, { status: 'failed', error: message, errorBrief: brief, analyzedInMs: elapsedMs(startedAt) });
        emitProductEvent('analysis_failed', { runId: run.id, stage: analysis.stage });
        yield { type: 'run-failed', run, error: message };
        return;
      }

      run = updateRun(run, { status: 'trace-committed', trace: resolvedRun.trace });
      yield { type: 'trace-committed', run, trace: resolvedRun.trace };

      run = updateRun(run, { status: 'complete', analyzedInMs: elapsedMs(startedAt) });
      run = appendActivity(run, 'Artifact Generation', 'accepted', 'Verified market intelligence artifact is ready.', resolvedRun.acceptedMarket.criticReasoning);
      emitProductEvent('market_accepted', { runId: run.id, artifactId: resolvedRun.acceptedMarket.id });
      yield { type: 'run-completed', run };
    } catch (error) {
      const brief = createPipelineErrorBrief(error, submission.sourceText);
      run = updateRun(run, { status: 'failed', error: brief.message, errorBrief: brief, analyzedInMs: elapsedMs(startedAt) });
      run = appendActivity(run, 'Orchestrator', 'failed', brief.message, brief.likelyCause);
      emitProductEvent('analysis_failed', { runId: run.id, stage: String(brief.stage) });
      yield { type: 'run-failed', run, error: brief.message };
    }
  }
}

class AnalysisRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly stage?: string,
    readonly likelyCause?: string,
    readonly details?: string[],
  ) {
    super(message);
    this.name = 'AnalysisRequestError';
  }
}

async function analyzeSource(sourceText: string): Promise<AnalysisResult> {
  let response: Response;

  try {
    response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceText }),
    });
  } catch (error) {
    throw new AnalysisRequestError(
      error instanceof Error ? error.message : 'The browser could not reach /api/analyze.',
      undefined,
      'network',
      'The Vite API middleware may not be running, or the local dev server could not be reached.',
      ['Run pnpm dev from the repository root and retry.'],
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const errorPayload = parseErrorPayload(payload);
    throw new AnalysisRequestError(errorPayload.message, response.status, errorPayload.stage, errorPayload.likelyCause, errorPayload.details);
  }

  const parsed = AnalysisResultSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AnalysisRequestError(
      'The API returned an invalid strict artifact payload.',
      response.status,
      'response-validation',
      'The backend response did not match AnalysisResultSchema.',
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`),
    );
  }

  return parsed.data;
}

function createRunFromAnalysis(run: PipelineRun, analysis: AnalysisResult, analyzedInMs: number): PipelineRun {
  const ingestion = createSourceAnalysis(analysis);
  const context = createContextAnalysis(analysis);
  const acceptedMarket: AcceptedMarket | undefined = analysis.acceptedMarket
    ? { ...toClientMarket(analysis.acceptedMarket), criticReasoning: analysis.criticVerdict.reasoning }
    : undefined;
  const trace = analysis.arcTrace ? toClientTrace(analysis) : undefined;

  return updateRun(run, {
    id: analysis.runId,
    extractedSource: analysis.source.url ? {
      title: analysis.source.title,
      domain: analysis.source.domain ?? new URL(analysis.source.url).hostname,
      url: analysis.source.url,
      text: analysis.claim.evidence.map((item) => item.text).join('\n\n'),
    } : undefined,
    ingestion,
    context,
    candidateMarkets: analysis.candidateMarkets.map(toClientMarket),
    criticReviews: [analysis.criticVerdict],
    rejectedMarkets: analysis.rejectedMarkets,
    acceptedMarket,
    trace,
    circleAgentWallet: analysis.circleAgentWallet,
    x402: analysis.x402,
    analysis,
    analyzedInMs,
    steps: createPipelineSteps(analysis),
  });
}

function createSourceAnalysis(analysis: AnalysisResult): SourceAnalysis {
  return {
    signalName: analysis.acceptedMarket?.question ?? analysis.claim.summary,
    language: analysis.source.language,
    languageConfidence: 100,
    source: analysis.source.domain ?? analysis.source.title,
    sourceUrl: analysis.source.url ?? undefined,
    sourceDate: analysis.source.publishedAt?.slice(0, 10) ?? 'Unpublished or unavailable',
    entities: analysis.claim.actors,
    region: analysis.claim.region,
    topic: analysis.claim.eventType,
  };
}

function createContextAnalysis(analysis: AnalysisResult): ContextAnalysis {
  return {
    englishSummary: analysis.claim.summary,
    marketRelevance: analysis.status === 'accepted' ? 'High' : 'Low',
    relevanceExplanation: analysis.marketComparison.reasoning,
    evidenceSummary: analysis.claim.evidence.map((item) => item.text).join(' '),
  };
}

function createPipelineSteps(analysis: AnalysisResult): PipelineStep[] {
  const failedStage = analysis.status === 'rejected' ? analysis.stage : null;
  return stageOrder.map((step) => {
    const status = failedStage && step.stage === failedStage ? 'failed' : 'complete';
    return {
      ...step,
      status,
      reasoningSnippet: outputForStage(analysis, step.stage, 'reasoning'),
      outputSummary: outputForStage(analysis, step.stage, 'summary'),
    };
  });
}

function outputForStage(analysis: AnalysisResult, stage: PipelineStage, mode: 'reasoning' | 'summary') {
  switch (stage) {
    case 'source-extraction':
      return mode === 'summary'
        ? `${analysis.source.title}${analysis.source.domain ? ` from ${analysis.source.domain}` : ''}.`
        : `${analysis.source.inputType.toUpperCase()} input hashed as ${analysis.source.extractedTextHash.slice(0, 12)}...`;
    case 'claim-extraction':
      return mode === 'summary'
        ? `${analysis.claim.eventType} in ${analysis.claim.region}; deadline ${analysis.claim.deadline}.`
        : analysis.claim.summary;
    case 'resolver-verification':
      return mode === 'summary' ? `${analysis.resolver.name} verified.` : analysis.resolver.verificationEvidence;
    case 'market-comparison':
      return mode === 'summary' ? `Novelty verdict: ${analysis.marketComparison.noveltyVerdict}.` : analysis.marketComparison.reasoning;
    case 'market-drafting':
      return mode === 'summary' ? analysis.candidateMarkets[0]?.question ?? 'No candidate market.' : `${analysis.rejectedMarkets.length} rejected alternatives retained.`;
    case 'critic-review':
      return analysis.criticVerdict.reasoning;
    case 'circle-wallet':
      return mode === 'summary'
        ? `Circle wallet ${analysis.circleAgentWallet.status}.`
        : analysis.circleAgentWallet.address ?? analysis.circleAgentWallet.error ?? 'No wallet proof.';
    case 'arc-trace-commit':
      return mode === 'summary'
        ? analysis.arcTrace ? `Committed ${analysis.arcTrace.transactionHash.slice(0, 14)}...` : 'Arc commit missing.'
        : analysis.arcTrace?.artifactHash ?? 'No artifact hash committed.';
    case 'x402-publication':
      return mode === 'summary'
        ? analysis.x402 ? `x402 ${analysis.x402.status} at ${analysis.x402.intelligenceUrl}.` : 'x402 publication missing.'
        : analysis.x402?.payToAddress ?? 'No payment address configured.';
    default:
      return analysis.rejectionReason ?? 'Pipeline completed.';
  }
}

function toClientMarket(market: AnalysisResult['candidateMarkets'][number]) {
  return {
    ...market,
    resolutionSource: `${market.resolverName} (${market.resolverUrl})`,
  };
}

function toClientTrace(analysis: AnalysisResult): ArcTrace | undefined {
  if (!analysis.arcTrace) return undefined;
  return {
    traceHash: analysis.arcTrace.artifactHash,
    transactionId: analysis.arcTrace.transactionHash,
    network: `${analysis.arcTrace.network} (${analysis.arcTrace.chainId})`,
    status: analysis.arcTrace.status,
    timestamp: analysis.arcTrace.committedAt,
    explorerUrl: analysis.arcTrace.explorerUrl,
    artifactHash: analysis.arcTrace.artifactHash,
    sourceHash: analysis.arcTrace.sourceHash,
    chainId: analysis.arcTrace.chainId,
  };
}

function markStepsThroughFailure(run: PipelineRun, failedStepId: PipelineStep['id']) {
  const failedIndex = stageOrder.findIndex((step) => step.id === failedStepId);
  return updateRun(run, {
    steps: stageOrder.map((step, index) => ({
      ...step,
      status: index < failedIndex ? 'complete' : index === failedIndex ? 'failed' : 'pending',
    })),
  });
}

function createPipelineErrorBrief(error: unknown, sourceText: string): PipelineErrorBrief {
  const requestError = error instanceof AnalysisRequestError ? error : undefined;
  const message = error instanceof Error ? error.message : 'Pipeline failed.';
  const stage = (requestError?.stage ?? 'api') as PipelineErrorBrief['stage'];
  const sourceKind = looksLikeUrl(sourceText) ? 'URL' : 'pasted text';

  return {
    title: 'AgoraBabel pipeline failure',
    stage,
    statusCode: requestError?.statusCode,
    message,
    likelyCause: requestError?.likelyCause ?? 'The no-fallback pipeline stopped before a verified artifact could be produced.',
    debuggingContext: [
      `Backend stage: ${stage}`,
      requestError?.statusCode ? `HTTP status: ${requestError.statusCode}` : 'HTTP status: unavailable',
      `Source type: ${sourceKind}`,
      `Source length: ${sourceText.trim().length} characters`,
      ...(requestError?.details ?? []),
    ],
    agentPrompt: [
      'Fix this AgoraBabel no-fallback pipeline failure.',
      `Backend stage: ${stage}.`,
      `Error: ${message}`,
      'Inspect src/server/analyze.ts and the stage module named in the error.',
      'Do not add heuristic fallback acceptance.',
    ].join('\n'),
  };
}

function createRejectionBrief(message: string, stage: PipelineStage, sourceText: string): PipelineErrorBrief {
  return {
    title: 'AgoraBabel market rejection',
    stage,
    message,
    likelyCause: 'The strict critic rejected the source or downstream proof failed.',
    debuggingContext: [`Stage: ${stage}`, `Source length: ${sourceText.trim().length} characters`],
    agentPrompt: `Investigate AgoraBabel rejection at ${stage}: ${message}`,
  };
}

function parseErrorPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return {
      message: 'Analysis failed.',
      stage: 'api',
      likelyCause: 'The API returned an error without a JSON body.',
      details: ['Inspect the Network response body for /api/analyze.'],
    };
  }

  const record = payload as Record<string, unknown>;
  const details = Array.isArray(record.details)
    ? record.details.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    message: typeof record.error === 'string' ? record.error : 'Analysis failed.',
    stage: typeof record.stage === 'string' ? record.stage : 'api',
    likelyCause: typeof record.likelyCause === 'string' ? record.likelyCause : 'The backend rejected or failed the source analysis request.',
    details,
  };
}

function stepIdForStage(stage: PipelineErrorBrief['stage']): PipelineStep['id'] {
  const found = stageOrder.find((step) => step.stage === stage);
  return found?.id ?? 'extraction';
}

function labelForStep(stepId: PipelineStep['id']) {
  return stageOrder.find((step) => step.id === stepId)?.agentName ?? 'Pipeline';
}

function createStep(
  id: PipelineStep['id'],
  title: string,
  agentName: string,
  action: string,
  reasoningSnippet: string,
  outputSummary: string,
  stage: PipelineStage,
): PipelineStep {
  return { id, title, agentName, action, reasoningSnippet, outputSummary, status: 'pending', stage };
}

function hydrateStep(run: PipelineRun, sourceStep: PipelineStep): PipelineRun {
  return updateRun(run, {
    steps: run.steps.map((step) => (step.id === sourceStep.id ? { ...sourceStep, status: step.status } : step)),
  });
}

function revealStepArtifacts(run: PipelineRun, resolvedRun: PipelineRun, stepId: PipelineStep['id']): PipelineRun {
  if (stepId === 'extraction') return updateRun(run, { extractedSource: resolvedRun.extractedSource });
  if (stepId === 'claim') return updateRun(run, { ingestion: resolvedRun.ingestion, context: resolvedRun.context });
  if (stepId === 'resolver') return updateRun(run, { analysis: resolvedRun.analysis });
  if (stepId === 'comparison') return updateRun(run, { analysis: resolvedRun.analysis });
  if (stepId === 'market-creator') return updateRun(run, { candidateMarkets: resolvedRun.candidateMarkets, rejectedMarkets: resolvedRun.rejectedMarkets });
  if (stepId === 'critic') return updateRun(run, { criticReviews: resolvedRun.criticReviews, acceptedMarket: resolvedRun.acceptedMarket });
  if (stepId === 'circle') return updateRun(run, { circleAgentWallet: resolvedRun.circleAgentWallet });
  if (stepId === 'settlement') return updateRun(run, { trace: resolvedRun.trace });
  if (stepId === 'x402') return updateRun(run, { x402: resolvedRun.x402 });
  return run;
}

function updateStep(run: PipelineRun, stepId: PipelineStep['id'], status: PipelineStepStatus): PipelineRun {
  return updateRun(run, {
    steps: run.steps.map((step) => (step.id === stepId ? { ...step, status } : step)),
  });
}

function appendActivity(
  run: PipelineRun,
  agentName: string,
  status: ActivityEvent['status'],
  message: string,
  reasoningSnippet: string,
): PipelineRun {
  const event: ActivityEvent = {
    id: `activity-${activitySequence += 1}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    agentName,
    status,
    message,
    reasoningSnippet,
  };

  return updateRun(run, {
    activityFeed: [event, ...run.activityFeed].slice(0, 12),
  });
}

function updateRun(run: PipelineRun, updates: Partial<PipelineRun>): PipelineRun {
  return {
    ...run,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
}

async function paceStage(stageStartedAt: number) {
  const minimumMs = STAGE_PACING_ENABLED ? STAGE_MIN_MS : 0;
  const remainingMs = Math.max(0, minimumMs - (performance.now() - stageStartedAt));
  await wait(remainingMs);
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function elapsedMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

function looksLikeUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function emitProductEvent(eventName: string, payload: Partial<{ artifactId: string; runId: string; stage: string; sourceType: 'text' | 'url' }> = {}) {
  const sessionId = getSessionId();
  void fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventName,
      ...payload,
      timestamp: new Date().toISOString(),
      sessionId,
    }),
  }).catch(() => undefined);
}

function getSessionId() {
  const key = 'agorababel:sessionId';
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = `session-${crypto.randomUUID()}`;
  window.localStorage.setItem(key, created);
  return created;
}
