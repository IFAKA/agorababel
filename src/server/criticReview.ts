import type { LlmDraft } from './llmStructured.ts';

export type CriticReviewOutcome =
  | { status: 'accepted'; criticVerdict: LlmDraft['criticVerdict'] }
  | { status: 'rejected'; criticVerdict: LlmDraft['criticVerdict']; rejectionReason: string };

export function enforceCritic(draft: LlmDraft, noveltyVerdict: 'new-opportunity' | 'duplicate' | 'too-close'): CriticReviewOutcome {
  const candidate = draft.candidateMarkets[0];
  if (!candidate) throw new Error('Critic review failed: no candidate market exists.');

  if (draft.rejectedMarkets.length < 2) {
    throw new Error('Critic review failed: at least two source-specific rejected candidates are required.');
  }

  const checks = Object.values(draft.criticVerdict.checks);
  const hasFailedChecks = checks.some((value) => value !== 'pass');

  if (draft.criticVerdict.decision !== 'accepted' && (hasFailedChecks || draft.criticVerdict.failedRules.length > 0)) {
    return reject(draft, draft.rejectionReason ?? draft.criticVerdict.reasoning);
  }

  if (noveltyVerdict !== 'new-opportunity') {
    return reject(draft, 'Critic review rejected the market because it is duplicate or too close to an existing market.');
  }

  const text = [candidate.question, candidate.yesCriteria, candidate.noCriteria, candidate.resolverName].join(' ');
  if (!isBinaryQuestion(candidate.question)) {
    return reject(draft, 'Critic review rejected the market because the accepted market must be a binary question.');
  }

  if (/\b(official sources|named authority|public authority|otherwise|market reaction|named public authority)\b/i.test(text)) {
    return reject(draft, 'Critic review rejected the market because the accepted market contains placeholder wording.');
  }

  if (hasFailedChecks) {
    return reject(draft, `Critic review rejected the market: ${draft.criticVerdict.failedRules.join(', ') || 'one or more checks failed'}.`);
  }

  if (candidate.marketBalance.balanceVerdict !== 'balanced') {
    return reject(draft, `Critic review rejected the market because market balance is ${candidate.marketBalance.balanceVerdict}: ${candidate.marketBalance.balanceRationale}`);
  }

  if (candidate.marketBalance.yesProbability < 15 || candidate.marketBalance.yesProbability > 85) {
    return reject(draft, `Critic review rejected the market because YES probability is ${candidate.marketBalance.yesProbability}%, outside the 15%-85% tradability range.`);
  }

  return {
    status: 'accepted',
    criticVerdict: {
      ...draft.criticVerdict,
      decision: 'accepted',
      failedRules: [],
    },
  };
}

function isBinaryQuestion(question: string) {
  if (!/\?/.test(question)) return false;
  if (/\bwill\b/i.test(question)) return true;
  return /^¿?\s*(se|sera|será|habra|habrá|aprobar[áa]|publicar[áa]|emitir[áa]|confirmar[áa]|resolver[áa])(?=\s|$)/i.test(question);
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
