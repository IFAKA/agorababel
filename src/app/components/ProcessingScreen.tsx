import { ArrowRight, Check, Clipboard, LoaderCircle, Play, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import type { Screen } from '../App';
import type { CriticVerdict, MarketQuestion, PipelineRun, PipelineStep, PipelineStepStatus } from '../pipeline/types';

type StepState = 'complete' | 'active' | 'pending' | 'failed';

const stepLabels: Record<PipelineStep['id'], string> = {
  extraction: 'Extract',
  ingestion: 'Source',
  context: 'Reasoning',
  'market-creator': 'Draft',
  critic: 'Decision',
  settlement: 'Artifact',
};

const stepDescriptions: Record<PipelineStep['id'], string> = {
  extraction: 'The article or pasted source is prepared.',
  ingestion: 'The source is normalized and identified.',
  context: 'The agent extracts why the signal matters.',
  'market-creator': 'A binary market draft is formed.',
  critic: 'Weak candidates are removed.',
  settlement: 'The accepted artifact is finalized.',
};

const MIN_PASTED_SOURCE_LENGTH = 120;
const UNSUPPORTED_URL_HOSTS = ['facebook.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'x.com', 'twitter.com'];

export function ProcessingScreen({
  sourceText,
  onSourceTextChange,
  runId,
  pipelineRun,
  onRunPipeline,
  onOpenFinalArtifact,
  onRunSampleArticle,
}: {
  sourceText: string;
  onSourceTextChange: (value: string) => void;
  runId: number;
  pipelineRun: PipelineRun;
  onRunPipeline: (value: string) => void;
  onNavigate: (screen: Screen) => void;
  onOpenFinalArtifact: () => void;
  onRunSampleArticle: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [errorCopied, setErrorCopied] = useState(false);
  const reduceMotion = useReducedMotion();
  const hasStarted = runId > 0;
  const runningStep = pipelineRun.steps.find((step) => step.status === 'running');
  const activeStep = runningStep ?? [...pipelineRun.steps].reverse().find((step) => step.status === 'complete') ?? pipelineRun.steps[0];
  const copyText = useMemo(() => formatMarketForCopy(pipelineRun), [pipelineRun]);
  const errorCopyText = useMemo(() => formatErrorForCopy(pipelineRun), [pipelineRun]);
  const isComplete = pipelineRun.status === 'complete';
  const isRunning = pipelineRun.status === 'running';
  const sourceReadiness = getSourceReadiness(sourceText, isRunning);

  useEffect(() => {
    setCopied(false);
    setErrorCopied(false);
  }, [pipelineRun.id]);

  const handleCopy = async () => {
    if (!pipelineRun.acceptedMarket) return;

    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const handleCopyError = async () => {
    if (!pipelineRun.error) return;

    await navigator.clipboard.writeText(errorCopyText);
    setErrorCopied(true);
    window.setTimeout(() => setErrorCopied(false), 1600);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F7F6F1] text-[#191A1C]">
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
          <header className="grid gap-5 border-b border-[#E3DED3] pb-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <p className="text-sm font-medium text-[#77746B]">Source to agent reasoning to decision to finalized artifact</p>
              <h1 className="mt-3 max-w-4xl text-4xl font-semibold leading-tight tracking-normal text-[#171717] sm:text-5xl">
                Watch one source become one market.
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={onRunSampleArticle} className="primary-button pressable px-5">
                <span className="inline-flex items-center justify-center gap-2">
                  <Play aria-hidden="true" size={15} />
                  Use sample source
                </span>
              </button>
            </div>
          </header>

          <section className="grid gap-8 lg:grid-cols-[minmax(18rem,0.48fr)_minmax(0,1fr)] lg:items-start">
            <aside className={`grid gap-6 ${hasStarted ? 'order-2' : 'order-1'} lg:order-none`}>
              <SourceInput
                sourceText={sourceText}
                onSourceTextChange={onSourceTextChange}
                onRunPipeline={onRunPipeline}
                sourceReadiness={sourceReadiness}
              />
              <ProgressSpine steps={pipelineRun.steps} runStatus={pipelineRun.status} hasStarted={hasStarted} />
            </aside>

            <div className={`min-w-0 ${hasStarted ? 'order-1' : 'order-2'} lg:order-none`}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={hasStarted ? `${activeStep?.id}-${pipelineRun.status}` : 'queued'}
                  initial={reduceMotion ? false : { opacity: 0, y: 12, filter: 'blur(4px)' }}
                  animate={reduceMotion ? undefined : { opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -8, filter: 'blur(3px)' }}
                  transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
                >
                  {!hasStarted ? (
                    <QueuedArtifact />
                  ) : (
                    <ActiveArtifact
                      pipelineRun={pipelineRun}
                      activeStep={activeStep}
                      copied={copied}
                      errorCopied={errorCopied}
                      onCopy={handleCopy}
                      onCopyError={handleCopyError}
                      onOpenFinalArtifact={onOpenFinalArtifact}
                      isComplete={isComplete}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function SourceInput({
  sourceText,
  onSourceTextChange,
  onRunPipeline,
  sourceReadiness,
}: {
  sourceText: string;
  onSourceTextChange: (value: string) => void;
  onRunPipeline: (value: string) => void;
  sourceReadiness: SourceReadiness;
}) {
  const charactersRemaining = Math.max(MIN_PASTED_SOURCE_LENGTH - sourceText.trim().length, 0);

  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between gap-3">
        <label className="eyebrow" htmlFor="source-material">
          Source
        </label>
        {!looksLikeUrl(sourceText) && charactersRemaining > 0 && (
          <span className="text-xs font-medium text-[#8B877D]">{charactersRemaining} more chars</span>
        )}
      </div>
      <textarea
        id="source-material"
        value={sourceText}
        onChange={(event) => onSourceTextChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            if (!sourceReadiness.canRun) {
              event.preventDefault();
              return;
            }

            onRunPipeline(sourceText);
          }
        }}
        aria-describedby="source-readiness-message"
        aria-invalid={sourceReadiness.tone === 'blocked'}
        autoComplete="off"
        spellCheck="true"
        className={`mt-3 h-56 w-full resize-none rounded-md border bg-white px-4 py-3 text-sm leading-7 text-[#292824] placeholder:text-[#9D998E] transition-colors duration-200 focus:outline-none ${
          sourceReadiness.tone === 'blocked'
            ? 'border-[#C58778] focus:border-[#8C3D32]'
            : 'border-[#E0DCD2] focus:border-[#171717]'
        }`}
        placeholder="Paste local-language article text or a URL..."
      />
      <p
        id="source-readiness-message"
        className={`mt-3 text-sm leading-6 ${
          sourceReadiness.tone === 'ready'
            ? 'text-[#526247]'
            : sourceReadiness.tone === 'blocked'
              ? 'text-[#8C3D32]'
              : 'text-[#77746B]'
        }`}
      >
        {sourceReadiness.message}
      </p>
      <button
        type="button"
        onClick={() => {
          if (sourceReadiness.canRun) onRunPipeline(sourceText);
        }}
        disabled={!sourceReadiness.canRun}
        className="primary-button pressable mt-4 w-full px-5 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <span className="inline-flex items-center justify-center gap-2">
          <Play aria-hidden="true" size={15} />
          Analyze source
        </span>
      </button>
    </section>
  );
}

function ProgressSpine({
  steps,
  runStatus,
  hasStarted,
}: {
  steps: PipelineStep[];
  runStatus: PipelineRun['status'];
  hasStarted: boolean;
}) {
  return (
    <nav aria-label="Workflow progress" className="grid gap-1">
      {steps.map((step) => {
        const state = getStepState(hasStarted ? step.status : 'pending', runStatus);

        return (
          <div key={step.id} className="grid grid-cols-[1.4rem_minmax(0,1fr)] gap-3 py-2">
            <StepMark state={state} />
            <div className="min-w-0">
              <div className={`text-sm font-medium ${state === 'active' ? 'text-[#171717]' : 'text-[#77746B]'}`}>
                {stepLabels[step.id]}
              </div>
              <p className="mt-1 text-sm leading-6 text-[#8B877D]">{stepDescriptions[step.id]}</p>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function StepMark({ state }: { state: StepState }) {
  const className = state === 'complete'
    ? 'border-[#171717] bg-[#171717]'
    : state === 'active'
      ? 'border-[#171717] bg-white'
      : state === 'failed'
        ? 'border-[#8C3D32] bg-[#8C3D32]'
        : 'border-[#D8D3C8] bg-[#F7F6F1]';

  return (
    <span className={`mt-0.5 grid size-5 place-items-center rounded-full border ${className}`}>
      {state === 'complete' && <Check aria-hidden="true" className="text-white" size={12} />}
      {state === 'active' && <LoaderCircle aria-hidden="true" className="animate-spin text-[#171717]" size={12} />}
      {state === 'failed' && <X aria-hidden="true" className="text-white" size={12} />}
    </span>
  );
}

function QueuedArtifact() {
  return (
    <section className="artifact-card min-h-[30rem] p-8 sm:p-10">
      <div className="eyebrow">Ready</div>
      <h2 className="mt-5 max-w-2xl text-3xl font-semibold leading-tight tracking-normal text-[#171717] sm:text-4xl">
        The workflow is waiting for a source.
      </h2>
      <p className="mt-5 max-w-xl text-lg leading-8 text-[#625F57]">
        Start the run and each stage will replace this canvas with the next artifact. Nothing else competes for attention.
      </p>
    </section>
  );
}

function ActiveArtifact({
  pipelineRun,
  activeStep,
  copied,
  errorCopied,
  onCopy,
  onCopyError,
  onOpenFinalArtifact,
  isComplete,
}: {
  pipelineRun: PipelineRun;
  activeStep?: PipelineStep;
  copied: boolean;
  errorCopied: boolean;
  onCopy: () => void;
  onCopyError: () => void;
  onOpenFinalArtifact: () => void;
  isComplete: boolean;
}) {
  if (pipelineRun.error) {
    const errorBrief = pipelineRun.errorBrief;
    const copyText = formatErrorForCopy(pipelineRun);

    return (
      <section className="artifact-card border-[#B86A5C] p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="eyebrow text-[#8C3D32]">Stopped</div>
            <h2 className="mt-4 text-2xl font-semibold leading-tight text-[#171717] sm:text-3xl">
              {errorBrief?.title ?? 'Pipeline failure'}
            </h2>
          </div>
          <button type="button" onClick={onCopyError} className="secondary-button pressable px-4">
            <span className="inline-flex items-center justify-center gap-2">
              <Clipboard aria-hidden="true" size={15} />
              {errorCopied ? 'Copied' : 'Copy fix brief'}
            </span>
          </button>
        </div>
        <p className="mt-4 text-lg leading-8 text-[#3E2723]">{pipelineRun.error}</p>
        {errorBrief && (
          <div className="mt-5 grid gap-3 rounded-md border border-[#E0C5BC] bg-[#FFF9F5] p-4 text-sm leading-6 text-[#4C332C]">
            <ArtifactField label="Stage" value={errorBrief.stage} />
            <ArtifactField label="Likely cause" value={errorBrief.likelyCause} />
            {errorBrief.statusCode !== undefined && <ArtifactField label="HTTP status" value={String(errorBrief.statusCode)} />}
          </div>
        )}
        <pre className="mt-5 max-h-72 overflow-auto rounded-md border border-[#E0DCD2] bg-white p-4 text-left text-xs leading-6 text-[#292824] whitespace-pre-wrap">
          {copyText}
        </pre>
        {pipelineRun.analyzedInMs !== undefined && <Runtime runtimeMs={pipelineRun.analyzedInMs} />}
      </section>
    );
  }

  if (pipelineRun.acceptedMarket && (activeStep?.id === 'settlement' || isComplete)) {
    return <FinalArtifact pipelineRun={pipelineRun} copied={copied} onCopy={onCopy} onOpenFinalArtifact={onOpenFinalArtifact} isComplete={isComplete} />;
  }

  if (activeStep?.id === 'critic' && pipelineRun.candidateMarkets.length > 0) {
    return <DecisionArtifact drafts={pipelineRun.candidateMarkets} reviews={pipelineRun.criticReviews} />;
  }

  if (activeStep?.id === 'market-creator' && pipelineRun.candidateMarkets.length > 0) {
    return <DraftArtifact market={pipelineRun.candidateMarkets[0]} />;
  }

  if (activeStep?.id === 'context' && pipelineRun.context) {
    return (
      <section className="artifact-card p-8 sm:p-10">
        <div className="eyebrow">Agent reasoning</div>
        <h2 className="mt-5 max-w-3xl text-3xl font-semibold leading-tight tracking-normal text-[#171717] sm:text-4xl">
          {pipelineRun.context.englishSummary}
        </h2>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-[#625F57]">{pipelineRun.context.relevanceExplanation}</p>
      </section>
    );
  }

  if (activeStep?.id === 'extraction') {
    return (
      <section className="artifact-card p-8 sm:p-10">
        <div className="eyebrow">Extracting source</div>
        <h2 className="mt-5 max-w-3xl text-3xl font-semibold leading-tight tracking-normal text-[#171717] sm:text-4xl">
          {pipelineRun.extractedSource ? pipelineRun.extractedSource.title : looksLikeUrl(pipelineRun.sourceInput) ? 'Extracting article...' : 'Preparing pasted source.'}
        </h2>
        <p className="mt-5 max-w-xl text-lg leading-8 text-[#625F57]">
          {pipelineRun.extractedSource ? pipelineRun.extractedSource.domain : activeStep.reasoningSnippet}
        </p>
        {pipelineRun.extractedSource && <ExtractedSourcePreview source={pipelineRun.extractedSource} />}
      </section>
    );
  }

  if (pipelineRun.ingestion) {
    return (
      <section className="artifact-card p-8 sm:p-10">
        <div className="eyebrow">Source parsed</div>
        <h2 className="mt-5 max-w-3xl text-3xl font-semibold leading-tight tracking-normal text-[#171717] sm:text-4xl">
          {pipelineRun.ingestion.signalName}
        </h2>
        <div className="mt-8 grid gap-4 border-t border-[#E5E1D8] pt-6 sm:grid-cols-3">
          <ArtifactField label="Language" value={pipelineRun.ingestion.language} />
          <ArtifactField label="Source" value={pipelineRun.extractedSource ? `${pipelineRun.extractedSource.title} / ${pipelineRun.extractedSource.domain}` : pipelineRun.ingestion.source} />
          <ArtifactField label="Topic" value={pipelineRun.ingestion.topic} />
        </div>
        {pipelineRun.extractedSource && <ExtractedSourcePreview source={pipelineRun.extractedSource} />}
      </section>
    );
  }

  return (
    <section className="artifact-card p-8 sm:p-10">
      <div className="eyebrow">Running</div>
      <h2 className="mt-5 text-3xl font-semibold leading-tight text-[#171717] sm:text-4xl">
        {looksLikeUrl(pipelineRun.sourceInput) ? 'Extracting article...' : `${activeStep?.agentName ?? 'Agents'} are reading the source.`}
      </h2>
      <p className="mt-5 max-w-xl text-lg leading-8 text-[#625F57]">{activeStep?.reasoningSnippet}</p>
    </section>
  );
}

type SourceReadiness = {
  canRun: boolean;
  message: string;
  tone: 'idle' | 'blocked' | 'ready';
};

function getSourceReadiness(value: string, isRunning: boolean): SourceReadiness {
  const trimmedValue = value.trim();

  if (isRunning) {
    return {
      canRun: false,
      message: 'The current run is still in progress.',
      tone: 'idle',
    };
  }

  if (!trimmedValue) {
    return {
      canRun: false,
      message: 'Paste article text or a readable article URL to start.',
      tone: 'idle',
    };
  }

  const url = parseArticleUrl(trimmedValue);
  if (url) {
    if (isUnsupportedUrlHost(url.hostname)) {
      return {
        canRun: false,
        message: 'Social URLs are not scraped yet. Paste the post text instead.',
        tone: 'blocked',
      };
    }

    return {
      canRun: true,
      message: 'Readable article URL accepted.',
      tone: 'ready',
    };
  }

  if (trimmedValue.length < MIN_PASTED_SOURCE_LENGTH) {
    return {
      canRun: false,
      message: `Paste at least ${MIN_PASTED_SOURCE_LENGTH} characters of source text.`,
      tone: 'idle',
    };
  }

  return {
    canRun: true,
    message: 'Source text accepted.',
    tone: 'ready',
  };
}

function looksLikeUrl(value: string): boolean {
  return parseArticleUrl(value) !== null;
}

function parseArticleUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function isUnsupportedUrlHost(hostname: string): boolean {
  return UNSUPPORTED_URL_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function ExtractedSourcePreview({
  source,
}: {
  source: NonNullable<PipelineRun['extractedSource']>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-6 border-t border-[#E5E1D8] pt-5">
      <button type="button" onClick={() => setOpen((value) => !value)} className="secondary-button pressable px-4">
        {open ? 'Hide extracted source' : 'View extracted source'}
      </button>
      {open && (
        <div className="mt-4 max-h-64 overflow-y-auto rounded-md border border-[#E0DCD2] bg-white p-4 text-sm leading-7 text-[#292824]">
          <div className="mb-3 font-medium">{source.url}</div>
          <p className="whitespace-pre-wrap">{source.text}</p>
        </div>
      )}
    </div>
  );
}

function DraftArtifact({ market }: { market: MarketQuestion }) {
  return (
    <section className="artifact-card p-8 sm:p-10">
      <div className="eyebrow">Draft market</div>
      <h2 className="mt-5 max-w-3xl text-3xl font-semibold leading-tight tracking-normal text-[#171717] sm:text-4xl">{market.question}</h2>
      <p className="mt-6 max-w-2xl text-lg leading-8 text-[#625F57]">{market.evidenceSummary}</p>
    </section>
  );
}

function DecisionArtifact({
  drafts,
  reviews,
}: {
  drafts: MarketQuestion[];
  reviews: CriticVerdict[];
}) {
  return (
    <section className="artifact-card p-8 sm:p-10">
      <div className="eyebrow">Decision</div>
      <div className="mt-6 grid gap-5">
        {drafts.map((draft) => {
          const review = reviews.find((item) => item.draftId === draft.id);
          const accepted = review?.decision === 'accepted';

          return (
            <article key={draft.id} className={`border-l-2 pl-5 ${accepted ? 'border-[#171717]' : 'border-[#D8D3C8]'}`}>
              <div className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#77746B]">
                {review ? review.decision : 'Reviewing'}
              </div>
              <h3 className={`text-2xl font-semibold leading-tight ${accepted ? 'text-[#171717]' : 'text-[#77746B]'}`}>{draft.question}</h3>
              {review && <p className="mt-3 max-w-3xl text-base leading-7 text-[#625F57]">{review.reasoning}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function FinalArtifact({
  pipelineRun,
  copied,
  onCopy,
  onOpenFinalArtifact,
  isComplete,
}: {
  pipelineRun: PipelineRun;
  copied: boolean;
  onCopy: () => void;
  onOpenFinalArtifact: () => void;
  isComplete: boolean;
}) {
  const market = pipelineRun.acceptedMarket;

  if (!market) return null;

  return (
    <section className="artifact-card overflow-hidden">
      <div className="p-8 sm:p-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="eyebrow">Finalized artifact</div>
            {pipelineRun.analyzedInMs !== undefined && <Runtime runtimeMs={pipelineRun.analyzedInMs} />}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onCopy}
              disabled={!isComplete}
              className="secondary-button pressable px-4 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="inline-flex items-center justify-center gap-2">
                {copied ? <Check aria-hidden="true" size={15} /> : <Clipboard aria-hidden="true" size={15} />}
                {copied ? 'Copied' : 'Copy'}
              </span>
            </button>
            <button
              type="button"
              onClick={onOpenFinalArtifact}
              disabled={!isComplete}
              className="primary-button pressable px-4 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="inline-flex items-center justify-center gap-2">
                Open final artifact
                <ArrowRight aria-hidden="true" size={15} />
              </span>
            </button>
          </div>
        </div>
        <h2 className="mt-5 max-w-4xl text-3xl font-semibold leading-tight tracking-normal text-[#171717] sm:text-5xl">{market.question}</h2>
      </div>
      <div className="grid border-t border-[#E5E1D8] bg-[#FBFAF7] p-8 sm:grid-cols-2 sm:p-10">
        <Criteria label="YES" value={market.yesCriteria} />
        <Criteria label="NO" value={market.noCriteria} />
        <div className="mt-8 sm:col-span-2">
          <ArtifactField label="Resolution" value={`${market.deadline} · ${market.resolutionSource}`} />
          <p className="mt-4 max-w-3xl text-base leading-7 text-[#625F57]">{market.evidenceSummary}</p>
        </div>
        {pipelineRun.trace && (
          <div className="mt-8 border-t border-[#E5E1D8] pt-6 sm:col-span-2">
            <ArtifactField
              label="Local trace hash"
            value={`Local trace hash, Arc commit pending: ${pipelineRun.trace.traceHash}.`}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function Runtime({ runtimeMs }: { runtimeMs: number }) {
  return <p className="mt-2 text-sm font-medium text-[#77746B]">Analyzed in {(runtimeMs / 1000).toFixed(1)}s</p>;
}

function Criteria({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-[#E5E1D8] py-5 sm:border-t-0 sm:py-0 sm:pr-8">
      <div className="eyebrow">{label}</div>
      <p className="mt-3 text-base leading-7 text-[#292824]">{value}</p>
    </div>
  );
}

function ArtifactField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mt-2 text-base font-medium leading-7 text-[#292824]">{value}</div>
    </div>
  );
}

function getStepState(status: PipelineStepStatus, runStatus: PipelineRun['status']): StepState {
  if (runStatus === 'failed' && status !== 'complete') return 'failed';
  if (status === 'complete') return 'complete';
  if (status === 'running') return 'active';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function formatMarketForCopy(run: PipelineRun): string {
  const market = run.acceptedMarket;

  if (!market) {
    return 'AgoraBabel workflow is still in progress.';
  }

  return [
    market.question,
    '',
    `YES: ${market.yesCriteria}`,
    `NO: ${market.noCriteria}`,
    `Deadline: ${market.deadline}`,
    `Resolution source: ${market.resolutionSource}`,
    `Evidence: ${market.evidenceSummary}`,
  ].join('\n');
}

function formatErrorForCopy(run: PipelineRun): string {
  const brief = run.errorBrief;

  if (!brief) {
    return [
      'Fix this AgoraBabel SaaS failure.',
      '',
      `Error message: ${run.error ?? 'Unknown pipeline error.'}`,
      `Run status: ${run.status}`,
      `Source length: ${run.sourceInput.trim().length} characters`,
      '',
      'Inspect src/server/analyze.ts, src/app/pipeline/apiProvider.ts, and src/app/components/ProcessingScreen.tsx.',
      'Run pnpm build after the fix.',
    ].join('\n');
  }

  return [
    brief.agentPrompt,
    '',
    'Debugging context:',
    ...brief.debuggingContext.map((item) => `- ${item}`),
  ].join('\n');
}
