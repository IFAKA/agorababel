export type AgentRunStatus = 'idle' | 'running' | 'trace-committed' | 'complete' | 'failed';

export type PipelineRunStatus = AgentRunStatus;

export type PipelineStepStatus = 'pending' | 'running' | 'complete' | 'failed';

export type MarketRelevance = 'Low' | 'Medium' | 'High';

export type SourceAnalysis = {
  signalName: string;
  language: string;
  languageConfidence: number;
  source: string;
  sourceUrl?: string;
  sourceDate: string;
  entities: string[];
  region: string;
  topic: string;
};

export type ContextAnalysis = {
  englishSummary: string;
  marketRelevance: MarketRelevance;
  relevanceExplanation: string;
  evidenceSummary: string;
};

export type Submission = {
  id: string;
  sourceText: string;
  scenarioId?: string;
  submittedAt: string;
};

export type ExtractedSource = {
  title: string;
  domain: string;
  url: string;
  text: string;
};

export type MarketQuestion = {
  id: string;
  question: string;
  yesCriteria: string;
  noCriteria: string;
  deadline: string;
  resolutionSource: string;
  evidenceSummary: string;
  confidenceScore: number;
};

export type MarketQuestionDraft = MarketQuestion;

export type RejectedMarketRule = 'ambiguity' | 'no deadline' | 'subjective wording' | 'weak resolution';

export type CriticCheck = {
  ambiguity: 'pass' | 'fail';
  resolvability: 'pass' | 'fail';
  deadline: 'pass' | 'fail';
  evidence: 'pass' | 'fail';
  resolutionSource: 'pass' | 'fail';
};

export type CriticVerdict = {
  draftId: string | null;
  decision: 'accepted' | 'rejected';
  checks: CriticCheck;
  reasoning: string;
  violatedRule?: RejectedMarketRule;
};

export type CriticReview = CriticVerdict;

export type RejectedMarketReview = {
  draftId: string;
  question: string;
  reasonRejected: string;
  violatedRule: RejectedMarketRule;
};

export type AcceptedMarket = MarketQuestion & {
  criticReasoning: string;
};

export type ArcTrace = {
  traceHash: string;
  transactionId: string;
  network: string;
  status: 'pending' | 'simulated' | 'committed' | 'failed';
  timestamp: string;
  explorerUrl?: string;
};

export type TraceRecord = ArcTrace;

export type PipelineStep = {
  id: 'extraction' | 'ingestion' | 'context' | 'market-creator' | 'critic' | 'settlement';
  title: string;
  agentName: string;
  action: string;
  reasoningSnippet: string;
  outputSummary: string;
  status: PipelineStepStatus;
};

export type ActivityEvent = {
  id: string;
  timestamp: string;
  agentName: string;
  status: PipelineStepStatus | 'accepted' | 'rejected' | 'committed';
  message: string;
  reasoningSnippet: string;
};

export type PipelineErrorBrief = {
  title: string;
  stage: PipelineStep['id'] | 'orchestrator' | 'api';
  statusCode?: number;
  message: string;
  likelyCause: string;
  agentPrompt: string;
  debuggingContext: string[];
};

export type AgentRun = {
  id: string;
  status: PipelineRunStatus;
  submission: Submission;
  sourceInput: string;
  extractedSource?: ExtractedSource;
  ingestion?: SourceAnalysis;
  context?: ContextAnalysis;
  candidateMarkets: MarketQuestion[];
  criticReviews: CriticVerdict[];
  rejectedMarkets: RejectedMarketReview[];
  acceptedMarket?: AcceptedMarket;
  trace?: ArcTrace;
  analyzedInMs?: number;
  steps: PipelineStep[];
  activityFeed: ActivityEvent[];
  createdAt: string;
  updatedAt: string;
  error?: string;
  errorBrief?: PipelineErrorBrief;
};

export type PipelineRun = AgentRun;

export type PipelineInput = {
  sourceText: string;
  scenario?: DemoScenario;
};

export type TracePayload = {
  runId: string;
  sourceInput: string;
  ingestion: SourceAnalysis;
  context: ContextAnalysis;
  candidateMarkets: MarketQuestion[];
  criticReviews: CriticVerdict[];
  rejectedMarkets: RejectedMarketReview[];
  acceptedMarket: AcceptedMarket;
  steps: PipelineStep[];
};

export type DemoScenario = {
  id: string;
  title: string;
  sourceText: string;
  expectedAcceptedMarket: MarketQuestion;
  sourceIntelligence: {
    sourceLanguage: string;
    localSource: string;
    region: string;
    topic: string;
    resolvabilityScore: string;
  };
  disclosureText: string;
};

export type PipelineRunUpdate =
  | { type: 'run-started'; run: PipelineRun }
  | { type: 'step-started'; run: PipelineRun; step: PipelineStep }
  | { type: 'step-completed'; run: PipelineRun; step: PipelineStep }
  | { type: 'trace-committed'; run: PipelineRun; trace: TraceRecord }
  | { type: 'run-completed'; run: PipelineRun }
  | { type: 'run-failed'; run: PipelineRun; error: string };

export type PipelineProvider = {
  run(input: PipelineInput): AsyncGenerator<PipelineRunUpdate>;
};

export type TraceProvider = {
  commit(payload: TracePayload): Promise<TraceRecord>;
};
