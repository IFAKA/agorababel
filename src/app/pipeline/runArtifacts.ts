import type { AnalysisResult, PipelineStage } from './analysisSchema';
import { updateRun } from './runState';
import { canonicalStageOrder, clonePipelineSteps, stepIdForStage } from './stages';
import type {
  AcceptedMarket,
  ArcTrace,
  ContextAnalysis,
  MarketQuestion,
  PipelineRun,
  PipelineStep,
  SourceAnalysis,
} from './types';

export function createQueuedCanonicalSteps(): PipelineStep[] {
  return clonePipelineSteps(canonicalStageOrder);
}

export function applyStageArtifact(run: PipelineRun, stage: PipelineStage, artifact: unknown): PipelineRun {
  const value = isRecord(artifact) ? artifact : {};

  if (stage === 'source-extraction') {
    const url = stringValue(value.url) ?? '';
    const title = stringValue(value.title) ?? 'Submitted source';
    const domain = stringValue(value.domain) ?? (url ? new URL(url).hostname : 'Pasted source');
    const text = stringValue(value.text)
      ?? (stringValue(value.extractedTextHash) ? `Extracted text hash ${stringValue(value.extractedTextHash)?.slice(0, 12)}...` : 'Source extracted.');

    return updateRun(run, {
      extractedSource: {
        title,
        domain,
        url,
        text,
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
        languageConfidence: numberValue(source.languageConfidence) ?? 100,
        source: run.extractedSource?.domain ?? stringValue(source.domain) ?? stringValue(source.title) ?? 'Submitted source',
        sourceUrl: run.extractedSource?.url || stringValue(source.url),
        sourceDate: stringValue(source.publishedAt)?.slice(0, 10) ?? stringValue(source.sourceDate) ?? 'Unpublished or unavailable',
        entities: Array.isArray(claim.actors) ? claim.actors.map(String) : [],
        region: String(claim.region ?? 'Unknown'),
        topic: String(claim.eventType ?? 'Event'),
      },
      context: {
        englishSummary: String(claim.summary ?? 'Claim extracted.'),
        marketRelevance: stringValue(value.marketRelevance) as ContextAnalysis['marketRelevance'] ?? 'Medium',
        relevanceExplanation: stringValue(value.relevanceExplanation) ?? 'The main claim has the fields needed for a market. Question overlap checking is still pending.',
        evidenceSummary: stringValue(value.evidenceSummary) ?? evidence,
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
    const criticReviews = Array.isArray(value.criticReviews)
      ? value.criticReviews as PipelineRun['criticReviews']
      : criticVerdict ? [criticVerdict] : run.criticReviews;
    const acceptedMarket = isRecord(value.acceptedMarket)
      ? { ...toClientMarket(value.acceptedMarket as AnalysisResult['candidateMarkets'][number]), criticReasoning: criticVerdict?.reasoning ?? 'Critic verdict accepted.' }
      : undefined;

    return updateRun(run, {
      criticReviews,
      acceptedMarket,
    });
  }

  if (stage === 'circle-wallet') {
    return updateRun(run, { circleAgentWallet: value as PipelineRun['circleAgentWallet'] });
  }

  if (stage === 'arc-trace-commit') {
    return updateRun(run, { trace: toClientTraceFromArcTrace(value) });
  }

  if (stage === 'x402-publication') {
    return updateRun(run, { x402: value as PipelineRun['x402'] });
  }

  return run;
}

export function createRunFromAnalysis(run: PipelineRun, analysis: AnalysisResult, analyzedInMs: number): PipelineRun {
  const ingestion = createSourceAnalysis(analysis);
  const context = createContextAnalysis(analysis);
  const acceptedMarket: AcceptedMarket | undefined = analysis.acceptedMarket
    ? { ...toClientMarket(analysis.acceptedMarket), criticReasoning: analysis.criticVerdict.reasoning }
    : undefined;
  const trace = analysis.arcTrace ? toClientTraceFromArcTrace(analysis.arcTrace) : undefined;

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
    steps: createCompletedStepsFromAnalysis(analysis),
  });
}

export function createCompletedStepsFromAnalysis(analysis: AnalysisResult): PipelineStep[] {
  const failedStage = analysis.status === 'rejected' ? analysis.stage : null;
  const failedStepId = failedStage ? stepIdForStage(failedStage) : null;
  const failedIndex = failedStepId ? canonicalStageOrder.findIndex((step) => step.id === failedStepId) : -1;

  return canonicalStageOrder.map((step, index) => {
    const status = failedIndex === -1 ? 'complete' : index < failedIndex ? 'complete' : index === failedIndex ? 'failed' : 'pending';
    return {
      ...step,
      status,
      reasoningSnippet: outputForStage(analysis, step.stage, 'reasoning'),
      outputSummary: outputForStage(analysis, step.stage, 'summary'),
    };
  });
}

export function toClientTraceFromArcTrace(trace: unknown): ArcTrace {
  const value = isRecord(trace) ? trace : {};
  const transactionId = stringValue(value.transactionHash) ?? stringValue(value.transactionId) ?? 'pending';
  const artifactHash = stringValue(value.artifactHash) ?? stringValue(value.traceHash) ?? 'pending';

  return {
    traceHash: artifactHash,
    transactionId,
    network: typeof value.chainId === 'number' && stringValue(value.network) ? `${value.network} (${value.chainId})` : stringValue(value.network) ?? 'Unknown network',
    status: value.status === 'committed' || value.status === 'failed' || value.status === 'simulated' || value.status === 'pending' ? value.status : 'pending',
    timestamp: stringValue(value.committedAt) ?? stringValue(value.timestamp) ?? new Date().toISOString(),
    explorerUrl: stringValue(value.explorerUrl),
    artifactHash,
    sourceHash: stringValue(value.sourceHash),
    chainId: typeof value.chainId === 'number' ? value.chainId : undefined,
  };
}

export function toClientMarket(market: AnalysisResult['candidateMarkets'][number] | MarketQuestion): MarketQuestion {
  return {
    ...market,
    resolutionSource: 'resolutionSource' in market && market.resolutionSource
      ? market.resolutionSource
      : `${market.resolverName} (${market.resolverUrl})`,
  };
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
        ? `Question overlap check: ${analysis.marketComparison?.noveltyVerdict === 'new-opportunity' ? 'no overlapping question found' : analysis.marketComparison?.noveltyVerdict ?? 'not checked'}.`
        : analysis.marketComparison?.reasoning ?? 'Question overlap check did not run.';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
