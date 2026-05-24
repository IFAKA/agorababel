import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverOfficialResolver, verifyResolver } from './resolverVerification.ts';
import type { LlmDraft } from './llmStructured.ts';

test('discovery rejects media URLs and verifies an official outbound resolver', async () => {
  const originalFetch = globalThis.fetch;
  const draft = createDraft({
    resolverUrl: 'https://elpais.com/chile/coverage',
    resolverName: 'El Pais Chile',
  });

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url === 'https://www.senado.cl/session') {
      return textResponse('Senado de Chile camara diputadas reconstruction legislative approval deadline 2026 published 2026-06-01');
    }

    if (url.startsWith('https://duckduckgo.com/html/')) {
      return textResponse('');
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const discovery = await discoverOfficialResolver({
      draft,
      sourceUrl: 'https://elpais.com/chile/coverage',
      outboundUrls: ['https://www.senado.cl/session'],
      sourceText: 'News coverage with an official Senate link.',
    });

    assert.equal(discovery.status, 'found');
    assert.equal(discovery.status === 'found' ? discovery.candidate.url : '', 'https://www.senado.cl/session');
    assert.equal(discovery.checkedCandidates.find((candidate) => candidate.url === 'https://elpais.com/chile/coverage')?.status, 'rejected');
    assert.equal(discovery.checkedCandidates.find((candidate) => candidate.url === 'https://www.senado.cl/session')?.status, 'selected');

    const resolver = await verifyResolver(discovery.status === 'found' ? discovery.candidate : assert.fail('missing candidate'), draft);
    assert.equal(resolver.name, 'Senado de Chile');
    assert.equal(resolver.url, 'https://www.senado.cl/session');
    assert.match(resolver.verificationEvidence, /official resolver domain/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('discovery returns not-found when only media coverage is available', async () => {
  const originalFetch = globalThis.fetch;
  const draft = createDraft({
    resolverUrl: 'https://elpais.com/chile/coverage',
    resolverName: 'El Pais Chile',
  });

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.startsWith('https://duckduckgo.com/html/')) {
      return textResponse('');
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const discovery = await discoverOfficialResolver({
      draft,
      sourceUrl: 'https://elpais.com/chile/coverage',
      outboundUrls: [],
      sourceText: 'Only media coverage is present.',
    });

    assert.equal(discovery.status, 'not-found');
    assert.match(discovery.reason, /No official resolver/);
    assert.ok(discovery.checkedCandidates.every((candidate) => candidate.status === 'rejected' && candidate.reason.length > 0));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('discovery can find a Bank of England MPC resolver through official search', async () => {
  const originalFetch = globalThis.fetch;
  const draft = createDraft({
    region: 'United Kingdom',
    actors: ['Bank of England', 'Monetary Policy Committee'],
    eventType: 'MPC interest rate decision',
    deadline: '2026-06-18',
    resolverName: 'Bank of England',
    resolverUrl: 'https://www.bankofengland.co.uk/',
  });

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.startsWith('https://duckduckgo.com/html/')) {
      return textResponse('<a class="result__a" href="https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2026/june-2026">Result</a>');
    }

    if (url === 'https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2026/june-2026') {
      return textResponse('Bank of England Monetary Policy Committee MPC interest rate decision June 2026 2026-06-18');
    }

    if (url === 'https://www.bankofengland.co.uk/' || url === 'https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes') {
      return textResponse('Bank of England Monetary Policy Committee publications 2026');
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const discovery = await discoverOfficialResolver({
      draft,
      sourceUrl: null,
      outboundUrls: [],
      sourceText: 'The MPC will announce a decision in June 2026.',
    });

    assert.equal(discovery.status, 'found');
    assert.equal(
      discovery.status === 'found' ? discovery.candidate.url : '',
      'https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2026/june-2026',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('discovery accepts the Chile Contraloria homepage as a future official resolver', async () => {
  const originalFetch = globalThis.fetch;
  const draft = createDraft({
    actors: ['Gobierno de Chile', 'Contraloria General de la Republica'],
    eventType: 'CEOL ratification',
    deadline: '2026-06-30',
    resolverName: 'Contraloria General de la Republica de Chile',
    resolverUrl: 'https://www.contraloria.cl/',
  });

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url === 'https://www.contraloria.cl/') {
      return textResponse('Contraloria General de la Republica de Chile');
    }

    if (url.startsWith('https://duckduckgo.com/html/')) {
      return textResponse('');
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const discovery = await discoverOfficialResolver({
      draft,
      sourceUrl: null,
      outboundUrls: [],
      sourceText: 'The official ratification may be published in the future by Contraloria.',
    });

    assert.equal(discovery.status, 'found');
    assert.equal(discovery.status === 'found' ? discovery.candidate.url : '', 'https://www.contraloria.cl/');

    const resolver = await verifyResolver(discovery.status === 'found' ? discovery.candidate : assert.fail('missing candidate'), draft);
    assert.match(resolver.verificationEvidence, /future publication source/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('discovery continues after a 403 official candidate and selects another official homepage', async () => {
  const originalFetch = globalThis.fetch;
  const draft = createDraft({
    actors: ['Gobierno de Chile', 'Contraloria General de la Republica'],
    eventType: 'CEOL ratification',
    deadline: '2026-06-30',
    resolverName: 'Gobierno de Chile',
    resolverUrl: 'https://www.gob.cl/',
  });

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url === 'https://www.gob.cl/') {
      return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
    }

    if (url === 'https://www.contraloria.cl/') {
      return textResponse('Contraloria General de la Republica de Chile');
    }

    if (url.startsWith('https://duckduckgo.com/html/')) {
      return textResponse('');
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const discovery = await discoverOfficialResolver({
      draft,
      sourceUrl: null,
      outboundUrls: [],
      sourceText: 'The official decision could be published by Gobierno de Chile or Contraloria.',
    });

    assert.equal(discovery.status, 'found');
    assert.equal(discovery.status === 'found' ? discovery.candidate.url : '', 'https://www.contraloria.cl/');
    assert.equal(discovery.checkedCandidates.find((candidate) => candidate.url === 'https://www.gob.cl/')?.status, 'rejected');
    assert.equal(discovery.checkedCandidates.find((candidate) => candidate.url === 'https://www.contraloria.cl/')?.status, 'selected');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createDraft(overrides: Partial<{
  region: string;
  actors: string[];
  eventType: string;
  deadline: string;
  resolverName: string;
  resolverUrl: string;
}> = {}): LlmDraft {
  const region = overrides.region ?? 'Chile';
  const actors = overrides.actors ?? ['Camara de Diputadas y Diputados', 'Senado de Chile'];
  const eventType = overrides.eventType ?? 'legislative approval';
  const deadline = overrides.deadline ?? '2026-06-01';
  const resolverName = overrides.resolverName ?? 'Senado de Chile';
  const resolverUrl = overrides.resolverUrl ?? 'https://www.senado.cl/session';

  return {
    source: {
      language: 'Spanish',
      publishedAt: '2026-05-20T15:14:00.000Z',
    },
    claim: {
      summary: 'The source reports a deadline-bound official decision.',
      region,
      actors,
      eventType,
      deadline,
      evidence: [{ text: 'The event has an official deadline.', source: 'source' }],
    },
    resolver: {
      name: resolverName,
      url: resolverUrl,
      verificationEvidence: 'Candidate resolver from structured draft.',
    },
    candidateMarkets: [{
      id: 'official-decision-market',
      question: 'Will the official body publish the decision by the deadline?',
      yesCriteria: 'YES if the official body publishes the decision by the deadline.',
      noCriteria: 'NO if the official body does not publish the decision by the deadline.',
      deadline,
      resolverName,
      resolverUrl,
      evidenceSummary: 'The source describes the official decision and deadline.',
      marketBalance: {
        yesProbability: 55,
        noProbability: 45,
        balanceVerdict: 'balanced',
        balanceRationale: 'The source describes a pending official decision with unresolved uncertainty before the deadline.',
      },
    }],
    rejectedMarkets: [
      {
        draftId: 'media-coverage',
        question: 'Will media cover the decision?',
        reasonRejected: 'Media coverage is not an official resolver.',
        violatedRule: 'weak resolution',
      },
      {
        draftId: 'market-reaction',
        question: 'Will markets react positively?',
        reasonRejected: 'Market reaction is subjective.',
        violatedRule: 'subjective wording',
      },
    ],
    criticVerdict: {
      draftId: 'official-decision-market',
      decision: 'accepted',
      checks: {
        binary: 'pass',
        resolver: 'pass',
        deadline: 'pass',
        evidence: 'pass',
        novelty: 'pass',
        placeholderFree: 'pass',
      },
      reasoning: 'The draft is binary and deadline-bounded.',
      failedRules: [],
    },
    rejectionReason: null,
  };
}

function textResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}
