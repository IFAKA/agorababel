import type { LlmDraft } from './llmStructured';

const MAX_DISCOVERY_CANDIDATES = 12;
const MAX_SEARCH_RESULTS_PER_QUERY = 5;
const FETCH_TIMEOUT_MS = 9000;
const GENERIC_NEWS_HOSTS = [
  'reuters.com',
  'apnews.com',
  'bloomberg.com',
  'ft.com',
  'nytimes.com',
  'wsj.com',
  'theguardian.com',
  'elpais.com',
  'cnn.com',
  'bbc.com',
];
const OFFICIAL_RESOLVER_HOSTS = [
  'bankofengland.co.uk',
  'contraloria.cl',
  'gob.cl',
  'bcentral.cl',
  'camara.cl',
  'senado.cl',
  'boletinoficial.gob.ar',
  'gov.uk',
  'europa.eu',
];

export type ResolverCandidate = {
  name: string;
  url: string;
  source: 'source-link' | 'source-url' | 'llm-draft' | 'official-search' | 'official-homepage';
};

export type ResolverCandidateCheck = ResolverCandidate & {
  status: 'selected' | 'rejected' | 'unchecked';
  reason: string;
};

export type ResolverDiscoveryInput = {
  draft: LlmDraft;
  sourceUrl: string | null;
  outboundUrls: string[];
  sourceText: string;
};

export type ResolverDiscoveryResult =
  | {
    status: 'found';
    candidate: ResolverCandidate;
    checkedCandidates: ResolverCandidateCheck[];
  }
  | {
    status: 'not-found';
    reason: string;
    checkedCandidates: ResolverCandidateCheck[];
  };

export type VerifiedResolver = {
  name: string;
  url: string;
  verificationStatus: 'verified';
  verificationEvidence: string;
};

type FetchedCandidate = {
  candidate: ResolverCandidate;
  body: string;
  contentType: string;
};

export async function discoverOfficialResolver(input: ResolverDiscoveryInput): Promise<ResolverDiscoveryResult> {
  const candidates = dedupeCandidates([
    ...createSourceCandidates(input),
    ...createKnownOfficialHomepageCandidates(input.draft),
    ...await createSearchCandidates(input).catch(() => []),
  ]).slice(0, MAX_DISCOVERY_CANDIDATES);

  const checks = new Map<string, ResolverCandidateCheck>();
  const rejected: string[] = [];

  for (const candidate of candidates) {
    const fetched = await fetchCandidate(candidate).catch((error) => {
      const reason = error instanceof Error ? error.message : 'fetch failed';
      rejected.push(`${candidate.url}: ${reason}`);
      checks.set(candidate.url, { ...candidate, status: 'rejected', reason });
      return null;
    });
    if (!fetched) continue;

    const verdict = inspectCandidate(fetched, input.draft);
    if (verdict.ok) {
      checks.set(candidate.url, { ...candidate, status: 'selected', reason: verdict.evidence });
      return { status: 'found', candidate, checkedCandidates: annotateCandidateChecks(candidates, checks) };
    }

    rejected.push(`${candidate.url}: ${verdict.reason}`);
    checks.set(candidate.url, { ...candidate, status: 'rejected', reason: verdict.reason });
  }

  return {
    status: 'not-found',
    reason: rejected.length
      ? `No official resolver matched the claim after checking ${Math.min(rejected.length, candidates.length)} candidate URL(s).`
      : 'No official resolver candidates were discoverable from the source, outbound links, official domains, or web search.',
    checkedCandidates: annotateCandidateChecks(candidates, checks),
  };
}

export async function verifyResolver(candidate: ResolverCandidate, draft: LlmDraft): Promise<VerifiedResolver> {
  const fetched = await fetchCandidate(candidate);
  const verdict = inspectCandidate(fetched, draft);

  if (!verdict.ok) {
    throw new Error(`Resolver verification failed: ${verdict.reason}`);
  }

  const url = new URL(candidate.url);

  return {
    name: candidate.name,
    url: url.href,
    verificationStatus: 'verified',
    verificationEvidence: [
      `${candidate.name} was discovered from ${formatCandidateSource(candidate.source)} and fetched successfully.`,
      verdict.evidence,
    ].join(' '),
  };
}

