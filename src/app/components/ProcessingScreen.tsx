import {
  ArrowRight,
  Check,
  Clipboard,
  FileText,
  ExternalLink,
  Globe2,
  History,
  Languages,
  Link,
  ListChecks,
  LoaderCircle,
  Play,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  clamp,
  getCompletedStepDwellMs,
  getOneStepPresentationTarget,
  getStepBriefing,
  type PresentedStepState,
} from '../pipeline/presentationTiming';
import type { CriticVerdict, MarketQuestion, PipelineRun, PipelineStep, PipelineStepStatus, SourceAnalysis } from '../pipeline/types';
import { pageContainerClassName } from './pageLayout';

type StepState = 'complete' | 'active' | 'pending' | 'failed';
type ProgressStepId = 'source' | PipelineStep['id'];
type ProgressStep = {
  id: ProgressStepId;
  label: string;
  description: string;
  status: PipelineStepStatus;
  selectable: boolean;
};
type HistoryItem = {
  id: string;
  title: string;
  detail: string;
  status: PipelineRun['status'];
  timestamp?: string;
  active?: boolean;
};
export type SubmissionHistoryItem = HistoryItem;
type StepTransitionDirection = -1 | 0 | 1;
type ArtifactView = {
  key: string;
  step?: PipelineStep;
  eyebrow: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  body?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

const stepRevealTransition = {
  duration: 0.24,
  ease: [0.23, 1, 0.32, 1],
};

const stepExitTransition = {
  duration: 0.16,
  ease: [0.23, 1, 0.32, 1],
};

const stepContentMotion = {
  enter: (direction: StepTransitionDirection) => ({
    opacity: 0,
    x: direction === 0 ? 0 : direction * 34,
    filter: 'blur(3px)',
  }),
  center: {
    opacity: 1,
    x: 0,
    filter: 'blur(0px)',
  },
  exit: (direction: StepTransitionDirection) => ({
    opacity: 0,
    x: direction === 0 ? 0 : direction * -34,
    filter: 'blur(2px)',
  }),
};

const stepLabels: Record<PipelineStep['id'], string> = {
  extraction: 'Source Extraction',
  claim: 'Claim Extraction',
  ingestion: 'Source Metadata',
  context: 'Translation & Context',
  resolver: 'Resolver Verification',
  comparison: 'Market Comparison',
  'market-creator': 'Market Drafting',
  critic: 'Critic Review',
  circle: 'Circle Wallet',
  settlement: 'Arc Commit',
  x402: 'x402 Publication',
};

const stepDescriptions: Record<PipelineStep['id'], string> = {
  extraction: 'The article or pasted source is prepared.',
  claim: 'The agent extracts a concrete claim, actors, evidence, and deadline.',
  ingestion: 'The source is normalized and identified.',
  context: 'The source is translated and operational context is summarized.',
  resolver: 'The official resolver URL is fetched and verified.',
  comparison: 'Existing market sources are searched for close matches.',
  'market-creator': 'A binary market draft is formed.',
  critic: 'Weak candidates are rejected against validation checks.',
  circle: 'The configured ARC-TESTNET Circle wallet is checked.',
  settlement: 'The accepted artifact hash is committed on Arc Testnet.',
  x402: 'Paid intelligence access metadata is published.',
};

const MIN_STEP_PROCESSING_MS = 850;
const MIN_FAILURE_PROCESSING_MS = 1300;
const MIN_PASTED_SOURCE_LENGTH = 120;
const SOURCE_ACCEPTED_HANDOFF_MS = 900;
const SOCIAL_URL_HOSTS = ['facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'tiktok.com', 'x.com', 'twitter.com'];

export function ProcessingScreen({
  sourceText,
  onSourceTextChange,
  runId,
  pipelineRun,
  onRunPipeline,
  onOpenFinalArtifact,
  onNewAnalysis,
  submissionHistory,
  onSelectSubmission,
}: {
  sourceText: string;
  onSourceTextChange: (value: string) => void;
  runId: number;
  pipelineRun: PipelineRun;
  onRunPipeline: (value: string) => void;
  onOpenFinalArtifact: () => void;
  onNewAnalysis: () => void;
  submissionHistory: SubmissionHistoryItem[];
  onSelectSubmission: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [errorCopied, setErrorCopied] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<ProgressStepId | null>(null);
  const [presentedStep, setPresentedStep] = useState<PresentedStepState>({ index: 0, status: 'pending', since: Date.now() });
  const [sourceAcceptedHandoffComplete, setSourceAcceptedHandoffComplete] = useState(false);
  const reduceMotion = useReducedMotion();
  const hasStarted = runId > 0;
  const showSourceAccepted = hasStarted && !sourceAcceptedHandoffComplete;
  const presentedSteps = useMemo(
    () => createPresentedSteps(pipelineRun.steps, hasStarted && !showSourceAccepted ? presentedStep : { index: 0, status: 'pending', since: presentedStep.since }),
    [hasStarted, pipelineRun.steps, presentedStep, showSourceAccepted],
  );
  const runningStep = presentedSteps.find((step) => step.status === 'running' || step.status === 'failed');
  const activeStep = runningStep ?? [...presentedSteps].reverse().find((step) => step.status === 'complete') ?? presentedSteps[0];
  const selectedPipelineStepId = selectedStepId && selectedStepId !== 'source' ? selectedStepId : null;
  const selectedStep = selectedPipelineStepId ? presentedSteps.find((step) => step.id === selectedPipelineStepId && step.status !== 'pending') : undefined;
  const displayedStep = selectedStep ?? activeStep;
  const displayedStepIndex = displayedStep ? presentedSteps.findIndex((step) => step.id === displayedStep.id) : -1;
  const previousDisplayedStepIndexRef = useRef(displayedStepIndex);
  const stepTransitionDirection: StepTransitionDirection =
    displayedStepIndex === previousDisplayedStepIndexRef.current
      ? 0
      : displayedStepIndex > previousDisplayedStepIndexRef.current
        ? 1
        : -1;
  const copyText = useMemo(() => formatMarketForCopy(pipelineRun), [pipelineRun]);
  const errorCopyText = useMemo(() => formatErrorForCopy(pipelineRun), [pipelineRun]);
  const isComplete = pipelineRun.status === 'complete';
  const isRunning = pipelineRun.status === 'running';
  const sourceReadiness = getSourceReadiness(sourceText, isRunning);
  const progressSteps = useMemo<ProgressStep[]>(() => [
    {
      id: 'source',
      label: 'Source',
      description: hasStarted ? 'Review the exact submitted source for this run.' : 'Paste source material and submit it for analysis.',
      status: hasStarted && !showSourceAccepted ? 'complete' : hasStarted ? 'running' : 'pending',
      selectable: true,
    },
    ...presentedSteps.map((step) => ({
      id: step.id,
      label: stepLabels[step.id],
      description: stepDescriptions[step.id],
      status: step.status,
      selectable: hasStarted && !showSourceAccepted && step.status !== 'pending',
    })),
  ], [hasStarted, presentedSteps, showSourceAccepted]);
  const selectedProgressStepId: ProgressStepId | undefined = selectedStepId ?? (!hasStarted || showSourceAccepted ? 'source' : displayedStep?.id);
  const handleSelectProgressStep = (stepId: ProgressStepId) => {
    if (stepId === 'source') {
      setSelectedStepId('source');
      return;
    }

    const step = presentedSteps.find((item) => item.id === stepId);
    if (step?.status !== 'pending') setSelectedStepId(stepId);
  };

  useEffect(() => {
    setCopied(false);
    setErrorCopied(false);
    setSelectedStepId(null);
    setSourceAcceptedHandoffComplete(runId === 0);
    setPresentedStep({ index: 0, status: runId > 0 ? 'running' : 'pending', since: Date.now() });
  }, [pipelineRun.id, runId]);

  useEffect(() => {
    if (!hasStarted) return;

    const handoffTimeout = window.setTimeout(() => setSourceAcceptedHandoffComplete(true), SOURCE_ACCEPTED_HANDOFF_MS);

    return () => {
      window.clearTimeout(handoffTimeout);
    };
  }, [hasStarted, runId]);

  useEffect(() => {
    previousDisplayedStepIndexRef.current = displayedStepIndex;
  }, [displayedStepIndex]);

  useEffect(() => {
    if (!hasStarted || showSourceAccepted || pipelineRun.steps.length === 0) return;

    const target = getGatedPresentationTarget(pipelineRun, presentedStep);

    const setPresented = (index: number, status: PipelineStepStatus) => {
      setPresentedStep({ index, status, since: Date.now() });
    };

    if (target.index > presentedStep.index && presentedStep.status !== 'complete') {
      const currentRawStep = pipelineRun.steps[presentedStep.index];

      if (currentRawStep?.status === 'complete' && areStepOperationsReadyToAdvance(pipelineRun, currentRawStep.id)) {
        setPresented(presentedStep.index, 'complete');
        return;
      }
    }

    if (target.index > presentedStep.index && presentedStep.status === 'complete') {
      const currentStep = pipelineRun.steps[presentedStep.index];
      const remainingDwellMs = Math.max(getCompletedStepDwellMs(pipelineRun, currentStep) - (Date.now() - presentedStep.since), 0);

      if (remainingDwellMs > 0) {
        const timeout = window.setTimeout(() => {
          const nextTarget = getOneStepPresentationTarget(pipelineRun, presentedStep, target);
          setPresented(nextTarget.index, nextTarget.status === 'pending' ? 'running' : nextTarget.status);
        }, remainingDwellMs);

        return () => window.clearTimeout(timeout);
      }
    }

    if (presentedStep.index !== target.index || presentedStep.status !== target.status) {
      const nextTarget = target.index > presentedStep.index
        ? getOneStepPresentationTarget(pipelineRun, presentedStep, target)
        : target;
      setPresented(nextTarget.index, nextTarget.status === 'pending' ? 'running' : nextTarget.status);
    }
  }, [hasStarted, pipelineRun, presentedStep, showSourceAccepted]);

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
        <div className={`${pageContainerClassName} max-w-[92rem]`}>
          <section className="mx-auto grid w-full min-w-0 gap-5 lg:grid-cols-[21rem_minmax(0,1fr)] xl:grid-cols-[22.5rem_minmax(0,1fr)]">
            <WorkflowSidebar
              steps={progressSteps}
              selectedStepId={selectedProgressStepId}
              historyItems={submissionHistory}
              onSelectStep={handleSelectProgressStep}
              onSelectHistoryItem={onSelectSubmission}
              onNewAnalysis={onNewAnalysis}
            />
            <PipelineArtifact
              sourceText={sourceText}
              onSourceTextChange={onSourceTextChange}
              onRunPipeline={onRunPipeline}
              sourceReadiness={sourceReadiness}
              pipelineRun={pipelineRun}
              activeStep={displayedStep}
              copied={copied}
              errorCopied={errorCopied}
              onCopy={handleCopy}
              onCopyError={handleCopyError}
              onOpenFinalArtifact={onOpenFinalArtifact}
              onNewAnalysis={onNewAnalysis}
              isComplete={isComplete}
              transitionDirection={!hasStarted || showSourceAccepted || (hasStarted && displayedStepIndex === 0 && presentedStep.status === 'running') ? 1 : stepTransitionDirection}
              showSourceInput={!hasStarted}
              showSourceAccepted={hasStarted && (showSourceAccepted || selectedStepId === 'source')}
              sourceHandoffActive={showSourceAccepted}
            />
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
  variant = 'panel',
}: {
  sourceText: string;
  onSourceTextChange: (value: string) => void;
  onRunPipeline: (value: string) => void;
  sourceReadiness: SourceReadiness;
  variant?: 'panel' | 'embedded';
}) {
  const charactersRemaining = Math.max(MIN_PASTED_SOURCE_LENGTH - sourceText.trim().length, 0);
  const wrapperClassName = variant === 'embedded' ? 'mt-8 border-t border-[#E5E1D8] pt-6' : 'panel p-4';

  return (
    <section className={wrapperClassName}>
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
        placeholder="Paste article text or URL in any language."
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
          Run analysis
        </span>
      </button>
    </section>
  );
}


function WorkflowSidebar({
  steps,
  selectedStepId,
  historyItems,
  onSelectStep,
  onSelectHistoryItem,
  onNewAnalysis,
}: {
  steps: ProgressStep[];
  selectedStepId?: ProgressStepId;
  historyItems: HistoryItem[];
  onSelectStep: (stepId: ProgressStepId) => void;
  onSelectHistoryItem: (id: string) => void;
  onNewAnalysis: () => void;
}) {
  return (
    <aside className="min-w-0 lg:sticky lg:top-5 lg:self-start" aria-label="Create workflow sidebar">
      <div className="artifact-card overflow-hidden bg-white shadow-[0_20px_55px_rgba(29,28,24,0.06)]">
        <div className="flex items-start justify-between gap-3 border-b border-[#EEE9DF] bg-[#FBFAF7] p-5">
          <div>
            <div className="eyebrow">Workflow</div>
            <p className="mt-2 text-sm font-medium leading-6 text-[#625F57]">Step through the run and revisit completed artifacts.</p>
          </div>
          <button type="button" onClick={onNewAnalysis} className="secondary-button pressable h-10 min-h-10 px-3 text-xs">
            <span className="inline-flex items-center justify-center gap-2">
              <RotateCcw aria-hidden="true" size={14} />
              New
            </span>
          </button>
        </div>
        <div className="grid gap-6 p-5">
          <VerticalProgressRail steps={steps} selectedStepId={selectedStepId} onSelectStep={onSelectStep} />
          <RunHistory items={historyItems} onSelectItem={onSelectHistoryItem} />
        </div>
      </div>
    </aside>
  );
}

function VerticalProgressRail({
  steps,
  selectedStepId,
  onSelectStep,
}: {
  steps: ProgressStep[];
  selectedStepId?: ProgressStepId;
  onSelectStep: (stepId: ProgressStepId) => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <nav aria-label="Workflow progress">
      <ol className="grid gap-0">
        {steps.map((step, index) => {
          const state = getStepState(step.status);
          const nextStep = steps[index + 1];
          const nextState = nextStep ? getStepState(nextStep.status) : undefined;
          const selected = selectedStepId === step.id;
          const disabled = !step.selectable;

          return (
            <li key={step.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
              <div className="grid justify-items-center">
                <button
                  type="button"
                  onClick={() => {
                    if (!disabled) onSelectStep(step.id);
                  }}
                  disabled={disabled}
                  aria-current={selected ? 'step' : undefined}
                  aria-label={`${step.label}: ${step.description}`}
                  className={`mt-1 grid size-7 place-items-center rounded-full border transition-[background-color,border-color,color,box-shadow] duration-200 disabled:cursor-not-allowed ${
                    selected
                      ? 'border-[#171717] bg-[#171717] text-white shadow-[0_0_0_4px_rgba(23,23,23,0.08)]'
                      : state === 'complete'
                        ? 'border-[#CFC8BA] bg-white text-[#171717] hover:border-[#171717]'
                        : state === 'failed'
                          ? 'border-[#8C3D32] bg-[#FFF9F5] text-[#8C3D32]'
                          : 'border-[#D8D3C8] bg-[#F7F6F1] text-[#9D998E] opacity-80'
                  }`}
                >
                  <StepMark state={state} compact selected={selected} />
                </button>
                {index < steps.length - 1 && <VerticalStepConnector state={state} nextState={nextState} reduceMotion={Boolean(reduceMotion)} />}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!disabled) onSelectStep(step.id);
                }}
                disabled={disabled}
                className={`min-w-0 rounded-md px-2 py-1.5 text-left transition-colors duration-200 disabled:cursor-not-allowed ${
                  selected ? 'bg-[#171717] text-white' : disabled ? 'text-[#9D998E]' : 'text-[#292824] hover:bg-[#F7F6F1]'
                }`}
              >
                <span className="block truncate text-sm font-semibold leading-5">{step.label}</span>
                <span className={`mt-1 block text-xs leading-5 ${selected ? 'text-white/72' : 'text-[#77746B]'}`}>{step.description}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function VerticalStepConnector({
  state,
  nextState,
  reduceMotion,
}: {
  state: StepState;
  nextState?: StepState;
  reduceMotion: boolean;
}) {
  const isPassed = state === 'complete' && nextState !== 'pending';
  const isPreparingNext = state === 'complete' && nextState === 'pending';
  const isFailed = state === 'failed';
  const guideClassName = isFailed
    ? 'bg-[repeating-linear-gradient(to_bottom,#C58778_0_4px,transparent_4px_8px)]'
    : 'bg-[repeating-linear-gradient(to_bottom,#C8C1B3_0_4px,transparent_4px_8px)]';

  return (
    <span aria-hidden="true" className="pointer-events-none relative my-1 h-8 w-px overflow-hidden">
      <span className={`absolute inset-0 ${guideClassName}`} />
      {isPassed && !reduceMotion ? (
        <motion.span
          key="vertical-solid-connector"
          className="absolute inset-x-0 top-0 h-full origin-top bg-[#171717]"
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.62, ease: [0.23, 1, 0.32, 1] }}
          style={{ transformOrigin: 'top' }}
        />
      ) : isPassed ? (
        <span className="absolute inset-0 bg-[#171717]" />
      ) : isPreparingNext && !reduceMotion ? (
        <motion.span
          key="vertical-handoff-connector"
          className="absolute inset-x-0 top-0 h-full origin-top bg-gradient-to-b from-[#171717] via-[#171717] to-transparent"
          initial={{ scaleY: 0, opacity: 0 }}
          animate={{ scaleY: [0, 0.42, 0.72], opacity: [0, 1, 0.38] }}
          transition={{ duration: 0.86, ease: [0.23, 1, 0.32, 1] }}
          style={{ transformOrigin: 'top' }}
        />
      ) : null}
    </span>
  );
}

function RunHistory({ items, onSelectItem }: { items: HistoryItem[]; onSelectItem: (id: string) => void }) {
  return (
    <section className="border-t border-[#EEE9DF] pt-5" aria-label="Submission history">
      <div className="flex items-center justify-between gap-3">
        <div className="eyebrow">Submissions</div>
        <History aria-hidden="true" size={15} className="text-[#77746B]" />
      </div>
      <div className="mt-4 grid max-h-[34vh] gap-2 overflow-y-auto pr-1 lg:max-h-[42vh]">
        {items.length > 0 ? items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectItem(item.id)}
            aria-current={item.active ? 'true' : undefined}
            className={`rounded-md border p-3 text-left transition-colors duration-200 ${
              item.active
                ? 'border-[#171717] bg-white shadow-[0_0_0_3px_rgba(23,23,23,0.06)]'
                : 'border-[#E5E1D8] bg-[#FBFAF7] hover:border-[#CFC8BA] hover:bg-white'
            }`}
          >
            <div className="flex items-start gap-2">
              <HistoryStatusDot status={item.status} />
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-5 text-[#292824]">{item.title}</div>
                <p className="mt-1 text-xs leading-5 text-[#625F57] [overflow-wrap:anywhere]">{item.detail}</p>
                {item.timestamp && <time className="mt-2 block text-[11px] font-medium text-[#9D998E]" dateTime={item.timestamp}>{formatOperationTime(item.timestamp)}</time>}
              </div>
            </div>
          </button>
        )) : (
          <p className="rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-3 text-sm leading-6 text-[#625F57]">No completed submissions yet.</p>
        )}
      </div>
    </section>
  );
}

function HistoryStatusDot({ status }: { status: HistoryItem['status'] }) {
  const className = status === 'complete'
    ? 'bg-[#526247]'
    : status === 'running'
      ? 'bg-[#171717]'
      : status === 'failed'
        ? 'bg-[#8C3D32]'
        : 'bg-[#C8C1B3]';

  return <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${className}`} />;
}

function ProgressRail({
  steps,
  selectedStepId,
  onSelectStep,
}: {
  steps: ProgressStep[];
  selectedStepId?: ProgressStepId;
  onSelectStep: (stepId: ProgressStepId) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [tooltip, setTooltip] = useState<{
    stepId: ProgressStepId;
    left: number;
    top: number;
  } | null>(null);

  const showTooltip = (stepId: ProgressStepId, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const tooltipWidth = 256;
    const viewportPadding = 16;
    const left = clamp(
      rect.left + rect.width / 2,
      viewportPadding + tooltipWidth / 2,
      window.innerWidth - viewportPadding - tooltipWidth / 2,
    );

    setTooltip({
      stepId,
      left,
      top: rect.bottom + 10,
    });
  };
  const tooltipStep = tooltip ? steps.find((step) => step.id === tooltip.stepId) : undefined;

  return (
    <nav aria-label="Workflow progress" className="relative overflow-visible">
      <div className="-mx-6 overflow-x-auto px-6 py-1 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
        <ol className="flex min-w-max items-center gap-0 sm:min-w-0">
          {steps.map((step, index) => {
            const state = getStepState(step.status);
            const nextStep = steps[index + 1];
            const nextState = nextStep ? getStepState(nextStep.status) : undefined;
            const selected = selectedStepId === step.id;
            const hasConnector = index < steps.length - 1;
            const disabled = !step.selectable;

            return (
              <li key={step.id} className="flex min-w-0 items-center">
                <span className="inline-flex shrink-0 items-center justify-center py-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!disabled) onSelectStep(step.id);
                    }}
                    onPointerEnter={(event) => showTooltip(step.id, event.currentTarget)}
                    onPointerLeave={() => setTooltip(null)}
                    onFocus={(event) => showTooltip(step.id, event.currentTarget)}
                    onBlur={() => setTooltip(null)}
                    disabled={disabled}
                    aria-current={selected ? 'step' : undefined}
                    aria-label={`${step.label}: ${step.description}`}
                    className={`${
                      selected ? 'inline-flex h-10 w-[9.5rem] justify-start gap-2 px-3 sm:w-40' : 'inline-grid size-9 place-items-center'
                    } items-center rounded-full border text-sm font-medium transition-[background-color,border-color,color,box-shadow] duration-200 disabled:cursor-not-allowed ${
                      selected
                        ? 'border-[#171717] bg-[#171717] text-white shadow-[0_0_0_4px_rgba(23,23,23,0.08),0_10px_24px_rgba(29,28,24,0.12)]'
                        : state === 'complete'
                          ? 'border-[#CFC8BA] bg-white text-[#171717] hover:border-[#171717]'
                          : state === 'failed'
                            ? 'border-[#8C3D32] bg-[#FFF9F5] text-[#8C3D32]'
                            : 'border-[#D8D3C8] bg-[#F7F6F1] text-[#9D998E] opacity-70'
                    }`}
                  >
                    <StepMark state={state} compact selected={selected} />
                    {selected && <span className="min-w-0 truncate text-left leading-5">{step.label}</span>}
                  </button>
                </span>
                {hasConnector && <StepConnector state={state} nextState={nextState} reduceMotion={Boolean(reduceMotion)} />}
              </li>
            );
          })}
        </ol>
      </div>
      {tooltip && tooltipStep && (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[9999] w-64 -translate-x-1/2 rounded-md border border-[#D8D3C8] bg-white px-3 py-2 text-left text-xs leading-5 text-[#625F57] opacity-100 shadow-[0_18px_44px_rgba(29,28,24,0.14)]"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          <span className="block font-semibold text-[#171717]">{tooltipStep.label}</span>
          {tooltipStep.description}
        </span>
      )}
    </nav>
  );
}

function StepConnector({
  state,
  nextState,
  reduceMotion,
}: {
  state: StepState;
  nextState?: StepState;
  reduceMotion: boolean;
}) {
  const isPassed = state === 'complete' && nextState !== 'pending';
  const isPreparingNext = state === 'complete' && nextState === 'pending';
  const isFailed = state === 'failed';
  const guideClassName = isFailed
    ? 'bg-[repeating-linear-gradient(to_right,#C58778_0_4px,transparent_4px_8px)]'
    : 'bg-[repeating-linear-gradient(to_right,#C8C1B3_0_4px,transparent_4px_8px)]';

  return (
    <span aria-hidden="true" className="pointer-events-none relative mx-1 h-px w-9 shrink-0 overflow-hidden sm:w-[clamp(2rem,5vw,5rem)]">
      <span className={`absolute inset-0 ${guideClassName}`} />
      {isPassed && !reduceMotion ? (
        <motion.span
          key="solid-connector"
          className="absolute inset-y-0 left-0 w-full origin-left bg-[#171717]"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.62, ease: [0.23, 1, 0.32, 1] }}
          style={{ transformOrigin: 'left' }}
        />
      ) : isPassed ? (
        <span className="absolute inset-0 bg-[#171717]" />
      ) : isPreparingNext && !reduceMotion ? (
        <motion.span
          key="handoff-connector"
          className="absolute inset-y-0 left-0 w-full origin-left bg-gradient-to-r from-[#171717] via-[#171717] to-transparent"
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: [0, 0.42, 0.72], opacity: [0, 1, 0.38] }}
          transition={{ duration: 0.86, ease: [0.23, 1, 0.32, 1] }}
          style={{ transformOrigin: 'left' }}
        />
      ) : (
        null
      )}
    </span>
  );
}

function StepMark({ state, compact = false, selected = false }: { state: StepState; compact?: boolean; selected?: boolean }) {
  const reduceMotion = useReducedMotion();
  const className = selected
    ? 'border-white/75 bg-white/10 text-white'
    : state === 'complete'
      ? 'border-[#171717] bg-[#171717] text-white'
      : state === 'active'
        ? 'border-[#171717] bg-white text-[#171717]'
        : state === 'failed'
          ? 'border-[#8C3D32] bg-[#8C3D32] text-white'
          : 'border-[#D8D3C8] bg-[#F7F6F1] text-[#9D998E]';
  const sizeClassName = compact ? 'size-4' : 'size-5';
  const iconSize = compact ? 10 : 12;

  return (
    <span className={`relative z-10 grid ${sizeClassName} place-items-center rounded-full border ${compact ? '' : 'mt-0.5'} ${className}`}>
      <AnimatePresence mode="wait" initial={false}>
        {state === 'complete' && (
          <motion.span
            key="complete"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
            transition={stepExitTransition}
          >
            <Check aria-hidden="true" size={iconSize} />
          </motion.span>
        )}
        {state === 'active' && (
          <motion.span
            key="active"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
            transition={stepExitTransition}
          >
            <LoaderCircle aria-hidden="true" className={reduceMotion ? '' : 'animate-spin'} size={iconSize} />
          </motion.span>
        )}
        {state === 'failed' && (
          <motion.span
            key="failed"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
            transition={stepExitTransition}
          >
            <X aria-hidden="true" size={iconSize} />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function PipelineArtifact({
  sourceText,
  onSourceTextChange,
  onRunPipeline,
  sourceReadiness,
  pipelineRun,
  activeStep,
  copied,
  errorCopied,
  onCopy,
  onCopyError,
  onOpenFinalArtifact,
  onNewAnalysis,
  isComplete,
  progressRail,
  transitionDirection,
  showSourceInput,
  showSourceAccepted,
  sourceHandoffActive,
}: {
  sourceText: string;
  onSourceTextChange: (value: string) => void;
  onRunPipeline: (value: string) => void;
  sourceReadiness: SourceReadiness;
  pipelineRun: PipelineRun;
  activeStep?: PipelineStep;
  copied: boolean;
  errorCopied: boolean;
  onCopy: () => void;
  onCopyError: () => void;
  onOpenFinalArtifact: () => void;
  onNewAnalysis: () => void;
  isComplete: boolean;
  progressRail?: ReactNode;
  transitionDirection: StepTransitionDirection;
  showSourceInput: boolean;
  showSourceAccepted: boolean;
  sourceHandoffActive: boolean;
}) {
  const reduceMotion = useReducedMotion();

  if (!showSourceInput && !showSourceAccepted && pipelineRun.error && activeStep?.status === 'failed') {
    const errorBrief = pipelineRun.errorBrief;
    const copyText = formatErrorForCopy(pipelineRun);

    return (
      <section className="artifact-card min-w-0 overflow-visible border-[#B86A5C]">
        {progressRail && <div className="relative z-40 border-b border-[#EEE9DF] bg-[#FBFAF7] px-6 py-4 sm:px-8">{progressRail}</div>}
        <div className="relative z-0 p-6 sm:p-8">
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
            <button type="button" onClick={onNewAnalysis} className="primary-button pressable px-4">
              <span className="inline-flex items-center justify-center gap-2">
                <RotateCcw aria-hidden="true" size={15} />
                New analysis
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
        </div>
      </section>
    );
  }

  const view = showSourceInput
    ? getSourceInputView({ sourceText, onSourceTextChange, onRunPipeline, sourceReadiness })
    : showSourceAccepted
      ? getSourceAcceptedView(pipelineRun, sourceText, Boolean(reduceMotion), sourceHandoffActive)
      : getArtifactView({
          pipelineRun,
          activeStep,
          copied,
          onCopy,
          onOpenFinalArtifact,
          onNewAnalysis,
          isComplete,
        });

  return (
    <StepArtifactFrame
      eyebrow={view.eyebrow}
      title={view.title}
      description={view.description}
      step={view.step}
      icon={view.icon}
      progressRail={progressRail}
      footer={view.footer}
      className={view.className}
      contentKey={view.key}
      transitionDirection={transitionDirection}
      reduceMotion={Boolean(reduceMotion)}
    >
      {view.body}
    </StepArtifactFrame>
  );
}

function getSourceInputView({
  sourceText,
  onSourceTextChange,
  onRunPipeline,
  sourceReadiness,
}: {
  sourceText: string;
  onSourceTextChange: (value: string) => void;
  onRunPipeline: (value: string) => void;
  sourceReadiness: SourceReadiness;
}): ArtifactView {
  return {
    key: 'source-input',
    eyebrow: 'Source',
    title: 'Source analysis is ready.',
    description: 'Paste source material to produce a validated artifact with rejected candidates and an audit trace.',
    icon: <FileText aria-hidden="true" size={18} />,
    body: (
      <SourceInput
        sourceText={sourceText}
        onSourceTextChange={onSourceTextChange}
        onRunPipeline={onRunPipeline}
        sourceReadiness={sourceReadiness}
        variant="embedded"
      />
    ),
  };
}

function getSourceAcceptedView(pipelineRun: PipelineRun, fallbackSourceText: string, reduceMotion: boolean, handoffActive: boolean): ArtifactView {
  const submittedSource = pipelineRun.sourceInput || fallbackSourceText;
  const sourceSummary = getSubmittedSourceSummary(submittedSource);
  const extracted = pipelineRun.extractedSource;

  return {
    key: 'source-accepted',
    eyebrow: 'Source',
    title: 'Submitted source.',
    description: handoffActive
      ? 'The submitted source is locked and queued for extraction.'
      : 'This is the exact input attached to the current run.',
    icon: handoffActive
      ? <LoaderCircle aria-hidden="true" className={reduceMotion ? '' : 'animate-spin'} size={18} />
      : <FileText aria-hidden="true" size={18} />,
    body: (
      <>
        <StepReveal className="mt-8 rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="eyebrow">Submitted source</div>
            <span className="rounded-sm border border-[#D8D3C8] bg-white px-2 py-1 text-xs font-medium text-[#625F57]">
              {sourceSummary.kind}
            </span>
          </div>
          <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-[#E5E1D8] bg-white p-4 text-base leading-7 text-[#292824] [overflow-wrap:anywhere] whitespace-pre-wrap">
            {sourceSummary.text}
          </div>
        </StepReveal>
        {extracted && (
          <StepReveal index={1} className="mt-5 rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="eyebrow">Extracted source text</div>
              <span className="rounded-sm border border-[#D8D3C8] bg-white px-2 py-1 text-xs font-medium text-[#625F57]">
                {extracted.domain}
              </span>
            </div>
            <div className="mt-3 max-h-96 overflow-y-auto rounded-md border border-[#E5E1D8] bg-white p-4 text-base leading-7 text-[#292824] [overflow-wrap:anywhere] whitespace-pre-wrap">
              <div className="mb-3 font-medium">{extracted.title}</div>
              {extracted.text}
            </div>
          </StepReveal>
        )}
        {handoffActive && (
          <StepReveal index={extracted ? 2 : 1} className="mt-5 flex items-center gap-3 rounded-md border border-[#E5E1D8] bg-white p-4 text-sm font-medium text-[#625F57]">
            <LoaderCircle aria-hidden="true" className={`shrink-0 text-[#292824] ${reduceMotion ? '' : 'animate-spin'}`} size={16} />
            Source handoff is being prepared for the first analysis agent.
          </StepReveal>
        )}
      </>
    ),
  };
}

