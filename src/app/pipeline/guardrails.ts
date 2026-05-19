import type { AcceptedMarket, MarketQuestion } from './types';

type GuardrailCriticVerdict = {
  draftId: string | null;
  decision: 'accepted' | 'rejected';
  checks: Record<string, 'pass' | 'fail'>;
};

export function getAcceptedMarketGuardrailFailure(
  acceptedMarket: AcceptedMarket | MarketQuestion | null | undefined,
  criticVerdict: GuardrailCriticVerdict,
): string | null {
  if (!acceptedMarket) return 'No accepted market draft is present.';
  if (!criticVerdict.draftId) return 'Accepted draftId is missing.';
  if (criticVerdict.draftId !== acceptedMarket.id) return 'Accepted draftId does not match the accepted market.';
  if (criticVerdict.decision !== 'accepted') return 'Critic verdict did not accept the market.';
  if (Object.values(criticVerdict.checks).some((value) => value !== 'pass')) return 'One or more critic checks failed.';
  if (!isSpecificCriteria(acceptedMarket.yesCriteria, 'YES')) return 'YES criteria is not specific enough.';
  if (!isSpecificCriteria(acceptedMarket.noCriteria, 'NO')) return 'NO criteria is not specific enough.';
  if (!isConcreteIsoDeadline(acceptedMarket.deadline)) return 'Deadline must be an ISO-like concrete date.';
  if (!acceptedMarket.resolutionSource.trim()) return 'Resolution source is missing.';
  if (hasVagueResolutionLanguage(acceptedMarket.resolutionSource)) return 'Resolution source is too vague.';
  if (!isBinaryTimeBoundedQuestion(acceptedMarket.question, acceptedMarket.deadline)) {
    return 'Question is not clearly binary and time-bounded.';
  }

  return null;
}

function isSpecificCriteria(value: string, label: 'YES' | 'NO') {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  const hasLabel = normalized.startsWith(label);
  const hasConcreteLength = normalized.length >= 70;
  const avoidsWeakFallback = !/\botherwise\b\.?$/i.test(normalized) && !/\bif they do not\b/i.test(normalized);
  const namesResolutionMechanism = /\b(publication|announcement|decree|tcmb|ministry|cabinet|central bank|boletin|gazette|resolution|decision)\b/i.test(normalized);
  const includesDeadlineBoundary = /\b(before|by|no later than|beyond|on or before)\b/i.test(normalized);

  return hasLabel
    && hasConcreteLength
    && avoidsWeakFallback
    && namesResolutionMechanism
    && includesDeadlineBoundary
    && !hasVagueResolutionLanguage(normalized)
    && lower !== `${label.toLowerCase()} otherwise.`;
}

function isConcreteIsoDeadline(value: string) {
  return /^202[6-9]-\d{2}-\d{2}$/.test(value.trim());
}

function hasVagueResolutionLanguage(value: string) {
  return /\b(according to official sources|official sources|sources say|named public authority|public authority|otherwise)\b/i.test(value);
}

function isBinaryTimeBoundedQuestion(question: string, deadline: string) {
  const normalizedQuestion = question.trim();
  const lower = normalizedQuestion.toLowerCase();
  const startsBinary = /^(will|does|did|has|is|are|was|were|can|should)\b/i.test(normalizedQuestion);
  const includesDeadline = deadline.trim().length > 0 && normalizedQuestion.includes(deadline);
  const hasTimeBoundary = /\b(before|by|through|on or before|no later than)\b/i.test(normalizedQuestion);
  const avoidsOpenEnded = !/\b(how many|how much|what amount|which|why|when)\b/i.test(lower);

  return normalizedQuestion.endsWith('?') && startsBinary && includesDeadline && hasTimeBoundary && avoidsOpenEnded;
}
