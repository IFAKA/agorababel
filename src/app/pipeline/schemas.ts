import type { ContextAnalysis, MarketQuestionDraft, SourceAnalysis } from './types';

type SchemaResult<T> = { success: true; data: T } | { success: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return undefined;
  }

  return value;
}

export function validateLlmSourceAnalysis(value: unknown): SchemaResult<SourceAnalysis> {
  if (!isRecord(value)) {
    return { success: false, error: 'Source analysis must be an object.' };
  }

  const sourceAnalysis = {
    signalName: readString(value, 'signalName'),
    language: readString(value, 'language'),
    languageConfidence: readNumber(value, 'languageConfidence'),
    source: readString(value, 'source'),
    sourceUrl: readString(value, 'sourceUrl'),
    sourceDate: readString(value, 'sourceDate'),
    entities: readStringArray(value, 'entities'),
    region: readString(value, 'region'),
    topic: readString(value, 'topic'),
  };

  const required = { ...sourceAnalysis };
  delete required.sourceUrl;
  const invalidField = Object.entries(required).find(([, fieldValue]) => fieldValue === undefined);

  if (invalidField) {
    return { success: false, error: `Source analysis is missing ${invalidField[0]}.` };
  }

  return { success: true, data: sourceAnalysis as SourceAnalysis };
}

export function validateLlmContextAnalysis(value: unknown): SchemaResult<ContextAnalysis> {
  if (!isRecord(value)) {
    return { success: false, error: 'Context analysis must be an object.' };
  }

  const context = {
    englishSummary: readString(value, 'englishSummary'),
    marketRelevance: value.marketRelevance,
    relevanceExplanation: readString(value, 'relevanceExplanation'),
    evidenceSummary: readString(value, 'evidenceSummary'),
  };

  if (!['Low', 'Medium', 'High'].includes(String(context.marketRelevance))) {
    return { success: false, error: 'Context marketRelevance must be Low, Medium, or High.' };
  }

  const invalidField = Object.entries(context).find(([, fieldValue]) => fieldValue === undefined);
  if (invalidField) {
    return { success: false, error: `Context analysis is missing ${invalidField[0]}.` };
  }

  return { success: true, data: context as ContextAnalysis };
}

export function validateLlmMarketDraft(value: unknown): SchemaResult<MarketQuestionDraft> {
  if (!isRecord(value)) {
    return { success: false, error: 'Market draft must be an object.' };
  }

  const marketDraft = {
    id: readString(value, 'id'),
    question: readString(value, 'question'),
    yesCriteria: readString(value, 'yesCriteria'),
    noCriteria: readString(value, 'noCriteria'),
    deadline: readString(value, 'deadline'),
    resolutionSource: readString(value, 'resolutionSource'),
    evidenceSummary: readString(value, 'evidenceSummary'),
    confidenceScore: readNumber(value, 'confidenceScore'),
    marketBalance: isRecord(value.marketBalance) ? {
      yesProbability: readNumber(value.marketBalance, 'yesProbability'),
      noProbability: readNumber(value.marketBalance, 'noProbability'),
      balanceVerdict: readString(value.marketBalance, 'balanceVerdict'),
      balanceRationale: readString(value.marketBalance, 'balanceRationale'),
    } : undefined,
  };

  const invalidField = Object.entries(marketDraft).find(([, fieldValue]) => fieldValue === undefined);

  if (invalidField) {
    return { success: false, error: `Market draft is missing ${invalidField[0]}.` };
  }

  if (!['balanced', 'too-lopsided', 'insufficient-evidence'].includes(marketDraft.marketBalance.balanceVerdict ?? '')) {
    return { success: false, error: 'Market draft balanceVerdict must be balanced, too-lopsided, or insufficient-evidence.' };
  }

  if (
    !Number.isInteger(marketDraft.marketBalance.yesProbability)
    || !Number.isInteger(marketDraft.marketBalance.noProbability)
    || marketDraft.marketBalance.yesProbability < 0
    || marketDraft.marketBalance.yesProbability > 100
    || marketDraft.marketBalance.noProbability < 0
    || marketDraft.marketBalance.noProbability > 100
  ) {
    return { success: false, error: 'Market draft probabilities must be integers from 0 to 100.' };
  }

  if (marketDraft.marketBalance.yesProbability + marketDraft.marketBalance.noProbability !== 100) {
    return { success: false, error: 'Market draft YES and NO probabilities must sum to 100.' };
  }

  if (
    marketDraft.marketBalance.balanceVerdict === 'balanced'
    && (marketDraft.marketBalance.yesProbability < 15 || marketDraft.marketBalance.yesProbability > 85)
  ) {
    return { success: false, error: 'Market draft is too lopsided to be balanced.' };
  }

  return { success: true, data: marketDraft as MarketQuestionDraft };
}
