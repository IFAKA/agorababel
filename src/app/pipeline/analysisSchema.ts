import { z } from 'zod';

const nonEmptyText = z.string().trim().min(1);
const absoluteHttpUrl = z.string().trim().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Invalid http(s) url');
const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/i);
const hex32 = z.string().regex(/^0x[a-f0-9]{64}$/i);

export const PipelineStageSchema = z.enum([
  'runtime-config',
  'source-extraction',
  'claim-extraction',
  'resolver-discovery',
  'resolver-verification',
  'market-comparison',
  'market-drafting',
  'critic-review',
  'circle-wallet',
  'arc-trace-commit',
  'x402-publication',
  'complete',
]);

export const EvidenceSnippetSchema = z.object({
  text: nonEmptyText,
  source: nonEmptyText,
}).strict();

export const SimilarMarketSchema = z.object({
  title: nonEmptyText,
  url: absoluteHttpUrl,
  source: nonEmptyText,
  similarity: z.enum(['low', 'medium', 'high']),
}).strict();

export const MarketQuestionSchema = z.object({
  id: nonEmptyText,
  question: nonEmptyText,
  yesCriteria: nonEmptyText,
  noCriteria: nonEmptyText,
  deadline: z.string().date(),
  resolverName: nonEmptyText,
  resolverUrl: absoluteHttpUrl,
  evidenceSummary: nonEmptyText,
}).strict();

export const CriticCheckSchema = z.object({
  binary: z.enum(['pass', 'fail']),
  resolver: z.enum(['pass', 'fail']),
  deadline: z.enum(['pass', 'fail']),
  evidence: z.enum(['pass', 'fail']),
  novelty: z.enum(['pass', 'fail']),
  placeholderFree: z.enum(['pass', 'fail']),
}).strict();

export const CriticVerdictSchema = z.object({
  draftId: nonEmptyText.nullable(),
  decision: z.enum(['accepted', 'rejected']),
  checks: CriticCheckSchema,
  reasoning: nonEmptyText,
  failedRules: z.array(nonEmptyText),
}).strict();

export const RejectedMarketReviewSchema = z.object({
  draftId: nonEmptyText,
  question: nonEmptyText,
  reasonRejected: nonEmptyText,
  violatedRule: z.enum(['ambiguity', 'no deadline', 'subjective wording', 'weak resolution', 'duplicate', 'placeholder wording']),
}).strict();

export const ArcTraceSchema = z.object({
  status: z.enum(['committed', 'failed']),
  artifactHash: hex32,
  sourceHash: hex32,
  transactionHash: z.string().regex(/^0x[a-f0-9]{64}$/i),
  chainId: z.literal(5042002),
  network: z.literal('Arc Testnet'),
  explorerUrl: absoluteHttpUrl,
  committedAt: nonEmptyText,
}).strict();

export const CircleAgentWalletStatusSchema = z.object({
  status: z.enum(['ready', 'unconfigured', 'failed']),
  walletId: nonEmptyText.nullable(),
  walletSetId: nonEmptyText.nullable(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).nullable(),
  blockchain: z.literal('ARC-TESTNET'),
  checkedAt: nonEmptyText,
  error: nonEmptyText.nullable(),
}).strict();

export const X402PublicationStatusSchema = z.object({
  status: z.enum(['required', 'disabled', 'failed']),
  artifactId: nonEmptyText,
  priceUsdcMicro: z.number().int().positive().nullable(),
  payToAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).nullable(),
  facilitatorUrl: absoluteHttpUrl.nullable(),
  gatewayUrl: absoluteHttpUrl.nullable(),
  network: nonEmptyText.nullable(),
  intelligenceUrl: nonEmptyText,
  demoUnlockUrl: nonEmptyText.nullable(),
}).strict();

