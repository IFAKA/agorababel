import type { OperationEvent, PipelineRun, PipelineStep, PipelineStepStatus } from './types';

export const READING_WORDS_PER_MINUTE = 150;
export const CONTENT_REVEAL_BUFFER_MS = 900;
export const STEP_COMPREHENSION_BUFFER_MS = 1600;
export const MIN_OPERATION_DWELL_MS = 1800;
export const MAX_OPERATION_DWELL_MS = 6200;
export const MIN_COMPLETED_STEP_DWELL_MS = 5600;
export const MAX_COMPLETED_STEP_DWELL_MS = 11600;

export type PresentedStepState = {
  index: number;
  status: PipelineStepStatus;
  since: number;
};

export type StepBriefing = {
  happened: string;
  why: string;
  next: string;
};

const stepBriefings: Record<PipelineStep['id'], StepBriefing> = {
  extraction: {
    happened: 'The source is now readable input.',
    why: 'The pipeline can reason over source material instead of an unstructured submission.',
    next: 'Metadata extraction can identify language, source, actors, region, and event type.',
  },
  ingestion: {
    happened: 'The source is normalized into structured metadata.',
    why: 'The workflow now has consistent fields to compare, cite, and validate.',
    next: 'Translation and context can focus on market relevance instead of source cleanup.',
  },
  context: {
    happened: 'The source is translated and summarized for market use.',
    why: 'Local reporting is converted into evidence the rest of the workflow can inspect.',
    next: 'Claim extraction can isolate the official event, actors, evidence, and deadline.',
  },
  claim: {
    happened: 'The forecastable claim is separated from background context.',
    why: 'The market can be framed around an official action rather than a vague news theme.',
    next: 'The workflow can look for an official source that can prove the outcome.',
  },
  resolver: {
    happened: 'The market now has an official settlement source.',
    why: 'A prediction market needs a source that can decide the outcome without judgment calls.',
    next: 'The draft can be checked against existing markets before a new one is created.',
  },
  comparison: {
    happened: 'Existing market sources were checked for overlap.',
    why: 'The workflow avoids publishing redundant markets when a close match already exists.',
    next: 'A candidate market can be drafted only if the opportunity is still distinct.',
  },
  'market-creator': {
    happened: 'A YES/NO market draft was written.',
    why: 'The artifact now has criteria, a deadline, and a resolution source that reviewers can inspect.',
    next: 'The quality check can reject weak drafts before anything is published.',
  },
  critic: {
    happened: 'Weak drafts were rejected before publication.',
    why: 'Only candidates with clear wording, evidence, deadlines, and resolvable outcomes continue.',
    next: 'The accepted market can move into wallet and proof preparation.',
  },
  circle: {
    happened: 'The publication wallet status was checked.',
    why: 'Trace publication needs a configured account before a proof record can be prepared.',
    next: 'The accepted artifact can be packaged with trace metadata.',
  },
  settlement: {
    happened: 'The accepted artifact now has a traceable proof record.',
    why: 'The market package can be audited against the structured source, criteria, and hash record.',
    next: 'Access details can be published for review.',
  },
  x402: {
    happened: 'The final access details were prepared.',
    why: 'The final artifact can distinguish analysis output from paid or disabled access paths.',
    next: 'The completed market artifact can be opened, copied, or reviewed.',
  },
};

export function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function formatOperationMetadataKey(value: string): string {
  return value.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').trim();
}

export function formatOperationStatusLabel(status: OperationEvent['status']): string {
  if (status === 'complete') return 'Checked';
  if (status === 'running') return 'Running';
  if (status === 'failed') return 'Failed';
  if (status === 'info') return 'Logged';
  return 'Queued';
}

export function getOperationReadableText(operation: Pick<OperationEvent, 'label' | 'status' | 'detail' | 'metadata'>): string {
  return [
    operation.label,
    operation.status,
    operation.detail,
    ...Object.entries(operation.metadata ?? {})
      .filter(([key]) => key !== 'mode')
      .map(([key, value]) => `${formatOperationMetadataKey(key)} ${value}`),
  ]
    .filter(Boolean)
    .join(' ');
}

