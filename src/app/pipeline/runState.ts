import type { ActivityEvent, OperationEvent, PipelineRun, PipelineStep, PipelineStepStatus } from './types';

let activitySequence = 0;
let operationSequence = 0;

export function updateRun(run: PipelineRun, updates: Partial<PipelineRun>): PipelineRun {
  return {
    ...run,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
}

export function updateStep(run: PipelineRun, stepId: PipelineStep['id'], status: PipelineStepStatus): PipelineRun {
  return updateRun(run, {
    steps: run.steps.map((step) => (step.id === stepId ? { ...step, status } : step)),
  });
}

export function updateStepText(
  run: PipelineRun,
  stepId: PipelineStep['id'],
  updates: Partial<Pick<PipelineStep, 'reasoningSnippet' | 'outputSummary'>>,
): PipelineRun {
  return updateRun(run, {
    steps: run.steps.map((step) => (step.id === stepId ? { ...step, ...updates } : step)),
  });
}

export function hydrateStep(run: PipelineRun, sourceStep: PipelineStep): PipelineRun {
  return updateRun(run, {
    steps: run.steps.map((step) => (step.id === sourceStep.id ? { ...sourceStep, status: step.status } : step)),
  });
}

export function appendActivity(
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

export function appendOperation(
  run: PipelineRun,
  stepId: PipelineStep['id'],
  operation: Omit<OperationEvent, 'id' | 'timestamp' | 'simulated'> & { simulated?: boolean },
): PipelineRun {
  const nextOperation: OperationEvent = {
    id: `operation-${operationSequence += 1}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    simulated: operation.simulated ?? false,
    ...operation,
    metadata: compactMetadata(operation.metadata),
  };
  const currentOperations = run.stepOperations[stepId] ?? [];
  const settledOperations = settleOperationsBeforeAppend(currentOperations, nextOperation.status);

  return updateRun(run, {
    stepOperations: {
      ...run.stepOperations,
      [stepId]: [...settledOperations, nextOperation].slice(-8),
    },
  });
}

export function completeStepOperations(run: PipelineRun, stepId: PipelineStep['id']): PipelineRun {
  const currentOperations = run.stepOperations[stepId] ?? [];

  return updateRun(run, {
    stepOperations: {
      ...run.stepOperations,
      [stepId]: currentOperations.map((operation) => operation.status === 'failed' ? operation : { ...operation, status: 'complete' }),
    },
  });
}

export function failStepOperations(run: PipelineRun, stepId: PipelineStep['id']): PipelineRun {
  const currentOperations = run.stepOperations[stepId] ?? [];

  return updateRun(run, {
    stepOperations: {
      ...run.stepOperations,
      [stepId]: currentOperations.map((operation) => operation.status === 'complete' ? operation : { ...operation, status: 'failed' }),
    },
  });
}

export function compactMetadata(metadata?: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
      .map(([key, value]) => [key, value.length > 72 ? `${value.slice(0, 69)}...` : value]),
  );
}

function settleOperationsBeforeAppend(
  operations: OperationEvent[],
  nextStatus: OperationEvent['status'],
): OperationEvent[] {
  if (nextStatus === 'pending') return operations;

  return operations.map((operation) => {
    if (operation.status !== 'running') return operation;

    return {
      ...operation,
      status: nextStatus === 'failed' ? 'failed' : 'complete',
    };
  });
}
