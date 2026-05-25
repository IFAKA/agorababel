import { z } from 'zod';
import { analysisJsonSchema } from '../app/pipeline/analysisSchema.ts';
import { getRuntimeConfig } from './config.ts';

const MAX_LLM_SOURCE_CHARS = 5000;
const GROQ_MAX_ATTEMPTS = 4;
const GROQ_RETRY_FLOOR_MS = 750;
const GROQ_ROOT_OBJECT_CORRECTION = [
  'Schema repair: the previous generation used a JSON array as the response root.',
  'Return one artifact object directly. Do not wrap it in an array, even if the source contains multiple claims.',
  'Choose the single strongest deadline-bound claim and put alternative drafts only inside rejectedMarkets.',
  'The first non-whitespace character must be { and the last non-whitespace character must be }.',
].join(' ');

const absoluteHttpUrl = z.string().trim().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Invalid http(s) url');
const marketProbability = z.number().int().min(0).max(100);
const MarketBalanceDraftSchema = z.object({
  yesProbability: marketProbability,
  noProbability: marketProbability,
  balanceVerdict: z.enum(['balanced', 'too-lopsided', 'insufficient-evidence']),
  balanceRationale: z.string().trim().min(1),
}).strict().superRefine((value, context) => {
  if (value.yesProbability + value.noProbability !== 100) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['noProbability'],
      message: 'YES and NO probabilities must sum to 100.',
    });
  }
});

const LlmDraftSchema = z.object({
  source: z.object({
    language: z.string().trim().min(1),
    publishedAt: z.string().trim().min(1).nullable(),
  }).strict(),
  claim: z.object({
    summary: z.string().trim().min(1),
    region: z.string().trim().min(1),
    actors: z.array(z.string().trim().min(1)).min(1),
    eventType: z.string().trim().min(1),
    deadline: z.string().trim().min(1),
    evidence: z.array(z.object({
      text: z.string().trim().min(1),
      source: z.string().trim().min(1),
    }).strict()).min(1),
  }).strict(),
  resolver: z.object({
    name: z.string().trim().min(1),
    url: absoluteHttpUrl,
    verificationEvidence: z.string().trim().min(1),
  }).strict(),
  candidateMarkets: z.array(z.object({
    id: z.string().trim().min(1),
    question: z.string().trim().min(1),
    yesCriteria: z.string().trim().min(1),
    noCriteria: z.string().trim().min(1),
    deadline: z.string().trim().min(1),
    resolverName: z.string().trim().min(1),
    resolverUrl: absoluteHttpUrl,
    evidenceSummary: z.string().trim().min(1),
    marketBalance: MarketBalanceDraftSchema,
  }).strict()).min(1).max(1),
  rejectedMarkets: z.array(z.object({
    draftId: z.string().trim().min(1),
    question: z.string().trim().min(1),
    reasonRejected: z.string().trim().min(1),
    violatedRule: z.enum(['ambiguity', 'no deadline', 'subjective wording', 'weak resolution', 'duplicate', 'placeholder wording']),
  }).strict()).min(2),
  criticVerdict: z.object({
    draftId: z.string().trim().min(1).nullable(),
    decision: z.enum(['accepted', 'rejected']),
    checks: z.object({
      binary: z.enum(['pass', 'fail']),
      resolver: z.enum(['pass', 'fail']),
      deadline: z.enum(['pass', 'fail']),
      evidence: z.enum(['pass', 'fail']),
      novelty: z.enum(['pass', 'fail']),
      placeholderFree: z.enum(['pass', 'fail']),
    }).strict(),
    reasoning: z.string().trim().min(1),
    failedRules: z.array(z.string().trim().min(1)),
  }).strict(),
  rejectionReason: z.string().trim().min(1).nullable(),
}).strict();

export type LlmDraft = z.infer<typeof LlmDraftSchema>;

