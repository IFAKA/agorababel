import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MarketQuestionSchema, analysisJsonSchema } from '../app/pipeline/analysisSchema.ts';

test('LLM JSON schema requires absolute HTTP resolver URLs', () => {
  const resolver = analysisJsonSchema.properties.resolver.properties.url;
  const candidateResolver = analysisJsonSchema.properties.candidateMarkets.items.properties.resolverUrl;

  assert.equal(resolver.pattern, '^https?://[^\\s]+$');
  assert.equal(candidateResolver.pattern, '^https?://[^\\s]+$');
});

test('LLM JSON schema requires full critic verdict fields', () => {
  const required = analysisJsonSchema.properties.criticVerdict.required;

  assert.deepEqual(required, ['draftId', 'decision', 'checks', 'reasoning', 'failedRules']);
});

test('Groq request uses strict JSON schema mode and explicit critic verdict instructions', () => {
  const source = readFileSync(new URL('./llmStructured.ts', import.meta.url), 'utf8');

  assert.match(source, /json_schema:\s*{[\s\S]*strict:\s*true/);
  assert.match(source, /response root must be a single JSON object, not an array/);
  assert.match(source, /MAX_LLM_SOURCE_CHARS = 5000/);
  assert.match(source, /criticVerdict must always include draftId, decision, checks, reasoning, and failedRules/);
  assert.match(source, /criticVerdict\.failedRules=\[\]/);
});

test('Groq schema-validation failures retry with the same strict schema contract', () => {
  const source = readFileSync(new URL('./llmStructured.ts', import.meta.url), 'utf8');

  assert.match(source, /isGroqSchemaValidationFailure/);
  assert.match(source, /retrying with explicit root-object instruction/);
  assert.match(source, /GROQ_ROOT_OBJECT_CORRECTION/);
  assert.match(source, /role: 'system' as const, content: correction/);
});

test('LLM parser rejects root arrays without extracting the first object', () => {
  const source = readFileSync(new URL('./llmStructured.ts', import.meta.url), 'utf8');

  assert.match(source, /JSON\.parse\(trimmed\)/);
  assert.match(source, /Array\.isArray\(parsed\)/);
  assert.doesNotMatch(source, /indexOf\('\{'\)/);
  assert.doesNotMatch(source, /lastIndexOf\('\}'\)/);
});

test('market artifact schema rejects non-HTTP resolver URLs', () => {
  assert.equal(MarketQuestionSchema.safeParse({
    id: 'market-1',
    question: 'Will the official body publish the decision before 2026-07-01?',
    yesCriteria: 'YES if the official body publishes the decision before 2026-07-01.',
    noCriteria: 'NO if the official body does not publish it before 2026-07-01.',
    deadline: '2026-07-01',
    resolverName: 'Official body',
    resolverUrl: 'mailto:resolver@example.com',
    evidenceSummary: 'The source named the official body and deadline.',
    marketBalance: createMarketBalance(),
  }).success, false);
});

test('market artifact schema accepts valid probability balance data', () => {
  assert.equal(MarketQuestionSchema.safeParse(createMarketQuestion()).success, true);
});

test('market artifact schema rejects missing probability balance data', () => {
  const { marketBalance, ...market } = createMarketQuestion();

  assert.equal(MarketQuestionSchema.safeParse(market).success, false);
  assert.equal(marketBalance.yesProbability, 55);
});

test('market artifact schema rejects probability estimates that do not sum to 100', () => {
  assert.equal(MarketQuestionSchema.safeParse(createMarketQuestion({
    marketBalance: createMarketBalance({ yesProbability: 55, noProbability: 44 }),
  })).success, false);
});

test('market artifact schema rejects lopsided markets marked as balanced', () => {
  assert.equal(MarketQuestionSchema.safeParse(createMarketQuestion({
    marketBalance: createMarketBalance({ yesProbability: 90, noProbability: 10, balanceVerdict: 'balanced' }),
  })).success, false);
});

function createMarketQuestion(overrides = {}) {
  return {
    id: 'market-1',
    question: 'Will the official body publish the decision before 2026-07-01?',
    yesCriteria: 'YES if the official body publishes the decision before 2026-07-01.',
    noCriteria: 'NO if the official body does not publish it before 2026-07-01.',
    deadline: '2026-07-01',
    resolverName: 'Official body',
    resolverUrl: 'https://resolver.example.com/',
    evidenceSummary: 'The source named the official body and deadline.',
    marketBalance: createMarketBalance(),
    ...overrides,
  };
}

function createMarketBalance(overrides = {}) {
  return {
    yesProbability: 55,
    noProbability: 45,
    balanceVerdict: 'balanced',
    balanceRationale: 'The source supports the claim, but official publication remains pending before the deadline.',
    ...overrides,
  };
}
