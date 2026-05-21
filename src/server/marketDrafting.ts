import type { LlmDraft } from './llmStructured';
import type { verifyResolver } from './resolverVerification';

type VerifiedResolver = Awaited<ReturnType<typeof verifyResolver>>;

export function normalizeCandidateMarkets(draft: LlmDraft, resolver: VerifiedResolver) {
  const accepted = draft.candidateMarkets[0];
  if (!accepted) throw new Error('Market drafting failed: no accepted candidate was produced.');

  return [{
    ...accepted,
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