export async function analyzeWithConfiguredLlm(
  sourceText: string,
  options: { onNote?: (message: string) => void } = {},
): Promise<LlmDraft> {
  const config = getRuntimeConfig();
  options.onNote?.('source text sent to configured LLM');
  options.onNote?.('strict JSON draft generating');
  const content = config.provider === 'groq'
    ? await callGroq(sourceText, options.onNote)
    : await callOpenAI(sourceText);
  options.onNote?.('draft received, validating schema');
  const parsedJson = parseLlmJsonObject(content);
  const parsed = LlmDraftSchema.safeParse(parsedJson);

  if (!parsed.success) {
    throw new Error(`LLM malformed JSON: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }

  options.onNote?.('claim extracted');
  options.onNote?.('critic verdict validated');
  return parsed.data;
}

async function callGroq(sourceText: string, onNote?: (message: string) => void) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is required when ANALYSIS_PROVIDER=groq.');
  }

  const config = getRuntimeConfig();
  const response = await callGroqCompletionWithRetry(sourceText, config.model, undefined, onNote);

  if (!response.ok) {
    const detail = await response.text().catch(() => '');

    if (isGroqSchemaValidationFailure(detail)) {
      onNote?.('Groq rejected generated JSON; retrying with explicit root-object instruction');
      const retry = await callGroqCompletionWithRetry(sourceText, config.model, GROQ_ROOT_OBJECT_CORRECTION, onNote);

      if (retry.ok) {
        return readGroqContent(retry);
      }

      const retryDetail = await retry.text().catch(() => '');
      throw new Error(`Groq analysis failed with HTTP ${retry.status}: ${summarizeGroqDetail(retryDetail)}`);
    }

    throw new Error(`Groq analysis failed with HTTP ${response.status}: ${summarizeGroqDetail(detail)}`);
  }

  return readGroqContent(response);
}

async function callGroqCompletionWithRetry(sourceText: string, model: string, correction?: string, onNote?: (message: string) => void) {
  let response = await callGroqCompletion(sourceText, model, correction);

  for (let attempt = 1; response.status === 429 && attempt < GROQ_MAX_ATTEMPTS; attempt += 1) {
    const detail = await response.text().catch(() => '');
    const delayMs = getGroqRetryDelayMs(response, detail, attempt);
    onNote?.(`Groq rate limited request; retrying in ${Math.round(delayMs / 100) / 10}s`);
    await sleep(delayMs);
    response = await callGroqCompletion(sourceText, model, correction);
  }

  return response;
}

async function callGroqCompletion(sourceText: string, model: string, correction?: string) {
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(createGroqRequestBody(sourceText, model, correction)),
  });
}

function getGroqRetryDelayMs(response: Response, detail: string, attempt: number) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.max(retryAfter * 1000, GROQ_RETRY_FLOOR_MS);
  }

  const retryMessageDelay = parseRetryMessageDelayMs(detail);
  if (retryMessageDelay) {
    return Math.max(retryMessageDelay, GROQ_RETRY_FLOOR_MS);
  }

  return GROQ_RETRY_FLOOR_MS * 2 ** (attempt - 1);
}

function parseRetryMessageDelayMs(detail: string) {
  const match = detail.match(/try again in\s+([\d.]+)\s*(ms|milliseconds?|s|sec|seconds?|m|min|minutes?)/i);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2].toLowerCase();
  if (unit.startsWith('ms') || unit.startsWith('millisecond')) return amount;
  if (unit === 'm' || unit.startsWith('min')) return amount * 60_000;
  return amount * 1000;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readGroqContent(response: Response) {
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('Groq analysis returned no JSON content.');
  return content;
}

async function callOpenAI(sourceText: string) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when ANALYSIS_PROVIDER=openai.');
  }

  const config = getRuntimeConfig();
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      input: [
        { role: 'system', content: createSystemPrompt() },
        { role: 'user', content: createUserPrompt(sourceText) },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'agorababel_pipeline_draft',
          strict: true,
          schema: analysisJsonSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`OpenAI analysis failed with HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }

  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const content = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text).find(Boolean);
  if (!content) throw new Error('OpenAI analysis returned no JSON content.');
  return content;
}

