import { sampleArticle } from '../sampleArticleData';
import { appendActivity, appendOperation as appendRunOperation, completeStepOperations, hydrateStep, updateRun, updateStep, updateStepText } from './runState';
import { createCanonicalPipelineStep, createPipelineStep } from './stages';
import type {
  AcceptedMarket,
  AgentRun,
  ContextAnalysis,
  CriticVerdict,
  DemoScenario,
  MarketQuestion,
  OperationEvent,
  PipelineInput,
  PipelineProvider,
  PipelineRun,
  PipelineRunUpdate,
  PipelineStep,
  RejectedMarketReview,
  Submission,
  SourceAnalysis,
  TracePayload,
  TraceProvider,
  ArcTrace,
} from './types';

const SAMPLE_OPERATION_DELAY_MS = 850;
const SAMPLE_STEP_COMPLETION_DELAY_MS = 700;
const DEMO_WALLET_ADDRESS = '0x8f3A2b91C4dE6F7089aC12E34b56D78e90aBabe1';
const PREVIEW_MODE = 'preview run';

function appendOperation(
  run: PipelineRun,
  stepId: PipelineStep['id'],
  operation: Omit<OperationEvent, 'id' | 'timestamp' | 'simulated'>,
): PipelineRun {
  return appendRunOperation(run, stepId, { ...operation, simulated: true });
}

export class SimulatedArcTraceProvider implements TraceProvider {
  async commit(payload: TracePayload): Promise<ArcTrace> {
    return createArcTrace(payload);
  }
}

export class SimulatedPipelineProvider implements PipelineProvider {
  constructor(private readonly traceProvider: TraceProvider = new SimulatedArcTraceProvider()) {}