export function getOperationsReadableText(operations: Pick<OperationEvent, 'label' | 'status' | 'detail' | 'metadata'>[]): string {
  return operations.map((operation) => getOperationReadableText(operation)).join(' ');
}

export function getCompactOperationReadableText(operation: Pick<OperationEvent, 'label' | 'status' | 'metadata'>): string {
  return [
    operation.label,
    formatOperationStatusLabel(operation.status),
    ...Object.entries(operation.metadata ?? {})
      .filter(([key]) => key !== 'mode')
      .slice(0, 2)
      .map(([key, value]) => `${formatOperationMetadataKey(key)} ${value}`),
  ]
    .filter(Boolean)
    .join(' ');
}

export function getCompactOperationsReadableText(operations: Pick<OperationEvent, 'label' | 'status' | 'metadata'>[]): string {
  return operations.map((operation) => getCompactOperationReadableText(operation)).join(' ');
}

export function getReadableDwellMs(
  readableText: string,
  {
    minMs,
    maxMs,
    wordsPerMinute = READING_WORDS_PER_MINUTE,
    bufferMs = CONTENT_REVEAL_BUFFER_MS,
  }: {
    minMs: number;
    maxMs: number;
    wordsPerMinute?: number;
    bufferMs?: number;
  },
): number {
  const wordCount = countWords(readableText);
  const readingMs = (wordCount / wordsPerMinute) * 60_000;

  return clamp(Math.round(readingMs + bufferMs), minMs, maxMs);
}

export function getOperationDwellMs(operation: Pick<OperationEvent, 'label' | 'status' | 'detail' | 'metadata'>): number {
  return getReadableDwellMs(getOperationReadableText(operation), {
    minMs: MIN_OPERATION_DWELL_MS,
    maxMs: MAX_OPERATION_DWELL_MS,
  });
}

export function getCompactOperationDwellMs(operation: Pick<OperationEvent, 'label' | 'status' | 'metadata'>): number {
  return getReadableDwellMs(getCompactOperationReadableText(operation), {
    minMs: MIN_OPERATION_DWELL_MS,
    maxMs: MAX_OPERATION_DWELL_MS,
  });
}

export function getStepDwellMs(readableText: string): number {
  return getReadableDwellMs(readableText, {
    minMs: MIN_COMPLETED_STEP_DWELL_MS,
    maxMs: MAX_COMPLETED_STEP_DWELL_MS,
    wordsPerMinute: 540,
    bufferMs: STEP_COMPREHENSION_BUFFER_MS,
  });
}

export function getStepBriefing(step: PipelineStep): StepBriefing {
  return stepBriefings[step.id];
}

export function getCompletedStepDwellMs(run: PipelineRun, step?: PipelineStep): number {
  return getStepDwellMs(getStepPresentationText(run, step));
}

