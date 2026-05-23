import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCandidateMarkets } from './marketDrafting.ts';
import type { LlmDraft } from './llmStructured.ts';

test('market drafting accepts candidate resolver URL after URL canonicalization', () => {
  const draft = createDraft('https://www.contraloria.cl');
  const markets = normalizeCandidateMarkets(draft, {
    name: 'Contraloria General de la Republica',
    url: 'https://www.contraloria.cl/',
    verificationStatus: 'verified',
    verificationEvidence: 'Official resolver host responded.',
  });

  assert.equal(markets[0].resolverUrl, 'https://www.contraloria.cl/');
});

test('market drafting rewrites candidate resolver URL to the discovered official resolver', () => {
  const draft = createDraft('https://www.contraloria.cl/not-the-resolver');
  const markets = normalizeCandidateMarkets(draft, {
    name: 'Contraloria General de la Republica',
    url: 'https://www.contraloria.cl/',
    verificationStatus: 'verified',
    verificationEvidence: 'Official resolver host responded.',
  });

  assert.equal(markets[0].resolverUrl, 'https://www.contraloria.cl/');
});

function createDraft(candidateResolverUrl: string): LlmDraft {
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
      name: 'Contraloria General de la Republica',
      url: 'https://www.contraloria.cl/',
      verificationEvidence: 'Official resolver host responded.',
    },
    candidateMarkets: [{
      id: 'chile-reconstruction-senate-2026',
      question: 'Will Chile pass the Reconstruction bill before 2026-06-01?',
      yesCriteria: 'YES if the Chilean Senate or official legislative record confirms passage before 2026-06-01.',
      noCriteria: 'NO if no such official confirmation is published before 2026-06-01.',
      deadline: '2026-06-01',
      resolverName: 'Contraloria General de la Republica',
      resolverUrl: candidateResolverUrl,
      evidenceSummary: 'The source states the bill advanced to the Senate with a target date.',
      marketBalance: {
        yesProbability: 55,
        noProbability: 45,
        balanceVerdict: 'balanced',
        balanceRationale: 'The source shows progress, but final official passage remains pending before the deadline.',
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
      decision: 'accepted',
      checks: {
        binary: 'pass',
        resolver: 'pass',
        deadline: 'pass',
        evidence: 'pass',
        novelty: 'pass',
        placeholderFree: 'pass',
      },
      reasoning: 'The candidate is binary, deadline-bounded, and uses the verified resolver.',
      failedRules: [],
    },
    rejectionReason: null,
  };
}
