import assert from 'node:assert/strict';
import test from 'node:test';
import { enforceCritic } from './criticReview.ts';
import type { LlmDraft } from './llmStructured.ts';

test('critic review returns a rejected outcome instead of throwing for strict LLM rejection', () => {
  const draft = createDraft({
    decision: 'rejected',
    failedRules: ['resolver'],
    rejectionReason: 'Missing official resolver URL for the Senate; candidate market relies on an invented URL.',
  });

  const outcome = enforceCritic(draft, 'new-opportunity');

  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.criticVerdict.decision, 'rejected');
  assert.match(outcome.rejectionReason, /Missing official resolver URL/);
});

test('critic review accepts only passing strict verdicts', () => {
  const outcome = enforceCritic(createDraft(), 'new-opportunity');

  assert.equal(outcome.status, 'accepted');
  assert.equal(outcome.criticVerdict.decision, 'accepted');
});

function createDraft(overrides: {
  decision?: LlmDraft['criticVerdict']['decision'];
  failedRules?: string[];
  rejectionReason?: string | null;
} = {}): LlmDraft {
  const decision = overrides.decision ?? 'accepted';
  const failedRules = overrides.failedRules ?? [];

  return {
    source: {
      language: 'Spanish',
      publishedAt: '2026-05-20T15:14:00.000Z',
    },
    claim: {
      summary: 'The Chamber approved the reconstruction bill and sent it to the Senate.',
      region: 'Chile',
      actors: ['Camara de Diputadas y Diputados', 'Senado'],
      eventType: 'legislative approval',
      deadline: '2026-06-01',
      evidence: [{ text: 'The bill was sent to the Senate.', source: 'pasted source text' }],
    },
    resolver: {
      name: 'Senado de Chile',
      url: 'https://www.senado.cl/',
      verificationEvidence: 'Official Senate site.',
    },
    candidateMarkets: [{
      id: 'chile-reconstruction-senate-2026',
      question: 'Will Chile pass the Reconstruction bill before 2026-06-01?',
      yesCriteria: 'YES if the Chilean Senate or official legislative record confirms passage before 2026-06-01.',
      noCriteria: 'NO if no such official confirmation is published before 2026-06-01.',
      deadline: '2026-06-01',
      resolverName: 'Senado de Chile',
      resolverUrl: 'https://www.senado.cl/',
      evidenceSummary: 'The source states the bill advanced to the Senate with a target date.',
      marketBalance: {
        yesProbability: 55,
        noProbability: 45,
        balanceVerdict: 'balanced',
        balanceRationale: 'The source shows progress, but final Senate passage remains pending before the deadline.',
      },
    }],
    rejectedMarkets: [
      {
        draftId: 'rejected-news-coverage',
        question: 'Will newspapers report more on the bill?',
        reasonRejected: 'Resolution depends on media coverage.',
        violatedRule: 'weak resolution',
      },
      {
        draftId: 'rejected-market-reaction',
        question: 'Will markets react positively to the bill?',
        reasonRejected: 'Resolution is subjective and market-reaction based.',
        violatedRule: 'subjective wording',
      },
    ],
    criticVerdict: {
      draftId: 'chile-reconstruction-senate-2026',
      decision,
      checks: {
        binary: decision === 'accepted' ? 'pass' : 'fail',
        resolver: decision === 'accepted' ? 'pass' : 'fail',
        deadline: 'pass',
        evidence: 'pass',
        novelty: 'pass',
        placeholderFree: 'pass',
      },
      reasoning: overrides.rejectionReason ?? 'The candidate is binary, deadline-bounded, and uses the verified resolver.',
      failedRules,
    },
    rejectionReason: overrides.rejectionReason ?? null,
  };
}