export function getStepPresentationText(run: PipelineRun, step?: PipelineStep): string {
  if (!step) return '';

  const briefing = getStepBriefing(step);
  const operationText = getCompactOperationsReadableText(run.stepOperations[step.id] ?? []);
  const baseText = [
    step.title,
    step.action,
    step.reasoningSnippet,
    step.outputSummary,
    briefing.happened,
    briefing.why,
    briefing.next,
    operationText,
  ];

  switch (step.id) {
    case 'extraction':
      return normalizeReadableText([
        ...baseText,
        run.extractedSource?.title,
        run.extractedSource?.domain,
        looksLikeUrl(run.sourceInput) ? 'Readable URL' : 'Pasted source text',
        run.extractedSource ? 'Article text extracted' : step.outputSummary,
        getSourceExcerpt(run),
      ]);
    case 'ingestion':
      return normalizeReadableText([
        ...baseText,
        run.ingestion?.signalName,
        run.ingestion?.language,
        run.ingestion?.source,
        run.ingestion?.topic,
        run.ingestion?.region,
        run.ingestion?.sourceDate,
        run.ingestion?.entities.join(' '),
      ]);
    case 'context':
      return normalizeReadableText([
        ...baseText,
        run.context?.englishSummary,
        run.context?.marketRelevance,
        run.context?.relevanceExplanation,
        run.context?.evidenceSummary,
      ]);
    case 'claim':
      return normalizeReadableText([
        ...baseText,
        run.ingestion?.signalName,
        run.ingestion?.region,
        run.ingestion?.topic,
        run.ingestion?.entities.join(' '),
        run.context?.relevanceExplanation,
        run.context?.evidenceSummary,
      ]);
    case 'resolver':
      return normalizeReadableText([
        ...baseText,
        run.liveResolver?.name,
        run.liveResolver?.url,
        run.liveResolver?.verificationStatus,
        run.liveResolver?.verificationEvidence,
        run.analysis?.resolver?.name,
        run.analysis?.resolver?.url,
        run.analysis?.resolver?.verificationEvidence,
        run.resolverDiscovery?.reason,
      ]);
    case 'comparison':
      return normalizeReadableText([
        ...baseText,
        run.liveMarketComparison?.status,
        run.liveMarketComparison?.noveltyVerdict,
        run.liveMarketComparison?.reasoning,
        run.liveMarketComparison?.similarMarkets.map((market) => `${market.title} ${market.similarity}`).join(' '),
        run.analysis?.marketComparison?.reasoning,
      ]);
    case 'market-creator':
      return normalizeReadableText([
        ...baseText,
        ...run.candidateMarkets.flatMap((market) => [
          market.question,
          market.evidenceSummary,
          market.yesCriteria,
          market.noCriteria,
          market.deadline,
          market.resolutionSource,
        ]),
        ...run.rejectedMarkets.flatMap((review) => [review.question, review.reasonRejected, review.violatedRule]),
      ]);
    case 'critic':
      return normalizeReadableText([
        ...baseText,
        ...run.candidateMarkets.flatMap((draft) => {
          const review = run.criticReviews.find((item) => item.draftId === draft.id);

          return [
            draft.question,
            review?.decision,
            review?.violatedRule,
            review?.reasoning,
            review ? Object.entries(review.checks).map(([label, status]) => `${label} ${status}`).join(' ') : '',
          ];
        }),
      ]);
    case 'circle':
      return normalizeReadableText([
        ...baseText,
        run.circleAgentWallet?.status,
        run.circleAgentWallet?.walletId,
        run.circleAgentWallet?.address,
        run.circleAgentWallet?.blockchain,
      ]);
    case 'settlement':
    case 'x402':
      return normalizeReadableText([
        ...baseText,
        run.acceptedMarket?.question,
        run.acceptedMarket?.yesCriteria,
        run.acceptedMarket?.noCriteria,
        run.acceptedMarket?.deadline,
        run.acceptedMarket?.resolutionSource,
        run.acceptedMarket?.evidenceSummary,
        run.trace?.status,
        run.trace?.network,
        run.x402?.status,
        run.x402?.intelligenceUrl,
      ]);
    default:
      return normalizeReadableText(baseText);
  }
}

function normalizeReadableText(values: Array<string | undefined | null | false>): string {
  return values
    .filter(Boolean)
    .map((value) => String(value).replace(/[a-f0-9]{32,}/gi, '[hash]').trim())
    .filter(Boolean)
    .join(' ');
}

function getSourceExcerpt(run: PipelineRun): string {
  const text = run.extractedSource?.text ?? run.sourceInput;
  const normalizedText = text.trim().replace(/\s+/g, ' ');

  if (!normalizedText || looksLikeUrl(normalizedText)) return '';
  return normalizedText.length > 230 ? `${normalizedText.slice(0, 227)}...` : normalizedText;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

export function getOneStepPresentationTarget(
  run: PipelineRun,
  current: PresentedStepState,
  target: Pick<PresentedStepState, 'index' | 'status'>,
): Pick<PresentedStepState, 'index' | 'status'> {
  if (target.index <= current.index) return target;

  const nextIndex = Math.min(current.index + 1, target.index);
  const nextStep = run.steps[nextIndex];

  if (!nextStep) return target;
  if (nextIndex === target.index) return target;
  if (nextStep.status === 'pending') return { index: nextIndex, status: 'running' };

  return { index: nextIndex, status: nextStep.status };
}
