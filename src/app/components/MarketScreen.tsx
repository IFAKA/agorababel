import { ArrowRight, Check, Clipboard, Download, ExternalLink, LoaderCircle, LockKeyhole, ReceiptText, Share2, WalletCards } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { emitProductEvent } from '../pipeline/apiProvider';
import type { PipelineRun } from '../pipeline/types';
import { pageContainerClassName } from './pageLayout';

export function MarketScreen({
  pipelineRun,
}: {
  pipelineRun: PipelineRun;
}) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [unlockState, setUnlockState] = useState<X402UnlockState>({ status: 'idle' });
  const market = pipelineRun.acceptedMarket;
  const ingestion = pipelineRun.ingestion;
  const context = pipelineRun.context;
  const analysis = pipelineRun.analysis;
  const trace = pipelineRun.trace;
  const traceCommitted = isCommittedTrace(trace);
  const tracePanelTitle = traceCommitted ? 'Arc Testnet Commit' : 'Local Trace Prepared';
  const operatorMemo = useMemo(
    () =>
      market && ingestion && context
        ? createOperatorMemo({
            sourceTitle: ingestion.signalName,
            originalLanguage: ingestion.language,
            region: ingestion.region,
            englishSummary: context.englishSummary,
            question: market.question,
            yesCriteria: market.yesCriteria,
            noCriteria: market.noCriteria,
            deadline: market.deadline,
            resolutionSource: market.resolutionSource,
            criticVerdict: market.criticReasoning,
            traceSummary: describeTraceForMemo(trace),
          })
        : '',
    [context, ingestion, market, trace],
  );

  const handleCopyMemo = async () => {
    if (!operatorMemo) return;

    await navigator.clipboard.writeText(operatorMemo);
    emitProductEvent('artifact_copied', { artifactId: market?.id, runId: pipelineRun.id });
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: market?.question ?? 'AgoraBabel market artifact', url });
    } else {
      await navigator.clipboard.writeText(url);
    }
    emitProductEvent('artifact_shared', { artifactId: market?.id, runId: pipelineRun.id });
  };

  const handleFeedback = (value: string) => {
    setFeedback(value);
    emitProductEvent('feedback_submitted', { artifactId: market?.id, runId: pipelineRun.id, stage: value });
  };

  const handleUnlock = async () => {
    if (!pipelineRun.x402 || !pipelineRun.x402.intelligenceUrl) return;
    if (pipelineRun.x402.status === 'disabled') {
      setUnlockState({ status: 'disabled' });
      emitProductEvent('x402_unlock_failed', { artifactId: market?.id, runId: pipelineRun.id, stage: 'disabled' });
      return;
    }

    emitProductEvent('x402_unlock_started', { artifactId: market?.id, runId: pipelineRun.id });
    setUnlockState({ status: 'checking' });

    try {
      const unpaidResponse = await fetch(pipelineRun.x402.intelligenceUrl);
      const requiredProof = unpaidResponse.status === 402
        ? await unpaidResponse.json().catch(() => null) as X402RequiredProof | null
        : null;

      if (unpaidResponse.status !== 402) {
        setUnlockState({ status: unpaidResponse.ok ? 'unlocked' : 'failed' });
        if (!unpaidResponse.ok) {
          emitProductEvent('x402_unlock_failed', { artifactId: market?.id, runId: pipelineRun.id, stage: String(unpaidResponse.status) });
        }
        return;
      }

      setUnlockState({ status: 'paying', requiredProof });
      const unlockResponse = await fetch(pipelineRun.x402.demoUnlockUrl ?? pipelineRun.x402.intelligenceUrl.replace(/\/intelligence$/, '/demo-unlock'), {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const payload = await unlockResponse.json().catch(() => null) as DemoUnlockPayload | null;

      if (!unlockResponse.ok || payload?.status !== 'unlocked') {
        setUnlockState({
          status: 'failed',
          requiredProof,
          error: payload && 'error' in payload && typeof payload.error === 'string' ? payload.error : `HTTP ${unlockResponse.status}`,
        });
        emitProductEvent('x402_unlock_failed', { artifactId: market?.id, runId: pipelineRun.id, stage: String(unlockResponse.status) });
        return;
      }

      setUnlockState({ status: 'unlocked', requiredProof, unlock: payload });
      emitProductEvent('x402_unlock_completed', { artifactId: market?.id, runId: pipelineRun.id });
    } catch (error) {
      setUnlockState({ status: 'failed', error: error instanceof Error ? error.message : 'Buyer-agent unlock failed.' });
      emitProductEvent('x402_unlock_failed', { artifactId: market?.id, runId: pipelineRun.id, stage: 'payment-required' });
    }
  };

  useEffect(() => {
    if (market) emitProductEvent('artifact_opened', { artifactId: market.id, runId: pipelineRun.id });
  }, [market, pipelineRun.id]);

  const handleDownloadMemo = () => {
    if (!operatorMemo) return;

    const blob = new Blob([operatorMemo], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'agorababel-market-artifact.md';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F7F6F1] text-[#191A1C]">
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className={pageContainerClassName}>
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E3DED3] pb-4">
            <div>
              <div className="eyebrow">Validated Prediction-Market Artifact</div>
              <div className="mt-2 text-sm text-[#77746B]">
                {ingestion ? `Original-language source: ${ingestion.language} / ${ingestion.source} / ${ingestion.region}` : 'No persisted artifact found for this route.'}
              </div>
              {pipelineRun.analyzedInMs !== undefined && (
                <div className="mt-1 text-sm font-medium text-[#77746B]">
                  Analyzed in {(pipelineRun.analyzedInMs / 1000).toFixed(1)}s
                </div>
              )}
            </div>
            {operatorMemo && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={handleCopyMemo} className="primary-button pressable px-4">
                  <span className="inline-flex items-center justify-center gap-2">
                    {copied ? <Check aria-hidden="true" size={15} /> : <Clipboard aria-hidden="true" size={15} />}
                    {copied ? 'Copied' : 'Copy'}
                  </span>
                </button>
                <button type="button" onClick={handleDownloadMemo} className="secondary-button pressable px-4">
                  <span className="inline-flex items-center justify-center gap-2">
                    <Download aria-hidden="true" size={15} />
                    Markdown
                  </span>
                </button>
                <button type="button" onClick={handleShare} className="secondary-button pressable px-4">
                  <span className="inline-flex items-center justify-center gap-2">
                    <Share2 aria-hidden="true" size={15} />
                    Share
                  </span>
                </button>
              </div>
            )}
          </header>

          {!market || !context ? (
            <section className="artifact-card p-8 sm:p-12">
              <div className="eyebrow">No persisted artifact</div>
              <h1 className="mt-5 max-w-3xl text-3xl font-semibold leading-tight tracking-normal text-[#171717] sm:text-5xl">
                No persisted artifact found for this route.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-[#625F57]">
                Complete an analysis before opening an artifact route.
              </p>
            </section>
          ) : (
            <article className="artifact-card overflow-hidden">
              <div className="grid gap-4 p-5 sm:p-6">
                <section className="grid gap-3 rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-3 text-sm font-semibold text-[#292824] sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] sm:items-center">
                  <FlowStep label="Source" />
                  <ArrowRight aria-hidden="true" className="hidden text-[#8B877D] sm:block" size={15} />
                  <FlowStep label="Candidate Markets Rejected" />
                  <ArrowRight aria-hidden="true" className="hidden text-[#8B877D] sm:block" size={15} />
                  <FlowStep label="Final Market" />
                  <ArrowRight aria-hidden="true" className="hidden text-[#8B877D] sm:block" size={15} />
                  <FlowStep label="Audit Trace" />
                </section>

                <div>
                  <p className="text-sm font-medium text-[#77746B]">Source</p>
                  <p className="mt-2 max-w-4xl text-sm leading-6 text-[#625F57]">{createSourceExcerpt(pipelineRun.sourceInput)}</p>
                </div>

                <ArtifactComparison pipelineRun={pipelineRun} />

                <div className="border-t border-[#E5E1D8] pt-4">
                  <p className="text-sm font-medium text-[#77746B]">Translation & Context</p>
                  <p className="mt-2 max-w-4xl text-sm leading-6 text-[#625F57]">{context.englishSummary}</p>
                </div>

                <div className="border-t border-[#E5E1D8] pt-4">
                  <p className="text-sm font-medium text-[#77746B]">Final Market</p>
                  <h1 className="mt-3 max-w-4xl text-2xl font-semibold leading-tight tracking-normal text-[#171717] sm:text-3xl">
                    {market.question}
                  </h1>
                </div>

                <section className="grid gap-4 border-t border-[#E5E1D8] pt-4 md:grid-cols-2">
                  <CriteriaBlock label="YES criteria" value={market.yesCriteria} />
                  <CriteriaBlock label="NO criteria" value={market.noCriteria} />
                </section>

                <section className="grid gap-4 border-t border-[#E5E1D8] pt-4 sm:grid-cols-2">
                  <ReportField label="Deadline" value={market.deadline} />
                  <ReportField label="Resolution source" value={market.resolutionSource} />
                  <ReportField label="Resolution criteria" value={market.criticReasoning} />
                  <ReportField
                    label="Arc artifact hash"
                    value={
                      traceCommitted
                        ? trace?.artifactHash ?? trace?.traceHash ?? 'Committed hash unavailable.'
                        : trace?.traceHash ?? 'No committed Arc trace.'
                    }
                  />
                </section>

                {analysis && (
                  <section className="grid gap-4 border-t border-[#E5E1D8] pt-4 lg:grid-cols-3">
                    <ProofPanel title="Official Resolver">
                      {analysis.resolver ? (
                        <>
                          <p className="text-sm font-semibold text-[#292824]">{analysis.resolver.name}</p>
                          <a href={analysis.resolver.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 break-all text-sm font-medium text-[#305F72]">
                            {analysis.resolver.url}
                            <ExternalLink aria-hidden="true" size={13} />
                          </a>
                          <p className="mt-2 text-sm leading-6 text-[#625F57]">{analysis.resolver.verificationEvidence}</p>
                        </>
                      ) : (
                        <p className="text-sm leading-6 text-[#625F57]">Source analyzed, but no official resolver found.</p>
                      )}
                    </ProofPanel>
                    <ProofPanel title="Market Comparison">
                      <p className="text-sm font-semibold text-[#292824]">{analysis.marketComparison?.noveltyVerdict ?? 'not checked'}</p>
                      <p className="mt-2 text-sm leading-6 text-[#625F57]">{analysis.marketComparison?.reasoning ?? analysis.rejectionReason ?? 'Market comparison did not run.'}</p>
                      <p className="mt-2 text-xs font-medium text-[#77746B]">{analysis.marketComparison?.similarMarkets.length ?? 0} similar markets listed</p>
                    </ProofPanel>
                    <ProofPanel title="Circle Wallet">
                      <p className="text-sm font-semibold text-[#292824]">{analysis.circleAgentWallet.status} / {analysis.circleAgentWallet.blockchain}</p>
                      <p className="mt-2 break-all text-sm leading-6 text-[#625F57]">{analysis.circleAgentWallet.address ?? 'No wallet address'}</p>
                      <p className="mt-1 text-xs font-medium text-[#77746B]">Wallet ID: {analysis.circleAgentWallet.walletId ?? 'missing'}</p>
                    </ProofPanel>
                  </section>
                )}

                <section className="grid gap-4 border-t border-[#E5E1D8] pt-4 md:grid-cols-2">
                  <ProofPanel title={tracePanelTitle}>
                    <p className="text-sm font-semibold text-[#292824]">{trace?.network ?? 'No committed trace'}</p>
                    <p className="mt-2 break-all text-sm leading-6 text-[#625F57]">
                      {traceCommitted
                        ? trace?.transactionId ?? 'Transaction hash unavailable'
                        : trace?.transactionId ?? 'Local trace prepared; no Arc transaction submitted'}
                    </p>
                    {!traceCommitted && (
                      <p className="mt-2 text-sm leading-6 text-[#625F57]">
                        Local trace prepared from the structured outputs. It is useful for demo review, but it is not an Arc Testnet commit proof.
                      </p>
                    )}
                    {traceCommitted && trace?.explorerUrl && (
                      <a href={trace.explorerUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[#305F72]">
                        Arcscan
                        <ExternalLink aria-hidden="true" size={13} />
                      </a>
                    )}
                  </ProofPanel>
                  <X402Panel x402={pipelineRun.x402} unlockState={unlockState} onUnlock={handleUnlock} />
                </section>

                <section className="border-t border-[#E5E1D8] pt-4">
                  <div className="eyebrow">Candidate Markets Rejected</div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {getRejectedMarkets(pipelineRun).map((rejected) => (
                      <div key={rejected.draftId} className="rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#8C3D32]">
                          Rejected: {formatRejectedReason(rejected.violatedRule)}
                        </div>
                        <div className="mt-2 text-sm font-semibold leading-6 text-[#292824]">{rejected.question}</div>
                        <p className="mt-1 text-sm leading-6 text-[#625F57]">{rejected.reasonRejected}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="border-t border-[#E5E1D8] pt-4">
                  <div className="eyebrow">Feedback</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {['Would trade', 'Would not trade', 'Needs clearer resolver'].map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => handleFeedback(item)}
                        className={`secondary-button pressable px-4 ${feedback === item ? 'border-[#171717] bg-[#171717] text-white' : ''}`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            </article>
          )}
        </div>
      </main>
    </div>
  );
}

type X402RequiredProof = {
  artifactId?: string;
  priceUsdcMicro?: number;
  formattedPrice?: string;
  payToAddress?: string;
  network?: string;
  gatewayUrl?: string;
};

type X402Receipt = {
  payer: string;
  seller: string;
  priceUsdcMicro: number;
  formattedPrice: string;
  network: string;
  settlementTransaction: string | null;
};

type DemoUnlockPayload = {
  status?: 'unlocked';
  artifactId?: string;
  buyer?: string;
  deposit?: null | {
    status: 'submitted';
    amountUsdc: string;
    depositTxHash: string;
    approvalTxHash?: string;
  };
  receipt?: X402Receipt;
  error?: string;
};

type X402UnlockState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'paying'; requiredProof: X402RequiredProof | null }
  | { status: 'unlocked'; requiredProof?: X402RequiredProof | null; unlock?: DemoUnlockPayload }
  | { status: 'failed'; requiredProof?: X402RequiredProof | null; error?: string }
  | { status: 'disabled' };

function X402Panel({
  x402,
  unlockState,
  onUnlock,
}: {
  x402: PipelineRun['x402'];
  unlockState: X402UnlockState;
  onUnlock: () => void;
}) {
  if (!x402 || x402.status === 'disabled') {
    return (
      <ProofPanel title="x402 Intelligence API">
        <p className="text-sm font-semibold text-[#292824]">Disabled for this run</p>
        <p className="mt-2 text-sm leading-6 text-[#625F57]">
          x402 is optional in this submission path and is not required unless X402_ENABLED=true.
        </p>
      </ProofPanel>
    );
  }

  return (
    <ProofPanel title="x402 Intelligence API">
      <div className="flex items-start gap-2">
        <LockKeyhole aria-hidden="true" className="mt-0.5 shrink-0 text-[#8C3D32]" size={16} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#292824]">Payment required until the buyer agent signs.</p>
          <p className="mt-1 break-all text-sm leading-6 text-[#625F57]">{x402.intelligenceUrl}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-sm text-[#625F57]">
        <X402Fact label="Price" value={`${formatMicroUsdc(x402.priceUsdcMicro)} USDC (${x402.priceUsdcMicro ?? 0} micro-USDC)`} />
        <X402Fact label="Seller" value={x402.payToAddress ?? 'No seller wallet configured'} />
        <X402Fact label="Gateway" value={x402.gatewayUrl ?? x402.facilitatorUrl ?? 'Circle Gateway testnet'} />
        <X402Fact label="Network" value={x402.network ?? 'Arc Testnet'} />
      </div>
      <button
        type="button"
        onClick={onUnlock}
        disabled={unlockState.status === 'checking' || unlockState.status === 'paying'}
        className="secondary-button pressable mt-3 px-4 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="inline-flex items-center justify-center gap-2">
          {unlockState.status === 'checking' || unlockState.status === 'paying'
            ? <LoaderCircle aria-hidden="true" className="animate-spin" size={15} />
            : <WalletCards aria-hidden="true" size={15} />}
          Pay with buyer agent
        </span>
      </button>
      {unlockState.status === 'checking' && <p className="mt-2 text-sm font-medium text-[#625F57]">Checking unpaid endpoint for a 402 challenge...</p>}
      {unlockState.status === 'paying' && (
        <div className="mt-3 rounded border border-[#E5E1D8] bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#8C3D32]">402 Required Proof</p>
          <p className="mt-2 text-sm leading-6 text-[#625F57]">
            The intelligence endpoint returned Payment Required. The buyer agent is signing and settling through Circle Gateway.
          </p>
        </div>
      )}
      {unlockState.status === 'unlocked' && (
        <div className="mt-3 rounded border border-[#CFC8BA] bg-white p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#292824]">
            <ReceiptText aria-hidden="true" size={15} />
            Paid receipt
          </div>
          <div className="mt-2 grid gap-2 text-sm text-[#625F57]">
            <X402Fact label="Buyer" value={unlockState.unlock?.buyer ?? unlockState.unlock?.receipt?.payer ?? 'Buyer address unavailable'} />
            <X402Fact label="Settlement" value={unlockState.unlock?.receipt?.settlementTransaction ?? 'Settlement accepted by Gateway'} />
            {unlockState.unlock?.deposit && (
              <X402Fact label="Deposit" value={`${unlockState.unlock.deposit.amountUsdc} USDC / ${unlockState.unlock.deposit.depositTxHash}`} />
            )}
          </div>
        </div>
      )}
      {unlockState.status === 'failed' && (
        <p className="mt-2 text-sm font-medium text-[#8C3D32]">
          Buyer-agent unlock failed{unlockState.error ? `: ${unlockState.error}` : '.'}
        </p>
      )}
    </ProofPanel>
  );
}

function X402Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[5.5rem_1fr]">
      <span className="font-medium text-[#77746B]">{label}</span>
      <span className="min-w-0 break-all text-[#292824]">{value}</span>
    </div>
  );
}

function ProofPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-3">
      <div className="eyebrow">{title}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function FlowStep({ label }: { label: string }) {
  return <div className="rounded border border-[#E5E1D8] bg-white px-3 py-2 text-center">{label}</div>;
}

function ArtifactComparison({ pipelineRun }: { pipelineRun: PipelineRun }) {
  const ingestion = pipelineRun.ingestion;
  const market = pipelineRun.acceptedMarket;
  const rejectedCount = getRejectedMarkets(pipelineRun).length;
  const artifactItems = [
    ingestion ? `${ingestion.language} source, ${ingestion.sourceDate}, ${ingestion.region}` : 'Source metadata unavailable',
    ingestion ? `Actors: ${ingestion.entities.filter((entity) => entity !== ingestion.region).join(', ') || 'Not provided'}` : 'Actors unavailable',
    market ? `Accepted resolver: ${market.resolutionSource}` : 'Resolver unavailable',
    market ? `Accepted deadline: ${market.deadline}` : 'Deadline unavailable',
    `${rejectedCount} rejected alternatives with reasons`,
    `Trace status: ${describeTraceForMemo(pipelineRun.trace)}`,
  ];

  return (
    <section className="rounded-md border border-[#D8D3C8] bg-white p-4">
      <div className="eyebrow">Naive output vs AgoraBabel artifact</div>
      <div className="mt-4 grid gap-3 md:grid-cols-[0.85fr_1.15fr] md:items-start">
        <div className="rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#77746B]">Naive output</div>
          <p className="mt-2 text-base font-semibold leading-7 text-[#292824]">{getNaiveQuestion(pipelineRun)}</p>
        </div>
        <div className="rounded-md border border-[#CFC8BA] bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#171717]">AgoraBabel artifact</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {artifactItems.map((item) => (
              <div key={item} className="flex min-w-0 gap-2 text-sm leading-6 text-[#625F57]">
                <Check aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-[#526247]" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {isChileCeolRun(pipelineRun) && (
        <p className="mt-3 text-sm font-medium leading-6 text-[#625F57]">
          AgoraBabel separates "terms agreed" from "ratification still pending" and resolves only on official government or Contraloria publication.
        </p>
      )}
    </section>
  );
}

function getNaiveQuestion(run: PipelineRun): string {
  if (isChileCeolRun(run)) {
    return 'Will Chile approve the Laguna Verde lithium deal by June 30, 2026?';
  }

  const deadline = run.acceptedMarket?.deadline ?? 'the deadline';
  const topic = run.ingestion?.topic.toLowerCase() ?? 'the reported event';

  return `Will ${topic} happen by ${deadline}?`;
}

function isChileCeolRun(run: PipelineRun): boolean {
  const text = [
    run.sourceInput,
    run.ingestion?.signalName,
    run.ingestion?.topic,
    run.acceptedMarket?.question,
  ].filter(Boolean).join(' ').toLowerCase();

  return text.includes('ceol') || text.includes('laguna verde') || text.includes('contraloria');
}

function getRejectedMarkets(pipelineRun: PipelineRun) {
  if (pipelineRun.rejectedMarkets.length > 0) return pipelineRun.rejectedMarkets;

  return pipelineRun.candidateMarkets
    .filter((candidate) => candidate.id !== pipelineRun.acceptedMarket?.id)
    .map((candidate) => {
      const review = pipelineRun.criticReviews.find((item) => item.draftId === candidate.id);

      return {
        draftId: candidate.id,
        question: candidate.question,
        reasonRejected: review?.reasoning ?? 'Rejected by guardrails.',
        violatedRule: review?.violatedRule ?? 'ambiguity' as const,
      };
    });
}

function createSourceExcerpt(sourceInput: string) {
  const trimmed = sourceInput.trim().replace(/\s+/g, ' ');
  return trimmed.length > 360 ? `${trimmed.slice(0, 360)}...` : trimmed;
}

function CriteriaBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <p className="mt-3 text-base leading-7 text-[#292824]">{value}</p>
    </div>
  );
}

function ReportField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow">{label}</div>
      <div className="mt-3 break-words text-base font-medium leading-7 text-[#292824]">{value}</div>
    </div>
  );
}

function createOperatorMemo({
  sourceTitle,
  originalLanguage,
  region,
  englishSummary,
  question,
  yesCriteria,
  noCriteria,
  deadline,
  resolutionSource,
  criticVerdict,
  traceSummary,
}: {
  sourceTitle: string;
  originalLanguage: string;
  region: string;
  englishSummary: string;
  question: string;
  yesCriteria: string;
  noCriteria: string;
  deadline: string;
  resolutionSource: string;
  criticVerdict: string;
  traceSummary: string;
}) {
  return [
    '# Validated Prediction-Market Artifact',
    '',
    '## Source',
    'Original-language material analyzed by the system.',
    `Material: ${sourceTitle}`,
    `Language: ${originalLanguage}`,
    `Region: ${region}`,
    '',
    '## Translation & Context',
    'English operational summary and market implications.',
    englishSummary,
    '',
    '## Candidate Markets Rejected',
    'Drafts rejected during validation review are included in the application view.',
    '',
    '## Final Market',
    'Validated YES/NO market artifact.',
    question,
    '',
    `YES: ${yesCriteria}`,
    '',
    `NO: ${noCriteria}`,
    '',
    '## Resolution Criteria',
    'Official conditions required for resolution.',
    `Deadline: ${deadline}`,
    `Official source: ${resolutionSource}`,
    criticVerdict,
    '',
    '## Audit Trace',
    'Audit status for the artifact.',
    traceSummary,
  ].join('\n');
}

function isCommittedTrace(trace: PipelineRun['trace']) {
  return trace?.status === 'committed' && Boolean(trace.transactionId?.startsWith('0x')) && Boolean(trace.explorerUrl);
}

function describeTraceForMemo(trace: PipelineRun['trace']) {
  if (!trace) {
    return 'No Arc transaction is attached to this artifact.';
  }

  if (isCommittedTrace(trace)) {
    return `Arc Testnet transaction ${trace.transactionId}; artifact hash ${trace.artifactHash ?? trace.traceHash}.`;
  }

  return `Local trace prepared from structured outputs; no Arc transaction or x402 proof is attached. Trace hash ${trace.traceHash}.`;
}

function formatMicroUsdc(value: number | null | undefined) {
  if (!value || value <= 0) return '0';
  const whole = Math.floor(value / 1_000_000);
  const fraction = String(value % 1_000_000).padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function formatRejectedReason(rule: string) {
  const normalized = rule.toLowerCase();

  if (normalized.includes('deadline')) return 'Missing deadline';
  if (normalized.includes('evidence')) return 'Weak evidence';
  if (normalized.includes('subjective')) return 'Subjective wording';
  if (normalized.includes('binary')) return 'Non-binary outcome';
  if (normalized.includes('resolution')) return 'Ambiguous resolution';
  return 'Ambiguous resolution';
}
