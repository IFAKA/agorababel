import { AnalysisResultSchema, type AnalysisResult, type PipelineStage } from './analysisSchema';
import { createPendingPipelineRun, createSubmission } from './simulatedProvider';
import { appendActivity, appendOperation, appendStepReasoning, compactMetadata, completeStepOperations, failStepOperations, updateRun, updateStep, updateStepText } from './runState';
import { canonicalStageOrder, labelForStep, stepIdForStage } from './stages';
import type {
  AcceptedMarket,
  ArcTrace,
  ContextAnalysis,
  PipelineInput,
  PipelineErrorBrief,
  PipelineProvider,
  PipelineRun,
  PipelineRunUpdate,
  PipelineStep,
  SourceAnalysis,
} from './types';

const STAGE_PACING_ENABLED = import.meta.env.VITE_DEMO_PACING === 'true';
const STAGE_MIN_MS = 850;

type StreamEvent =
  | { type: 'run-started'; runId: string }
  | { type: 'step-started'; runId: string; stage: PipelineStage; message: string }
  | { type: 'step-note'; runId: string; stage: PipelineStage; message: string }
  | { type: 'step-completed'; runId: string; stage: PipelineStage; message: string; artifact?: unknown }
  | { type: 'trace-committed'; runId: string; trace: NonNullable<AnalysisResult['arcTrace']> }
  | { type: 'run-completed'; runId: string; analysis: AnalysisResult }
  | { type: 'run-failed'; runId?: string; stage: PipelineErrorBrief['stage']; error: string; likelyCause: string; details?: string[] };

const stageOrder = canonicalStageOrder;

