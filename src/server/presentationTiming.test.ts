import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countWords,
  getCompactOperationDwellMs,
  getCompactOperationReadableText,
  getCompletedStepDwellMs,
  getOneStepPresentationTarget,
  getOperationDwellMs,
  getOperationReadableText,
  getStepPresentationText,
  MAX_COMPLETED_STEP_DWELL_MS,
  MAX_OPERATION_DWELL_MS,
  MIN_COMPLETED_STEP_DWELL_MS,
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

test('short completed step text clamps to minimum dwell', () => {
  const run = createMinimalRun();
  const step = run.steps[0];

  step.title = '';
  step.action = '';
  step.reasoningSnippet = '';
  step.outputSummary = '';

  assert.equal(getCompletedStepDwellMs(run, step), MIN_COMPLETED_STEP_DWELL_MS);
});

test('long completed step text clamps to maximum dwell', () => {
  const run = createMinimalRun();
  const step = run.steps.find((item) => item.id === 'market-creator');
  assert.ok(step);

  run.candidateMarkets = [
    {
      id: 'draft-long',
      question: Array.from({ length: 120 }, (_, index) => `question${index}`).join(' '),
      yesCriteria: Array.from({ length: 80 }, (_, index) => `yes${index}`).join(' '),
      noCriteria: Array.from({ length: 80 }, (_, index) => `no${index}`).join(' '),
      deadline: '2026-12-31',
      resolutionSource: 'Official source',
      evidenceSummary: Array.from({ length: 100 }, (_, index) => `evidence${index}`).join(' '),
    },
  ];

  assert.equal(getCompletedStepDwellMs(run, step), MAX_COMPLETED_STEP_DWELL_MS);
});

test('completed step dwell adapts to dynamic visible artifact text within bounds', () => {
  const run = createMinimalRun();
  const step = run.steps.find((item) => item.id === 'resolver');
  assert.ok(step);

  const briefDwell = getCompletedStepDwellMs(run, step);

  run.liveResolver = {
    name: 'Official Gazette',
    url: 'https://example.gov/gazette',
    verificationStatus: 'verified',
    verificationEvidence: Array.from({ length: 28 }, (_, index) => `evidence${index}`).join(' '),
  };

  const detailedDwell = getCompletedStepDwellMs(run, step);

  assert.ok(briefDwell >= MIN_COMPLETED_STEP_DWELL_MS);
  assert.ok(detailedDwell <= MAX_COMPLETED_STEP_DWELL_MS);
  assert.ok(detailedDwell > briefDwell);
});

test('step presentation text excludes hidden payloads and full hashes', () => {
  const run = createMinimalRun();
  const step = run.steps[0];

  run.sourceInput = Array.from({ length: 120 }, (_, index) => `source${index}`).join(' ');
  step.outputSummary = 'Hash 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef created.';

  const readableText = getStepPresentationText(run, step);

  assert.match(readableText, /\.\.\.$/);
  assert.doesNotMatch(readableText, /source119/);
  assert.doesNotMatch(readableText, /0123456789abcdef0123456789abcdef/);
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
