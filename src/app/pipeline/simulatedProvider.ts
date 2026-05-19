import { sampleArticle } from '../sampleArticleData';
import type {
  AcceptedMarket,
  ActivityEvent,
  AgentRun,
  ContextAnalysis,
  CriticVerdict,
  DemoScenario,
  MarketQuestion,
  PipelineInput,
  PipelineProvider,
  PipelineRun,
  PipelineRunUpdate,
  PipelineStep,
  PipelineStepStatus,
  RejectedMarketReview,
  Submission,
  SourceAnalysis,
  TracePayload,
  TraceProvider,
  ArcTrace,
} from './types';

const STEP_DELAY_MS = 650;
let activitySequence = 0;

export class SimulatedArcTraceProvider implements TraceProvider {
  async commit(payload: TracePayload): Promise<ArcTrace> {
    return createArcTrace(payload);
  }
}

export class SimulatedPipelineProvider implements PipelineProvider {
  constructor(private readonly traceProvider: TraceProvider = new SimulatedArcTraceProvider()) {}

  async *run(input: PipelineInput): AsyncGenerator<PipelineRunUpdate> {
    const submission = createSubmission(input.sourceText, input.scenario);
    const resolvedRun = createResolvedPipelineRun(submission.sourceText, submission);
    let run = runAgentPipeline(submission);
    run = updateRun(run, { status: 'running' });
    run = appendActivity(run, 'AgoraBabel Orchestrator', 'running', 'Run started from submitted source.', 'The workflow keeps each agent output visible for audit.');
    yield { type: 'run-started', run };

    try {
      for (const step of resolvedRun.steps) {
        run = hydrateStep(run, step);
        run = updateStep(run, step.id, 'running');
        run = appendActivity(run, step.agentName, 'running', step.action, step.reasoningSnippet);
        yield { type: 'step-started', run, step: run.steps.find((item) => item.id === step.id)! };

        await wait(STEP_DELAY_MS);

        run = revealStepArtifacts(run, resolvedRun, step.id);
        run = updateStep(run, step.id, 'complete');
        run = appendActivity(run, step.agentName, 'complete', step.outputSummary, step.reasoningSnippet);
        yield { type: 'step-completed', run, step: run.steps.find((item) => item.id === step.id)! };
      }

      const trace = await this.traceProvider.commit({
        runId: run.id,
        sourceInput: run.sourceInput,
        ingestion: resolvedRun.ingestion!,
        context: resolvedRun.context!,
        candidateMarkets: resolvedRun.candidateMarkets,
        criticReviews: resolvedRun.criticReviews,
        rejectedMarkets: resolvedRun.rejectedMarkets,
        acceptedMarket: resolvedRun.acceptedMarket!,
        steps: run.steps,
      });

      run = updateRun(run, { status: 'trace-committed', trace });
      run = appendActivity(run, 'Local Trace', 'committed', 'Local trace hash generated. Arc commit pending.', 'The local trace hash fingerprints source, agent artifacts, critic verdicts, and the accepted market.');
      yield { type: 'trace-committed', run, trace };

      run = updateRun(run, { status: 'complete' });
      run = appendActivity(run, 'Final Output', 'accepted', 'Best accepted YES/NO market is ready to copy.', resolvedRun.acceptedMarket!.criticReasoning);
      yield { type: 'run-completed', run };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pipeline failed.';
      run = updateRun(run, { status: 'failed', error: message });
      run = appendActivity(run, 'AgoraBabel Orchestrator', 'failed', message, 'The run stopped before a final market could be validated.');
      yield { type: 'run-failed', run, error: message };
    }
  }
}

export function createSubmission(sourceText: string, scenario?: DemoScenario): Submission {
  const normalizedSource = sourceText.trim() || scenario?.sourceText || '';
  const scenarioId = scenario?.id ?? 'real-data';

  return {
    id: `submission-${awaitlessShaSeed(`${scenarioId}:${normalizedSource}`)}`,
    sourceText: normalizedSource,
    scenarioId: scenario?.id,
    submittedAt: new Date().toISOString(),
  };
}

