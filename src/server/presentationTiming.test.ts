import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countWords,
  getCompactOperationDwellMs,
  getCompactOperationReadableText,
  getOneStepPresentationTarget,
  getOperationDwellMs,
  getOperationReadableText,
  MAX_OPERATION_DWELL_MS,
  MIN_OPERATION_DWELL_MS,
  type PresentedStepState,
} from '../app/pipeline/presentationTiming.ts';
import type { PipelineRun, PipelineStep } from '../app/pipeline/types.ts';

test('operation readable text includes visible row content and metadata only', () => {
  const readableText = getOperationReadableText({
    label: 'Resolver fetch',
    status: 'running',
    detail: 'Checking official host response.',
    metadata: {
      url: 'https://example.gov',
      responseCode: '200',
      mode: 'simulated',
    },
  });

  assert.match(readableText, /Resolver fetch/);
  assert.match(readableText, /running/);
  assert.match(readableText, /Checking official host response/);
  assert.match(readableText, /response Code 200/);
  assert.doesNotMatch(readableText, /simulated/);
});

test('compact operation readable text matches collapsed substep rows', () => {
  const readableText = getCompactOperationReadableText({
    label: 'Resolver fetch',
    status: 'running',
    metadata: {
      url: 'https://example.gov',
      responseCode: '200',
      latency: '340ms',
      mode: 'simulated',
    },
  });

  assert.match(readableText, /Resolver fetch/);
  assert.match(readableText, /Running/);
  assert.match(readableText, /url https:\/\/example.gov/);
  assert.match(readableText, /response Code 200/);
  assert.doesNotMatch(readableText, /latency/);
  assert.doesNotMatch(readableText, /simulated/);
});

test('compact operation dwell is based on collapsed substep row text', () => {
  assert.equal(
    getCompactOperationDwellMs({
      label: '',
      status: 'complete',
      metadata: {},
    }),
    MIN_OPERATION_DWELL_MS,
  );

  assert.equal(
    getCompactOperationDwellMs({
      label: 'Long compact row',
      status: 'complete',
      metadata: {
        first: Array.from({ length: 50 }, (_, index) => `word${index}`).join(' '),
        second: Array.from({ length: 50 }, (_, index) => `chip${index}`).join(' '),
      },
    }),
    MAX_OPERATION_DWELL_MS,
  );
});

test('word counting and operation dwell clamp to readable bounds', () => {
  assert.equal(countWords('  one two\nthree  '), 3);

  assert.equal(
    getOperationDwellMs({
      label: '',
      status: 'complete',
      detail: '',
      metadata: {},
    }),
    MIN_OPERATION_DWELL_MS,
  );

  assert.equal(
    getOperationDwellMs({
      label: 'Long operation',
      status: 'complete',
      detail: Array.from({ length: 80 }, (_, index) => `word${index}`).join(' '),
      metadata: {},
    }),
    MAX_OPERATION_DWELL_MS,
  );
});

test('presentation target advances one completed step at a time', () => {
  const run = createMinimalRun();
  run.steps = run.steps.map((step) => ({ ...step, status: 'complete' }));

  const current: PresentedStepState = { index: 0, status: 'complete', since: Date.now() };
  const target = { index: 4, status: 'complete' as const };

  assert.deepEqual(getOneStepPresentationTarget(run, current, target), {
    index: 1,
    status: 'complete',
  });
});

function createMinimalRun(): PipelineRun {
  const now = new Date().toISOString();

  return {
    id: 'run-test',
    status: 'running',
    submission: {
      id: 'submission-test',
      sourceText: 'sample source',
      submittedAt: now,
    },
    sourceInput: 'sample source',
    candidateMarkets: [],
    criticReviews: [],
    rejectedMarkets: [],
    steps: ['extraction', 'claim', 'resolver', 'comparison', 'market-creator'].map((id) => createStep(id as PipelineStep['id'])),
    activityFeed: [],
    stepOperations: {},
    createdAt: now,
    updatedAt: now,
  };
}

function createStep(id: PipelineStep['id']): PipelineStep {
  return {
    id,
    title: id,
    agentName: id,
    action: `${id} action`,
    reasoningSnippet: `${id} reasoning`,
    outputSummary: `${id} output`,
    status: 'pending',
    stage: 'source-extraction',
  };
}
