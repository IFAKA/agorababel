import { AnalysisResultSchema, type AnalysisResult } from './analysisSchema';
import { createPendingPipelineRun, createSubmission } from './simulatedProvider';
import type {
  AcceptedMarket,
  ActivityEvent,
  ArcTrace,
  ContextAnalysis,
  CriticVerdict,
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

export class ApiPipelineProvider implements PipelineProvider {
  async *run(input: PipelineInput): AsyncGenerator<PipelineRunUpdate> {
    const startedAt = performance.now();
    const submission = createSubmission(input.sourceText);
    let run = createPendingPipelineRun(submission.sourceText, submission);

    run = updateRun(run, { status: 'running' });
    run = appendActivity(run, 'Source Analysis', 'running', 'Run started from submitted source.', 'The API will validate the source before any market artifact is shown.');
    yield { type: 'run-started', run };

    try {
      const extractionStep = createExtractionStep(submission.sourceText);
      run = hydrateStep(run, extractionStep);
      run = updateStep(run, 'extraction', 'running');
      run = appendActivity(run, extractionStep.agentName, 'running', extractionStep.action, extractionStep.reasoningSnippet);
      const extractionStartedAt = performance.now();
      yield { type: 'step-started', run, step: run.steps.find((item) => item.id === 'extraction')! };

      let analysis: AnalysisResult;
      try {
        analysis = await analyzeSource(submission.sourceText);
      } catch (error) {
        await paceStage(extractionStartedAt);
        const brief = createPipelineErrorBrief(error, 'extraction', submission.sourceText);
        run = updateStep(run, 'extraction', 'failed');
        run = updateRun(run, { status: 'failed', error: brief.message, errorBrief: brief, analyzedInMs: elapsedMs(startedAt) });
        run = appendActivity(run, extractionStep.agentName, 'failed', brief.message, brief.likelyCause);
        yield { type: 'step-completed', run, step: run.steps.find((item) => item.id === 'extraction')! };
        yield { type: 'run-failed', run, error: brief.message };
        return;
      }

      const resolvedRun = createRunFromAnalysis(run, analysis);
      await paceStage(extractionStartedAt);
      run = hydrateStep(run, resolvedRun.steps.find((step) => step.id === 'extraction')!);
      run = revealStepArtifacts(run, resolvedRun, 'extraction');
      run = updateStep(run, 'extraction', 'complete');
      run = appendActivity(run, extractionStep.agentName, 'complete', resolvedRun.steps.find((step) => step.id === 'extraction')!.outputSummary, resolvedRun.steps.find((step) => step.id === 'extraction')!.reasoningSnippet);
      yield { type: 'step-completed', run, step: run.steps.find((item) => item.id === 'extraction')! };

      for (const step of resolvedRun.steps.filter((item) => item.id !== 'extraction' && item.id !== 'settlement')) {
        run = hydrateStep(run, step);
        run = updateStep(run, step.id, step.status === 'failed' ? 'failed' : 'running');
        run = appendActivity(run, step.agentName, run.steps.find((item) => item.id === step.id)!.status, step.action, step.reasoningSnippet);
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

      if (!resolvedRun.acceptedMarket) {
        const message = analysis.rejectionReason ?? 'The input was rejected because no deadlineable public event could be validated.';
        const brief = createRejectionBrief(message, analysis.criticVerdict.reasoning, submission.sourceText);
        run = updateRun(run, { status: 'failed', error: message, errorBrief: brief, analyzedInMs: elapsedMs(startedAt) });
        run = appendActivity(run, 'Validation Review', 'rejected', message, analysis.criticVerdict.reasoning);
        yield { type: 'run-failed', run, error: message };
        return;
      }

      const settlementStep = resolvedRun.steps.find((step) => step.id === 'settlement')!;
      run = hydrateStep(run, settlementStep);
      run = updateStep(run, 'settlement', 'running');
      run = appendActivity(run, settlementStep.agentName, 'running', settlementStep.action, settlementStep.reasoningSnippet);
      const traceStartedAt = performance.now();
      yield { type: 'step-started', run, step: run.steps.find((item) => item.id === 'settlement')! };

      const trace = await createLocalTrace(analysis);
      await paceStage(traceStartedAt);
      run = updateStep(run, 'settlement', 'complete');
      run = updateRun(run, { status: 'trace-committed', trace, analyzedInMs: elapsedMs(startedAt) });
      run = appendActivity(run, 'Audit Trace', 'committed', 'Trace hash generated from structured analysis outputs.', 'Local audit trace prepared for Arc testnet commit.');
      yield { type: 'step-completed', run, step: run.steps.find((item) => item.id === 'settlement')! };
      yield { type: 'trace-committed', run, trace };

      run = updateRun(run, { status: 'complete', analyzedInMs: elapsedMs(startedAt) });
      run = appendActivity(run, 'Artifact Generation', 'accepted', 'Validated market artifact is ready.', resolvedRun.acceptedMarket.criticReasoning);
      yield { type: 'run-completed', run };
    } catch (error) {
      const brief = createPipelineErrorBrief(error, 'orchestrator', submission.sourceText);
      run = updateRun(run, { status: 'failed', error: brief.message, errorBrief: brief, analyzedInMs: elapsedMs(startedAt) });
      run = appendActivity(run, 'Source Analysis', 'failed', brief.message, brief.likelyCause);
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
      ['Run pnpm dev from the repository root and retry the request.', 'Check the browser console and terminal output for network or server startup errors.'],
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const errorPayload = parseErrorPayload(payload);
    throw new AnalysisRequestError(
      errorPayload.message,
      response.status,
      errorPayload.stage,
      errorPayload.likelyCause,
      errorPayload.details,
    );
  }

  const parsed = AnalysisResultSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AnalysisRequestError(
      'The API returned an invalid analysis payload.',
      response.status,
      'response-validation',
      'The backend response did not match AnalysisResultSchema.',
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`),
    );
  }

  return parsed.data;
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

function createPipelineErrorBrief(error: unknown, stage: PipelineErrorBrief['stage'], sourceText: string): PipelineErrorBrief {
  const requestError = error instanceof AnalysisRequestError ? error : undefined;
  const message = error instanceof Error ? error.message : 'Pipeline failed.';
  const sourceKind = looksLikeUrl(sourceText) ? 'URL' : 'pasted text';
  const sourcePreview = sourceText.trim().slice(0, 500);
  const likelyCause = requestError?.likelyCause ?? 'An unexpected pipeline exception stopped the run before a validated market artifact was produced.';
  const details = requestError?.details ?? [];

  return {
    title: 'AgoraBabel pipeline failure',
    stage,
    statusCode: requestError?.statusCode,
    message,
    likelyCause,
    debuggingContext: [
      `Stage: ${stage}`,
      requestError?.stage ? `Backend stage: ${requestError.stage}` : 'Backend stage: unavailable',
      requestError?.statusCode ? `HTTP status: ${requestError.statusCode}` : 'HTTP status: unavailable',
      `Source type: ${sourceKind}`,
      `Source length: ${sourceText.trim().length} characters`,
      `Source preview: ${sourcePreview || '[empty]'}`,
      ...details,
    ],
    agentPrompt: [
      'Fix this AgoraBabel SaaS failure.',
      `Failure stage: ${stage}.`,
      requestError?.stage ? `Backend stage: ${requestError.stage}.` : 'Backend stage was not available.',
      requestError?.statusCode ? `HTTP status: ${requestError.statusCode}.` : 'HTTP status was not available.',
      `Error message: ${message}`,
      `Likely cause: ${likelyCause}`,
      'Relevant files to inspect first: src/server/analyze.ts, src/app/pipeline/apiProvider.ts, src/app/pipeline/analysisSchema.ts, and src/app/components/ProcessingScreen.tsx.',
      'Keep the fix focused, preserve the existing Vite React pipeline flow, then run pnpm build.',
    ].join('\n'),
  };
}

function createRejectionBrief(message: string, criticReasoning: string, sourceText: string): PipelineErrorBrief {
  return {
    title: 'AgoraBabel market rejection',
    stage: 'critic',
    message,
    likelyCause: 'The source was processed successfully, but the critic did not find a public, objective, deadlineable YES/NO market.',
    debuggingContext: [
      'Stage: critic',
      'HTTP status: 200',
      `Source length: ${sourceText.trim().length} characters`,
      `Critic reasoning: ${criticReasoning}`,
    ],
    agentPrompt: [
      'Improve AgoraBabel market acceptance or explain why this input should remain rejected.',
      `Rejection reason: ${message}`,
      `Critic reasoning: ${criticReasoning}`,
      'Inspect src/server/analyze.ts local heuristics and src/app/pipeline/analysisSchema.ts validation rules.',
      'Only loosen acceptance if the source supports an objective, public, time-bounded YES/NO market.',
    ].join('\n'),
  };
}

function createRunFromAnalysis(run: PipelineRun, analysis: AnalysisResult): PipelineRun {
  const ingestion = createSourceAnalysis(analysis);
  const context = createContextAnalysis(analysis);
  const acceptedMarket: AcceptedMarket | undefined = analysis.acceptedMarket
    ? { ...analysis.acceptedMarket, criticReasoning: analysis.criticVerdict.reasoning }
    : undefined;

  return updateRun(run, {
    extractedSource: analysis.extractedSource ?? undefined,
    ingestion,
    context,
    candidateMarkets: analysis.candidateMarkets,
    criticReviews: createCriticReviews(analysis),
    rejectedMarkets: analysis.rejectedMarkets,
    acceptedMarket,
    steps: createPipelineSteps(analysis, ingestion, context, Boolean(acceptedMarket)),
  });
}

function createCriticReviews(analysis: AnalysisResult): CriticVerdict[] {
  return analysis.candidateMarkets.map((candidate) => {
    if (analysis.criticVerdict.draftId === candidate.id) {
      return {
        ...analysis.criticVerdict,
        draftId: candidate.id,
      };
    }

    return {
      draftId: candidate.id,
      decision: 'rejected',
      checks: {
        ambiguity: 'fail',
        resolvability: candidate.resolutionSource.toLowerCase().includes('official') ? 'pass' : 'fail',
        deadline: candidate.deadline ? 'pass' : 'fail',
        evidence: 'fail',
        resolutionSource: candidate.resolutionSource.toLowerCase().includes('official') ? 'pass' : 'fail',
      },
      reasoning: analysis.rejectedMarkets.find((item) => item.draftId === candidate.id)?.reasonRejected
        ?? candidate.evidenceSummary
        ?? 'Rejected because the candidate did not pass the critic guardrails.',
      violatedRule: analysis.rejectedMarkets.find((item) => item.draftId === candidate.id)?.violatedRule ?? 'ambiguity',
    };
  });
}

function createSourceAnalysis(analysis: AnalysisResult): SourceAnalysis {
  return {
    signalName: analysis.acceptedMarket?.question ?? analysis.eventSummary,
    language: normalizeLanguageLabel(analysis.detectedLanguage),
    languageConfidence: 100,
    source: analysis.sourceType.replace(/_/g, ' '),
    sourceUrl: analysis.extractedSource?.url,
    sourceDate: new Date().toISOString().slice(0, 10),
    entities: analysis.entities,
    region: analysis.region,
    topic: analysis.eventSummary,
  };
}

function normalizeLanguageLabel(value: string) {
  const lower = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    ar: 'Arabic',
    de: 'German',
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    hi: 'Hindi',
    id: 'Indonesian',
    it: 'Italian',
    ja: 'Japanese',
    ko: 'Korean',
    pt: 'Portuguese',
    ru: 'Russian',
    tr: 'Turkish',
    zh: 'Chinese',
  };

  if (aliases[lower]) return aliases[lower];
  if (/^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(value.trim())) {
    try {
      return new Intl.DisplayNames(['en'], { type: 'language' }).of(lower) ?? value.toUpperCase();
    } catch {
      return value.toUpperCase();
    }
  }

  return value;
}

function createContextAnalysis(analysis: AnalysisResult): ContextAnalysis {
  return {
    englishSummary: analysis.eventSummary,
    marketRelevance: analysis.marketRelevance.level,
    relevanceExplanation: analysis.marketRelevance.explanation,
    evidenceSummary: analysis.acceptedMarket?.evidenceSummary ?? analysis.rejectionReason ?? analysis.criticVerdict.reasoning,
  };
}

function createPipelineSteps(
  analysis: AnalysisResult,
  ingestion: SourceAnalysis,
  context: ContextAnalysis,
  accepted: boolean,
): PipelineStep[] {
  const criticStatus: PipelineStepStatus = accepted ? 'complete' : 'failed';

  return [
    createStep('extraction', 'Source Extraction', 'Source Extraction', analysis.extractedSource ? 'Extract readable article text with the URL reader.' : 'Prepare pasted source text for analysis.', analysis.extractedSource ? `${analysis.extractedSource.title} from ${analysis.extractedSource.domain}.` : 'Raw pasted text accepted for analysis.', analysis.extractedSource ? `Extracted readable article text from ${analysis.extractedSource.domain}.` : 'Prepared pasted source text.', 'complete'),
    createStep('ingestion', 'Source Metadata', 'Source Metadata', analysis.extractedSource ? 'Extract readable article text, then parse language, entities, and region.' : 'Parse language, source type, entities, and region.', `${ingestion.language} input with ${ingestion.entities.length} extracted entities.`, `${analysis.extractedSource ? `${analysis.extractedSource.title} / ${analysis.extractedSource.domain}` : ingestion.source}; region ${ingestion.region}.`, 'complete'),
    createStep('context', 'Translation & Context', 'Translation & Context', 'Identify whether the source describes a deadlineable public event.', context.relevanceExplanation, context.englishSummary, 'complete'),
    createStep('market-creator', 'Market Drafting', 'Market Drafting', 'Draft objective, binary market candidates only when the source supports them.', `${analysis.candidateMarkets.length} candidate market${analysis.candidateMarkets.length === 1 ? '' : 's'} returned by the validated schema.`, analysis.candidateMarkets[0]?.question ?? 'No market candidate survived source validation.', 'complete'),
    createStep('critic', 'Validation Review', 'Validation Review', 'Reject weak candidates and approve only clear, public-resolution markets.', analysis.criticVerdict.reasoning, accepted ? 'One market accepted.' : analysis.rejectionReason ?? 'No accepted market.', criticStatus),
    createStep('settlement', 'Trace Commit', 'Audit Trace', 'Package the accepted market with a local trace hash.', 'Prepared for Arc testnet commit.', accepted ? 'Trace hash generated from structured analysis outputs.' : 'Skipped because no market was accepted.', accepted ? 'complete' : 'pending'),
  ];
}

function createExtractionStep(sourceText: string): PipelineStep {
  const isUrl = looksLikeUrl(sourceText);

  return createStep(
    'extraction',
    'Source Extraction',
    'Source Extraction',
    isUrl ? 'Extract readable article text from the submitted URL.' : 'Prepare pasted source text for analysis.',
    isUrl ? 'Extracting article...' : 'Using the pasted source directly.',
    isUrl ? 'Article extraction pending.' : 'Pasted source prepared.',
    'pending',
  );
}

function createStep(
  id: PipelineStep['id'],
  title: string,
  agentName: string,
  action: string,
  reasoningSnippet: string,
  outputSummary: string,
  status: PipelineStepStatus,
): PipelineStep {
  return {
    id,
    title,
    agentName,
    action,
    reasoningSnippet,
    outputSummary,
    status,
  };
}

function hydrateStep(run: PipelineRun, sourceStep: PipelineStep): PipelineRun {
  return updateRun(run, {
    steps: run.steps.map((step) => (step.id === sourceStep.id ? { ...sourceStep, status: step.status } : step)),
  });
}

function revealStepArtifacts(run: PipelineRun, resolvedRun: PipelineRun, stepId: PipelineStep['id']): PipelineRun {
  if (stepId === 'extraction') {
    return updateRun(run, { extractedSource: resolvedRun.extractedSource });
  }

  if (stepId === 'ingestion') {
    return updateRun(run, { ingestion: resolvedRun.ingestion });
  }

  if (stepId === 'context') {
    return updateRun(run, { context: resolvedRun.context });
  }

  if (stepId === 'market-creator') {
    return updateRun(run, { candidateMarkets: resolvedRun.candidateMarkets });
  }

  if (stepId === 'critic') {
    return updateRun(run, {
      criticReviews: resolvedRun.criticReviews,
      acceptedMarket: resolvedRun.acceptedMarket,
    });
  }

  return run;
}

async function createLocalTrace(analysis: AnalysisResult): Promise<ArcTrace> {
  const traceHash = await sha256Hex(canonicalJson(analysis));

  return {
    traceHash: `sha256:${traceHash}`,
    transactionId: 'Prepared for Arc testnet commit',
    network: 'Local trace hash',
    status: 'pending',
    timestamp: new Date().toISOString(),
  };
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
