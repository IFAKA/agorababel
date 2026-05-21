import type { LlmDraft } from './llmStructured';

const SEARCH_SOURCES = [
  {
    source: 'Polymarket search',
    urlForQuery: (query: string) => `https://polymarket.com/search?query=${encodeURIComponent(query)}`,
  },
  {
    source: 'Kalshi search',
    urlForQuery: (query: string) => `https://kalshi.com/search?search=${encodeURIComponent(query)}`,
  },
];

export async function compareMarketNovelty(draft: LlmDraft) {
  const accepted = draft.candidateMarkets[0];
  if (!accepted) throw new Error('Market comparison failed: no candidate market was drafted.');

  const query = [draft.claim.region, ...draft.claim.actors.slice(0, 3), draft.claim.eventType]
    .filter(Boolean)
    .join(' ');
  const similarMarkets = [];
  const unavailableSources = [];

  for (const source of SEARCH_SOURCES) {
    const searchUrl = source.urlForQuery(query);
    const response = await fetch(searchUrl, {
      headers: {
        Accept: 'text/html,text/plain,*/*',
        'User-Agent': 'AgoraBabel-SaaS/2.0',
      },
    });

    if (response.status === 429 || response.status >= 500) {
      unavailableSources.push(`${source.source} HTTP ${response.status}`);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Market comparison failed: ${source.source} returned HTTP ${response.status}.`);
    }

    const text = (await response.text()).toLowerCase();
    const actorMatches = draft.claim.actors.filter((actor) => text.includes(actor.toLowerCase())).length;
    const eventMatch = text.includes(draft.claim.eventType.toLowerCase()) || text.includes(draft.claim.region.toLowerCase());

    if (actorMatches >= 2 && eventMatch) {
      similarMarkets.push({
        title: `${source.source} result matching ${draft.claim.actors.slice(0, 2).join(' / ')}`,
        url: searchUrl,
        source: source.source,
        similarity: 'medium' as const,
      });
    }
  }

  return {
    status: 'checked' as const,
    similarMarkets,
    noveltyVerdict: similarMarkets.length > 0 ? 'too-close' as const : 'new-opportunity' as const,
    reasoning: unavailableSources.length > 0
      ? `Configured public market search was rate-limited or unavailable for ${unavailableSources.join(', ')}; no fetched source showed an overlapping actor/event market.`
      : similarMarkets.length > 0
      ? 'Comparable public market pages contained overlapping actors and event terms.'
      : 'Configured public market searches completed without overlapping actor/event matches.',
  };
}