  async *run(input: PipelineInput): AsyncGenerator<PipelineRunUpdate> {
    const startedAt = Date.now();
    const submission = createSubmission(input.sourceText, input.scenario);
    const resolvedRun = createResolvedPipelineRun(submission.sourceText, submission);
    let run = runAgentPipeline(submission);
    run = updateRun(run, { status: 'running', steps: createQueuedPipelineSteps() });
    run = appendActivity(run, 'Source Queue', 'running', 'Preview run started from the bundled source.', 'Log note: this uses prepared preview records and does not call live analysis, Circle, Arc, or x402 services.');
    yield { type: 'run-started', run };

    try {
      throwIfAborted(input.signal);

      for (const step of resolvedRun.steps) {
        run = hydrateStep(run, step);
        run = updateStep(run, step.id, 'running');
        run = appendActivity(run, step.agentName, 'running', step.action, step.reasoningSnippet);
        run = appendOperation(run, step.id, {
          label: demoOperationLabelForStep(step.id, 'start'),
          status: 'running',
          detail: step.action,
          metadata: demoOperationMetadataForStep(step.id, run, resolvedRun, 'start'),
        });
        yield { type: 'step-started', run, step: run.steps.find((item) => item.id === step.id)! };

        for (const note of runningNotesForStep(step)) {
          await wait(SAMPLE_OPERATION_DELAY_MS, input.signal);

          run = updateStepText(run, step.id, { reasoningSnippet: note });
          run = appendActivity(run, step.agentName, 'running', note, 'Preview log update for the current stage.');
          run = appendOperation(run, step.id, {
            label: demoOperationLabelForStep(step.id, 'note'),
            status: 'running',
            detail: note,
            metadata: demoOperationMetadataForStep(step.id, run, resolvedRun, 'note'),
          });
          yield { type: 'step-note', run, step: run.steps.find((item) => item.id === step.id)! };
        }

        await wait(SAMPLE_STEP_COMPLETION_DELAY_MS, input.signal);

        run = revealStepArtifacts(run, resolvedRun, step.id);

        if (step.id === 'settlement') {
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
        }

        run = updateStep(run, step.id, 'complete');
        run = completeStepOperations(run, step.id);
        run = appendActivity(run, step.agentName, 'complete', step.outputSummary, step.reasoningSnippet);
        run = appendOperation(run, step.id, {
          label: demoOperationLabelForStep(step.id, 'complete'),
          status: 'complete',
          detail: step.outputSummary,
          metadata: demoOperationMetadataForStep(step.id, run, resolvedRun, 'complete'),
        });
        yield { type: 'step-completed', run, step: run.steps.find((item) => item.id === step.id)! };

        if (step.id === 'settlement' && run.trace) {
          run = appendActivity(run, 'Proof Saver', 'committed', 'Preview proof prepared as a local hash only.', 'Preview log note: no Arc Testnet transaction was submitted.');
          run = appendOperation(run, 'settlement', {
            label: 'Preview proof status',
            status: 'complete',
            detail: 'Preview proof prepared as a local hash only.',
            metadata: {
              proof: run.trace.traceHash,
              transaction: run.trace.transactionId,
            },
          });
          yield { type: 'trace-committed', run, trace: run.trace };
        }
      }

      run = updateRun(run, { status: 'complete', analyzedInMs: Date.now() - startedAt });
      run = appendActivity(run, 'Artifact Generation', 'accepted', 'Preview market artifact is ready.', 'Preview log note: wallet, Arc, and access records are prepared preview records, not production proof.');
      yield { type: 'run-completed', run };
    } catch (error) {
      if (input.signal?.aborted || isAbortError(error)) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Pipeline failed.';
      run = updateRun(run, { status: 'failed', error: message });
      run = appendActivity(run, 'Source Analysis', 'failed', message, 'The run stopped before a final market could be validated.');
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
    throw new Error('Cannot create a preview proof hash before the pipeline has accepted a market.');
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
    transactionId: 'preview-proof',
    network: 'Preview proof; no chain transaction',
    status: 'simulated',
    timestamp: new Date().toISOString(),
    artifactHash: `preview:${traceHash}`,
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
    stepOperations: {},
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
  const now = new Date().toISOString();
  const ingestion = ingestSource(sourceInput);
  const context = createContext(ingestion);
  const candidateMarkets = generateMarket(ingestion, context);
  const criticReviews = validateMarket(candidateMarkets);
  const rejectedMarkets = createRejectedMarketReviews(candidateMarkets, criticReviews);
  const acceptedMarket = createAcceptedMarket(candidateMarkets, criticReviews);
  const extractedSource = createExtractedSource(sourceInput, ingestion);
  const liveResolver = createDemoResolver(ingestion);
  const liveMarketComparison = createDemoMarketComparison(ingestion);
  const circleAgentWallet = createDemoCircleWallet(now);
  const x402 = createDemoX402(acceptedMarket);

  return {
    id: `run-${awaitlessShaSeed(sourceInput)}`,
    status: 'idle',
    submission,
    sourceInput,
    extractedSource,
    ingestion,
    context,
    candidateMarkets,
    criticReviews,
    rejectedMarkets,
    acceptedMarket,
    liveResolver,
    liveMarketComparison,
    circleAgentWallet,
    x402,
    steps: createPipelineSteps(ingestion, context, candidateMarkets, criticReviews, acceptedMarket),
    stepOperations: {},
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
  const trace = createDemoTrace(traceHash, now);

  return updateRun(resolvedRun, {
    status: 'complete',
    analyzedInMs: 0,
    trace,
    steps: resolvedRun.steps.map((step) => ({ ...step, status: 'complete' })),
    stepOperations: createCompletedDemoOperations(resolvedRun, trace),
    activityFeed: [
      {
        id: `activity-${traceHash}-preview-proof`,
        timestamp: now,
        agentName: 'Artifact Generation',
        status: 'accepted',
        message: 'Preview artifact includes prepared proof records.',
        reasoningSnippet: 'Preview log note: wallet, Arc, and access records are prepared records, not production proofs.',
      },
      ...resolvedRun.activityFeed,
    ],
  });
}

function createQueuedPipelineSteps(): PipelineStep[] {
  return [
    createCanonicalPipelineStep('extraction'),
    createCanonicalPipelineStep('claim'),
    createCanonicalPipelineStep('resolver', { action: 'Check the official page that will decide YES or NO.', outputSummary: 'No official source checked yet.' }),
    createCanonicalPipelineStep('comparison'),
    createCanonicalPipelineStep('market-creator'),
    createCanonicalPipelineStep('critic'),
    createCanonicalPipelineStep('circle'),
    createCanonicalPipelineStep('settlement', { outputSummary: 'No proof prepared yet.' }),
    createCanonicalPipelineStep('x402', { reasoningSnippet: 'Waiting for proof.' }),
  ];
}

function revealStepArtifacts(run: PipelineRun, resolvedRun: PipelineRun, stepId: PipelineStep['id']): PipelineRun {
  if (stepId === 'extraction') return updateRun(run, { extractedSource: resolvedRun.extractedSource });
  if (stepId === 'claim') return updateRun(run, { ingestion: resolvedRun.ingestion, context: resolvedRun.context });
  if (stepId === 'resolver') return updateRun(run, { liveResolver: resolvedRun.liveResolver });
  if (stepId === 'comparison') return updateRun(run, { liveMarketComparison: resolvedRun.liveMarketComparison });
  if (stepId === 'market-creator') return updateRun(run, { candidateMarkets: resolvedRun.candidateMarkets, rejectedMarkets: resolvedRun.rejectedMarkets });
  if (stepId === 'critic') {
    return updateRun(run, {
      criticReviews: resolvedRun.criticReviews,
      rejectedMarkets: resolvedRun.rejectedMarkets,
      acceptedMarket: resolvedRun.acceptedMarket,
    });
  }
  if (stepId === 'circle') return updateRun(run, { circleAgentWallet: resolvedRun.circleAgentWallet });
  if (stepId === 'x402') return updateRun(run, { x402: resolvedRun.x402 });

  return run;
}

function createExtractedSource(sourceInput: string, ingestion: SourceAnalysis): NonNullable<PipelineRun['extractedSource']> {
  return {
    title: ingestion.signalName,
    domain: ingestion.sourceUrl ? new URL(ingestion.sourceUrl).hostname : ingestion.source,
    url: ingestion.sourceUrl ?? '',
    text: sourceInput,
  };
}

function createDemoResolver(ingestion: SourceAnalysis): NonNullable<PipelineRun['liveResolver']> {
  if (ingestion.region === 'Chile' && ingestion.topic.includes('CEOL')) {
    return {
      name: 'Contraloria General de la Republica / Government of Chile',
      url: 'https://www.contraloria.cl/',
      verificationStatus: 'verified',
      verificationEvidence: 'The source names Contraloria and the Government of Chile as official decision sources for this market.',
    };
  }

  if (ingestion.region === 'Argentina') {
    return {
      name: 'Boletin Oficial de la Republica Argentina / BCRA',
      url: 'https://www.boletinoficial.gob.ar/',
      verificationStatus: 'verified',
      verificationEvidence: 'The source identifies the official decree publication path as the decision source for this market.',
    };
  }

  if (ingestion.region === 'Turkey') {
    return {
      name: 'Central Bank of the Republic of Turkiye',
      url: 'https://www.tcmb.gov.tr/',
      verificationStatus: 'verified',
      verificationEvidence: 'The source maps the event to the official central-bank publication site.',
    };
  }

  return {
    name: getResolutionSource(ingestion),
    url: 'https://example.test/official-source',
    verificationStatus: 'verified',
    verificationEvidence: 'The official decision source is identified from the submitted source.',
  };
}

function createDemoMarketComparison(ingestion: SourceAnalysis): NonNullable<PipelineRun['liveMarketComparison']> {
  return {
    status: 'checked',
    similarMarkets: [],
    noveltyVerdict: 'new-opportunity',
    reasoning: `No overlapping ${ingestion.region} ${ingestion.topic.toLowerCase()} markets were found in the checked market sources.`,
  };
}

function createDemoCircleWallet(checkedAt: string): NonNullable<PipelineRun['circleAgentWallet']> {
  return {
    status: 'ready',
    walletId: 'demo-wallet-agorababel-arc-testnet',
    walletSetId: 'demo-wallet-set-agorababel',
    address: DEMO_WALLET_ADDRESS,
    blockchain: 'ARC-TESTNET',
    checkedAt,
    error: null,
  };
}

function createDemoTrace(seed: string, timestamp: string): ArcTrace {
  return {
    traceHash: `preview:${seed}`,
    transactionId: 'preview-local-proof',
    network: 'Preview proof; no chain transaction',
    status: 'simulated',
    timestamp,
    artifactHash: `preview:${seed}`,
  };
}

function createDemoX402(acceptedMarket: AcceptedMarket): NonNullable<PipelineRun['x402']> {
  const artifactId = `preview-${acceptedMarket.id}`;

  return {
    status: 'required',
    artifactId,
    priceUsdcMicro: 250000,
    payToAddress: DEMO_WALLET_ADDRESS,
    facilitatorUrl: 'https://gateway-api-testnet.circle.com',
    gatewayUrl: 'https://gateway-api-testnet.circle.com',
    network: 'Preview access metadata; no payment service call',
    intelligenceUrl: `/demo/artifacts/${artifactId}/intelligence`,
    demoUnlockUrl: `/demo/artifacts/${artifactId}/unlock`,
  };
}

function demoOperationLabelForStep(stepId: PipelineStep['id'], phase: 'start' | 'note' | 'complete'): string {
  const labels: Record<PipelineStep['id'], Record<typeof phase, string>> = {
    extraction: { start: 'Input accepted', note: 'Fixture read', complete: 'Source artifact ready' },
    ingestion: { start: 'Source details started', note: 'Source fields mapped', complete: 'Source details ready' },
    context: { start: 'Context summary started', note: 'Evidence summarized', complete: 'Context ready' },
    claim: { start: 'Claim search started', note: 'Claim fields mapped', complete: 'Main claim ready' },
    resolver: { start: 'Official source selected', note: 'Official source checked', complete: 'Official source ready' },
    comparison: { start: 'Duplicate search started', note: 'Local market index checked', complete: 'Duplicate check ready' },
    'market-creator': { start: 'Market draft started', note: 'Alternatives generated', complete: 'Accepted draft selected' },
    critic: { start: 'Quality checks started', note: 'Review checks completed', complete: 'Quality decision recorded' },
    circle: { start: 'Wallet record loaded', note: 'Test wallet fields checked', complete: 'Wallet ready' },
    settlement: { start: 'Proof payload prepared', note: 'Local hashes computed', complete: 'Local proof prepared' },
    x402: { start: 'Access details started', note: 'Payment fields staged', complete: 'Access metadata ready' },
  };

  return labels[stepId][phase];
}

function demoOperationMetadataForStep(
  stepId: PipelineStep['id'],
  run: PipelineRun,
  resolvedRun: PipelineRun,
  phase: 'start' | 'note' | 'complete',
): Record<string, string> {
  const source = resolvedRun.extractedSource;
  const ingestion = resolvedRun.ingestion;
  const resolver = resolvedRun.liveResolver;
  const comparison = resolvedRun.liveMarketComparison;
  const acceptedMarket = resolvedRun.acceptedMarket;
  const trace = run.trace ?? resolvedRun.trace;
  const x402 = resolvedRun.x402;

  switch (stepId) {
    case 'extraction':
      return {
        mode: PREVIEW_MODE,
        input: looksLikeUrl(run.sourceInput) ? 'url' : 'text',
        domain: source?.domain ?? 'Submitted source',
        hash: awaitlessShaSeed(run.sourceInput).slice(0, 12),
      };
    case 'claim':
      return {
        mode: PREVIEW_MODE,
        schema: phase === 'complete' ? 'validated' : 'mapping',
        actors: String(ingestion?.entities.length ?? 0),
        deadline: ingestion ? defaultDeadline(ingestion) : 'pending',
      };
    case 'resolver':
      return {
        mode: PREVIEW_MODE,
        status: resolver?.verificationStatus ?? 'pending',
        officialSource: resolver?.name ?? 'pending',
        url: resolver?.url ?? 'pending',
      };
    case 'comparison':
      return {
        mode: PREVIEW_MODE,
        sources: 'preview index',
        similar: String(comparison?.similarMarkets.length ?? 0),
        result: comparison?.noveltyVerdict === 'new-opportunity' ? 'no close duplicate' : comparison?.noveltyVerdict ?? 'pending',
      };
    case 'market-creator':
      return {
        mode: PREVIEW_MODE,
        candidates: String(resolvedRun.candidateMarkets.length),
        rejected: String(resolvedRun.rejectedMarkets.length),
        accepted: acceptedMarket?.id ?? 'pending',
      };
    case 'critic': {
      const review = resolvedRun.criticReviews.find((item) => item.decision === 'accepted') ?? resolvedRun.criticReviews[0];
      const passCount = review ? Object.values(review.checks).filter((status) => status === 'pass').length : 0;
      return {
        mode: PREVIEW_MODE,
        verdict: review?.decision ?? 'pending',
        checks: review ? `${passCount}/${Object.keys(review.checks).length} pass` : 'pending',
      };
    }
    case 'circle':
      return {
        mode: PREVIEW_MODE,
        status: resolvedRun.circleAgentWallet?.status ?? 'pending',
        wallet: resolvedRun.circleAgentWallet?.walletId ?? 'pending',
        blockchain: resolvedRun.circleAgentWallet?.blockchain ?? 'ARC-TESTNET',
      };
    case 'settlement':
      return {
        mode: PREVIEW_MODE,
        proof: trace?.artifactHash ?? 'pending',
        source: awaitlessShaSeed(resolvedRun.sourceInput).slice(0, 12),
        transaction: trace?.transactionId ?? 'none',
      };
    case 'x402':
      return {
        mode: PREVIEW_MODE,
        artifact: x402?.artifactId ?? 'pending',
        price: x402?.priceUsdcMicro ? `${x402.priceUsdcMicro / 1_000_000} USDC` : 'disabled',
        gateway: x402?.gatewayUrl ?? 'preview',
      };
    default:
      return { mode: PREVIEW_MODE };
  }
}

function createCompletedDemoOperations(resolvedRun: PipelineRun, trace: ArcTrace): PipelineRun['stepOperations'] {
  return resolvedRun.steps.reduce<PipelineRun['stepOperations']>((operations, step) => {
    let currentRun = updateRun(resolvedRun, { trace });
    currentRun = appendOperation(currentRun, step.id, {
      label: demoOperationLabelForStep(step.id, 'start'),
      status: 'complete',
      detail: step.action,
      metadata: demoOperationMetadataForStep(step.id, currentRun, resolvedRun, 'start'),
    });
    currentRun = appendOperation(currentRun, step.id, {
      label: demoOperationLabelForStep(step.id, 'complete'),
      status: 'complete',
      detail: step.outputSummary,
      metadata: demoOperationMetadataForStep(step.id, currentRun, resolvedRun, 'complete'),
    });
    operations[step.id] = currentRun.stepOperations[step.id];
    return operations;
  }, {});
}

function runningNotesForStep(step: PipelineStep): string[] {
  switch (step.id) {
    case 'extraction':
      return [
        'Reading the submitted article or pasted text.',
        'Preparing a short source excerpt and proof hash.',
      ];
    case 'claim':
      return [
        'Finding the actors, event type, quoted evidence, and possible deadline.',
        'Checking that the main claim has the fields needed for a market.',
      ];
    case 'resolver':
      return [
        'Selecting the official page named by the source evidence.',
        'Checking that the official page can decide the market outcome.',
      ];
    case 'comparison':
      return [
        'Searching market sources for overlapping questions.',
        'Deciding whether this would duplicate an existing market.',
      ];
    case 'market-creator':
      return [
        'Writing supported YES/NO market drafts from the validated claim.',
        'Choosing the clearest draft and setting aside weaker alternatives.',
      ];
    case 'critic':
      return [
        'Checking clear YES/NO wording, deadline, evidence, official source, and duplicates.',
        'Recording rejected drafts and confirming the accepted market.',
      ];
    case 'circle':
      return [
        'Loading the configured test-wallet record.',
        'Checking wallet status, address, wallet ID, and network fields.',
      ];
    case 'settlement':
      return [
        'Hashing the accepted market and source evidence.',
        'Preparing proof metadata and transaction status.',
      ];
    case 'x402':
      return [
        'Preparing artifact ID, price, payment gateway, and access details.',
        'Attaching the intelligence and unlock URLs for the final artifact.',
      ];
    default:
      return [step.reasoningSnippet];
  }
}

function ingestSource(sourceInput: string): SourceAnalysis {
  const lowerText = sourceInput.toLowerCase();
  const language = lowerText.includes('merkez bankasi') || lowerText.includes('turkiye') || lowerText.includes('tcmb')
    ? 'Turkish'
    : lowerText.includes('funcionarios') || lowerText.includes('nacion') || lowerText.includes('decreto') || lowerText.includes('contraloria') || lowerText.includes('mineria')
      ? 'Spanish'
      : lowerText.includes('nikkei')
        ? 'Japanese'
        : 'English';
  const source = lowerText.includes('dunya') ? 'Dunya' : lowerText.includes('nikkei') ? 'Nikkei' : lowerText.includes('diario financiero') ? 'Diario Financiero' : lowerText.includes('la nacion') ? 'La Nacion' : looksLikeUrl(sourceInput) ? new URL(sourceInput).hostname : 'Submitted source';
  const region = lowerText.includes('turkiye') || lowerText.includes('turkey') || lowerText.includes('tcmb') ? 'Turkey' : lowerText.includes('chile') ? 'Chile' : lowerText.includes('japan') ? 'Japan' : lowerText.includes('argentina') ? 'Argentina' : 'Unknown';
  const topic = lowerText.includes('ceol') || lowerText.includes('laguna verde') || lowerText.includes('contraloria')
    ? 'CEOL ratification'
    : lowerText.includes('tcmb') || lowerText.includes('merkez bankasi') || lowerText.includes('lira')
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
    languageConfidence: language === 'English' ? 0.88 : 0.97,
    source,
    sourceUrl: looksLikeUrl(sourceInput) ? sourceInput : undefined,
    sourceDate: detectSourceDate(sourceInput),
    entities,
    region,
    topic,
  };
}

function createContext(ingestion: SourceAnalysis): ContextAnalysis {
  const deadline = defaultDeadline(ingestion);
  const englishSummary = ingestion.region === 'Turkey'
    ? `Dunya says TCMB officials are preparing an emergency liquidity and policy-rate intervention before ${deadline}, with any qualifying decision expected on the official TCMB page.`
    : ingestion.region === 'Argentina' && ingestion.topic.includes('Currency')
    ? `Officials close to Argentina's central bank say the government is evaluating removal of currency controls before ${deadline}, contingent on an official decree.`
    : ingestion.region === 'Chile' && ingestion.topic.includes('CEOL')
      ? `Diario Financiero Chile says terms for the Laguna Verde lithium CEOL have been agreed, but official government ratification and Contraloria review remain pending before ${deadline}.`
      : ingestion.region === 'Chile'
        ? `Chilean officials may publish a lithium extraction permit decision before ${deadline}.`
      : ingestion.region === 'Japan'
        ? `Japan may extend household electricity subsidies through ${deadline}, pending a cabinet announcement.`
        : `The submitted source describes a public policy event that may resolve before ${deadline}.`;

  return {
    englishSummary,
    marketRelevance: ingestion.region === 'Unknown' ? 'Medium' : 'High',
    relevanceExplanation: 'The signal is useful because it appears in local-language financial press before broad English coverage, names the authority, gives a deadline, and can resolve against an official public source.',
    evidenceSummary: ingestion.region === 'Turkey'
      ? 'Dunya names TCMB sources, an emergency liquidity or rate intervention, the 2026-06-15 deadline, and official publication on the TCMB site.'
      : ingestion.region === 'Chile' && ingestion.topic.includes('CEOL')
        ? 'Diario Financiero Chile separates agreed CEOL terms from still-pending government ratification and Contraloria toma de razon by 2026-06-30.'
        : `${ingestion.source} mentions ${ingestion.entities.join(', ')} in ${ingestion.region}; the claim contains a public authority and a deadline candidate.`,
  };
}

function createCandidateMarkets(ingestion: SourceAnalysis, context: ContextAnalysis): MarketQuestion[] {
  const deadline = defaultDeadline(ingestion);
  const resolutionSource = getResolutionSource(ingestion);
  const resolver = createDemoResolver(ingestion);

  return [
    {
      id: 'draft-official-action',
      question: createQuestion(ingestion, deadline),
      yesCriteria: ingestion.region === 'Chile' && ingestion.topic.includes('CEOL')
        ? `YES if ${resolutionSource} publishes ratification, toma de razon, or another official confirmation that the Laguna Verde CEOL is approved before ${deadline}.`
        : `YES if ${resolutionSource} publishes an announcement, decision, decree, or policy notice confirming the event before ${deadline}.`,
      noCriteria: ingestion.region === 'Chile' && ingestion.topic.includes('CEOL')
        ? `NO if ${resolutionSource} has not published qualifying ratification before ${deadline}, or publishes a rejection or delay beyond ${deadline}.`
        : `NO if ${resolutionSource} has not published a qualifying confirmation before ${deadline}, or publishes a rejection or delay beyond ${deadline}.`,
      deadline,
      resolverName: resolver.name,
      resolverUrl: resolver.url,
      resolutionSource,
      evidenceSummary: `${context.evidenceSummary} This draft resolves on the authority's official action, not whether media coverage spreads or prices move.`,
      confidenceScore: 82,
      marketBalance: {
        yesProbability: ingestion.region === 'Chile' && ingestion.topic.includes('CEOL') ? 58 : 62,
        noProbability: ingestion.region === 'Chile' && ingestion.topic.includes('CEOL') ? 42 : 38,
        balanceVerdict: 'balanced',
        balanceRationale: ingestion.region === 'Chile' && ingestion.topic.includes('CEOL')
          ? 'The source reports agreed terms, but official ratification and Contraloria review remain pending before the deadline.'
          : 'The source is strong enough to support the claim, while the official resolver has not yet published a final confirmation.',
      },
    },
    {
      id: 'draft-news-confirmation',
      question: `Will major English-language outlets report that ${ingestion.signalName.toLowerCase()} happened before ${deadline}?`,
      yesCriteria: 'YES if at least two major English-language outlets report the event occurred.',
      noCriteria: 'NO otherwise.',
      deadline,
      resolverName: 'Major English-language news coverage',
      resolverUrl: 'https://example.test/demo/news-coverage',
      resolutionSource: 'Major English-language news coverage',
      evidenceSummary: 'Rejected because news coverage would measure downstream attention rather than the official government action.',
      confidenceScore: 55,
      marketBalance: {
        yesProbability: 78,
        noProbability: 22,
        balanceVerdict: 'balanced',
        balanceRationale: 'Downstream media attention is plausible but still uncertain; it is rejected because the resolver is weak, not because of tradability.',
      },
    },
    {
      id: 'draft-market-impact',
      question: ingestion.region === 'Chile'
        ? `Will shares of companies tied to Laguna Verde lithium rise after CEOL coverage before ${deadline}?`
        : `Will ${ingestion.region} markets react positively to ${ingestion.topic.toLowerCase()} before ${deadline}?`,
      yesCriteria: 'YES if selected market indicators move positively after the event.',
      noCriteria: 'NO if they do not.',
      deadline,
      resolverName: 'Market price movement',
      resolverUrl: 'https://example.test/demo/market-prices',
      resolutionSource: 'Market price movement',
      evidenceSummary: 'Rejected because stock or asset-price movement is noisy and cannot prove whether official action occurred.',
      confidenceScore: 31,
      marketBalance: {
        yesProbability: 50,
        noProbability: 50,
        balanceVerdict: 'insufficient-evidence',
        balanceRationale: 'The source does not provide enough information to estimate a market-price direction from official-action evidence.',
      },
    },
    {
      id: 'draft-company-statement',
      question: `Will the company say the ${ingestion.topic.toLowerCase()} is complete before ${deadline}?`,
      yesCriteria: 'YES if a company press release says the agreement or process is complete.',
      noCriteria: 'NO if there is no company statement before the deadline.',
      deadline,
      resolverName: 'Company statements',
      resolverUrl: 'https://example.test/demo/company-statements',
      resolutionSource: 'Company statements',
      evidenceSummary: 'Rejected because company statements are weaker than an official government or Contraloria publication.',
      confidenceScore: 42,
      marketBalance: {
        yesProbability: 88,
        noProbability: 12,
        balanceVerdict: 'too-lopsided',
        balanceRationale: 'A company statement is likely after agreed terms, making the question too obvious for a balanced YES/NO market.',
      },
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
          binary: 'pass',
          resolver: 'pass',
          deadline: 'pass',
          evidence: 'pass',
          novelty: 'pass',
          placeholderFree: 'pass',
        },
        reasoning: draft.question.includes('Laguna Verde')
          ? 'Accepted: resolves on official Government of Chile publication or Contraloria ratification by the deadline, not on news coverage, stock movement, or company statements.'
          : 'Accepted: asks whether the named authority takes official action by the deadline, with YES/NO criteria tied to a public resolver.',
        failedRules: [],
      };
    }

    if (draft.id === 'draft-news-confirmation') {
      return {
        draftId: draft.id,
        decision: 'rejected',
        checks: {
          binary: 'fail',
          resolver: 'fail',
          deadline: 'pass',
          evidence: 'pass',
          novelty: 'pass',
          placeholderFree: 'pass',
        },
        reasoning: 'Rejected: news coverage is downstream attention and could lag, omit, or reframe the source; it is not the official source of resolution.',
        failedRules: ['weak resolution'],
        violatedRule: 'weak resolution',
      };
    }

    if (draft.id === 'draft-company-statement') {
      return {
        draftId: draft.id,
        decision: 'rejected',
        checks: {
          binary: 'pass',
          resolver: 'fail',
          deadline: 'pass',
          evidence: 'fail',
          novelty: 'pass',
          placeholderFree: 'pass',
        },
        reasoning: 'Rejected: a company statement is weaker than official government publication or Contraloria ratification.',
        failedRules: ['weak resolution'],
        violatedRule: 'weak resolution',
      };
    }

    return {
      draftId: draft.id,
      decision: 'rejected',
      checks: {
        binary: 'fail',
        resolver: 'fail',
        deadline: 'pass',
        evidence: 'fail',
        novelty: 'pass',
        placeholderFree: 'pass',
      },
      reasoning: 'Rejected: stock movement is not proof of official action because price direction depends on many drivers.',
      failedRules: ['subjective wording'],
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
    createPipelineStep('extraction', 'Read Source', 'Source Reader', 'Turn the submitted URL or pasted text into readable source material.', 'Source text is prepared for review.', 'Source text is ready with a short excerpt for review.'),
    createPipelineStep('claim', 'Find Main Claim', 'Claim Finder', 'Identify the event claim, people or organizations involved, evidence, and deadline.', `${ingestion.language} source with ${ingestion.entities.length} actors and a ${defaultDeadline(ingestion)} deadline.`, `${ingestion.topic} in ${ingestion.region}; deadline ${defaultDeadline(ingestion)}.`),
    createPipelineStep('resolver', 'Check Official Source', 'Official Source Checker', 'Find and verify the official page that will decide YES or NO.', createDemoResolver(ingestion).verificationEvidence, `${createDemoResolver(ingestion).name} checked as the official source.`),
    createPipelineStep('comparison', 'Check Duplicates', 'Market Duplicate Checker', 'Search existing market sources for close matches.', createDemoMarketComparison(ingestion).reasoning, 'Duplicate check result: no close duplicate found.'),
    createPipelineStep('market-creator', 'Write Market', 'Market Writer', 'Write one clear YES/NO market with rules, evidence, and a deadline.', `${drafts.length} market drafts generated; the accepted draft resolves on official action.`, `Drafted ${drafts.length} YES/NO markets including "${acceptedMarket.question}"`),
    createPipelineStep('critic', 'Quality Check', 'Quality Checker', 'Reject drafts that are vague, duplicated, unsupported, or hard to resolve.', `${acceptedCount}/${reviews.length} drafts passed the wording, source, deadline, evidence, and duplicate checks.`, acceptedMarket.criticReasoning),
    createPipelineStep('circle', 'Check Wallet', 'Wallet Checker', 'Check the Circle test wallet used to attach a proof record.', 'Circle test-wallet record is ready for proof attachment.', `Circle test wallet ready at ${DEMO_WALLET_ADDRESS}.`),
    createPipelineStep('settlement', 'Save Proof', 'Proof Saver', 'Save proof of the accepted market on Arc Testnet.', 'Proof hash prepared for the accepted market.', 'Proof prepared for preview review.'),
    createPipelineStep('x402', 'Publish Access', 'Access Publisher', 'Publish access details for the final paid artifact.', 'Access metadata is prepared for the final artifact.', `Access metadata ready for ${acceptedMarket.id}.`),
  ];
}

function detectEntities(sourceInput: string, region: string, topic: string): string[] {
  const lowerText = sourceInput.toLowerCase();
  const entities = new Set<string>();

  if (region !== 'Unknown') entities.add(region);
  if (topic.includes('Emergency')) entities.add('TCMB');
  if (topic.includes('Emergency')) entities.add('Policy-rate Intervention');
  if (topic.includes('CEOL')) entities.add('Laguna Verde CEOL');
  if (topic.includes('CEOL')) entities.add('Contraloria General de la Republica');
  if (topic.includes('CEOL')) entities.add('Government of Chile');
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
  if (ingestion.region === 'Chile' && ingestion.topic.includes('CEOL')) return '2026-06-30';
  if (ingestion.topic.includes('Lithium')) return '2026-08-15';
  if (ingestion.topic.includes('Energy')) return '2026-09-30';
  return '2026-07-01';
}

function getResolutionSource(ingestion: SourceAnalysis): string {
  if (ingestion.region === 'Turkey') return 'Official TCMB monetary-policy or liquidity announcement';
  if (ingestion.region === 'Argentina') return 'Official Argentine government decree or Central Bank publication';
  if (ingestion.region === 'Chile' && ingestion.topic.includes('CEOL')) return 'Official Government of Chile publication or Contraloria ratification';
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
    if (ingestion.topic.includes('CEOL')) {
      return `Will Chile officially ratify the Laguna Verde lithium CEOL before ${deadline}?`;
    }

    return `Will Chile publish a lithium extraction permit decision before ${deadline}?`;
  }

  if (ingestion.region === 'Japan') {
    return `Will Japan extend household electricity subsidies before ${deadline}?`;
  }

  return `Will the named authority officially confirm ${ingestion.topic.toLowerCase()} before ${deadline}?`;
}

function detectSourceDate(sourceInput: string): string {
  if (sourceInput.trim() === sampleArticle.sourceText) return sampleArticle.sourceDate;

  const explicitPublishedDate = sourceInput.match(/\b(?:published|dated|reported on)\s+(202[6-9]-\d{2}-\d{2})\b/i);
  return explicitPublishedDate?.[1] ?? 'Not provided';
}

function looksLikeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return false;

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const handleAbort = () => {
      window.clearTimeout(timer);
      reject(createAbortError());
    };

    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createAbortError() {
  return new DOMException('The pipeline run was superseded by a newer run.', 'AbortError');
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
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
