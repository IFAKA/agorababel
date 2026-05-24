import { createSourceExcerpt, isCommittedTrace, looksLikeUrl } from '../artifactHelpers.ts';
import type { PipelineRun, PipelineStep, SourceAnalysis } from './types';

export function getArtifactReadableText(run: PipelineRun, step?: PipelineStep, isComplete = run.status === 'complete'): string {
  if (!step) return normalizeReadableText(['Queued', 'Analysis is preparing.', 'Waiting']);

  switch (step.id) {
    case 'extraction': {
      const extracted = run.extractedSource;

      return normalizeReadableText([
        'Read Source',
        getExtractionTitle(run, step),
        extracted ? `Detected source: ${extracted.domain}` : formatStepStatus(step.status),
        'Input type',
        looksLikeUrl(run.sourceInput) ? 'Readable URL' : 'Pasted source text',
        'Preparation status',
        getExtractionStatus(run, step),
        getSubmittedSourceExcerpt(run),
      ]);
    }

    case 'ingestion': {
      const ingestion = run.ingestion;

      if (!ingestion) return getPendingArtifactReadableText(step, 'Source metadata is being assembled.');

      return normalizeReadableText([
        'Source Details',
        'Submitted source metadata.',
        'Submitted source',
        getSubmittedSourceForRun(run),
        'Language',
        `${ingestion.language} (${formatLanguageConfidence(ingestion.languageConfidence)})`,
        'Detected source',
        run.extractedSource?.domain ?? ingestion.source,
        'Actors',
        getActors(ingestion.entities),
        'Region',
        ingestion.region,
        'Detected signal',
        ingestion.signalName,
        'Event type',
        ingestion.topic,
        'Source date',
        ingestion.sourceDate,
        'Normalized claim',
        getNormalizedClaim(ingestion),
      ]);
    }

    case 'claim': {
      const ingestion = run.ingestion;
      const context = run.context;

      if (!ingestion || !context) return getPendingArtifactReadableText(step, 'Structured claim extraction is running.');

      return normalizeReadableText([
        'Find Main Claim',
        run.analysis?.claim.summary ?? getNormalizedClaim(ingestion),
        'Claim',
        run.analysis?.claim.summary ?? getNormalizedClaim(ingestion),
        'Deadline',
        run.analysis?.claim.deadline ?? run.candidateMarkets[0]?.deadline,
        'Actors',
        (run.analysis?.claim.actors ?? ingestion.entities).join(', ') || getActors(ingestion.entities),
        'Event type',
        run.analysis?.claim.eventType ?? ingestion.topic,
        'Evidence',
        run.analysis?.claim.evidence.map((item) => `${item.text} (${item.source})`).join(' ') ?? context.evidenceSummary,
      ]);
    }

    case 'resolver': {
      const resolver = run.liveResolver ?? run.analysis?.resolver;
      const discovery = run.resolverDiscovery ?? createResolverDiscoveryFromResolver(resolver);

      if (!resolver) {
        if (run.status === 'rejected' || discovery) {
          return normalizeReadableText([
            'Check Official Source',
            discovery?.status === 'found' ? 'Checking the official source' : 'No official source found',
            discovery?.status === 'found'
              ? `We are opening ${discovery.candidate?.name ?? 'the official page'} to confirm it can decide the market.`
              : run.analysis?.rejectionReason ?? discovery?.reason,
            getResolverDiscoveryText(discovery),
            discovery?.status !== 'found' ? run.analysis?.rejectionReason ?? discovery?.reason : undefined,
          ]);
        }

        return getPendingArtifactReadableText(step, 'Checking the official source.');
      }

      return normalizeReadableText([
        'Check Official Source',
        resolver.name,
        getResolverDiscoveryText(discovery, resolver.url),
        'Status',
        resolver.verificationStatus,
        'Official source URL',
        resolver.url,
      ]);
    }

    case 'comparison': {
      const comparison = run.liveMarketComparison ?? run.analysis?.marketComparison;

      if (!comparison) return getPendingArtifactReadableText(step, 'Checking existing betting questions for the same outcome.');

      return normalizeReadableText([
        'Check Existing Questions',
        comparison.noveltyVerdict === 'new-opportunity' ? 'No overlapping question found' : `Question overlap check: ${comparison.noveltyVerdict}`,
        'Search status',
        comparison.status,
        'Similar questions',
        comparison.similarMarkets.length > 0
          ? comparison.similarMarkets.map((market) => `${market.title} (${market.similarity})`).join('; ')
          : 'No betting questions with the same actor and event found in configured sources.',
      ]);
    }

    case 'context': {
      const context = run.context;

      if (!context) return getPendingArtifactReadableText(step, 'Translation and context are running.');

      return normalizeReadableText([
        'Translation & Context',
        context.englishSummary,
        'Market relevance',
        context.marketRelevance,
        'Evidence summary',
        context.evidenceSummary,
      ]);
    }

    case 'market-creator': {
      const market = run.candidateMarkets[0];

      if (!market) return getPendingArtifactReadableText(step, 'Writing the YES/NO market.');

      return normalizeReadableText([
        'Write Market',
        market.question,
        'YES',
        market.yesCriteria,
        'NO',
        market.noCriteria,
        'Deadline',
        market.deadline,
        'Resolution source',
        market.resolutionSource,
        'Why this framing',
        market.evidenceSummary,
      ]);
    }

    case 'critic':
      if (run.candidateMarkets.length === 0) return getPendingArtifactReadableText(step, 'Quality check is waiting for the market draft.');

      return normalizeReadableText([
        'Quality Check',
        'Market drafts are checked before approval.',
        ...run.candidateMarkets.flatMap((draft) => {
          const review = run.criticReviews.find((item) => item.draftId === draft.id);
          const accepted = review?.decision === 'accepted';

          return [
            review ? (accepted ? 'Accepted' : 'Rejected') : 'Reviewing',
            review?.violatedRule,
            draft.question,
            review ? Object.entries(review.checks).map(([label, status]) => `${formatMetadataLabel(label)} ${status}`).join(' ') : undefined,
            review?.reasoning,
          ];
        }),
      ]);

    case 'circle': {
      const wallet = run.circleAgentWallet;

      if (!wallet) return getPendingArtifactReadableText(step, 'Circle wallet status is being checked.');

      const isReady = wallet.status === 'ready';

      return normalizeReadableText([
        'Check Wallet',
        isReady ? 'Circle wallet is ready for proof attachment.' : 'Circle wallet is not ready.',
        isReady ? 'The proof step can use this configured Arc Testnet wallet.' : wallet.error,
        'Wallet readiness',
        wallet.status,
        isReady ? 'Ready' : 'Blocked',
        wallet.error,
        wallet.walletId ? `Wallet ID ${wallet.walletId}` : undefined,
        wallet.walletSetId ? `Wallet set ${wallet.walletSetId}` : undefined,
        wallet.address ? `Address ${wallet.address}` : undefined,
        'Blockchain',
        wallet.blockchain,
        'Checked at',
        wallet.checkedAt,
      ]);
    }

    case 'settlement': {
      const market = run.acceptedMarket;
      const traceCommitted = isCommittedTrace(run.trace);

      if (!market) return getPendingArtifactReadableText(step, 'Saving proof is waiting for an approved market.');

      return normalizeReadableText([
        traceCommitted ? 'Proof Saved' : 'Proof Prepared',
        traceCommitted ? 'Arc proof saved.' : 'Proof prepared for review.',
        'Trace status',
        formatTraceStatus(run.trace),
        'Network',
        run.trace?.network ?? 'Arc Testnet',
        run.trace?.timestamp ? `Timestamp ${run.trace.timestamp}` : undefined,
        traceCommitted && run.trace?.explorerUrl ? 'Open Arcscan transaction' : undefined,
        !traceCommitted ? 'Local trace prepared from the structured outputs. It is useful for demo review, but it is not an Arc Testnet commit proof.' : undefined,
      ]);
    }

    case 'x402': {
      const publication = run.x402;
      const disabled = !publication || publication.status === 'disabled';
      const market = run.acceptedMarket;

      if (!market) return getPendingArtifactReadableText(step, 'Access publication is waiting for a saved proof.');

      return normalizeReadableText([
        disabled ? 'Paid Access Disabled' : 'Publish Access',
        market.question,
        'Validated artifact',
        run.analyzedInMs !== undefined ? `Analyzed in ${(run.analyzedInMs / 1000).toFixed(1)}s` : undefined,
        isComplete ? 'Copy Open artifact' : undefined,
        'YES',
        market.yesCriteria,
        'NO',
        market.noCriteria,
        'Resolution',
        `${market.deadline} ${market.resolutionSource}`,
        market.evidenceSummary,
        !isCommittedTrace(run.trace) ? 'Local trace prepared from the structured outputs. It is useful for demo review, but it is not an Arc Testnet commit proof.' : undefined,
        disabled ? 'x402 is disabled for this run and is not blocking artifact review.' : undefined,
        publication?.artifactId ? `Artifact ID ${publication.artifactId}` : `Artifact ID ${run.acceptedMarket.id}`,
        publication?.status ? `Status ${publication.status}` : undefined,
        publication?.priceUsdcMicro ? `Price ${formatUsdcPrice(publication.priceUsdcMicro)}` : undefined,
        publication?.payToAddress ? `Pay-to address ${publication.payToAddress}` : undefined,
        publication?.gatewayUrl ? `Gateway ${publication.gatewayUrl}` : undefined,
        publication?.facilitatorUrl ? `Facilitator ${publication.facilitatorUrl}` : undefined,
        publication?.network ? `Network ${publication.network}` : undefined,
        publication?.intelligenceUrl ? `Intelligence URL ${publication.intelligenceUrl}` : undefined,
        publication?.demoUnlockUrl ? `Unlock URL ${publication.demoUnlockUrl}` : undefined,
      ]);
    }

    default:
      return getPendingArtifactReadableText(step, step.outputSummary || step.reasoningSnippet);
  }
}

