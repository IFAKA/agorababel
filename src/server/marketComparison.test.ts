import assert from 'node:assert/strict';
import test from 'node:test';
import { compareMarketNovelty } from './marketComparison.ts';
import type { LlmDraft } from './llmStructured.ts';

test('market comparison ignores search page query echo without market result links', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.startsWith('https://polymarket.com/search?')) {
      return textResponse('<html><body><input value="Chile Gobierno de Chile Contraloria CEOL ratification"></body></html>');
    }

    if (url.startsWith('https://kalshi.com/search?')) {
      return new Response('rate limited', { status: 429 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const comparison = await compareMarketNovelty(createDraft());

    assert.equal(comparison.noveltyVerdict, 'new-opportunity');
    assert.equal(comparison.similarMarkets.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('market comparison flags overlapping actual market result links', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.startsWith('https://polymarket.com/search?')) {
      return textResponse('<a href="/event/chile-ceol-ratification">Chile Gobierno de Chile Contraloria General de la Republica CEOL ratification</a>');
    }

    if (url.startsWith('https://kalshi.com/search?')) {
      return new Response('rate limited', { status: 429 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const comparison = await compareMarketNovelty(createDraft());

    assert.equal(comparison.noveltyVerdict, 'too-close');
    assert.equal(comparison.similarMarkets.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createDraft(): LlmDraft {
  return {
    source: {
      language: 'Spanish',
      publishedAt: '2026-05-20T15:14:00.000Z',
    },
    claim: {
      summary: 'The CEOL ratification remains pending.',
      region: 'Chile',
      actors: ['Gobierno de Chile', 'Contraloria General de la Republica'],
      eventType: 'CEOL ratification',
      deadline: '2026-06-30',
      evidence: [{ text: 'The official publication remains pending.', source: 'source' }],
    },
    resolver: {
      name: 'Contraloria General de la Republica de Chile',
      url: 'https://www.contraloria.cl/',
      verificationEvidence: 'Official resolver.',
    },
    candidateMarkets: [{
      id: 'chile-ceol-ratification',
      question: 'Will the official CEOL ratification be published before 2026-06-30?',
      yesCriteria: 'YES if the official ratification is published before 2026-06-30.',
      noCriteria: 'NO otherwise.',
      deadline: '2026-06-30',
      resolverName: 'Contraloria General de la Republica de Chile',
      resolverUrl: 'https://www.contraloria.cl/',
      evidenceSummary: 'The source says ratification remains pending.',
      marketBalance: {
        yesProbability: 60,
        noProbability: 40,
        balanceVerdict: 'balanced',
        balanceRationale: 'Ratification is possible but not guaranteed.',
      },
    }],
    rejectedMarkets: [
      {
        draftId: 'media',
        question: 'Will media cover the CEOL?',
        reasonRejected: 'Media coverage is not official resolution.',
        violatedRule: 'weak resolution',
      },
      {
        draftId: 'reaction',
        question: 'Will stocks rise?',
        reasonRejected: 'Market reaction is subjective.',
        violatedRule: 'subjective wording',
      },
    ],
    criticVerdict: {
      draftId: 'chile-ceol-ratification',
      decision: 'accepted',
      checks: {
        binary: 'pass',
        resolver: 'pass',
        deadline: 'pass',
        evidence: 'pass',
        novelty: 'pass',
        placeholderFree: 'pass',
      },
      reasoning: 'The candidate is binary and official-source resolved.',
      failedRules: [],
    },
    rejectionReason: null,
  };
}

function textResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}