export class ApiPipelineProvider implements PipelineProvider {
  async *run(input: PipelineInput): AsyncGenerator<PipelineRunUpdate> {
    const startedAt = performance.now();
    const submission = createSubmission(input.sourceText);
    let run = updateRun(createPendingPipelineRun(submission.sourceText, submission), {
      status: 'running',
      steps: stageOrder,
    });

    emitProductEvent('source_submitted', { runId: run.id, sourceType: looksLikeUrl(input.sourceText) ? 'url' : 'text' });
    run = appendActivity(run, 'Source Queue', 'running', 'Live analysis started.', 'The API must return verified evidence, wallet proof, Arc proof, and paid-access details before accepting a market.');
    run = appendOperation(run, 'extraction', {
      label: 'Source submitted',
      status: 'running',
      detail: 'Browser posted source to the live streaming analyzer.',
      metadata: {
        input: looksLikeUrl(input.sourceText) ? 'url' : 'text',
        stream: '/api/analyze/stream',
      },
    });
    yield { type: 'run-started', run };

    try {
      let terminalEventReceived = false;

      for await (const event of streamAnalyzeSource(submission.sourceText, input.signal)) {
        if (event.type === 'run-started') {
          run = updateRun(run, { id: event.runId });
          run = appendOperation(run, 'extraction', {
            label: 'Run ID assigned',
            status: 'info',
            detail: 'Backend accepted the stream request and returned a run identifier.',
            metadata: { run: event.runId },
          });
          yield { type: 'run-started', run };
          continue;
        }

        if (event.type === 'step-started') {
          const stepId = stepIdForStage(event.stage);
          run = appendStepReasoning(run, stepId, event.message);
          run = updateStep(run, stepId, 'running');
          run = appendActivity(run, labelForStep(stepId), 'running', event.message, 'Backend stage started.');
          run = appendOperation(run, stepId, {
            label: liveOperationLabelForStage(event.stage, 'start'),
            status: 'running',
            detail: event.message,
            metadata: liveOperationMetadataForStage(event.stage, run, undefined, 'start'),
          });
          yield { type: 'step-started', run, step: run.steps.find((step) => step.id === stepId)! };
          continue;
        }

        if (event.type === 'step-note') {
          const stepId = stepIdForStage(event.stage);
          run = appendStepReasoning(run, stepId, event.message);
          run = appendActivity(run, labelForStep(stepId), 'running', event.message, 'Live backend progress note.');
          run = appendOperation(run, stepId, {
            label: liveOperationLabelForStage(event.stage, 'note'),
            status: 'running',
            detail: event.message,
            metadata: liveOperationMetadataForStage(event.stage, run, undefined, 'note'),
          });
          yield { type: 'step-note', run, step: run.steps.find((step) => step.id === stepId)! };
          continue;
        }

        if (event.type === 'step-completed') {
          const stepId = stepIdForStage(event.stage);
          run = revealStreamArtifact(run, event.stage, event.artifact);
          run = updateStepText(run, stepId, { outputSummary: event.message });
          run = completeStepOperations(run, stepId);
          run = updateStep(run, stepId, 'complete');
          run = appendActivity(run, labelForStep(stepId), 'complete', event.message, stageCompletionReasoning(event.stage, event.artifact));
          run = appendOperation(run, stepId, {
            label: liveOperationLabelForStage(event.stage, 'complete'),
            status: 'complete',
            detail: event.message,
            metadata: liveOperationMetadataForStage(event.stage, run, event.artifact, 'complete'),
          });
          yield { type: 'step-completed', run, step: run.steps.find((step) => step.id === stepId)! };
          continue;
        }

        if (event.type === 'trace-committed') {
          const trace = toClientTraceFromArcTrace(event.trace);
          run = updateRun(run, { status: 'trace-committed', trace });
          run = appendOperation(run, 'settlement', {
            label: 'Arc transaction recorded',
            status: trace.status === 'committed' ? 'complete' : 'failed',
            detail: trace.status === 'committed' ? 'Trace registry transaction returned from Arc Testnet.' : 'Arc trace commit returned a failed status.',
            metadata: {
              artifact: trace.artifactHash ?? trace.traceHash,
              source: trace.sourceHash ?? 'pending',
              transaction: trace.transactionId,
              network: trace.network,
            },
          });
          yield { type: 'trace-committed', run, trace };
          continue;
        }

        if (event.type === 'run-completed') {
          terminalEventReceived = true;
          const parsed = AnalysisResultSchema.safeParse(event.analysis);
          if (!parsed.success) {
            throw new AnalysisRequestError(
              'The streaming API returned an invalid strict artifact payload.',
              200,
              'response-validation',
              'The backend stream completed with a payload that did not match AnalysisResultSchema.',
              parsed.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`),
            );
          }

          const resolvedRun = createRunFromAnalysis(run, parsed.data, elapsedMs(startedAt));
          if (parsed.data.status === 'rejected') {
            const message = parsed.data.rejectionReason ?? 'The API rejected the market before acceptance.';
            run = updateRun(resolvedRun, { status: 'rejected', analyzedInMs: elapsedMs(startedAt) });
            run = appendOperation(run, stepIdForStage(parsed.data.stage), {
              label: 'Strict artifact rejected',
              status: 'failed',
              detail: message,
              metadata: { stage: parsed.data.stage },
            });
            emitProductEvent('analysis_rejected', { runId: run.id, stage: parsed.data.stage });
            yield { type: 'run-completed', run };
            return;
          }

          if (!resolvedRun.acceptedMarket || !resolvedRun.trace || resolvedRun.trace.status !== 'committed') {
            const message = 'The API completed without the required accepted market and committed trace.';
            const brief = createRejectionBrief(message, parsed.data.stage, submission.sourceText);
            run = updateRun(resolvedRun, { status: 'failed', error: message, errorBrief: brief, analyzedInMs: elapsedMs(startedAt) });
            run = appendOperation(run, stepIdForStage(parsed.data.stage), {
              label: 'Strict artifact invalid',
              status: 'failed',
              detail: message,
              metadata: { stage: parsed.data.stage },
            });
            emitProductEvent('analysis_failed', { runId: run.id, stage: parsed.data.stage });
            yield { type: 'run-failed', run, error: message };
            return;
          }

          run = updateRun(resolvedRun, { status: 'complete', analyzedInMs: elapsedMs(startedAt) });
          run = appendActivity(run, 'Artifact Generation', 'accepted', 'Verified market intelligence artifact is ready.', resolvedRun.acceptedMarket.criticReasoning);
          run = appendOperation(run, 'x402', {
            label: 'Final artifact ready',
            status: 'complete',
            detail: 'Validated market intelligence artifact is ready to open.',
            metadata: {
              artifact: resolvedRun.acceptedMarket.id,
              run: resolvedRun.id,
            },
          });
          emitProductEvent('market_accepted', { runId: run.id, artifactId: resolvedRun.acceptedMarket.id });
          yield { type: 'run-completed', run };
          return;
        }

        if (event.type === 'run-failed') {
          terminalEventReceived = true;
          const error = new AnalysisRequestError(event.error, 200, String(event.stage), event.likelyCause, event.details);
          const brief = createPipelineErrorBrief(error, submission.sourceText);
          const failedStepId = stepIdForStage(brief.stage);
          run = markStepsThroughFailure(run, failedStepId);
          run = failStepOperations(run, failedStepId);
          run = updateRun(run, { status: 'failed', error: brief.message, errorBrief: brief, analyzedInMs: elapsedMs(startedAt) });
          run = appendActivity(run, labelForStep(failedStepId), 'failed', brief.message, brief.likelyCause);
          run = appendOperation(run, failedStepId, {
            label: 'Stage failed',
            status: 'failed',
            detail: brief.message,
            metadata: { stage: String(brief.stage) },
          });
          emitProductEvent('analysis_failed', { runId: run.id, stage: String(brief.stage), sourceType: looksLikeUrl(input.sourceText) ? 'url' : 'text' });
          yield { type: 'step-completed', run, step: run.steps.find((step) => step.id === failedStepId)! };
          yield { type: 'run-failed', run, error: brief.message };
          return;
        }
      }

      if (!terminalEventReceived) {
        throw new AnalysisRequestError(
          'The streaming API ended before the pipeline completed.',
          200,
          'api',
          'The SSE connection closed without run-completed or run-failed.',
        );
      }
    } catch (error) {
      if (input.signal?.aborted || isAbortError(error)) {
        return;
      }

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

async function analyzeSource(sourceText: string, signal?: AbortSignal): Promise<AnalysisResult> {
  let response: Response;

  try {
    response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceText }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw error;
    }

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

async function* streamAnalyzeSource(sourceText: string, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  let response: Response;

  try {
    response = await fetch('/api/analyze/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ sourceText }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw error;
    }

    throw new AnalysisRequestError(
      error instanceof Error ? error.message : 'The browser could not reach /api/analyze/stream.',
      undefined,
      'network',
      'The Vite API middleware may not be running, or the local dev server could not be reached.',
      ['Run pnpm dev from the repository root and retry.'],
    );
  }

  if (!response.ok || !response.body) {
    const payload: unknown = await response.json().catch(() => null);
    const errorPayload = parseErrorPayload(payload);
    throw new AnalysisRequestError(errorPayload.message, response.status, errorPayload.stage, errorPayload.likelyCause, errorPayload.details);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        return;
      }

      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const event = parseSseFrame(frame);
        if (event) yield event;
      }

      if (done) break;
    }

    const finalEvent = parseSseFrame(buffer);
    if (finalEvent) yield finalEvent;
  } finally {
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
    }
  }
}

function parseSseFrame(frame: string): StreamEvent | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');

  if (!data) return null;

  try {
    const parsed = JSON.parse(data) as StreamEvent;
    return typeof parsed?.type === 'string' ? parsed : null;
  } catch {
    throw new AnalysisRequestError(
      'The streaming API returned malformed SSE data.',
      200,
      'response-validation',
      'A server-sent event could not be parsed as JSON.',
      [data.slice(0, 200)],
    );
  }
}

function revealStreamArtifact(run: PipelineRun, stage: PipelineStage, artifact: unknown): PipelineRun {
  const value = isRecord(artifact) ? artifact : {};

  if (stage === 'source-extraction') {
    const url = typeof value.url === 'string' ? value.url : '';
    const title = typeof value.title === 'string' ? value.title : 'Submitted source';
    const domain = typeof value.domain === 'string' ? value.domain : url ? new URL(url).hostname : 'Pasted source';

    return updateRun(run, {
      extractedSource: {
        title,
        domain,
        url,
        text: typeof value.extractedTextHash === 'string' ? `Extracted text hash ${value.extractedTextHash.slice(0, 12)}...` : 'Source extracted.',
      },
    });
  }

  if (stage === 'claim-extraction') {
    const claim = isRecord(value.claim) ? value.claim : {};
    const source = isRecord(value.source) ? value.source : {};
    const evidence = Array.isArray(claim.evidence)
      ? claim.evidence.filter(isRecord).map((item) => String(item.text ?? '')).filter(Boolean).join(' ')
      : '';

    return updateRun(run, {
      ingestion: {
        signalName: String(claim.summary ?? 'Claim extracted'),
        language: String(source.language ?? 'Unknown'),
        languageConfidence: 100,
        source: run.extractedSource?.domain ?? 'Submitted source',
        sourceUrl: run.extractedSource?.url || undefined,
        sourceDate: typeof source.publishedAt === 'string' ? source.publishedAt.slice(0, 10) : 'Unpublished or unavailable',
        entities: Array.isArray(claim.actors) ? claim.actors.map(String) : [],
        region: String(claim.region ?? 'Unknown'),
        topic: String(claim.eventType ?? 'Event'),
      },
      context: {
        englishSummary: String(claim.summary ?? 'Claim extracted.'),
        marketRelevance: 'Medium',
        relevanceExplanation: 'The main claim has the fields needed for a market. Duplicate checking is still pending.',
        evidenceSummary: evidence,
      },
    });
  }

  if (stage === 'market-drafting') {
    const candidateMarkets = Array.isArray(value.candidateMarkets) ? value.candidateMarkets.map(toClientMarket) : run.candidateMarkets;
    const rejectedMarkets = Array.isArray(value.rejectedMarkets)
      ? value.rejectedMarkets as PipelineRun['rejectedMarkets']
      : run.rejectedMarkets;
    return updateRun(run, { candidateMarkets, rejectedMarkets });
  }

  if (stage === 'resolver-discovery') {
    return updateRun(run, { resolverDiscovery: value as PipelineRun['resolverDiscovery'] });
  }

  if (stage === 'resolver-verification') {
    return updateRun(run, { liveResolver: value as PipelineRun['liveResolver'] });
  }

  if (stage === 'market-comparison') {
    return updateRun(run, {
      liveMarketComparison: value as PipelineRun['liveMarketComparison'],
      context: run.context ? {
        ...run.context,
        marketRelevance: value.noveltyVerdict === 'new-opportunity' ? 'High' : 'Low',
        relevanceExplanation: String(value.reasoning ?? run.context.relevanceExplanation),
      } : run.context,
    });
  }

  if (stage === 'critic-review') {
    const criticVerdict = isRecord(value.criticVerdict) ? value.criticVerdict as PipelineRun['criticReviews'][number] : undefined;
    const acceptedMarket = isRecord(value.acceptedMarket)
      ? { ...toClientMarket(value.acceptedMarket as AnalysisResult['candidateMarkets'][number]), criticReasoning: criticVerdict?.reasoning ?? 'Critic verdict accepted.' }
      : undefined;

    return updateRun(run, {
      criticReviews: criticVerdict ? [criticVerdict] : run.criticReviews,
      acceptedMarket,
    });
  }

  if (stage === 'circle-wallet') {
    return updateRun(run, { circleAgentWallet: value as PipelineRun['circleAgentWallet'] });
  }

  if (stage === 'arc-trace-commit') {
    return updateRun(run, { trace: toClientTraceFromArcTrace(value as NonNullable<AnalysisResult['arcTrace']>) });
  }

  if (stage === 'x402-publication') {
    return updateRun(run, { x402: value as PipelineRun['x402'] });
  }

  return run;
}

function stageCompletionReasoning(stage: PipelineStage, artifact: unknown) {
  const value = isRecord(artifact) ? artifact : {};

  if (stage === 'source-extraction' && typeof value.extractedTextHash === 'string') {
    return `Extracted text hash ${value.extractedTextHash.slice(0, 12)}...`;
  }

  if (stage === 'claim-extraction') return 'Structured JSON was parsed and schema-validated before display.';
  if (stage === 'resolver-discovery') {
    const candidate = isRecord(value.candidate) ? value.candidate : undefined;
    return value.status === 'found'
      ? `Official resolver candidate selected: ${String(candidate?.url ?? 'candidate selected')}`
      : String(value.reason ?? 'No official resolver candidate found.');
  }
  if (stage === 'resolver-verification') return String(value.verificationEvidence ?? 'Official source fetch and identity checks passed.');
  if (stage === 'market-comparison') return String(value.reasoning ?? 'Novelty check completed.');
  if (stage === 'market-drafting') return 'Candidate and rejected alternatives are normalized from validated fields.';
  if (stage === 'critic-review') return String(isRecord(value.criticVerdict) ? value.criticVerdict.reasoning ?? 'Critic checks passed.' : 'Critic checks passed.');
  if (stage === 'circle-wallet') return String(value.address ?? value.error ?? 'Circle wallet status checked.');
  if (stage === 'arc-trace-commit') return String(value.artifactHash ?? 'Arc trace committed.');
  if (stage === 'x402-publication') return String(value.payToAddress ?? 'x402 publication ready.');
  return 'Backend stage completed.';
}

function toClientTraceFromArcTrace(trace: NonNullable<AnalysisResult['arcTrace']>): ArcTrace {
  return {
    traceHash: trace.artifactHash,
    transactionId: trace.transactionHash,
    network: `${trace.network} (${trace.chainId})`,
    status: trace.status,
    timestamp: trace.committedAt,
    explorerUrl: trace.explorerUrl,
    artifactHash: trace.artifactHash,
    sourceHash: trace.sourceHash,
    chainId: trace.chainId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
    relevanceExplanation: analysis.marketComparison?.reasoning ?? analysis.rejectionReason ?? 'No market comparison ran.',
    evidenceSummary: analysis.claim.evidence.map((item) => item.text).join(' '),
  };
}

function createPipelineSteps(analysis: AnalysisResult): PipelineStep[] {
  const failedStage = analysis.status === 'rejected' ? analysis.stage : null;
  const failedStepId = failedStage ? stepIdForStage(failedStage) : null;
  const failedIndex = failedStepId ? stageOrder.findIndex((step) => step.id === failedStepId) : -1;
  return stageOrder.map((step) => {
    const stepIndex = stageOrder.findIndex((item) => item.id === step.id);
    const status = failedIndex === -1 ? 'complete' : stepIndex < failedIndex ? 'complete' : stepIndex === failedIndex ? 'failed' : 'pending';
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
    case 'resolver-discovery':
      return mode === 'summary'
        ? analysis.resolver ? `${analysis.resolver.name} discovered.` : 'No official resolver found.'
        : analysis.rejectionReason ?? analysis.resolver?.verificationEvidence ?? 'Official resolver discovery completed.';
    case 'resolver-verification':
      return mode === 'summary' ? `${analysis.resolver?.name ?? 'No resolver'} verified.` : analysis.resolver?.verificationEvidence ?? analysis.rejectionReason ?? 'No resolver verified.';
    case 'market-comparison':
      return mode === 'summary'
        ? `Duplicate check: ${analysis.marketComparison?.noveltyVerdict === 'new-opportunity' ? 'no close duplicate found' : analysis.marketComparison?.noveltyVerdict ?? 'not checked'}.`
        : analysis.marketComparison?.reasoning ?? 'Duplicate check did not run.';
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
        ? analysis.arcTrace ? `Proof saved ${analysis.arcTrace.transactionHash.slice(0, 14)}...` : 'Arc proof missing.'
        : analysis.arcTrace?.artifactHash ?? 'No proof hash saved.';
    case 'x402-publication':
      return mode === 'summary'
        ? analysis.x402 ? `Access ${analysis.x402.status} at ${analysis.x402.intelligenceUrl}.` : 'Access publication missing.'
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

function liveOperationLabelForStage(stage: PipelineStage, phase: 'start' | 'note' | 'complete'): string {
  const fallback = phase === 'start' ? 'Stage started' : phase === 'note' ? 'Backend progress' : 'Stage completed';
  const labels: Partial<Record<PipelineStage, Record<typeof phase, string>>> = {
    'source-extraction': { start: 'Source read started', note: 'Source reading progress', complete: 'Source proof hash ready' },
    'claim-extraction': { start: 'Main claim search started', note: 'Claim fields extracted', complete: 'Main claim checked' },
    'resolver-discovery': { start: 'Official source search started', note: 'Official source search running', complete: 'Official source candidate recorded' },
    'resolver-verification': { start: 'Official source fetch started', note: 'Official source checked', complete: 'Official source verified' },
    'market-comparison': { start: 'Duplicate search started', note: 'Similarity scan running', complete: 'Duplicate check recorded' },
    'market-drafting': { start: 'Market draft started', note: 'Alternatives staged', complete: 'Market draft accepted' },
    'critic-review': { start: 'Quality checks started', note: 'Quality checks running', complete: 'Quality decision recorded' },
    'circle-wallet': { start: 'Circle wallet check started', note: 'Wallet status fetched', complete: 'Wallet proof ready' },
    'arc-trace-commit': { start: 'Arc proof save started', note: 'Proof hashes staged', complete: 'Arc transaction returned' },
    'x402-publication': { start: 'Access publication started', note: 'Payment gateway staged', complete: 'Access metadata ready' },
  };

  return labels[stage]?.[phase] ?? fallback;
}

function liveOperationMetadataForStage(
  stage: PipelineStage,
  run: PipelineRun,
  artifact: unknown,
  phase: 'start' | 'note' | 'complete',
): Record<string, string> {
  const value = isRecord(artifact) ? artifact : {};

  if (stage === 'source-extraction') {
    return compactMetadata({
      input: stringValue(value.inputType) ?? (looksLikeUrl(run.sourceInput) ? 'url' : 'text'),
      status: phase === 'complete' ? 'extracted' : 'fetch/read',
      hash: shorten(stringValue(value.extractedTextHash)),
      domain: stringValue(value.domain) ?? run.extractedSource?.domain,
      title: stringValue(value.title),
    });
  }

  if (stage === 'claim-extraction') {
    const claim = isRecord(value.claim) ? value.claim : {};
    const source = isRecord(value.source) ? value.source : {};
    return compactMetadata({
      llm: phase === 'complete' ? 'schema valid' : 'strict JSON',
      language: stringValue(source.language) ?? run.ingestion?.language,
      actors: Array.isArray(claim.actors) ? String(claim.actors.length) : run.ingestion ? String(run.ingestion.entities.length) : undefined,
      event: stringValue(claim.eventType) ?? run.ingestion?.topic,
      deadline: stringValue(claim.deadline) ?? run.acceptedMarket?.deadline,
    });
  }

  if (stage === 'resolver-discovery') {
    const candidate = isRecord(value.candidate) ? value.candidate : undefined;
    const checkedCandidates = Array.isArray(value.checkedCandidates) ? value.checkedCandidates : undefined;
    return compactMetadata({
      status: stringValue(value.status),
      candidate: stringValue(candidate?.url),
      checked: checkedCandidates ? String(checkedCandidates.length) : undefined,
      reason: shorten(stringValue(value.reason), 36),
    });
  }

  if (stage === 'resolver-verification') {
    return compactMetadata({
      resolver: stringValue(value.name) ?? run.liveResolver?.name,
      url: stringValue(value.url) ?? run.liveResolver?.url,
      status: stringValue(value.verificationStatus) ?? run.liveResolver?.verificationStatus,
      evidence: shorten(stringValue(value.verificationEvidence) ?? run.liveResolver?.verificationEvidence, 36),
    });
  }

  if (stage === 'market-comparison') {
    const similarMarkets = Array.isArray(value.similarMarkets) ? value.similarMarkets : run.liveMarketComparison?.similarMarkets;
    return compactMetadata({
      search: stringValue(value.status) ?? run.liveMarketComparison?.status,
      similar: similarMarkets ? String(similarMarkets.length) : undefined,
      verdict: stringValue(value.noveltyVerdict) ?? run.liveMarketComparison?.noveltyVerdict,
    });
  }

  if (stage === 'market-drafting') {
    const candidates = Array.isArray(value.candidateMarkets) ? value.candidateMarkets.length : run.candidateMarkets.length;
    const rejected = Array.isArray(value.rejectedMarkets) ? value.rejectedMarkets.length : run.rejectedMarkets.length;
    return compactMetadata({
      candidates: String(candidates),
      rejected: String(rejected),
      accepted: run.acceptedMarket?.id ?? run.candidateMarkets[0]?.id,
    });
  }

  if (stage === 'critic-review') {
    const verdict = isRecord(value.criticVerdict) ? value.criticVerdict : run.criticReviews[0];
    const checks = isRecord(verdict?.checks) ? verdict.checks : undefined;
    const passCount = checks ? Object.values(checks).filter((status) => status === 'pass').length : undefined;
    return compactMetadata({
      verdict: stringValue(verdict?.decision),
      draft: stringValue(verdict?.draftId),
      checks: checks && passCount !== undefined ? `${passCount}/${Object.keys(checks).length} pass` : undefined,
    });
  }

  if (stage === 'circle-wallet') {
    return compactMetadata({
      status: stringValue(value.status) ?? run.circleAgentWallet?.status,
      wallet: stringValue(value.walletId) ?? run.circleAgentWallet?.walletId ?? undefined,
      address: shorten(stringValue(value.address) ?? run.circleAgentWallet?.address ?? undefined, 18),
      blockchain: stringValue(value.blockchain) ?? run.circleAgentWallet?.blockchain,
    });
  }

  if (stage === 'arc-trace-commit') {
    const trace = run.trace;
    return compactMetadata({
      artifact: shorten(stringValue(value.artifactHash) ?? trace?.artifactHash ?? trace?.traceHash),
      source: shorten(stringValue(value.sourceHash) ?? trace?.sourceHash),
      transaction: shorten(stringValue(value.transactionHash) ?? trace?.transactionId, 18),
      status: stringValue(value.status) ?? trace?.status,
    });
  }

  if (stage === 'x402-publication') {
    return compactMetadata({
      artifact: stringValue(value.artifactId) ?? run.x402?.artifactId,
      price: typeof value.priceUsdcMicro === 'number' ? `${value.priceUsdcMicro / 1_000_000} USDC` : run.x402?.priceUsdcMicro ? `${run.x402.priceUsdcMicro / 1_000_000} USDC` : undefined,
      gateway: stringValue(value.gatewayUrl) ?? run.x402?.gatewayUrl ?? undefined,
      facilitator: stringValue(value.facilitatorUrl) ?? run.x402?.facilitatorUrl ?? undefined,
      intelligence: stringValue(value.intelligenceUrl) ?? run.x402?.intelligenceUrl,
    });
  }

  return {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function shorten(value?: string, length = 14): string | undefined {
  if (!value) return undefined;
  if (value.length <= length) return value;
  return `${value.slice(0, length)}...`;
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

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function looksLikeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return false;

  try {
    const url = new URL(trimmed);
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