function getPendingArtifactReadableText(step: PipelineStep, title: string): string {
  return normalizeReadableText([
    'Queued',
    title,
    step.status === 'running' ? step.reasoningSnippet : formatStepStatus(step.status),
    formatStepStatus(step.status),
  ]);
}

function normalizeReadableText(values: Array<string | undefined | null | false>): string {
  return values
    .filter(Boolean)
    .map((value) => String(value).replace(/[a-f0-9]{32,}/gi, '[hash]').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

function getSubmittedSourceForRun(run: PipelineRun): string {
  return run.sourceInput || run.submission.sourceText;
}

function getSubmittedSourceExcerpt(run: PipelineRun): string {
  return createSourceExcerpt(getSubmittedSourceForRun(run), 227);
}

function getExtractionTitle(run: PipelineRun, step: PipelineStep): string {
  if (run.extractedSource) return looksLikeUrl(run.sourceInput) ? 'Article source prepared.' : 'Source text prepared.';
  if (looksLikeUrl(run.sourceInput)) return step.status === 'complete' ? 'Article source prepared.' : 'Extracting article...';
  return step.status === 'complete' ? 'Source text prepared.' : 'Preparing pasted source.';
}

function getExtractionStatus(run: PipelineRun, step: PipelineStep): string {
  if (run.extractedSource) return 'Article text extracted';
  if (looksLikeUrl(run.sourceInput)) return step.status === 'running' ? 'Reading source' : 'URL prepared';
  return step.status === 'running' ? 'Preparing pasted text' : 'Source text prepared';
}

function formatLanguageConfidence(value: number): string {
  const normalizedValue = value > 1 ? value : value * 100;
  return `${Math.round(normalizedValue)}%`;
}

function getActors(entities: string[]): string {
  return entities.filter((entity) => !['Turkey', 'Argentina', 'Chile', 'Japan'].includes(entity)).join(', ') || 'Not provided';
}

function getNormalizedClaim(ingestion: SourceAnalysis): string {
  if (ingestion.region === 'Turkey') {
    return 'TCMB may publish an emergency liquidity or policy-rate intervention before the stated deadline.';
  }

  if (ingestion.region === 'Argentina' && ingestion.topic.includes('Currency')) {
    return 'Argentina may officially remove remaining currency controls before the stated deadline.';
  }

  if (ingestion.region === 'Chile') {
    if (ingestion.topic.includes('CEOL')) {
      return 'Laguna Verde CEOL terms are agreed, but official government ratification and Contraloria review remain pending.';
    }

    return 'Chile may publish an official lithium extraction permit decision before the stated deadline.';
  }

  if (ingestion.region === 'Japan') {
    return 'Japan may extend household electricity subsidies before the stated deadline.';
  }

  return `${ingestion.region} may officially confirm ${ingestion.topic.toLowerCase()} before the stated deadline.`;
}

function createResolverDiscoveryFromResolver(resolver: PipelineRun['liveResolver'] | undefined | null): PipelineRun['resolverDiscovery'] | undefined {
  if (!resolver) return undefined;

  const candidate = {
    name: resolver.name,
    url: resolver.url,
    source: 'llm-draft' as const,
    status: 'selected' as const,
    reason: resolver.verificationEvidence,
  };

  return {
    status: 'found',
    candidate,
    checkedCandidates: [candidate],
  };
}

function getResolverDiscoveryText(discovery: PipelineRun['resolverDiscovery'] | undefined, verifiedUrl?: string): string {
  if (!discovery) return '';

  const selectedUrl = verifiedUrl ?? discovery.candidate?.url;
  const candidates = discovery.checkedCandidates.length > 0
    ? discovery.checkedCandidates
    : discovery.candidate
      ? [discovery.candidate]
      : [];

  return normalizeReadableText([
    'Official Source Search',
    discovery.status === 'found'
      ? 'Official source candidates were checked before opening the final page.'
      : discovery.reason ?? 'No official source candidate passed the discovery checks.',
    discovery.status === 'found' ? 'Candidate selected' : 'No source',
    ...candidates.flatMap((candidate) => {
      const status = candidate.url === selectedUrl
        ? 'selected'
        : candidate.status ?? (discovery.status === 'found' ? 'unchecked' : 'rejected');

      return [
        'URL',
        candidate.url,
        'Source',
        formatResolverCandidateSource(candidate.source),
        'Status',
        formatResolverCandidateStatus(status),
        'Reason',
        candidate.reason ?? (status === 'selected' ? 'Selected for resolver verification.' : 'Candidate queued for discovery.'),
      ];
    }),
  ]);
}

function formatResolverCandidateSource(source: NonNullable<PipelineRun['resolverDiscovery']>['checkedCandidates'][number]['source']): string {
  const labels: Record<NonNullable<PipelineRun['resolverDiscovery']>['checkedCandidates'][number]['source'], string> = {
    'source-link': 'Outbound link',
    'source-url': 'Source URL',
    'llm-draft': 'LLM hint',
    'official-search': 'Official search',
    'official-homepage': 'Official domain',
  };

  return labels[source] ?? source;
}

function formatResolverCandidateStatus(status: NonNullable<NonNullable<PipelineRun['resolverDiscovery']>['checkedCandidates'][number]['status']>): string {
  if (status === 'selected') return 'Selected';
  if (status === 'rejected') return 'Rejected';
  return 'Queued';
}

function formatMetadataLabel(value: string): string {
  return value.replace(/([A-Z])/g, ' $1').trim();
}

function formatTraceStatus(trace: PipelineRun['trace']) {
  if (isCommittedTrace(trace)) return 'Committed transaction';
  if (trace) return 'Trace prepared';
  return 'Preparing commit';
}

function formatUsdcPrice(value: number): string {
  const usdc = value / 1_000_000;
  return `${usdc.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC (${value} micro-USDC)`;
}

function formatStepStatus(status: PipelineStep['status']): string {
  if (status === 'complete') return 'Complete';
  if (status === 'running') return 'Running';
  if (status === 'failed') return 'Failed';
  return 'Queued';
}