export const AnalysisResultSchema = z.object({
  runId: nonEmptyText,
  status: z.enum(['accepted', 'rejected']),
  stage: PipelineStageSchema,
  source: z.object({
    inputType: z.enum(['text', 'url']),
    title: nonEmptyText,
    url: absoluteHttpUrl.nullable(),
    domain: nonEmptyText.nullable(),
    language: nonEmptyText,
    publishedAt: z.string().datetime().nullable(),
    extractedTextHash: sha256Hex,
  }).strict(),
  claim: z.object({
    summary: nonEmptyText,
    region: nonEmptyText,
    actors: z.array(nonEmptyText).min(1).max(12),
    eventType: nonEmptyText,
    deadline: z.string().date(),
    evidence: z.array(EvidenceSnippetSchema).min(1).max(8),
  }).strict(),
  resolver: z.object({
    name: nonEmptyText,
    url: absoluteHttpUrl,
    verificationStatus: z.literal('verified'),
    verificationEvidence: nonEmptyText,
  }).strict().nullable(),
  marketComparison: z.object({
    status: z.literal('checked'),
    similarMarkets: z.array(SimilarMarketSchema).max(8),
    noveltyVerdict: z.enum(['new-opportunity', 'duplicate', 'too-close']),
    reasoning: nonEmptyText,
  }).strict().nullable(),
  candidateMarkets: z.array(MarketQuestionSchema).max(1),
  rejectedMarkets: z.array(RejectedMarketReviewSchema).max(4),
  criticVerdict: CriticVerdictSchema,
  acceptedMarket: MarketQuestionSchema.nullable(),
  arcTrace: ArcTraceSchema.nullable(),
  circleAgentWallet: CircleAgentWalletStatusSchema,
  x402: X402PublicationStatusSchema.nullable(),
  rejectionReason: nonEmptyText.nullable(),
}).strict().superRefine((value, context) => {
  if (value.status === 'accepted') {
    if (!value.acceptedMarket) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['acceptedMarket'], message: 'Accepted result requires acceptedMarket.' });
    }

    if (!value.resolver) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['resolver'], message: 'Accepted result requires a verified resolver.' });
    }

    if (!value.marketComparison) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['marketComparison'], message: 'Accepted result requires market comparison.' });
    }

    if (value.candidateMarkets.length !== 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['candidateMarkets'], message: 'Accepted result requires exactly one candidate market.' });
    }

    if (value.rejectedMarkets.length < 2) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['rejectedMarkets'], message: 'Accepted result requires at least two rejected alternatives.' });
    }

    if (value.criticVerdict.decision !== 'accepted') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['criticVerdict', 'decision'], message: 'Accepted result requires accepted critic verdict.' });
    }

    if (value.arcTrace?.status !== 'committed') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['arcTrace'], message: 'Accepted result requires committed Arc trace.' });
    }

    if (value.circleAgentWallet.status !== 'ready') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['circleAgentWallet', 'status'], message: 'Accepted result requires ready Circle wallet.' });
    }

    if (value.marketComparison?.noveltyVerdict !== 'new-opportunity') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['marketComparison', 'noveltyVerdict'], message: 'Accepted result requires a new-opportunity novelty verdict.' });
    }

    if (value.rejectionReason !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['rejectionReason'], message: 'Accepted result cannot include a rejection reason.' });
    }
  }

  if (value.status === 'rejected') {
    if (value.acceptedMarket !== null || value.arcTrace !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['acceptedMarket'], message: 'Rejected result cannot include accepted market or Arc trace.' });
    }

    if (!value.rejectionReason) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['rejectionReason'], message: 'Rejected result requires rejectionReason.' });
    }
  }

  const forbidden = /\b(official sources|named authority|public authority|otherwise|market reaction|named public authority)\b/i;
  const acceptedText = value.acceptedMarket
    ? [value.acceptedMarket.question, value.acceptedMarket.yesCriteria, value.acceptedMarket.noCriteria, value.acceptedMarket.resolverName].join(' ')
    : '';

  if (acceptedText && forbidden.test(acceptedText)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['acceptedMarket'], message: 'Accepted market contains placeholder wording.' });
  }
});

