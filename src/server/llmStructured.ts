import { z } from 'zod';
import { analysisJsonSchema } from '../app/pipeline/analysisSchema';
import { getRuntimeConfig } from './config';

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
    url: z.string().url(),
    verificationEvidence: z.string().trim().min(1),
  }).strict(),
  candidateMarkets: z.array(z.object({
    id: z.string().trim().min(1),
    question: z.string().trim().min(1),
    yesCriteria: z.string().trim().min(1),
    noCriteria: z.string().trim().min(1),
    deadline: z.string().trim().min(1),
    resolverName: z.string().trim().min(1),
    resolverUrl: z.string().url(),
    evidenceSummary: z.string().trim().min(1),
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

export async function analyzeWithConfiguredLlm(sourceText: string): Promise<LlmDraft> {
  const config = getRuntimeConfig();
  const content = config.provider === 'groq'
    ? await callGroq(sourceText)
    : await callOpenAI(sourceText);
  const parsedJson = JSON.parse(extractJsonObject(content));
  const parsed = LlmDraftSchema.safeParse(parsedJson);

  if (!parsed.success) {
    throw new Error(`LLM malformed JSON: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }

  return parsed.data;
}

async function callGroq(sourceText: string) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is required when ANALYSIS_PROVIDER=groq.');
  }

  const config = getRuntimeConfig();
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'agorababel_pipeline_draft',
          schema: analysisJsonSchema,
        },
      },
      messages: [
        { role: 'system', content: createSystemPrompt() },
        {
          role: 'user',
          content: [
            'Extract one strict market-intelligence artifact from the source.',
            'Return one JSON object with exactly these top-level keys: source, claim, resolver, candidateMarkets, rejectedMarkets, criticVerdict, rejectionReason.',
            'Do not return {rejected, reason}. If rejecting, still fill every required object/array and set criticVerdict.decision="rejected" plus a non-null rejectionReason.',
            'If accepting, set criticVerdict.decision="accepted", failedRules=[], rejectionReason=null, candidateMarkets length 1, and rejectedMarkets length at least 2.',
            '',
            sourceText.slice(0, 30000),
          ].join('\n'),
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Groq analysis failed with HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }

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
        { role: 'user', content: `Extract one strict market-intelligence artifact or reject.\n\n${sourceText.slice(0, 30000)}` },
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

function createSystemPrompt() {
  return [
    'You are AgoraBabel, a no-fallback market-intelligence agent.',
    'Return only JSON matching the supplied schema fields. Do not use Markdown.',
    'Every response must include top-level keys source, claim, resolver, candidateMarkets, rejectedMarkets, criticVerdict, and rejectionReason.',
    'Never return a short refusal object such as rejected/reason.',
    'Reject unless the source proves a concrete event claim, named actors, an explicit deadline derived from the source, and an exact official resolver URL.',
    'The accepted market, if any, must be binary YES/NO, source-specific, deadline-bounded, and resolvable by the named official body.',
    'Do not invent deadlines, resolvers, publication dates, URLs, confidence scores, or facts absent from the source.',
    'Never use placeholder wording: official sources, named authority, public authority, otherwise, market reaction.',
    'Rejected candidate markets must be specific alternatives based on the same source, not generic examples.',
  ].join(' ');
}

function extractJsonObject(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error('LLM response did not contain a JSON object.');
}