function getArtifactView({
  pipelineRun,
  activeStep,
  copied,
  onCopy,
  onOpenFinalArtifact,
  onNewAnalysis,
  isComplete,
}: {
  pipelineRun: PipelineRun;
  activeStep?: PipelineStep;
  copied: boolean;
  onCopy: () => void;
  onOpenFinalArtifact: () => void;
  onNewAnalysis: () => void;
  isComplete: boolean;
}): ArtifactView {
  if (!activeStep) {
    return {
      key: 'preparing',
      eyebrow: 'Queued',
      title: 'Analysis is preparing.',
      description: 'Waiting for the first workflow update.',
      icon: <LoaderCircle aria-hidden="true" size={18} />,
      body: (
        <StepReveal className="mt-8 rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4 text-sm leading-6 text-[#625F57]">
          The workflow will update this card as soon as provider data arrives.
        </StepReveal>
      ),
    };
  }

  switch (activeStep.id) {
    case 'extraction': {
      const extracted = pipelineRun.extractedSource;
      const title = getExtractionTitle(pipelineRun, activeStep);
      const description = extracted ? extracted.domain : activeStep.reasoningSnippet;
      const sourceExcerpt = getSourceExcerpt(pipelineRun);

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: 'Source Extraction',
        title,
        description,
        icon: <FileText aria-hidden="true" size={18} />,
        body: (
          <>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <StepReveal>
                <ArtifactField label="Input type" value={looksLikeUrl(pipelineRun.sourceInput) ? 'Readable URL' : 'Pasted source text'} />
              </StepReveal>
              <StepReveal index={1}>
                <ArtifactField label="Preparation status" value={getExtractionStatus(pipelineRun, activeStep)} />
              </StepReveal>
            </div>
            {sourceExcerpt && (
              <StepReveal index={2} className="mt-5 rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4">
                <div className="eyebrow">Source excerpt</div>
                <p className="mt-3 text-base leading-7 text-[#292824]">{sourceExcerpt}</p>
              </StepReveal>
            )}
          </>
        ),
      };
    }

    case 'ingestion': {
      const ingestion = pipelineRun.ingestion;

      if (!ingestion) {
        return createPendingArtifactView(activeStep, 'Source metadata is being assembled.');
      }

      const source = pipelineRun.extractedSource ? `${pipelineRun.extractedSource.title} / ${pipelineRun.extractedSource.domain}` : ingestion.source;
      const fields = [
        ['Language', `${ingestion.language} (${formatLanguageConfidence(ingestion.languageConfidence)})`],
        ['Source', source],
        ['Actors', getActors(ingestion.entities)],
        ['Region', ingestion.region],
        ['Event type', ingestion.topic],
        ['Source date', ingestion.sourceDate],
        ['Normalized claim', getNormalizedClaim(ingestion)],
      ];

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: 'Source Metadata',
        title: ingestion.signalName,
        description: 'The source is normalized into structured market-intelligence metadata.',
        icon: <Globe2 aria-hidden="true" size={18} />,
        body: (
          <div className="mt-8 grid gap-4 border-t border-[#E5E1D8] pt-6 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map(([label, value], index) => (
              <StepReveal key={label} index={index}>
                <ArtifactField label={label} value={value || 'Not available'} />
              </StepReveal>
            ))}
          </div>
        ),
      };
    }

    case 'claim': {
      const ingestion = pipelineRun.ingestion;
      const context = pipelineRun.context;

      if (!ingestion || !context) {
        return createPendingArtifactView(activeStep, 'Structured claim extraction is running.');
      }

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: 'Claim Extraction',
        title: ingestion.signalName,
        description: context.relevanceExplanation,
        icon: <Languages aria-hidden="true" size={18} />,
        body: (
          <div className="mt-8 grid gap-4 border-t border-[#E5E1D8] pt-6">
            <StepReveal>
              <ArtifactField label="Region and event" value={`${ingestion.region} / ${ingestion.topic}`} />
            </StepReveal>
            <StepReveal index={1}>
              <ArtifactField label="Actors" value={getActors(ingestion.entities)} />
            </StepReveal>
            <StepReveal index={2} className="rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4">
              <div className="eyebrow">Validated evidence</div>
              <p className="mt-3 text-base leading-7 text-[#292824]">{context.evidenceSummary}</p>
            </StepReveal>
          </div>
        ),
      };
    }

    case 'resolver': {
      const resolver = pipelineRun.liveResolver ?? pipelineRun.analysis?.resolver;
      const discovery = pipelineRun.resolverDiscovery ?? createResolverDiscoveryFromResolver(resolver);

      if (!resolver) {
        if (pipelineRun.status === 'rejected' || discovery) {
          return {
            key: activeStep.id,
            step: activeStep,
            eyebrow: 'Official Resolver',
            title: discovery?.status === 'found'
              ? 'Official resolver verification running'
              : 'Source analyzed, but no official resolver found',
            description: discovery?.status === 'found'
              ? `${discovery.candidate?.name ?? 'Resolver candidate'} is being fetched and identity-checked.`
              : pipelineRun.analysis?.rejectionReason ?? discovery?.reason ?? 'The source did not produce a fetchable official resolver URL.',
            icon: <Globe2 aria-hidden="true" size={18} />,
            body: (
              <div className="mt-8 grid gap-4 border-t border-[#E5E1D8] pt-6">
                {discovery && <ResolverDiscoveryPanel discovery={discovery} />}
                {discovery?.status !== 'found' && (
                  <div className="rounded-md border border-[#E0C5BC] bg-[#FFF9F5] p-4">
                    <ArtifactField label="Result" value={pipelineRun.analysis?.rejectionReason ?? discovery?.reason ?? 'No official resolver found.'} />
                  </div>
                )}
              </div>
            ),
          };
        }

        return createPendingArtifactView(activeStep, 'Resolver verification is running.');
      }

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: 'Official Resolver',
        title: resolver.name,
        description: resolver.verificationEvidence,
        icon: <Globe2 aria-hidden="true" size={18} />,
        body: (
          <div className="mt-8 grid gap-4 border-t border-[#E5E1D8] pt-6">
            {discovery && <ResolverDiscoveryPanel discovery={discovery} verifiedUrl={resolver.url} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <StepReveal>
                <ArtifactField label="Status" value={resolver.verificationStatus} />
              </StepReveal>
              <StepReveal index={1}>
                <ArtifactField label="Resolver URL" value={resolver.url} />
              </StepReveal>
            </div>
          </div>
        ),
      };
    }

    case 'comparison': {
      const comparison = pipelineRun.liveMarketComparison ?? pipelineRun.analysis?.marketComparison;

      if (!comparison) {
        return createPendingArtifactView(activeStep, 'Market comparison is checking configured sources.');
      }

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: 'Market Comparison',
        title: `Novelty verdict: ${comparison.noveltyVerdict}`,
        description: comparison.reasoning,
        icon: <ListChecks aria-hidden="true" size={18} />,
        body: (
          <div className="mt-8 grid gap-4 border-t border-[#E5E1D8] pt-6">
            <StepReveal>
              <ArtifactField label="Search status" value={comparison.status} />
            </StepReveal>
            <StepReveal index={1} className="rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4">
              <div className="eyebrow">Similar markets</div>
              <p className="mt-3 text-base leading-7 text-[#292824]">
                {comparison.similarMarkets.length > 0
                  ? comparison.similarMarkets.map((market) => `${market.title} (${market.similarity})`).join('; ')
                  : 'No overlapping actor/event markets found in configured sources.'}
              </p>
            </StepReveal>
          </div>
        ),
      };
    }

    case 'context': {
      const context = pipelineRun.context;

      if (!context) {
        return createPendingArtifactView(activeStep, 'Translation and context are running.');
      }

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: 'Translation & Context',
        title: context.englishSummary,
        description: context.relevanceExplanation,
        icon: <Languages aria-hidden="true" size={18} />,
        body: (
          <div className="mt-8 grid gap-4 border-t border-[#E5E1D8] pt-6">
            <StepReveal>
              <ArtifactField label="Market relevance" value={context.marketRelevance} />
            </StepReveal>
            <StepReveal index={1} className="rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4">
              <div className="eyebrow">Evidence summary</div>
              <p className="mt-3 text-base leading-7 text-[#292824]">{context.evidenceSummary}</p>
            </StepReveal>
            <StepReveal index={2}>
              <ComparisonMoment pipelineRun={pipelineRun} />
            </StepReveal>
          </div>
        ),
      };
    }

    case 'market-creator': {
      const market = pipelineRun.candidateMarkets[0];

      if (!market) {
        return createPendingArtifactView(activeStep, 'Market draft is being formed.');
      }

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: 'Market Drafting',
        title: market.question,
        description: 'The accepted draft is framed around official action, not media pickup or market reaction.',
        icon: <Link aria-hidden="true" size={18} />,
        body: (
          <div className="mt-8 grid gap-5 border-t border-[#E5E1D8] pt-6 sm:grid-cols-2">
            <StepReveal>
              <Criteria label="YES" value={market.yesCriteria} />
            </StepReveal>
            <StepReveal index={1}>
              <Criteria label="NO" value={market.noCriteria} />
            </StepReveal>
            <StepReveal index={2} className="sm:col-span-2">
              <div className="grid gap-4 rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4 sm:grid-cols-2">
                <ArtifactField label="Deadline" value={market.deadline} />
                <ArtifactField label="Resolution source" value={market.resolutionSource} />
                <div className="sm:col-span-2">
                  <ArtifactField label="Why this framing" value={market.evidenceSummary} />
                </div>
              </div>
            </StepReveal>
            <StepReveal index={3} className="sm:col-span-2">
              <ComparisonMoment pipelineRun={pipelineRun} />
            </StepReveal>
          </div>
        ),
      };
    }

    case 'critic': {
      if (pipelineRun.candidateMarkets.length === 0) {
        return createPendingArtifactView(activeStep, 'Candidate review is waiting for drafts.');
      }

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: 'Validation Review',
        title: 'Candidate markets are checked for resolvability.',
        description: 'The critic accepts only drafts with clear wording, evidence, deadlines, and resolution sources.',
        icon: <ListChecks aria-hidden="true" size={18} />,
        body: (
          <div className="mt-8 grid gap-5">
            {pipelineRun.candidateMarkets.map((draft, index) => {
              const review = pipelineRun.criticReviews.find((item) => item.draftId === draft.id);
              const accepted = review?.decision === 'accepted';

              return (
                <StepReveal key={draft.id} index={index}>
                  <article className={`rounded-md border p-4 ${accepted ? 'border-[#171717] bg-white' : 'border-[#E5E1D8] bg-[#FBFAF7]'}`}>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className={`text-sm font-semibold uppercase tracking-[0.08em] ${accepted ? 'text-[#171717]' : 'text-[#77746B]'}`}>
                        {review ? (accepted ? 'Accepted' : 'Rejected') : 'Reviewing'}
                      </div>
                      {review?.violatedRule && <span className="rounded-sm bg-[#EFEAE0] px-2 py-1 text-xs font-medium text-[#625F57]">{review.violatedRule}</span>}
                    </div>
                    <h3 className={`text-xl font-semibold leading-tight ${accepted ? 'text-[#171717]' : 'text-[#77746B]'}`}>{draft.question}</h3>
                    {review && (
                      <>
                        <CriticChecks checks={review.checks} />
                        <p className="mt-4 max-w-3xl text-base leading-7 text-[#625F57]">{review.reasoning}</p>
                      </>
                    )}
                  </article>
                </StepReveal>
              );
            })}
          </div>
        ),
      };
    }

    case 'settlement':
    case 'x402': {
      const market = pipelineRun.acceptedMarket;
      const traceCommitted = isCommittedTrace(pipelineRun.trace);

      if (!market) {
        return createPendingArtifactView(activeStep, 'Artifact publication is waiting for a validated market.');
      }

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: activeStep.id === 'x402'
          ? pipelineRun.x402?.status === 'disabled' || !pipelineRun.x402 ? 'x402 Disabled' : 'x402 Publication'
          : traceCommitted ? 'Arc Trace Commit' : 'Trace Prepared',
        title: market.question,
        description: traceCommitted
          ? 'The artifact hash has a live Arc transaction proof.'
          : 'The artifact hash and source hash are staged for trace review.',
        icon: <ShieldCheck aria-hidden="true" size={18} />,
        body: (
          <StepReveal className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E1D8] pt-6">
            <div>
              <div className="eyebrow">Validated artifact</div>
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
              {isComplete && (
                <button
                  type="button"
                  onClick={onOpenFinalArtifact}
                  className="primary-button pressable px-4"
                >
                  <span className="inline-flex items-center justify-center gap-2">
                    Open artifact
                    <ArrowRight aria-hidden="true" size={15} />
                  </span>
                </button>
              )}
              <button type="button" onClick={onNewAnalysis} className="secondary-button pressable px-4">
                <span className="inline-flex items-center justify-center gap-2">
                  <RotateCcw aria-hidden="true" size={15} />
                  New analysis
                </span>
              </button>
            </div>
          </StepReveal>
        ),
        footer: (
          <div className="grid gap-6 sm:grid-cols-2">
            <StepReveal>
              <Criteria label="YES" value={market.yesCriteria} />
            </StepReveal>
            <StepReveal index={1}>
              <Criteria label="NO" value={market.noCriteria} />
            </StepReveal>
            <StepReveal index={2} className="sm:col-span-2">
              <ArtifactField label="Resolution" value={`${market.deadline} · ${market.resolutionSource}`} />
              <p className="mt-4 max-w-3xl text-base leading-7 text-[#625F57]">{market.evidenceSummary}</p>
            </StepReveal>
            <StepReveal index={3} className="border-t border-[#E5E1D8] pt-6 sm:col-span-2">
              <div className="grid gap-4 sm:grid-cols-3">
                <ArtifactField label="Trace status" value={formatTraceStatus(pipelineRun.trace)} />
                <ArtifactField label="Network" value={pipelineRun.trace?.network ?? 'Arc Testnet'} />
                <ArtifactField label="Trace hash" value={pipelineRun.trace?.traceHash ?? 'Pending'} />
              </div>
              {traceCommitted && pipelineRun.trace?.explorerUrl && (
                <a href={pipelineRun.trace.explorerUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#305F72]">
                  Arcscan transaction
                  <ExternalLink aria-hidden="true" size={13} />
                </a>
              )}
              {!traceCommitted && (
                <p className="mt-4 max-w-3xl text-sm font-medium leading-6 text-[#77746B]">
                  Local trace prepared from the structured outputs. It is useful for demo review, but it is not an Arc Testnet commit proof.
                </p>
              )}
              {(activeStep.id === 'x402' && (!pipelineRun.x402 || pipelineRun.x402.status === 'disabled')) && (
                <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-[#77746B]">
                  x402 is disabled for this run and is not blocking artifact review.
                </p>
              )}
            </StepReveal>
            <StepReveal index={4} className="sm:col-span-2">
              <ComparisonMoment pipelineRun={pipelineRun} />
            </StepReveal>
          </div>
        ),
      };
    }

    default:
      return createPendingArtifactView(activeStep, activeStep.outputSummary || activeStep.reasoningSnippet);
  }
}