function createGroqRequestBody(sourceText: string, model: string, correction?: string) {
  return {
    model,
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'agorababel_pipeline_draft',
        strict: true,
        schema: analysisJsonSchema,
      },
    },
    messages: [
      { role: 'system', content: createSystemPrompt() },
      ...(correction ? [{ role: 'system' as const, content: correction }] : []),
      { role: 'user', content: createUserPrompt(sourceText, correction) },
    ],
  };
}

function createSystemPrompt() {
  return [
    'You are AgoraBabel, a no-fallback market-intelligence agent.',
    'Return only JSON matching the supplied schema fields. Do not use Markdown.',
    'The response root must be one JSON object, never an array or a list of claim objects.',
    'Every response must include top-level keys source, claim, resolver, candidateMarkets, rejectedMarkets, criticVerdict, and rejectionReason.',
    'Never return a short refusal object such as rejected/reason.',
    'Reject unless the source proves a concrete event claim, named actors, and an explicit deadline derived from the source. Resolver URLs are candidate hints that will be independently discovered and verified online.',
    'resolver.url and candidateMarkets[0].resolverUrl must be the same absolute http or https URL. Prefer official URLs copied from the source; otherwise use the official homepage for the named resolver body, never a news article URL.',
    'Never omit criticVerdict.draftId, criticVerdict.reasoning, or criticVerdict.failedRules.',
    'The accepted market, if any, must be binary YES/NO, source-specific, deadline-bounded, and resolvable by the named official body.',
    'candidateMarkets[0].marketBalance must estimate YES and NO probabilities from the source evidence, not from live betting markets. yesProbability and noProbability must be integers that sum to 100.',
    'Use marketBalance.balanceVerdict="too-lopsided" if YES is below 15 or above 85; such markets should be rejected because almost nobody would rationally take the other side.',
    'Use marketBalance.balanceVerdict="insufficient-evidence" if the source does not support an evidence-based probability estimate.',
    'When estimating market balance, consider whether the event has already happened or is pending, source strength, resolver publication status, remaining uncertainty before the deadline, and whether the source describes intent, negotiation, approval, rejection, delay, or final publication.',
    'Do not invent deadlines, resolvers, publication dates, URLs, confidence scores, or facts absent from the source.',
    'Never use placeholder wording: official sources, named authority, public authority, otherwise, market reaction.',
    'Rejected candidate markets must be specific alternatives based on the same source, not generic examples.',
  ].join(' ');
}

function createUserPrompt(sourceText: string, correction?: string) {
  return [
    correction ? `Correction: ${correction}` : '',
    'Extract one strict market-intelligence artifact from the source.',
    'The response root must be a single JSON object, not an array. Begin with { and end with }.',
    'Return one JSON object with exactly these top-level keys: source, claim, resolver, candidateMarkets, rejectedMarkets, criticVerdict, rejectionReason.',
    'Do not return {rejected, reason}. If rejecting, still fill every required object/array and set criticVerdict.decision="rejected" plus a non-null rejectionReason.',
    'criticVerdict must always include draftId, decision, checks, reasoning, and failedRules.',
    'If accepting, set criticVerdict.draftId to candidateMarkets[0].id, criticVerdict.decision="accepted", criticVerdict.failedRules=[], rejectionReason=null, candidateMarkets length 1, and rejectedMarkets length at least 2.',
    'Accept only if candidateMarkets[0].marketBalance.balanceVerdict="balanced" and yesProbability is between 15 and 85 inclusive.',
    'If rejecting, set criticVerdict.draftId to candidateMarkets[0].id when one candidate exists or null otherwise, set criticVerdict.failedRules to the failed rule names, and write a concrete criticVerdict.reasoning.',
    '',
    sourceText.slice(0, MAX_LLM_SOURCE_CHARS),
  ].filter(Boolean).join('\n');
}

export function parseLlmJsonObject(value: string) {
  const trimmed = value.trim();
  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('LLM response was not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LLM response JSON root was not an object.');
  }

  return parsed;
}

function isGroqSchemaValidationFailure(detail: string) {
  return /json_validate_failed|Generated JSON does not match the expected schema/i.test(detail);
}

function summarizeGroqDetail(detail: string) {
  return detail.slice(0, 1200);
}