export function runAgentPipeline(submission: Submission): AgentRun {
  return createPendingPipelineRun(submission.sourceText, submission);
}

export function generateMarket(ingestion: SourceAnalysis, context: ContextAnalysis): MarketQuestion[] {
  return createCandidateMarkets(ingestion, context);
}

export function validateMarket(candidateMarkets: MarketQuestion[]): CriticVerdict[] {
  return createCriticReviews(candidateMarkets);
}

export async function createArcTrace(agentRun: AgentRun | TracePayload): Promise<ArcTrace> {
  if (!('runId' in agentRun) && (!agentRun.ingestion || !agentRun.context || !agentRun.acceptedMarket)) {
    throw new Error('Cannot create a local trace hash before the pipeline has accepted a market.');
  }

  const payload = 'runId' in agentRun
    ? agentRun
    : {
        runId: agentRun.id,
        sourceInput: agentRun.sourceInput,
        ingestion: agentRun.ingestion!,
        context: agentRun.context!,
        candidateMarkets: agentRun.candidateMarkets,
        criticReviews: agentRun.criticReviews,
        rejectedMarkets: agentRun.rejectedMarkets,
        acceptedMarket: agentRun.acceptedMarket!,
        steps: agentRun.steps,
      };
  const traceHash = await sha256Hex(canonicalJson(payload));

  return {
    traceHash: `sha256:${traceHash}`,
    transactionId: 'Arc commit pending',
    network: 'Local trace hash',
    status: 'pending',
    timestamp: new Date().toISOString(),
  };
}

