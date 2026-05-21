import type { OperationEvent, PipelineRun, PipelineStep, PipelineStepStatus } from './types';

export const READING_WORDS_PER_MINUTE = 150;
export const CONTENT_REVEAL_BUFFER_MS = 900;
export const MIN_OPERATION_DWELL_MS = 1800;
export const MAX_OPERATION_DWELL_MS = 6200;
export const MIN_COMPLETED_STEP_DWELL_MS = 3600;
export const MAX_COMPLETED_STEP_DWELL_MS = 8200;

export type PresentedStepState = {
  index: number;
  status: PipelineStepStatus;
  since: number;
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
  });
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