function createSourceCandidates(input: ResolverDiscoveryInput): ResolverCandidate[] {
  const urls = [
    ...(input.sourceUrl ? [{ url: input.sourceUrl, source: 'source-url' as const }] : []),
    ...input.outboundUrls.map((url) => ({ url, source: 'source-link' as const })),
    { url: input.draft.resolver.url, source: 'llm-draft' as const },
  ];

  return urls.flatMap(({ url, source }) => {
    try {
      const parsed = new URL(url);
      const name = officialNameForHost(normalizeHost(parsed.hostname), input.draft.resolver.name);
      return [{ name, url: parsed.href, source }];
    } catch {
      return [];
    }
  });
}

function annotateCandidateChecks(
  candidates: ResolverCandidate[],
  checks: Map<string, ResolverCandidateCheck>,
): ResolverCandidateCheck[] {
  return candidates.map((candidate) => checks.get(candidate.url) ?? {
    ...candidate,
    status: 'unchecked',
    reason: 'Candidate queued but not fetched after an official resolver was selected.',
  });
}

function createKnownOfficialHomepageCandidates(draft: LlmDraft): ResolverCandidate[] {
  const text = [
    draft.resolver.name,
    draft.claim.region,
    draft.claim.eventType,
    ...draft.claim.actors,
  ].join(' ').toLowerCase();
  const candidates: ResolverCandidate[] = [];

  if (text.includes('bank of england') || text.includes('monetary policy committee') || /\bmpc\b/i.test(text)) {
    candidates.push({
      name: 'Bank of England',
      url: 'https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes',
      source: 'official-homepage',
    });
  }

  if (text.includes('chile') || text.includes('chilena') || text.includes('chileno')) {
    if (text.includes('senado')) {
      candidates.push({ name: 'Senado de Chile', url: 'https://www.senado.cl/', source: 'official-homepage' });
    }
    if (text.includes('diputad')) {
      candidates.push({ name: 'Camara de Diputadas y Diputados de Chile', url: 'https://www.camara.cl/', source: 'official-homepage' });
    }
    if (text.includes('contralor')) {
      candidates.push({ name: 'Contraloria General de la Republica de Chile', url: 'https://www.contraloria.cl/', source: 'official-homepage' });
    }
    candidates.push({ name: 'Gobierno de Chile', url: 'https://www.gob.cl/', source: 'official-homepage' });
  }

  return candidates;
}

async function createSearchCandidates(input: ResolverDiscoveryInput): Promise<ResolverCandidate[]> {
  const hosts = officialHostsForDraft(input.draft);
  const queryCore = [
    ...input.draft.claim.actors.slice(0, 3),
    input.draft.claim.eventType,
    input.draft.claim.deadline,
  ].join(' ');
  const results: ResolverCandidate[] = [];

  for (const host of hosts) {
    const searchUrl = new URL('https://duckduckgo.com/html/');
    searchUrl.searchParams.set('q', `site:${host} ${queryCore}`);
    const response = await fetchWithTimeout(searchUrl.href, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
        'User-Agent': 'AgoraBabel-SaaS/2.0',
      },
    });
    if (!response.ok) continue;

    const html = await response.text();
    for (const href of parseSearchResultUrls(html).slice(0, MAX_SEARCH_RESULTS_PER_QUERY)) {
      try {
        const url = new URL(href);
        if (!hostMatches(url.hostname, host)) continue;
        results.push({
          name: officialNameForHost(normalizeHost(url.hostname), input.draft.resolver.name),
          url: url.href,
          source: 'official-search',
        });
      } catch {
        continue;
      }
    }
  }

  return results;
}

