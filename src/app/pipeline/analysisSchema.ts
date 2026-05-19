import { z } from 'zod';
import { getAcceptedMarketGuardrailFailure } from './guardrails';

const nonEmptyText = z.string().trim().min(1);
const RejectedMarketRuleSchema = z.enum(['ambiguity', 'no deadline', 'subjective wording', 'weak resolution']);

export const MarketQuestionSchema = z.object({
  id: nonEmptyText,
  question: nonEmptyText,
  yesCriteria: nonEmptyText,
  noCriteria: nonEmptyText,
  deadline: nonEmptyText,
  resolutionSource: nonEmptyText,
  evidenceSummary: nonEmptyText,
  confidenceScore: z.number().min(0).max(100),
}).strict();

export const CriticCheckSchema = z.object({
  ambiguity: z.enum(['pass', 'fail']),
  resolvability: z.enum(['pass', 'fail']),
  deadline: z.enum(['pass', 'fail']),
  evidence: z.enum(['pass', 'fail']),
  resolutionSource: z.enum(['pass', 'fail']),
}).strict();

export const CriticVerdictSchema = z.object({
  draftId: nonEmptyText.nullable(),
  decision: z.enum(['accepted', 'rejected']),
  checks: CriticCheckSchema,
  reasoning: nonEmptyText,
  violatedRule: RejectedMarketRuleSchema.optional(),
}).strict();

export const RejectedMarketReviewSchema = z.object({
  draftId: nonEmptyText,
  question: nonEmptyText,
  reasonRejected: nonEmptyText,
  violatedRule: RejectedMarketRuleSchema,
}).strict();

export const AnalysisResultSchema = z.object({
  detectedLanguage: nonEmptyText,
  region: nonEmptyText,
  sourceType: z.enum(['article', 'url_article', 'official_report', 'social_post', 'other']),
  extractedSource: z.object({
    title: nonEmptyText,
    domain: nonEmptyText,
    url: nonEmptyText,
    text: nonEmptyText,
  }).strict().nullable(),
  entities: z.array(nonEmptyText).max(12),
  eventSummary: nonEmptyText,
  marketRelevance: z.object({
    level: z.enum(['Low', 'Medium', 'High']),
    explanation: nonEmptyText,
    hasDeadlineableEvent: z.boolean(),
  }).strict(),
  candidateMarkets: z.array(MarketQuestionSchema).max(3),
  criticVerdict: CriticVerdictSchema,
  rejectedMarkets: z.array(RejectedMarketReviewSchema).max(3),
  acceptedMarket: MarketQuestionSchema.nullable(),
  rejectionReason: nonEmptyText.nullable(),
}).strict().superRefine((value, context) => {
  if (value.acceptedMarket && value.criticVerdict.decision !== 'accepted') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['criticVerdict', 'decision'],
      message: 'Accepted market requires an accepted critic verdict.',
    });
  }

  if (value.acceptedMarket) {
    if (value.rejectedMarkets.length < 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rejectedMarkets'],
        message: 'Accepted analyses require at least two rejected market candidates.',
      });
    }

    if (!value.candidateMarkets.some((candidate) => candidate.id === value.acceptedMarket?.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['acceptedMarket', 'id'],
        message: 'Accepted market must match a candidate market id.',
      });
    }

    for (const rejectedMarket of value.rejectedMarkets) {
      if (rejectedMarket.draftId === value.acceptedMarket.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rejectedMarkets'],
          message: 'Rejected market list cannot include the accepted draft.',
        });
      }
    }

    const failure = getAcceptedMarketGuardrailFailure(value.acceptedMarket, value.criticVerdict);

    if (failure) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['acceptedMarket'],
        message: failure,
      });
    }
  }

  if (!value.acceptedMarket && !value.rejectionReason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rejectionReason'],
      message: 'Rejected inputs require a rejection reason.',
    });
  }
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const analyzeRequestSchema = z.object({
  sourceText: z.string().trim().min(1, 'Paste article text or an article URL.').max(20000),
}).strict();

export const analysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'detectedLanguage',
    'region',
    'sourceType',
    'extractedSource',
    'entities',
    'eventSummary',
    'marketRelevance',
    'candidateMarkets',
    'criticVerdict',
    'rejectedMarkets',
    'acceptedMarket',
    'rejectionReason',
  ],
  properties: {
    detectedLanguage: { type: 'string' },
    region: { type: 'string' },
    sourceType: { type: 'string', enum: ['article', 'url_article', 'official_report', 'social_post', 'other'] },
    extractedSource: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'domain', 'url', 'text'],
          properties: {
            title: { type: 'string' },
            domain: { type: 'string' },
            url: { type: 'string' },
            text: { type: 'string' },
          },
        },
        { type: 'null' },
      ],
    },
    entities: { type: 'array', items: { type: 'string' } },
    eventSummary: { type: 'string' },
    marketRelevance: {
      type: 'object',
      additionalProperties: false,
      required: ['level', 'explanation', 'hasDeadlineableEvent'],
      properties: {
        level: { type: 'string', enum: ['Low', 'Medium', 'High'] },
        explanation: { type: 'string' },
        hasDeadlineableEvent: { type: 'boolean' },
      },
    },
    candidateMarkets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'question',
          'yesCriteria',
          'noCriteria',
          'deadline',
          'resolutionSource',
          'evidenceSummary',
          'confidenceScore',
        ],
        properties: {
          id: { type: 'string' },
          question: { type: 'string' },
          yesCriteria: { type: 'string' },
          noCriteria: { type: 'string' },
          deadline: { type: 'string' },
          resolutionSource: { type: 'string' },
          evidenceSummary: { type: 'string' },
          confidenceScore: { type: 'number' },
        },
      },
    },
    criticVerdict: {
      type: 'object',
      additionalProperties: false,
      required: ['draftId', 'decision', 'checks', 'reasoning'],
      properties: {
        draftId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        decision: { type: 'string', enum: ['accepted', 'rejected'] },
        checks: {
          type: 'object',
          additionalProperties: false,
          required: ['ambiguity', 'resolvability', 'deadline', 'evidence', 'resolutionSource'],
          properties: {
            ambiguity: { type: 'string', enum: ['pass', 'fail'] },
            resolvability: { type: 'string', enum: ['pass', 'fail'] },
            deadline: { type: 'string', enum: ['pass', 'fail'] },
            evidence: { type: 'string', enum: ['pass', 'fail'] },
            resolutionSource: { type: 'string', enum: ['pass', 'fail'] },
          },
        },
        reasoning: { type: 'string' },
      },
    },
    rejectedMarkets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['draftId', 'question', 'reasonRejected', 'violatedRule'],
        properties: {
          draftId: { type: 'string' },
          question: { type: 'string' },
          reasonRejected: { type: 'string' },
          violatedRule: { type: 'string', enum: ['ambiguity', 'no deadline', 'subjective wording', 'weak resolution'] },
        },
      },
    },
    acceptedMarket: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'question',
            'yesCriteria',
            'noCriteria',
            'deadline',
            'resolutionSource',
            'evidenceSummary',
            'confidenceScore',
          ],
          properties: {
            id: { type: 'string' },
            question: { type: 'string' },
            yesCriteria: { type: 'string' },
            noCriteria: { type: 'string' },
            deadline: { type: 'string' },
            resolutionSource: { type: 'string' },
            evidenceSummary: { type: 'string' },
            confidenceScore: { type: 'number' },
          },
        },
        { type: 'null' },
      ],
    },
    rejectionReason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const;
