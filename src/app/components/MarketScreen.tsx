import { ArrowRight, Check, Clipboard, Download, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PipelineRun } from '../pipeline/types';

export function MarketScreen({
  pipelineRun,
  onRunSampleArticle,
}: {
  pipelineRun: PipelineRun;
  onRunSampleArticle: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const market = pipelineRun.acceptedMarket;
  const ingestion = pipelineRun.ingestion;
  const context = pipelineRun.context;
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
            traceSummary: pipelineRun.trace
              ? `Local trace hash, Arc commit pending: ${pipelineRun.trace.traceHash}.`
              : 'Local trace hash pending. Arc commit pending.',
          })
        : '',
    [context, ingestion, market, pipelineRun.trace],
  );

  const handleCopyMemo = async () => {
    if (!operatorMemo) return;

    await navigator.clipboard.writeText(operatorMemo);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

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
        <div className="mx-auto grid w-full max-w-5xl gap-5 px-5 py-5 sm:px-8 lg:px-10 lg:py-6">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E3DED3] pb-4">
            <div>
              <div className="eyebrow">Finalized artifact</div>
              <div className="mt-2 text-sm text-[#77746B]">
                {ingestion ? `Original language source: ${ingestion.language} / ${ingestion.source} / ${ingestion.region}` : 'No accepted artifact yet'}
              </div>
              {pipelineRun.analyzedInMs !== undefined && (
                <div className="mt-1 text-sm font-medium text-[#77746B]">
                  Analyzed in {(pipelineRun.analyzedInMs / 1000).toFixed(1)}s
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleCopyMemo} disabled={!operatorMemo} className="primary-button pressable px-4 disabled:cursor-not-allowed disabled:opacity-45">
                <span className="inline-flex items-center justify-center gap-2">
                  {copied ? <Check aria-hidden="true" size={15} /> : <Clipboard aria-hidden="true" size={15} />}
                  {copied ? 'Copied' : 'Copy'}
                </span>
              </button>
              <button type="button" onClick={handleDownloadMemo} disabled={!operatorMemo} className="secondary-button pressable px-4 disabled:cursor-not-allowed disabled:opacity-45">
                <span className="inline-flex items-center justify-center gap-2">
                  <Download aria-hidden="true" size={15} />
                  Markdown
                </span>
              </button>
              <button type="button" onClick={onRunSampleArticle} className="secondary-button pressable px-4">
                <span className="inline-flex items-center justify-center gap-2">
                  <RotateCcw aria-hidden="true" size={15} />
                  Use sample source
                </span>
              </button>
            </div>
          </header>

          {!market || !context ? (
            <section className="artifact-card p-8 sm:p-12">
              <div className="eyebrow">No market</div>
              <h1 className="mt-5 max-w-3xl text-3xl font-semibold leading-tight tracking-normal text-[#171717] sm:text-5xl">
                No accepted market artifact is available.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-[#625F57]">
                Run a source through /create. Rejected inputs do not produce a market.
              </p>
            </section>
          ) : (
            <article className="artifact-card overflow-hidden">
              <div className="grid gap-4 p-5 sm:p-6">
                <section className="grid gap-3 rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-3 text-sm font-semibold text-[#292824] sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] sm:items-center">
                  <FlowStep label="Source" />
                  <ArrowRight aria-hidden="true" className="hidden text-[#8B877D] sm:block" size={15} />
                  <FlowStep label="Rejected markets" />
                  <ArrowRight aria-hidden="true" className="hidden text-[#8B877D] sm:block" size={15} />
                  <FlowStep label="Accepted market" />
                  <ArrowRight aria-hidden="true" className="hidden text-[#8B877D] sm:block" size={15} />
                  <FlowStep label="Local trace" />
                </section>

                <div>
                  <p className="text-sm font-medium text-[#77746B]">Foreign-language source excerpt</p>
                  <p className="mt-2 max-w-4xl text-sm leading-6 text-[#625F57]">{createSourceExcerpt(pipelineRun.sourceInput)}</p>
                </div>

                <div className="border-t border-[#E5E1D8] pt-4">
                  <p className="text-sm font-medium text-[#77746B]">English summary</p>
                  <p className="mt-2 max-w-4xl text-sm leading-6 text-[#625F57]">{context.englishSummary}</p>
                </div>

                <div className="border-t border-[#E5E1D8] pt-4">
                  <p className="text-sm font-medium text-[#77746B]">Final accepted validated market draft</p>
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
                  <ReportField label="Critic verdict" value={market.criticReasoning} />
                  <ReportField label="Arc status" value="Arc commit pending." />
                  <ReportField
                    label="Local trace hash, Arc commit pending"
                    value={
                      pipelineRun.trace
                        ? pipelineRun.trace.traceHash
                        : 'Local trace hash pending.'
                    }
                  />
                </section>

                <section className="border-t border-[#E5E1D8] pt-4">
                  <div className="eyebrow">Rejected candidate markets</div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {getRejectedMarkets(pipelineRun).map((rejected) => (
                      <div key={rejected.draftId} className="rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#8C3D32]">
                          Violated rule: {rejected.violatedRule}
                        </div>
                        <div className="mt-2 text-sm font-semibold leading-6 text-[#292824]">{rejected.question}</div>
                        <p className="mt-1 text-sm leading-6 text-[#625F57]">{rejected.reasonRejected}</p>
                      </div>
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

function FlowStep({ label }: { label: string }) {
  return <div className="rounded border border-[#E5E1D8] bg-white px-3 py-2 text-center">{label}</div>;
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
    '# AgoraBabel Market Artifact',
    '',
    `Source: ${sourceTitle}`,
    `Original language: ${originalLanguage}`,
    `Region: ${region}`,
    '',
    '## Source Reasoning',
    englishSummary,
    '',
    '## Accepted Market',
    question,
    '',
    `YES: ${yesCriteria}`,
    '',
    `NO: ${noCriteria}`,
    '',
    `Deadline: ${deadline}`,
    `Resolution source: ${resolutionSource}`,
    '',
    '## Critic Decision',
    criticVerdict,
    '',
    '## Local Trace Hash',
    traceSummary,
  ].join('\n');
}