async function fetchCandidate(candidate: ResolverCandidate): Promise<FetchedCandidate> {
  const url = new URL(candidate.url);
  const host = normalizeHost(url.hostname);

  if (isGenericNewsHost(host)) {
    throw new Error(`${host} is a news outlet, not an official resolver`);
  }

  if (!isKnownOfficialResolverHost(host) && !looksOfficialHost(host)) {
    throw new Error(`${host} is not an official resolver domain`);
  }

  const response = await fetchWithTimeout(url.href, {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain,*/*',
      'User-Agent': 'AgoraBabel-SaaS/2.0',
    },
  });

  if (!response.ok) {
    throw new Error(`${url.href} returned HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('text') || contentType.includes('html') || contentType.includes('json')
    ? (await response.text()).slice(0, 8000)
    : '';

  return { candidate, body, contentType };
}

function inspectCandidate(fetched: FetchedCandidate, draft: LlmDraft): { ok: true; evidence: string } | { ok: false; reason: string } {
  const host = normalizeHost(new URL(fetched.candidate.url).hostname);
  const path = new URL(fetched.candidate.url).pathname;
  const normalizedBody = fetched.body.toLowerCase();
  const bodyForMatching = stripDiacritics(normalizedBody);

  if (!isKnownOfficialResolverHost(host) && !looksOfficialHost(host)) {
    return { ok: false, reason: `${host} is not an official resolver domain` };
  }

  if (fetched.body && !containsOfficialSignal(fetched.body, fetched.candidate.name, host)) {
    return { ok: false, reason: `fetched page did not plausibly match ${fetched.candidate.name}` };
  }

  if (isFutureOfficialPublicationSource(fetched.candidate, host, path)) {
    return {
      ok: true,
      evidence: [
        `${host} is a known official resolver domain`,
        'official resolver homepage/future publication source fetched successfully',
        fetched.contentType ? `content-type ${fetched.contentType}` : '',
      ].filter(Boolean).join('; ') + '.',
    };
  }

  const claimTerms = [
    ...draft.claim.actors,
    draft.claim.region,
    draft.claim.eventType,
  ].flatMap(tokenizeSignificantWords);
  const matchedTerms = new Set(claimTerms.filter((term) => bodyForMatching.includes(term)));
  const deadlineEvidence = containsDateSignal(bodyForMatching, draft.claim.deadline);

  if (fetched.body && matchedTerms.size < Math.min(2, claimTerms.length) && !deadlineEvidence) {
    return {
      ok: false,
      reason: 'official page fetched, but it did not match the claim actors, event, or deadline',
    };
  }

  const evidenceParts = [
    `${host} is an official resolver domain`,
    matchedTerms.size ? `${matchedTerms.size} claim term(s) matched` : '',
    deadlineEvidence ? `deadline/date signal ${draft.claim.deadline} matched` : '',
    fetched.contentType ? `content-type ${fetched.contentType}` : '',
  ].filter(Boolean);

  return { ok: true, evidence: evidenceParts.join('; ') + '.' };
}

function isFutureOfficialPublicationSource(candidate: ResolverCandidate, host: string, path: string) {
  if (!isKnownOfficialResolverHost(host)) return false;
  if (candidate.source === 'official-homepage') return true;
  return path === '/' || path === '';
}

function officialHostsForDraft(draft: LlmDraft): string[] {
  const text = [
    draft.resolver.name,
    draft.claim.region,
    draft.claim.eventType,
    ...draft.claim.actors,
  ].join(' ').toLowerCase();
  const hosts = new Set<string>();

  for (const host of OFFICIAL_RESOLVER_HOSTS) {
    if (text.includes(host.replace(/\.(co\.)?[^.]+$/, '').replace(/-/g, ' '))) hosts.add(host);
  }

  if (text.includes('bank of england') || text.includes('monetary policy committee') || /\bmpc\b/i.test(text)) {
    hosts.add('bankofengland.co.uk');
  }

  if (text.includes('chile') || text.includes('chilena') || text.includes('chileno')) {
    ['gob.cl', 'bcentral.cl', 'contraloria.cl', 'camara.cl', 'senado.cl'].forEach((host) => hosts.add(host));
  }

  return Array.from(hosts).slice(0, 5);
}

function parseSearchResultUrls(html: string): string[] {
  const urls = new Set<string>();
  const hrefMatches = html.matchAll(/href=["']([^"']+)["']/gi);

  for (const match of hrefMatches) {
    const raw = decodeHtmlEntities(match[1] ?? '');
    const decoded = decodeSearchRedirect(raw);
    if (/^https?:\/\//i.test(decoded)) urls.add(decoded);
  }

  return Array.from(urls);
}

function decodeSearchRedirect(rawHref: string) {
  try {
    const maybeUrl = rawHref.startsWith('//') ? new URL(`https:${rawHref}`) : new URL(rawHref, 'https://duckduckgo.com');
    const redirected = maybeUrl.searchParams.get('uddg');
    return redirected ? decodeURIComponent(redirected) : maybeUrl.href;
  } catch {
    return rawHref;
  }
}

function dedupeCandidates(candidates: ResolverCandidate[]) {
  const seen = new Set<string>();
  const sourcePriority: Record<ResolverCandidate['source'], number> = {
    'source-url': 0,
    'source-link': 1,
    'official-search': 2,
    'llm-draft': 3,
    'official-homepage': 4,
  };

  return [...candidates].sort((a, b) => sourcePriority[a.source] - sourcePriority[b.source]).filter((candidate) => {
    try {
      const url = new URL(candidate.url);
      url.hash = '';
      const key = url.href.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch {
      return false;
    }
  });
}

function officialNameForHost(host: string, fallback: string) {
  if (host.endsWith('bankofengland.co.uk')) return 'Bank of England';
  if (host.endsWith('senado.cl')) return 'Senado de Chile';
  if (host.endsWith('camara.cl')) return 'Camara de Diputadas y Diputados de Chile';
  if (host.endsWith('contraloria.cl')) return 'Contraloria General de la Republica de Chile';
  if (host.endsWith('gob.cl')) return 'Gobierno de Chile';
  if (host.endsWith('bcentral.cl')) return 'Banco Central de Chile';
  if (host.endsWith('boletinoficial.gob.ar')) return 'Boletin Oficial de la Republica Argentina';
  return fallback;
}

function formatCandidateSource(source: ResolverCandidate['source']) {
  const labels: Record<ResolverCandidate['source'], string> = {
    'source-link': 'an outbound source link',
    'source-url': 'the submitted source URL',
    'llm-draft': 'the structured draft resolver candidate',
    'official-search': 'official-domain discovery search',
    'official-homepage': 'official-domain inference',
  };

  return labels[source];
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isGenericNewsHost(host: string) {
  return GENERIC_NEWS_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function isKnownOfficialResolverHost(host: string) {
  return OFFICIAL_RESOLVER_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function looksOfficialHost(host: string) {
  return /\.(gov|gob|go|gc|eu|int)$/i.test(host) || host.includes('.gov.') || host.includes('.gob.');
}

function hostMatches(hostname: string, officialHost: string) {
  const host = normalizeHost(hostname);
  return host === officialHost || host.endsWith(`.${officialHost}`);
}

function containsOfficialSignal(body: string, resolverName: string, host: string) {
  const normalizedBody = stripDiacritics(body.toLowerCase());
  const resolverWords = tokenizeSignificantWords(resolverName);
  const matchedWords = resolverWords.filter((word) => normalizedBody.includes(word)).length;

  return matchedWords >= Math.min(2, resolverWords.length) || isKnownOfficialResolverHost(host) || looksOfficialHost(host);
}

function containsDateSignal(body: string, isoDate: string) {
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return false;
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  const monthIndex = Number(month) - 1;
  const normalizedDay = String(Number(day));
  const monthName = monthNames[monthIndex] ?? '';
  const spanishMonthName = monthNames[monthIndex + 12] ?? '';

  return body.includes(isoDate)
    || body.includes(`${normalizedDay} ${monthName} ${year}`)
    || body.includes(`${normalizedDay} ${spanishMonthName} ${year}`)
    || body.includes(year);
}

function tokenizeSignificantWords(value: string): string[] {
  return stripDiacritics(value.toLowerCase())
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length > 3)
    .filter((word) => !['official', 'resolver', 'source', 'will', 'before', 'after', 'with', 'from', 'para', 'como', 'sobre'].includes(word));
}

function normalizeHost(hostname: string) {
  return hostname.replace(/^www\./, '').toLowerCase();
}

function stripDiacritics(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