export function createPendingPipelineRun(sourceText: string, submission = createSubmission(sourceText)): PipelineRun {
  const sourceInput = sourceText.trim();
  const now = new Date().toISOString();

  return {
    id: `run-${awaitlessShaSeed(sourceInput)}`,
    status: 'idle',
    submission,
    sourceInput,
    candidateMarkets: [],
    criticReviews: [],
    rejectedMarkets: [],
    steps: createQueuedPipelineSteps(),
    activityFeed: [
      {
        id: `activity-${awaitlessShaSeed(sourceInput)}-queued`,
        timestamp: now,
        agentName: 'Source Queue',
        status: 'pending',
        message: 'Source text or URL queued for ingestion.',
        reasoningSnippet: 'The product starts with raw local-language evidence, not a trading signal.',
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function createResolvedPipelineRun(sourceText: string, submission = createSubmission(sourceText)): PipelineRun {
  const sourceInput = sourceText.trim() || sampleArticle.sourceText;
  const ingestion = ingestSource(sourceInput);
  const context = createContext(ingestion);
  const candidateMarkets = generateMarket(ingestion, context);
  const criticReviews = validateMarket(candidateMarkets);
  const rejectedMarkets = createRejectedMarketReviews(candidateMarkets, criticReviews);
  const acceptedMarket = createAcceptedMarket(candidateMarkets, criticReviews);
  const now = new Date().toISOString();

  return {
    id: `run-${awaitlessShaSeed(sourceInput)}`,
    status: 'idle',
    submission,
    sourceInput,
    ingestion,
    context,
    candidateMarkets,
    criticReviews,
    rejectedMarkets,
    acceptedMarket,
    steps: createPipelineSteps(ingestion, context, candidateMarkets, criticReviews, acceptedMarket),
    activityFeed: [
      {
        id: `activity-${awaitlessShaSeed(sourceInput)}-queued`,
        timestamp: now,
        agentName: 'Source Queue',
        status: 'pending',
        message: 'Source text or URL queued for ingestion.',
        reasoningSnippet: 'The product starts with raw local-language evidence, not a trading signal.',
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export function createDemoArtifactRun(): PipelineRun {
  const submission = createSubmission(sampleArticle.sourceText);
  const resolvedRun = createResolvedPipelineRun(submission.sourceText, submission);
  const traceHash = awaitlessShaSeed(JSON.stringify({
    sourceInput: resolvedRun.sourceInput,
    acceptedMarket: resolvedRun.acceptedMarket,
    criticReviews: resolvedRun.criticReviews,
  }));
  const now = new Date().toISOString();

  return updateRun(resolvedRun, {
    status: 'complete',
    analyzedInMs: 0,
    trace: {
      traceHash: `local:${traceHash}`,
      transactionId: 'Arc commit pending',
      network: 'Local trace hash',
      status: 'pending',
      timestamp: now,
    },
    activityFeed: [
      {
        id: `activity-${traceHash}-local-trace`,
        timestamp: now,
        agentName: 'Local Trace',
        status: 'committed',
        message: 'Local trace hash loaded from bundled fallback.',
        reasoningSnippet: 'Arc commit pending.',
      },
      ...resolvedRun.activityFeed,
    ],
  });
}

function createQueuedPipelineSteps(): PipelineStep[] {
  return [
    createStep('extraction', 'Source Extraction', 'Source Extraction Agent', 'Prepare submitted text or article content for analysis.', 'Waiting for the submitted source.', 'Source content will appear after extraction.'),
    createStep('ingestion', 'Source Scout', 'Source Scout Agent', 'Parse language, source, date, entities, region, and source credibility.', 'Waiting for the submitted source.', 'Source metadata will appear after ingestion.'),
    createStep('context', 'Signal Analyst', 'Signal Analyst Agent', 'Translate the report, identify market relevance, and estimate English-market lag.', 'Waiting for source extraction.', 'Context summary will appear after translation.'),
    createStep('market-creator', 'Market Structurer', 'Market Structurer Agent', 'Generate objective, binary, time-bounded market candidates from the signal.', 'Waiting for translated context.', 'Candidate markets will appear after structuring.'),
    createStep('critic', 'Resolution Critic', 'Resolution Critic Agent', 'Reject weak candidates and approve only markets with clear criteria and public resolution.', 'Waiting for candidates.', 'Critic verdicts will appear after validation.'),
    createStep('settlement', 'Audit Trace', 'Local Trace Agent', 'Package the accepted market with a local trace hash.', 'Waiting for an accepted market.', 'Local trace hash will appear after artifact packaging.'),
  ];
}

function hydrateStep(run: PipelineRun, sourceStep: PipelineStep): PipelineRun {
  return updateRun(run, {
    steps: run.steps.map((step) => (step.id === sourceStep.id ? { ...sourceStep, status: step.status } : step)),
  });
}

function revealStepArtifacts(run: PipelineRun, resolvedRun: PipelineRun, stepId: PipelineStep['id']): PipelineRun {
  if (stepId === 'ingestion') {
    return updateRun(run, { ingestion: resolvedRun.ingestion });
  }

  if (stepId === 'context') {
    return updateRun(run, { context: resolvedRun.context });
  }

  if (stepId === 'market-creator') {
    return updateRun(run, { candidateMarkets: resolvedRun.candidateMarkets });
  }

  if (stepId === 'critic') {
    return updateRun(run, {
      criticReviews: resolvedRun.criticReviews,
      rejectedMarkets: resolvedRun.rejectedMarkets,
      acceptedMarket: resolvedRun.acceptedMarket,
    });
  }

  return run;
}

function ingestSource(sourceInput: string): SourceAnalysis {
  const lowerText = sourceInput.toLowerCase();
  const language = lowerText.includes('merkez bankasi') || lowerText.includes('turkiye') || lowerText.includes('tcmb')
    ? 'Turkish'
    : lowerText.includes('funcionarios') || lowerText.includes('nacion') || lowerText.includes('decreto')
      ? 'Spanish'
      : lowerText.includes('nikkei')
        ? 'Japanese'
        : 'English';
  const source = lowerText.includes('dunya') ? 'Dunya' : lowerText.includes('nikkei') ? 'Nikkei' : lowerText.includes('diario financiero') ? 'Diario Financiero' : lowerText.includes('la nacion') ? 'La Nacion' : looksLikeUrl(sourceInput) ? new URL(sourceInput).hostname : 'Submitted source';
  const region = lowerText.includes('turkiye') || lowerText.includes('turkey') || lowerText.includes('tcmb') ? 'Turkey' : lowerText.includes('chile') ? 'Chile' : lowerText.includes('japan') ? 'Japan' : lowerText.includes('argentina') ? 'Argentina' : 'Unknown';
  const topic = lowerText.includes('tcmb') || lowerText.includes('merkez bankasi') || lowerText.includes('lira')
    ? 'Emergency monetary intervention'
    : lowerText.includes('lithium')
    ? 'Lithium permit decision'
    : lowerText.includes('subsid')
      ? 'Energy subsidy policy'
      : lowerText.includes('currency') || lowerText.includes('controles cambiarios')
        ? 'Currency controls policy'
        : 'Public policy event';
  const entities = detectEntities(sourceInput, region, topic);

  return {
    signalName: region === 'Unknown' ? topic : `${region} ${topic}`,
    language,
    languageConfidence: language === 'English' ? 88 : 97,
    source,
    sourceUrl: looksLikeUrl(sourceInput) ? sourceInput : undefined,
    sourceDate: detectDate(sourceInput) ?? '2026-05-14',
    entities,
    region,
    topic,
  };
}

function createContext(ingestion: SourceAnalysis): ContextAnalysis {
  const deadline = defaultDeadline(ingestion);
  const englishSummary = ingestion.region === 'Turkey'
    ? `Local Turkish reporting says TCMB officials are preparing an emergency rate or liquidity intervention before ${deadline}, with any qualifying action expected through an official central-bank publication.`
    : ingestion.region === 'Argentina' && ingestion.topic.includes('Currency')
    ? `Officials close to Argentina's central bank say the government is evaluating removal of currency controls before ${deadline}, contingent on an official decree.`
    : ingestion.region === 'Chile'
      ? `Chilean officials may publish a lithium extraction permit decision before ${deadline}.`
      : ingestion.region === 'Japan'
        ? `Japan may extend household electricity subsidies through ${deadline}, pending a cabinet announcement.`
        : `The submitted source describes a public policy event that may resolve before ${deadline}.`;

  return {
    englishSummary,
    marketRelevance: ingestion.region === 'Unknown' ? 'Medium' : 'High',
    relevanceExplanation: 'The signal is useful because it appears in local-language financial press before broad English coverage, names an authority, gives a deadline, and can resolve against a public source.',
    evidenceSummary: `${ingestion.source} mentions ${ingestion.entities.join(', ')} in ${ingestion.region}; the claim contains a public authority and a deadline candidate.`,
  };
}

function createCandidateMarkets(ingestion: SourceAnalysis, context: ContextAnalysis): MarketQuestion[] {
  const deadline = defaultDeadline(ingestion);
  const resolutionSource = getResolutionSource(ingestion);

  return [
    {
      id: 'draft-official-action',
      question: createQuestion(ingestion, deadline),
      yesCriteria: `YES if ${resolutionSource} publishes an announcement, decision, decree, or policy notice confirming the event before ${deadline}.`,
      noCriteria: `NO if ${resolutionSource} has not published a qualifying confirmation before ${deadline}, or publishes a rejection or delay beyond ${deadline}.`,
      deadline,
      resolutionSource,
      evidenceSummary: context.evidenceSummary,
      confidenceScore: 82,
    },
    {
      id: 'draft-news-confirmation',
      question: `Will major English-language outlets report that ${ingestion.signalName.toLowerCase()} happened before ${deadline}?`,
      yesCriteria: 'YES if at least two major English-language outlets report the event occurred.',
      noCriteria: 'NO otherwise.',
      deadline,
      resolutionSource: 'Major English-language news coverage',
      evidenceSummary: 'Rejected candidate included to show the critic filtering out source-lag and coverage-dependent wording.',
      confidenceScore: 55,
    },
    {
      id: 'draft-market-impact',
      question: `Will ${ingestion.region} markets react positively to ${ingestion.topic.toLowerCase()} before ${deadline}?`,
      yesCriteria: 'YES if selected market indicators move positively after the event.',
      noCriteria: 'NO if they do not.',
      deadline,
      resolutionSource: 'Market price movement',
      evidenceSummary: 'Rejected candidate included because AgoraBabel is not a profit-prediction or trading bot.',
      confidenceScore: 31,
    },
  ];
}

function createCriticReviews(drafts: MarketQuestion[]): CriticVerdict[] {
  return drafts.map((draft) => {
    if (draft.id === 'draft-official-action') {
      return {
        draftId: draft.id,
        decision: 'accepted',
        checks: {
          ambiguity: 'pass',
          resolvability: 'pass',
          deadline: 'pass',
          evidence: 'pass',
          resolutionSource: 'pass',
        },
        reasoning: 'Accepted: binary action, official source, explicit deadline, and evidence tied back to the original report.',
      };
    }

    if (draft.id === 'draft-news-confirmation') {
      return {
        draftId: draft.id,
        decision: 'rejected',
        checks: {
          ambiguity: 'fail',
          resolvability: 'fail',
          deadline: 'pass',
          evidence: 'pass',
          resolutionSource: 'fail',
        },
        reasoning: 'Rejected: coverage by English-language outlets is a proxy for attention, not the underlying event resolution.',
        violatedRule: 'weak resolution',
      };
    }

    return {
      draftId: draft.id,
      decision: 'rejected',
      checks: {
        ambiguity: 'fail',
        resolvability: 'fail',
        deadline: 'pass',
        evidence: 'fail',
        resolutionSource: 'fail',
      },
      reasoning: 'Rejected: asks for market reaction and profit-adjacent direction instead of an objective real-world outcome.',
      violatedRule: 'subjective wording',
    };
  });
}

function createRejectedMarketReviews(drafts: MarketQuestion[], reviews: CriticVerdict[]): RejectedMarketReview[] {
  return drafts.flatMap((draft) => {
    const review = reviews.find((item) => item.draftId === draft.id);

    if (review?.decision !== 'rejected') return [];

    return [{
      draftId: draft.id,
      question: draft.question,
      reasonRejected: review.reasoning,
      violatedRule: review.violatedRule ?? 'ambiguity',
    }];
  });
}

function createAcceptedMarket(drafts: MarketQuestion[], reviews: CriticVerdict[]): AcceptedMarket {
  const acceptedReview = reviews.find((review) => review.decision === 'accepted') ?? reviews[0];
  const draft = drafts.find((item) => item.id === acceptedReview.draftId) ?? drafts[0];

  return {
    ...draft,
    criticReasoning: acceptedReview.reasoning,
  };
}

function createPipelineSteps(
  ingestion: SourceAnalysis,
  context: ContextAnalysis,
  drafts: MarketQuestion[],
  reviews: CriticVerdict[],
  acceptedMarket: AcceptedMarket,
): PipelineStep[] {
  const acceptedCount = reviews.filter((review) => review.decision === 'accepted').length;

  return [
    createStep('extraction', 'Source Extraction', 'Source Extraction Agent', 'Prepare submitted text or article content for analysis.', 'Source text is available for analysis.', 'Prepared source content for language and entity detection.'),
    createStep('ingestion', 'Source Scout', 'Source Scout Agent', 'Parse language, source, date, entities, region, and source credibility.', `${ingestion.language} source with ${ingestion.entities.length} extracted entities and a named local outlet.`, `${ingestion.language} from ${ingestion.source}; region ${ingestion.region}; topic ${ingestion.topic}.`),
    createStep('context', 'Signal Analyst', 'Signal Analyst Agent', 'Translate the report, identify market relevance, and estimate English-market lag.', context.relevanceExplanation, context.englishSummary),
    createStep('market-creator', 'Market Structurer', 'Market Structurer Agent', 'Generate objective, binary, time-bounded market candidates from the signal.', `${drafts.length} candidate markets generated; one uses official-action resolution instead of English-news lag.`, `Drafted ${drafts.length} YES/NO candidates including "${acceptedMarket.question}"`),
    createStep('critic', 'Resolution Critic', 'Resolution Critic Agent', 'Reject weak candidates and approve only markets with clear criteria and public resolution.', `${acceptedCount}/${reviews.length} candidates accepted after ambiguity, evidence, and resolution checks.`, acceptedMarket.criticReasoning),
    createStep('settlement', 'Audit Trace', 'Local Trace Agent', 'Package the accepted market with a local trace hash.', 'Arc commit pending.', 'Prepared local trace hash metadata for the accepted artifact.'),
  ];
}

function createStep(
  id: PipelineStep['id'],
  title: string,
  agentName: string,
  action: string,
  reasoningSnippet: string,
  outputSummary: string,
): PipelineStep {
  return {
    id,
    title,
    agentName,
    action,
    reasoningSnippet,
    outputSummary,
    status: 'pending',
  };
}

function updateStep(run: PipelineRun, stepId: PipelineStep['id'], status: PipelineStepStatus): PipelineRun {
  return updateRun(run, {
    steps: run.steps.map((step) => (step.id === stepId ? { ...step, status } : step)),
  });
}

function appendActivity(
  run: PipelineRun,
  agentName: string,
  status: ActivityEvent['status'],
  message: string,
  reasoningSnippet: string,
): PipelineRun {
  const event: ActivityEvent = {
    id: `activity-${activitySequence += 1}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    agentName,
    status,
    message,
    reasoningSnippet,
  };

  return updateRun(run, {
    activityFeed: [event, ...run.activityFeed].slice(0, 12),
  });
}

function updateRun(run: PipelineRun, updates: Partial<PipelineRun>): PipelineRun {
  return {
    ...run,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
}

function detectEntities(sourceInput: string, region: string, topic: string): string[] {
  const lowerText = sourceInput.toLowerCase();
  const entities = new Set<string>();

  if (region !== 'Unknown') entities.add(region);
  if (topic.includes('Emergency')) entities.add('TCMB');
  if (topic.includes('Emergency')) entities.add('Policy-rate Intervention');
  if (lowerText.includes('lira')) entities.add('Turkish Lira');
  if (topic.includes('Currency')) entities.add('Currency Controls');
  if (topic.includes('Lithium')) entities.add('Lithium Extraction Permit');
  if (topic.includes('Energy')) entities.add('Electricity Subsidies');
  if (lowerText.includes('central bank') || lowerText.includes('banco central')) entities.add('Central Bank');
  if (lowerText.includes('decree') || lowerText.includes('decreto')) entities.add('Government Decree');
  if (lowerText.includes('ministry')) entities.add('Ministry');
  if (lowerText.includes('cabinet')) entities.add('Cabinet');

  return Array.from(entities);
}

function defaultDeadline(ingestion: SourceAnalysis): string {
  if (ingestion.region === 'Turkey') return '2026-06-15';
  if (ingestion.topic.includes('Lithium')) return '2026-08-15';
  if (ingestion.topic.includes('Energy')) return '2026-09-30';
  return '2026-07-01';
}

function getResolutionSource(ingestion: SourceAnalysis): string {
  if (ingestion.region === 'Turkey') return 'Official TCMB monetary-policy or liquidity announcement';
  if (ingestion.region === 'Argentina') return 'Official Argentine government decree or Central Bank publication';
  if (ingestion.region === 'Chile') return 'Official Chilean mining ministry publication';
  if (ingestion.region === 'Japan') return 'Official Japanese cabinet or ministry announcement';
  return 'Official public record from the named authority';
}

function createQuestion(ingestion: SourceAnalysis, deadline: string): string {
  if (ingestion.region === 'Turkey') {
    return `Will Turkey announce an emergency central-bank rate or liquidity intervention before ${deadline}?`;
  }

  if (ingestion.region === 'Argentina' && ingestion.topic.includes('Currency')) {
    return `Will Argentina officially remove currency controls before ${deadline}?`;
  }

  if (ingestion.region === 'Chile') {
    return `Will Chile publish a lithium extraction permit decision before ${deadline}?`;
  }

  if (ingestion.region === 'Japan') {
    return `Will Japan extend household electricity subsidies before ${deadline}?`;
  }

  return `Will the named authority officially confirm ${ingestion.topic.toLowerCase()} before ${deadline}?`;
}

function detectDate(sourceInput: string): string | undefined {
  const match = sourceInput.match(/\b(202[6-9]-\d{2}-\d{2})\b/);
  return match?.[1];
}

function looksLikeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function awaitlessShaSeed(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(16).padStart(8, '0');
}
