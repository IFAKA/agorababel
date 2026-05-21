import type { LlmDraft } from './llmStructured';

const GENERIC_NEWS_HOSTS = ['reuters.com', 'apnews.com', 'bloomberg.com', 'ft.com', 'nytimes.com', 'wsj.com', 'theguardian.com'];

export async function verifyResolver(draft: LlmDraft) {
  const url = new URL(draft.resolver.url);
  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  if (GENERIC_NEWS_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error(`Resolver verification failed: ${host} is a news outlet, not an official resolver.`);
  }

  const response = await fetch(url.href, {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain,*/*',
      'User-Agent': 'AgoraBabel-SaaS/2.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Resolver verification failed: ${draft.resolver.url} returned HTTP ${response.status}.`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('text') || contentType.includes('html')
    ? (await response.text()).slice(0, 5000)
    : '';

  if (body && !containsOfficialSignal(body, draft.resolver.name, host)) {
    throw new Error(`Resolver verification failed: fetched page did not plausibly match ${draft.resolver.name}.`);
  }

  return {
    name: draft.resolver.name,
    url: url.href,
    verificationStatus: 'verified' as const,
    verificationEvidence: draft.resolver.verificationEvidence,
  };
}

function containsOfficialSignal(body: string, resolverName: string, host: string) {
  const normalizedBody = body.toLowerCase();
  const resolverWords = resolverName.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
  const matchedWords = resolverWords.filter((word) => normalizedBody.includes(word)).length;

  return matchedWords >= Math.min(2, resolverWords.length) || /\.(gov|gob|go|gc|eu|int|org)\b/i.test(host);
}
