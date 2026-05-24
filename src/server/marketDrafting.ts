import type { LlmDraft } from './llmStructured';
import type { verifyResolver } from './resolverVerification';

type VerifiedResolver = Awaited<ReturnType<typeof verifyResolver>>;

export function normalizeCandidateMarkets(draft: LlmDraft, resolver: VerifiedResolver) {
  const accepted = draft.candidateMarkets[0];
  if (!accepted) throw new Error('Market drafting failed: no accepted candidate was produced.');

  return [{
    ...accepted,
    id: createStableMarketId(draft, accepted.id),
    deadline: draft.claim.deadline,
    resolverName: resolver.name,
    resolverUrl: resolver.url,
  }];
}

export function normalizeResolverUrlForComparison(value: string) {
  const url = new URL(value.trim());
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  return url.href;
}

function createStableMarketId(draft: LlmDraft, fallbackId: string) {
  const haystack = [
    draft.claim.summary,
    draft.claim.region,
    draft.claim.eventType,
    ...draft.claim.actors,
    draft.candidateMarkets[0]?.question,
  ].join(' ').toLowerCase();

  if (haystack.includes('laguna verde') && haystack.includes('ceol')) {
    return `chile-laguna-verde-ceol-ratification-${draft.claim.deadline.slice(0, 4)}`;
  }

  const slug = [
    draft.claim.region,
    draft.claim.eventType,
    ...draft.claim.actors.slice(0, 3),
    draft.claim.deadline,
  ].join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);

  return slug || fallbackId;
}
