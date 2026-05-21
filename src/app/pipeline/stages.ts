import type { PipelineStage } from './analysisSchema';
import type { PipelineErrorBrief, PipelineStep } from './types';

type StepSeed = Omit<PipelineStep, 'status'>;

export const pipelineStepLabels: Record<PipelineStep['id'], string> = {
  extraction: 'Read Source',
  ingestion: 'Source Details',
  context: 'Translation & Context',
  claim: 'Find Main Claim',
  resolver: 'Check Official Source',
  comparison: 'Check Duplicates',
  'market-creator': 'Write Market',
  critic: 'Quality Check',
  circle: 'Check Wallet',
  settlement: 'Save Proof',
  x402: 'Publish Access',
};

export const pipelineStepDescriptions: Record<PipelineStep['id'], string> = {
  extraction: 'We turn the submitted URL or pasted text into readable source material.',
  ingestion: 'We label the source language, region, actors, and event type.',
  context: 'We translate or summarize why the source matters for a market.',
  claim: 'We identify the specific event claim, who is involved, the evidence, and the deadline.',
  resolver: 'We check the official page that will decide whether the market resolves YES or NO.',
  comparison: 'We search for existing markets so we do not create a duplicate.',
  'market-creator': 'We write a clear YES/NO market with rules and a deadline.',
  critic: 'We reject drafts that are vague, duplicated, unsupported, or hard to resolve.',
  circle: 'We check the test wallet used to attach a proof record.',
  settlement: 'We save a proof of the accepted market on Arc Testnet.',
  x402: 'We publish the access details for the final paid artifact.',
};

export const pipelineAgentLabels: Record<PipelineStep['id'], string> = {
  extraction: 'Source Reader',
  ingestion: 'Source Details Agent',
  context: 'Context Translator',
  claim: 'Claim Finder',
  resolver: 'Official Source Checker',
  comparison: 'Market Duplicate Checker',
  'market-creator': 'Market Writer',
  critic: 'Quality Checker',
  circle: 'Wallet Checker',
  settlement: 'Proof Saver',
  x402: 'Access Publisher',
};

export const canonicalStageOrder: PipelineStep[] = [
  createPipelineStep('extraction', 'Read Source', 'Source Reader', 'Turn the submitted URL or pasted text into readable source material.', 'Waiting for submitted source.', 'No readable source yet.', 'source-extraction'),
  createPipelineStep('claim', 'Find Main Claim', 'Claim Finder', 'Identify the event claim, people or organizations involved, evidence, and deadline.', 'Waiting for source reading.', 'No main claim found yet.', 'claim-extraction'),
  createPipelineStep('resolver', 'Check Official Source', 'Official Source Checker', 'Find and verify the official page that will decide YES or NO.', 'Waiting for main claim.', 'No official source found yet.', 'resolver-verification'),
  createPipelineStep('comparison', 'Check Duplicates', 'Market Duplicate Checker', 'Search existing market sources for close matches.', 'Waiting for official source check.', 'No duplicate check completed yet.', 'market-comparison'),
  createPipelineStep('market-creator', 'Write Market', 'Market Writer', 'Write one clear YES/NO market with rules, evidence, and a deadline.', 'Waiting for duplicate check.', 'No market draft yet.', 'market-drafting'),
  createPipelineStep('critic', 'Quality Check', 'Quality Checker', 'Reject drafts that are vague, duplicated, unsupported, or hard to resolve.', 'Waiting for market drafts.', 'No quality decision yet.', 'critic-review'),
  createPipelineStep('circle', 'Check Wallet', 'Wallet Checker', 'Check the Circle test wallet used to attach a proof record.', 'Waiting for approved market.', 'No wallet proof yet.', 'circle-wallet'),
  createPipelineStep('settlement', 'Save Proof', 'Proof Saver', 'Save proof of the accepted market on Arc Testnet.', 'Waiting for wallet check.', 'No Arc proof yet.', 'arc-trace-commit'),
  createPipelineStep('x402', 'Publish Access', 'Access Publisher', 'Publish access details for the final paid artifact.', 'Waiting for saved proof.', 'No access details published yet.', 'x402-publication'),
];

const canonicalStepSeeds = Object.fromEntries(canonicalStageOrder.map((step) => [step.id, { ...step, status: undefined }])) as Record<PipelineStep['id'], StepSeed>;

export function createPipelineStep(
  id: PipelineStep['id'],
  title: string,
  agentName: string,
  action: string,
  reasoningSnippet: string,
  outputSummary: string,
  stage: PipelineStage = inferStageFromStepId(id),
): PipelineStep {
  return { id, title, agentName, action, reasoningSnippet, outputSummary, status: 'pending', stage };
}

export function createCanonicalPipelineStep(id: PipelineStep['id'], updates: Partial<Omit<PipelineStep, 'id' | 'stage' | 'status'>> = {}): PipelineStep {
  const seed = canonicalStepSeeds[id];

  return {
    ...seed,
    ...updates,
    status: 'pending',
  };
}

export function clonePipelineSteps(steps: PipelineStep[] = canonicalStageOrder): PipelineStep[] {
  return steps.map((step) => ({ ...step }));
}

export function inferStageFromStepId(id: PipelineStep['id']): PipelineStep['stage'] {
  if (id === 'extraction') return 'source-extraction';
  if (id === 'ingestion' || id === 'context' || id === 'claim') return 'claim-extraction';
  if (id === 'resolver') return 'resolver-verification';
  if (id === 'comparison') return 'market-comparison';
  if (id === 'market-creator') return 'market-drafting';
  if (id === 'critic') return 'critic-review';
  if (id === 'circle') return 'circle-wallet';
  if (id === 'settlement') return 'arc-trace-commit';
  return 'x402-publication';
}

export function stepIdForStage(stage: PipelineErrorBrief['stage']): PipelineStep['id'] {
  if (stage === 'resolver-discovery') return 'resolver';
  const found = canonicalStageOrder.find((step) => step.stage === stage);
  return found?.id ?? (stage === 'api' || stage === 'network' || stage === 'orchestrator' ? 'extraction' : 'extraction');
}

export function labelForStep(stepId: PipelineStep['id']) {
  return pipelineAgentLabels[stepId] ?? pipelineStepLabels[stepId];
}