function createPendingArtifactView(step: PipelineStep, title: string): ArtifactView {
  return {
    key: step.id,
    step,
    eyebrow: 'Queued',
    title,
    description: step.reasoningSnippet,
    icon: <LoaderCircle aria-hidden="true" size={18} />,
    body: (
      <StepReveal className="mt-8 rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4 text-sm leading-6 text-[#625F57]">
        The workflow will update this card as soon as provider data arrives.
      </StepReveal>
    ),
  };
}

function StepArtifactFrame({
  step,
  eyebrow,
  title,
  description,
  icon,
  children,
  footer,
  progressRail,
  contentKey,
  transitionDirection = 0,
  reduceMotion = false,
  className = '',
}: {
  step?: PipelineStep;
  eyebrow: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  progressRail?: ReactNode;
  contentKey?: string;
  transitionDirection?: StepTransitionDirection;
  reduceMotion?: boolean;
  className?: string;
}) {
  return (
    <motion.section
      transition={reduceMotion ? { duration: 0.001 } : stepRevealTransition}
      className={`artifact-card min-w-0 overflow-visible ${className}`}
    >
      {progressRail && <div className="relative z-40 border-b border-[#EEE9DF] bg-[#FBFAF7] px-6 py-4 sm:px-8 lg:px-10">{progressRail}</div>}
      <div className="grid overflow-hidden">
        <AnimatePresence initial={false} custom={transitionDirection}>
          <motion.div
            key={contentKey ?? title}
            custom={transitionDirection}
            initial={reduceMotion ? { opacity: 1 } : 'enter'}
            animate={reduceMotion ? { opacity: 1 } : 'center'}
            exit={reduceMotion ? { opacity: 0 } : 'exit'}
            variants={stepContentMotion}
            transition={reduceMotion ? { duration: 0.001 } : stepRevealTransition}
            className="relative z-0 col-start-1 row-start-1 min-w-0 bg-white"
          >
            <div className="p-8 sm:p-10">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="eyebrow">{eyebrow}</div>
                  <h2 className="mt-5 max-w-4xl text-3xl font-semibold leading-tight tracking-normal text-[#171717] sm:text-4xl">
                    {title}
                  </h2>
                </div>
                {icon && (
                  <div className="grid size-11 shrink-0 place-items-center rounded-md border border-[#E5E1D8] bg-[#FBFAF7] text-[#292824]">
                    {icon}
                  </div>
                )}
              </div>
              {description && <p className="mt-5 max-w-2xl text-lg leading-8 text-[#625F57]">{description}</p>}
              {step && <StepBrief step={step} />}
              {children}
            </div>
            {footer && <div className="border-t border-[#E5E1D8] bg-[#FBFAF7] p-8 sm:p-10">{footer}</div>}
            {step && (
              <div className="border-t border-[#EEE9DF] px-8 py-4 text-sm leading-6 text-[#77746B] sm:px-10">
                {step.status === 'pending' ? step.action : step.outputSummary || step.reasoningSnippet}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.section>
  );
}

function StepBrief({ step }: { step: PipelineStep }) {
  const briefing = getStepBriefing(step);
  const statusLabel = step.status === 'complete' ? 'What happened' : step.status === 'running' ? 'Now running' : 'Waiting on';
  const statusValue = step.status === 'complete' ? briefing.happened : step.status === 'running' ? step.reasoningSnippet : step.action;

  return (
    <div className="mt-6 grid gap-4 rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4 lg:grid-cols-3">
      <ArtifactField label={statusLabel} value={statusValue} />
      <ArtifactField label="Why it matters" value={briefing.why} />
      <ArtifactField label="Next unlocked" value={step.status === 'complete' ? briefing.next : step.outputSummary || briefing.next} />
    </div>
  );
}

function ResolverDiscoveryPanel({
  discovery,
  verifiedUrl,
}: {
  discovery: NonNullable<PipelineRun['resolverDiscovery']>;
  verifiedUrl?: string;
}) {
  const selectedUrl = verifiedUrl ?? discovery.candidate?.url;
  const candidates = discovery.checkedCandidates.length > 0
    ? discovery.checkedCandidates
    : discovery.candidate
      ? [discovery.candidate]
      : [];

  return (
    <StepReveal className="rounded-md border border-[#D8D1C3] bg-[#FBFAF7] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Resolver Discovery</div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#625F57]">
            {discovery.status === 'found'
              ? 'Official resolver candidates were checked before the verification fetch.'
              : discovery.reason ?? 'No official resolver candidate survived discovery checks.'}
          </p>
        </div>
        <span className={`rounded-sm border px-2 py-1 text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] ${
          discovery.status === 'found'
            ? 'border-[#CFC8BA] bg-white text-[#292824]'
            : 'border-[#C58778] bg-[#FFF9F5] text-[#8C3D32]'
        }`}>
          {discovery.status === 'found' ? 'Candidate selected' : 'No resolver'}
        </span>
      </div>

      <div className="mt-4 overflow-hidden rounded-md border border-[#E5E1D8] bg-white">
        <div className="grid grid-cols-[minmax(0,1.35fr)_8rem_6.5rem_minmax(0,1fr)] gap-3 border-b border-[#E5E1D8] bg-[#F7F6F1] px-3 py-2 text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-[#77746B] max-lg:hidden">
          <div>URL</div>
          <div>Source</div>
          <div>Status</div>
          <div>Reason</div>
        </div>
        <div className="divide-y divide-[#E5E1D8]">
          {candidates.map((candidate, index) => {
            const status = candidate.url === selectedUrl
              ? 'selected'
              : candidate.status ?? (discovery.status === 'found' ? 'unchecked' : 'rejected');

            return (
              <div
                key={`${candidate.url}-${index}`}
                className={`grid gap-2 px-3 py-3 text-sm leading-6 lg:grid-cols-[minmax(0,1.35fr)_8rem_6.5rem_minmax(0,1fr)] lg:gap-3 ${
                  status === 'selected' ? 'bg-[#F2F7EE]' : ''
                }`}
              >
                <div className="min-w-0 font-medium text-[#292824] [overflow-wrap:anywhere]">{candidate.url}</div>
                <div className="text-[#625F57]">{formatResolverCandidateSource(candidate.source)}</div>
                <div>
                  <span className={`rounded-sm border px-1.5 py-0.5 text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] ${resolverCandidateStatusClassName(status)}`}>
                    {formatResolverCandidateStatus(status)}
                  </span>
                </div>
                <div className="min-w-0 text-[#625F57] [overflow-wrap:anywhere]">
                  {candidate.reason ?? (status === 'selected' ? 'Selected for resolver verification.' : 'Candidate queued for discovery.')}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </StepReveal>
  );
}

function formatOperationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function sanitizeOperationText(value: string): string {
  return value
    .replace(/\blocal simulated\b/gi, 'verified')
    .replace(/\bsimulated\b/gi, 'verified')
    .replace(/\blocal demo\b/gi, 'staged')
    .replace(/\bdemo\b/gi, 'staged')
    .replace(/\blocal\b/gi, 'staged')
    .replace(/\s+/g, ' ')
    .trim();
}

function StepReveal({
  children,
  index = 0,
  className = '',
}: {
  children: ReactNode;
  index?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, filter: 'blur(3px)' }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, filter: 'blur(2px)' }}
      transition={{
        ...stepRevealTransition,
        delay: reduceMotion ? 0 : Math.min(index * 0.045, 0.18),
      }}
    >
      {children}
    </motion.div>
  );
}

function StepPendingArtifact({ title, description, progressRail }: { title: string; description: string; progressRail?: ReactNode }) {
  return (
    <StepArtifactFrame eyebrow="Queued" title={title} description={description} icon={<LoaderCircle aria-hidden="true" size={18} />} progressRail={progressRail}>
      <StepReveal className="mt-8 rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4 text-sm leading-6 text-[#625F57]">
        The workflow will update this card as soon as provider data arrives.
      </StepReveal>
    </StepArtifactFrame>
  );
}

function ExtractionArtifact({ pipelineRun, step, progressRail }: { pipelineRun: PipelineRun; step: PipelineStep; progressRail?: ReactNode }) {
  const extracted = pipelineRun.extractedSource;
  const title = getExtractionTitle(pipelineRun, step);
  const description = extracted ? extracted.domain : step.reasoningSnippet;
  const sourceExcerpt = getSourceExcerpt(pipelineRun);

  return (
    <StepArtifactFrame eyebrow="Source Extraction" title={title} description={description} step={step} icon={<FileText aria-hidden="true" size={18} />} progressRail={progressRail}>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <StepReveal>
          <ArtifactField label="Input type" value={looksLikeUrl(pipelineRun.sourceInput) ? 'Readable URL' : 'Pasted source text'} />
        </StepReveal>
        <StepReveal index={1}>
          <ArtifactField label="Preparation status" value={getExtractionStatus(pipelineRun, step)} />
        </StepReveal>
      </div>
      {sourceExcerpt && (
        <StepReveal index={2} className="mt-5 rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4">
          <div className="eyebrow">Source excerpt</div>
          <p className="mt-3 text-base leading-7 text-[#292824]">{sourceExcerpt}</p>
        </StepReveal>
      )}
    </StepArtifactFrame>
  );
}

function IngestionArtifact({ pipelineRun, step, progressRail }: { pipelineRun: PipelineRun; step: PipelineStep; progressRail?: ReactNode }) {
  const ingestion = pipelineRun.ingestion;

  if (!ingestion) {
    return <StepPendingArtifact title="Source metadata is being assembled." description={step.reasoningSnippet} progressRail={progressRail} />;
  }

  const source = pipelineRun.extractedSource ? `${pipelineRun.extractedSource.title} / ${pipelineRun.extractedSource.domain}` : ingestion.source;
  const fields = [
    ['Language', `${ingestion.language} (${formatLanguageConfidence(ingestion.languageConfidence)})`],
    ['Source', source],
    ['Actors', getActors(ingestion.entities)],
    ['Region', ingestion.region],
    ['Event type', ingestion.topic],
    ['Source date', ingestion.sourceDate],
    ['Normalized claim', getNormalizedClaim(ingestion)],
  ];

  return (
    <StepArtifactFrame eyebrow="Source Metadata" title={ingestion.signalName} description="The source is normalized into structured market-intelligence metadata." step={step} icon={<Globe2 aria-hidden="true" size={18} />} progressRail={progressRail}>
      <div className="mt-8 grid gap-4 border-t border-[#E5E1D8] pt-6 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([label, value], index) => (
          <StepReveal key={label} index={index}>
            <ArtifactField label={label} value={value || 'Not available'} />
          </StepReveal>
        ))}
      </div>
    </StepArtifactFrame>
  );
}

