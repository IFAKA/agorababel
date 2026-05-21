import type { LlmDraft } from './llmStructured';

export type CriticReviewOutcome =
  | { status: 'accepted'; criticVerdict: LlmDraft['criticVerdict'] }
  | { status: 'rejected'; criticVerdict: LlmDraft['criticVerdict']; rejectionReason: string };

export function enforceCritic(draft: LlmDraft, noveltyVerdict: 'new-opportunity' | 'duplicate' | 'too-close'): CriticReviewOutcome {
  const candidate = draft.candidateMarkets[0];
  if (!candidate) throw new Error('Critic review failed: no candidate market exists.');

  if (draft.rejectedMarkets.length < 2) {
    throw new Error('Critic review failed: at least two source-specific rejected candidates are required.');
  }

  if (draft.criticVerdict.decision !== 'accepted') {
    return reject(draft, draft.rejectionReason ?? draft.criticVerdict.reasoning);
  }

  if (noveltyVerdict !== 'new-opportunity') {
    return reject(draft, 'Critic review rejected the market because it is duplicate or too close to an existing market.');
  }

  const text = [candidate.question, candidate.yesCriteria, candidate.noCriteria, candidate.resolverName].join(' ');
  if (!/\bwill\b/i.test(candidate.question) || !/\?/.test(candidate.question)) {
    return reject(draft, 'Critic review rejected the market because the accepted market must be a binary question.');
  }

  if (/\b(official sources|named authority|public authority|otherwise|market reaction|named public authority)\b/i.test(text)) {
    return reject(draft, 'Critic review rejected the market because the accepted market contains placeholder wording.');
  }

  if (Object.values(draft.criticVerdict.checks).some((value) => value !== 'pass')) {
    return reject(draft, `Critic review rejected the market: ${draft.criticVerdict.failedRules.join(', ') || 'one or more checks failed'}.`);
  }

  return { status: 'accepted', criticVerdict: draft.criticVerdict };
}

function reject(draft: LlmDraft, rejectionReason: string): CriticReviewOutcome {
  return {
    status: 'rejected',
    criticVerdict: {
      ...draft.criticVerdict,
      decision: 'rejected',
      failedRules: draft.criticVerdict.failedRules.length ? draft.criticVerdict.failedRules : ['critic-review'],
    },
    rejectionReason,
  };
}