export type PipelineStage = z.infer<typeof PipelineStageSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type MarketQuestion = z.infer<typeof MarketQuestionSchema>;
export type RejectedMarketReview = z.infer<typeof RejectedMarketReviewSchema>;
export type CriticVerdict = z.infer<typeof CriticVerdictSchema>;
export type CircleAgentWalletStatus = z.infer<typeof CircleAgentWalletStatusSchema>;
export type X402PublicationStatus = z.infer<typeof X402PublicationStatusSchema>;

export const analyzeRequestSchema = z.object({
  sourceText: z.string().trim().min(1, 'Paste article text or an article URL.').max(40000),
}).strict();

export const analysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'claim', 'resolver', 'candidateMarkets', 'rejectedMarkets', 'criticVerdict', 'rejectionReason'],
  properties: {
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['language', 'publishedAt'],
      properties: {
        language: { type: 'string' },
        publishedAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
    },
    claim: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'region', 'actors', 'eventType', 'deadline', 'evidence'],
      properties: {
        summary: { type: 'string' },
        region: { type: 'string' },
        actors: { type: 'array', minItems: 1, items: { type: 'string' } },
        eventType: { type: 'string' },
        deadline: { type: 'string' },
        evidence: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['text', 'source'],
            properties: {
              text: { type: 'string' },
              source: { type: 'string' },
            },
          },
        },
      },
    },
    resolver: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'url', 'verificationEvidence'],
      properties: {
        name: { type: 'string' },
        url: { type: 'string', pattern: '^https?://[^\\s]+$' },
        verificationEvidence: { type: 'string' },
      },
    },
    candidateMarkets: {
      type: 'array',
      minItems: 1,
      maxItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'question', 'yesCriteria', 'noCriteria', 'deadline', 'resolverName', 'resolverUrl', 'evidenceSummary'],
        properties: {
          id: { type: 'string' },
          question: { type: 'string' },
          yesCriteria: { type: 'string' },
          noCriteria: { type: 'string' },
          deadline: { type: 'string' },
          resolverName: { type: 'string' },
          resolverUrl: { type: 'string', pattern: '^https?://[^\\s]+$' },
          evidenceSummary: { type: 'string' },
        },
      },
    },
    rejectedMarkets: {
      type: 'array',
      minItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['draftId', 'question', 'reasonRejected', 'violatedRule'],
        properties: {
          draftId: { type: 'string' },
          question: { type: 'string' },
          reasonRejected: { type: 'string' },
          violatedRule: { type: 'string', enum: ['ambiguity', 'no deadline', 'subjective wording', 'weak resolution', 'duplicate', 'placeholder wording'] },
        },
      },
    },
    criticVerdict: {
      type: 'object',
      additionalProperties: false,
      required: ['draftId', 'decision', 'checks', 'reasoning', 'failedRules'],
      properties: {
        draftId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        decision: { type: 'string', enum: ['accepted', 'rejected'] },
        checks: {
          type: 'object',
          additionalProperties: false,
          required: ['binary', 'resolver', 'deadline', 'evidence', 'novelty', 'placeholderFree'],
          properties: {
            binary: { type: 'string', enum: ['pass', 'fail'] },
            resolver: { type: 'string', enum: ['pass', 'fail'] },
            deadline: { type: 'string', enum: ['pass', 'fail'] },
            evidence: { type: 'string', enum: ['pass', 'fail'] },
            novelty: { type: 'string', enum: ['pass', 'fail'] },
            placeholderFree: { type: 'string', enum: ['pass', 'fail'] },
          },
        },
        reasoning: { type: 'string' },
        failedRules: { type: 'array', items: { type: 'string' } },
      },
    },
    rejectionReason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
};