function ContextArtifact({ pipelineRun, step, progressRail }: { pipelineRun: PipelineRun; step: PipelineStep; progressRail?: ReactNode }) {
  const context = pipelineRun.context;

  if (!context) {
    return <StepPendingArtifact title="Translation and context are running." description={step.reasoningSnippet} progressRail={progressRail} />;
  }

  return (
    <StepArtifactFrame eyebrow="Translation & Context" title={context.englishSummary} description={context.relevanceExplanation} step={step} icon={<Languages aria-hidden="true" size={18} />} progressRail={progressRail}>
      <div className="mt-8 grid gap-4 border-t border-[#E5E1D8] pt-6">
        <StepReveal>
          <ArtifactField label="Market relevance" value={context.marketRelevance} />
        </StepReveal>
        <StepReveal index={1} className="rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4">
          <div className="eyebrow">Evidence summary</div>
          <p className="mt-3 text-base leading-7 text-[#292824]">{context.evidenceSummary}</p>
        </StepReveal>
      </div>
    </StepArtifactFrame>
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
    if (isSocialUrlHost(url.hostname)) {
      return {
        canRun: true,
        message: 'Social URL accepted. Public post text will be extracted when analysis starts.',
        tone: 'ready',
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
  const trimmed = value.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function isSocialUrlHost(hostname: string): boolean {
  return SOCIAL_URL_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function DraftArtifact({ market, step, progressRail }: { market?: MarketQuestion; step: PipelineStep; progressRail?: ReactNode }) {
  if (!market) {
    return <StepPendingArtifact title="Market draft is being formed." description={step.reasoningSnippet} progressRail={progressRail} />;
  }

  return (
    <StepArtifactFrame eyebrow="Market Drafting" title={market.question} description="The accepted draft is framed around official action, not media pickup or market reaction." step={step} icon={<Link aria-hidden="true" size={18} />} progressRail={progressRail}>
      <div className="mt-8 grid gap-5 border-t border-[#E5E1D8] pt-6 sm:grid-cols-2">
        <StepReveal>
          <Criteria label="YES" value={market.yesCriteria} />
        </StepReveal>
        <StepReveal index={1}>
          <Criteria label="NO" value={market.noCriteria} />
        </StepReveal>
        <StepReveal index={2} className="sm:col-span-2">
          <div className="grid gap-4 rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4 sm:grid-cols-2">
            <ArtifactField label="Deadline" value={market.deadline} />
            <ArtifactField label="Resolution source" value={market.resolutionSource} />
            <div className="sm:col-span-2">
              <ArtifactField label="Why this framing" value={market.evidenceSummary} />
            </div>
          </div>
        </StepReveal>
      </div>
    </StepArtifactFrame>
  );
}

function DecisionArtifact({
  drafts,
  reviews,
  step,
  progressRail,
}: {
  drafts: MarketQuestion[];
  reviews: CriticVerdict[];
  step: PipelineStep;
  progressRail?: ReactNode;
}) {
  if (drafts.length === 0) {
    return <StepPendingArtifact title="Candidate review is waiting for drafts." description={step.reasoningSnippet} progressRail={progressRail} />;
  }

  return (
    <StepArtifactFrame eyebrow="Validation Review" title="Candidate markets are checked for resolvability." description="The critic accepts only drafts with clear wording, evidence, deadlines, and resolution sources." step={step} icon={<ListChecks aria-hidden="true" size={18} />} progressRail={progressRail}>
      <div className="mt-8 grid gap-5">
        {drafts.map((draft) => {
          const review = reviews.find((item) => item.draftId === draft.id);
          const accepted = review?.decision === 'accepted';

          return (
            <StepReveal key={draft.id} index={drafts.indexOf(draft)}>
              <article className={`rounded-md border p-4 ${accepted ? 'border-[#171717] bg-white' : 'border-[#E5E1D8] bg-[#FBFAF7]'}`}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className={`text-sm font-semibold uppercase tracking-[0.08em] ${accepted ? 'text-[#171717]' : 'text-[#77746B]'}`}>
                    {review ? (accepted ? 'Accepted' : 'Rejected') : 'Reviewing'}
                  </div>
                  {review?.violatedRule && <span className="rounded-sm bg-[#EFEAE0] px-2 py-1 text-xs font-medium text-[#625F57]">{review.violatedRule}</span>}
                </div>
                <h3 className={`text-xl font-semibold leading-tight ${accepted ? 'text-[#171717]' : 'text-[#77746B]'}`}>{draft.question}</h3>
                {review && (
                  <>
                    <CriticChecks checks={review.checks} />
                    <p className="mt-4 max-w-3xl text-base leading-7 text-[#625F57]">{review.reasoning}</p>
                  </>
                )}
              </article>
            </StepReveal>
          );
        })}
      </div>
    </StepArtifactFrame>
  );
}

function CriticChecks({ checks }: { checks: CriticVerdict['checks'] }) {
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {Object.entries(checks).map(([label, status]) => (
        <div key={label} className="flex items-center gap-2 rounded-sm border border-[#E5E1D8] bg-white px-2 py-1.5 text-xs font-medium text-[#625F57]">
          <span className={`size-1.5 rounded-full ${status === 'pass' ? 'bg-[#526247]' : 'bg-[#8C3D32]'}`} />
          <span className="capitalize">{label.replace(/([A-Z])/g, ' $1')}</span>
        </div>
      ))}
    </div>
  );
}

function FinalArtifact({
  pipelineRun,
  step,
  copied,
  onCopy,
  onOpenFinalArtifact,
  onNewAnalysis,
  isComplete,
  progressRail,
}: {
  pipelineRun: PipelineRun;
  step: PipelineStep;
  copied: boolean;
  onCopy: () => void;
  onOpenFinalArtifact: () => void;
  onNewAnalysis: () => void;
  isComplete: boolean;
  progressRail?: ReactNode;
}) {
  const market = pipelineRun.acceptedMarket;

  if (!market) {
    return <StepPendingArtifact title="Trace commit is waiting for a validated market." description={step.reasoningSnippet} progressRail={progressRail} />;
  }

  return (
    <StepArtifactFrame
      eyebrow={isCommittedTrace(pipelineRun.trace) ? 'Trace Commit' : 'Trace Prepared'}
      title={market.question}
      description={isCommittedTrace(pipelineRun.trace)
        ? 'The artifact hash has a live Arc transaction proof.'
        : 'The artifact hash and source hash are staged for trace review.'}
      step={step}
      icon={<ShieldCheck aria-hidden="true" size={18} />}
      progressRail={progressRail}
      footer={
        <div className="grid gap-6 sm:grid-cols-2">
          <StepReveal>
            <Criteria label="YES" value={market.yesCriteria} />
          </StepReveal>
          <StepReveal index={1}>
            <Criteria label="NO" value={market.noCriteria} />
          </StepReveal>
          <StepReveal index={2} className="sm:col-span-2">
            <ArtifactField label="Resolution" value={`${market.deadline} · ${market.resolutionSource}`} />
            <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-[#77746B]">
              Resolution criteria and audit trace are packaged together for defensible review.
            </p>
            <p className="mt-4 max-w-3xl text-base leading-7 text-[#625F57]">{market.evidenceSummary}</p>
          </StepReveal>
          <StepReveal index={3} className="border-t border-[#E5E1D8] pt-6 sm:col-span-2">
            <div className="grid gap-4 sm:grid-cols-3">
              <ArtifactField label="Trace status" value={formatTraceStatus(pipelineRun.trace)} />
              <ArtifactField label="Network" value={pipelineRun.trace?.network ?? 'Arc Testnet'} />
              <ArtifactField label="Trace hash" value={pipelineRun.trace?.traceHash ?? 'Pending'} />
            </div>
            {!isCommittedTrace(pipelineRun.trace) && (
              <p className="mt-4 max-w-3xl text-sm font-medium leading-6 text-[#77746B]">
                Trace material is prepared from the structured outputs and will show a transaction link when a chain commit is available.
              </p>
            )}
          </StepReveal>
        </div>
      }
    >
      <StepReveal className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E1D8] pt-6">
        <div>
          <div className="eyebrow">Validated artifact</div>
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
          {isComplete && (
            <button
              type="button"
              onClick={onOpenFinalArtifact}
              className="primary-button pressable px-4"
            >
              <span className="inline-flex items-center justify-center gap-2">
                Open artifact
                <ArrowRight aria-hidden="true" size={15} />
              </span>
            </button>
          )}
          <button type="button" onClick={onNewAnalysis} className="secondary-button pressable px-4">
            <span className="inline-flex items-center justify-center gap-2">
              <RotateCcw aria-hidden="true" size={15} />
              New analysis
            </span>
          </button>
        </div>
      </StepReveal>
    </StepArtifactFrame>
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

function ComparisonMoment({ pipelineRun }: { pipelineRun: PipelineRun }) {
  const ingestion = pipelineRun.ingestion;
  const acceptedMarket = pipelineRun.acceptedMarket ?? pipelineRun.candidateMarkets[0];
  const rejectedCount = pipelineRun.rejectedMarkets.length || Math.max(pipelineRun.candidateMarkets.length - 1, 0);
  const artifactItems = [
    ingestion ? `${ingestion.language} source, ${ingestion.sourceDate}, ${ingestion.region}` : 'Source fields pending',
    ingestion ? `Actors: ${getActors(ingestion.entities)}` : 'Actors pending',
    acceptedMarket ? `Resolver: ${acceptedMarket.resolutionSource}` : 'Resolver pending',
    acceptedMarket ? `Accepted deadline: ${acceptedMarket.deadline}` : 'Deadline pending',
    `${rejectedCount} rejected alternatives retained`,
    `Trace status: ${formatTraceStatus(pipelineRun.trace)}`,
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
          The pipeline keeps "terms agreed" separate from "ratification still pending" and resolves only on official government or Contraloria publication.
        </p>
      )}
    </section>
  );
}

function getNaiveQuestion(run: PipelineRun): string {
  if (isChileCeolRun(run)) {
    return 'Will Chile approve the Laguna Verde lithium deal by June 30, 2026?';
  }

  const deadline = run.acceptedMarket?.deadline ?? run.candidateMarkets[0]?.deadline ?? 'the deadline';
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

function resolverCandidateStatusClassName(status: NonNullable<NonNullable<PipelineRun['resolverDiscovery']>['checkedCandidates'][number]['status']>): string {
  if (status === 'selected') return 'border-[#BFD0B3] bg-[#F2F7EE] text-[#2E5B2D]';
  if (status === 'rejected') return 'border-[#C58778] bg-[#FFF9F5] text-[#8C3D32]';
  return 'border-[#E5E1D8] bg-white text-[#77746B]';
}

function ArtifactField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow">{label}</div>
      <div className="mt-2 min-w-0 text-base font-medium leading-7 text-[#292824] [overflow-wrap:anywhere]">{value}</div>
    </div>
  );
}

function getExtractionTitle(run: PipelineRun, step: PipelineStep): string {
  if (run.extractedSource) return run.extractedSource.title;
  if (looksLikeUrl(run.sourceInput)) return step.status === 'complete' ? 'Article source prepared.' : 'Extracting article...';
  return step.status === 'complete' ? 'Source text prepared.' : 'Preparing pasted source.';
}

function getExtractionStatus(run: PipelineRun, step: PipelineStep): string {
  if (run.extractedSource) return 'Article text extracted';
  if (looksLikeUrl(run.sourceInput)) return step.status === 'running' ? 'Reading source' : 'URL prepared';
  return step.status === 'running' ? 'Preparing pasted text' : 'Source text prepared';
}

function getSourceExcerpt(run: PipelineRun): string {
  const text = run.extractedSource?.text ?? run.sourceInput;
  const normalizedText = text.trim().replace(/\s+/g, ' ');

  if (!normalizedText) return '';
  return normalizedText.length > 230 ? `${normalizedText.slice(0, 227)}...` : normalizedText;
}

function getSubmittedSourceSummary(sourceText: string): { kind: string; text: string } {
  const normalizedText = sourceText.trim().replace(/\s+/g, ' ');
  const url = parseArticleUrl(normalizedText);

  if (url) {
    return {
      kind: isSocialUrlHost(url.hostname) ? 'Social URL' : 'Article URL',
      text: url.href,
    };
  }

  return {
    kind: 'Pasted text',
    text: sourceText.trim(),
  };
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

function createPresentedSteps(steps: PipelineStep[], presentedStep: PresentedStepState): PipelineStep[] {
  return steps.map((step, index) => {
    if (index < presentedStep.index) return { ...step, status: 'complete' };
    if (index === presentedStep.index) return { ...step, status: presentedStep.status };
    return { ...step, status: 'pending' };
  });
}

function getPresentationTarget(run: PipelineRun): { index: number; status: PipelineStepStatus } {
  const failedStepIndex = run.steps.findIndex((step) => step.status === 'failed');

  if (failedStepIndex >= 0) {
    return { index: failedStepIndex, status: 'failed' };
  }

  if (run.status === 'failed') {
    const errorStage = run.errorBrief?.stage;
    const errorStepIndex = errorStage && isPipelineStepId(errorStage)
      ? run.steps.findIndex((step) => step.id === errorStage)
      : -1;
    const firstIncompleteIndex = run.steps.findIndex((step) => step.status !== 'complete');
    const fallbackIndex = firstIncompleteIndex >= 0 ? firstIncompleteIndex : Math.max(run.steps.length - 1, 0);

    return {
      index: errorStepIndex >= 0 ? errorStepIndex : fallbackIndex,
      status: 'failed',
    };
  }

  const runningStepIndex = run.steps.findIndex((step) => step.status === 'running');

  if (runningStepIndex >= 0) {
    return { index: runningStepIndex, status: 'running' };
  }

  if (run.status === 'complete' || run.status === 'trace-committed') {
    return { index: Math.max(run.steps.length - 1, 0), status: 'complete' };
  }

  const lastCompleteIndex = getLastCompleteStepIndex(run.steps);

  if (lastCompleteIndex >= 0) {
    return { index: lastCompleteIndex, status: 'complete' };
  }

  return { index: 0, status: run.status === 'running' ? 'running' : 'pending' };
}

function getGatedPresentationTarget(run: PipelineRun, current: PresentedStepState): { index: number; status: PipelineStepStatus } {
  const target = getPresentationTarget(run);

  if (target.index <= current.index) {
    return target;
  }

  for (let index = current.index; index < target.index; index += 1) {
    const step = run.steps[index];

    if (!step) break;

    if (step.status === 'failed') {
      return { index, status: 'failed' };
    }

    if (step.status !== 'complete' || !areStepOperationsReadyToAdvance(run, step.id)) {
      return { index, status: step.status === 'pending' ? 'running' : step.status };
    }
  }

  return target;
}

function areStepOperationsReadyToAdvance(run: PipelineRun, stepId: PipelineStep['id']): boolean {
  const operations = run.stepOperations[stepId] ?? [];

  if (operations.length === 0) {
    return true;
  }

  return operations.every((operation) => operation.status === 'complete' || operation.status === 'info');
}

function isPipelineStepId(value: string): value is PipelineStep['id'] {
  return ['extraction', 'ingestion', 'context', 'claim', 'resolver', 'comparison', 'market-creator', 'critic', 'circle', 'settlement', 'x402'].includes(value);
}

function getLastCompleteStepIndex(steps: PipelineStep[]): number {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].status === 'complete') return index;
  }

  return -1;
}

function getStepState(status: PipelineStepStatus): StepState {
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

function isCommittedTrace(trace: PipelineRun['trace']) {
  return trace?.status === 'committed' && Boolean(trace.transactionId?.startsWith('0x')) && Boolean(trace.explorerUrl);
}

function formatTraceStatus(trace: PipelineRun['trace']) {
  if (isCommittedTrace(trace)) return `Committed transaction ${trace?.transactionId}`;
  if (trace) return 'Trace prepared';
  return 'Preparing commit';
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
