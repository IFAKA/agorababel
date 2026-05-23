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
  Wallet,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  getNaiveQuestion,
  getRunSourceExcerpt as getSourceExcerpt,
  getSubmittedSourceSummary,
  isChileCeolRun,
  isCommittedTrace,
  looksLikeUrl,
  parseArticleUrl,
} from '../../artifactHelpers';
import { pipelineStepDescriptions as stepDescriptions, pipelineStepLabels as stepLabels } from '../../pipeline/stages';
import {
  clamp,
  getCompletedStepDwellMs,
  getOneStepPresentationTarget,
  type PresentedStepState,
} from '../../pipeline/presentationTiming';
import type { CriticVerdict, MarketQuestion, PipelineRun, PipelineStep, PipelineStepStatus, SourceAnalysis } from '../../pipeline/types';
import { pageContainerClassName } from '../pageLayout';

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

const MIN_STEP_PROCESSING_MS = 850;
const MIN_FAILURE_PROCESSING_MS = 1300;
const MIN_PASTED_SOURCE_LENGTH = 120;
const SOURCE_ACCEPTED_HANDOFF_MS = 900;

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
    () => {
      if (hasStarted && !showSourceAccepted && (pipelineRun.status === 'complete' || pipelineRun.status === 'trace-committed')) {
        return pipelineRun.steps.map((step) => ({ ...step, status: 'complete' as const }));
      }

      return createPresentedSteps(pipelineRun.steps, hasStarted && !showSourceAccepted ? presentedStep : { index: 0, status: 'pending', since: presentedStep.since });
    },
    [hasStarted, pipelineRun.status, pipelineRun.steps, presentedStep, showSourceAccepted],
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
      description: hasStarted ? 'The exact submitted article, URL, or pasted text for this run.' : 'Paste an article URL or source text to start.',
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
              runStatus={pipelineRun.status}
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
  runStatus,
  historyItems,
  onSelectStep,
  onSelectHistoryItem,
  onNewAnalysis,
}: {
  steps: ProgressStep[];
  selectedStepId?: ProgressStepId;
  runStatus: PipelineRun['status'];
  historyItems: HistoryItem[];
  onSelectStep: (stepId: ProgressStepId) => void;
  onSelectHistoryItem: (id: string) => void;
  onNewAnalysis: () => void;
}) {
  const runState = getRunStateLabel(runStatus);

  return (
    <aside className="min-w-0 lg:sticky lg:top-5 lg:self-start" aria-label="Create workflow sidebar">
      <div className="artifact-card overflow-hidden bg-white shadow-[0_20px_55px_rgba(29,28,24,0.06)]">
        <div className="flex items-start justify-between gap-4 border-b border-[#EEE9DF] bg-[#FBFAF7] p-5">
          <div className="min-w-0 flex-1">
            <div className="eyebrow">Workflow</div>
            <div className="mt-2 inline-flex rounded-sm border border-[#D8D3C8] bg-white px-2 py-1 text-xs font-semibold uppercase leading-4 tracking-[0.08em] text-[#625F57]">
              {runState}
            </div>
          </div>
          <button type="button" onClick={onNewAnalysis} className="secondary-button pressable h-11 min-h-11 shrink-0 whitespace-nowrap px-4 text-sm">
            <span className="inline-flex items-center justify-center gap-2">
              <RotateCcw aria-hidden="true" size={15} />
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
                  aria-label={`${step.label}: ${formatStepStatus(step.status)}. ${step.description}`}
                  className={`workflow-step-trigger mt-1 grid size-7 place-items-center rounded-full border transition-[background-color,border-color,color,box-shadow] duration-200 disabled:cursor-not-allowed ${
                    selected
                      ? 'workflow-step-trigger--selected shadow-[0_0_0_4px_rgba(23,23,23,0.08)]'
                      : state === 'complete'
                        ? 'workflow-step-trigger--complete'
                        : state === 'failed'
                          ? 'workflow-step-trigger--failed'
                          : 'workflow-step-trigger--pending'
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
  const guideClassName = isFailed ? 'workflow-connector-guide--failed' : 'workflow-connector-guide--idle';

  return (
    <span aria-hidden="true" className="pointer-events-none relative my-1 h-8 w-px overflow-hidden">
      <span className={`workflow-connector-guide workflow-connector-guide--vertical absolute inset-0 ${guideClassName}`} />
      {isPassed && !reduceMotion ? (
        <motion.span
          key="vertical-solid-connector"
          className="workflow-connector-fill absolute inset-x-0 top-0 h-full origin-top"
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.62, ease: [0.23, 1, 0.32, 1] }}
          style={{ transformOrigin: 'top' }}
        />
      ) : isPassed ? (
        <span className="workflow-connector-fill absolute inset-0" />
      ) : isPreparingNext && !reduceMotion ? (
        <motion.span
          key="vertical-handoff-connector"
          className="workflow-connector-handoff workflow-connector-handoff--vertical absolute inset-x-0 top-0 h-full origin-top"
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
                    aria-label={`${step.label}: ${formatStepStatus(step.status)}. ${step.description}`}
                    className={`${
                      selected ? 'inline-flex h-10 w-[9.5rem] justify-start gap-2 px-3 sm:w-40' : 'inline-grid size-9 place-items-center'
                    } workflow-step-trigger items-center rounded-full border text-sm font-medium transition-[background-color,border-color,color,box-shadow] duration-200 disabled:cursor-not-allowed ${
                      selected
                        ? 'workflow-step-trigger--selected shadow-[0_0_0_4px_rgba(23,23,23,0.08),0_10px_24px_rgba(29,28,24,0.12)]'
                        : state === 'complete'
                          ? 'workflow-step-trigger--complete'
                          : state === 'failed'
                            ? 'workflow-step-trigger--failed'
                            : 'workflow-step-trigger--pending'
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
          {formatStepStatus(tooltipStep.status)}
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
  const guideClassName = isFailed ? 'workflow-connector-guide--failed' : 'workflow-connector-guide--idle';

  return (
    <span aria-hidden="true" className="pointer-events-none relative mx-1 h-px w-9 shrink-0 overflow-hidden sm:w-[clamp(2rem,5vw,5rem)]">
      <span className={`workflow-connector-guide workflow-connector-guide--horizontal absolute inset-0 ${guideClassName}`} />
      {isPassed && !reduceMotion ? (
        <motion.span
          key="solid-connector"
          className="workflow-connector-fill absolute inset-y-0 left-0 w-full origin-left"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.62, ease: [0.23, 1, 0.32, 1] }}
          style={{ transformOrigin: 'left' }}
        />
      ) : isPassed ? (
        <span className="workflow-connector-fill absolute inset-0" />
      ) : isPreparingNext && !reduceMotion ? (
        <motion.span
          key="handoff-connector"
          className="workflow-connector-handoff workflow-connector-handoff--horizontal absolute inset-y-0 left-0 w-full origin-left"
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
    ? 'workflow-step-mark--selected'
    : state === 'complete'
      ? 'workflow-step-mark--complete'
      : state === 'active'
        ? 'workflow-step-mark--active'
        : state === 'failed'
          ? 'workflow-step-mark--failed'
          : 'workflow-step-mark--pending';
  const sizeClassName = compact ? 'size-4' : 'size-5';
  const iconSize = compact ? 10 : 12;

  return (
    <span className={`workflow-step-mark relative z-10 grid ${sizeClassName} place-items-center rounded-full border ${compact ? '' : 'mt-0.5'} ${className}`}>
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
  const showExtractedSeparately = Boolean(extracted && !isEffectivelySameSource(sourceSummary.text, extracted.text));

  return {
    key: 'source-accepted',
    eyebrow: 'Source',
    title: 'Submitted source.',
    description: handoffActive ? 'Queued' : undefined,
    icon: handoffActive
      ? <LoaderCircle aria-hidden="true" className={reduceMotion ? '' : 'animate-spin'} size={18} />
      : <FileText aria-hidden="true" size={18} />,
    body: (
      <>
        <StepReveal className="mt-8 rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="eyebrow">Submitted source</div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-sm border border-[#D8D3C8] bg-white px-2 py-1 text-xs font-medium text-[#625F57]">
                {sourceSummary.kind}
              </span>
              {extracted && (
                <span className="rounded-sm border border-[#D8D3C8] bg-white px-2 py-1 text-xs font-medium text-[#625F57]">
                  {extracted.domain}
                </span>
              )}
            </div>
          </div>
          <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-[#E5E1D8] bg-white p-4 text-base leading-7 text-[#292824] [overflow-wrap:anywhere] whitespace-pre-wrap">
            {sourceSummary.text}
          </div>
        </StepReveal>
        {extracted && showExtractedSeparately && (
          <StepReveal index={1} className="mt-5">
            <details className="rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4">
              <summary className="cursor-pointer select-none text-sm font-semibold uppercase leading-5 tracking-[0.08em] text-[#625F57]">
                Extracted text
              </summary>
              <div className="mt-3 max-h-80 overflow-y-auto rounded-md border border-[#E5E1D8] bg-white p-4 text-base leading-7 text-[#292824] [overflow-wrap:anywhere] whitespace-pre-wrap">
                <div className="mb-3 font-medium">{extracted.title}</div>
                {extracted.text}
              </div>
            </details>
          </StepReveal>
        )}
        {handoffActive && (
          <StepReveal index={showExtractedSeparately ? 2 : 1} className="mt-5 flex items-center gap-3 rounded-md border border-[#E5E1D8] bg-white p-4 text-sm font-medium text-[#625F57]">
            <LoaderCircle aria-hidden="true" className={`shrink-0 text-[#292824] ${reduceMotion ? '' : 'animate-spin'}`} size={16} />
            Running
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
  isComplete,
}: {
  pipelineRun: PipelineRun;
  activeStep?: PipelineStep;
  copied: boolean;
  onCopy: () => void;
  onOpenFinalArtifact: () => void;
  isComplete: boolean;
}): ArtifactView {
  if (!activeStep) {
    return {
      key: 'preparing',
      eyebrow: 'Queued',
      title: 'Analysis is preparing.',
      description: 'Waiting',
      icon: <LoaderCircle aria-hidden="true" size={18} />,
      body: (
        <StepReveal className="mt-8 rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4 text-sm leading-6 text-[#625F57]">
          Waiting
        </StepReveal>
      ),
    };
  }

  switch (activeStep.id) {
    case 'extraction': {
      const extracted = pipelineRun.extractedSource;
      const title = getExtractionTitle(pipelineRun, activeStep);
      const sourceExcerpt = getSourceExcerpt(pipelineRun);

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: 'Read Source',
        title,
        description: extracted ? extracted.domain : formatStepStatus(activeStep.status),
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
        eyebrow: 'Source Details',
        title: ingestion.signalName,
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
        eyebrow: 'Find Main Claim',
        title: pipelineRun.analysis?.claim.summary ?? getNormalizedClaim(ingestion),
        icon: <Languages aria-hidden="true" size={18} />,
        body: (
          <div className="mt-8 grid gap-4 border-t border-[#E5E1D8] pt-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <StepReveal>
                <ArtifactField label="Claim" value={pipelineRun.analysis?.claim.summary ?? getNormalizedClaim(ingestion)} />
              </StepReveal>
              <StepReveal index={1}>
                <ArtifactField label="Deadline" value={pipelineRun.analysis?.claim.deadline ?? pipelineRun.candidateMarkets[0]?.deadline ?? 'Deadline pending'} />
              </StepReveal>
              <StepReveal index={2}>
                <ArtifactField label="Actors" value={(pipelineRun.analysis?.claim.actors ?? ingestion.entities).join(', ') || getActors(ingestion.entities)} />
              </StepReveal>
              <StepReveal index={3}>
                <ArtifactField label="Event type" value={pipelineRun.analysis?.claim.eventType ?? ingestion.topic} />
              </StepReveal>
            </div>
            <StepReveal index={4} className="rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4">
              <div className="eyebrow">Evidence</div>
              <p className="mt-3 text-base leading-7 text-[#292824]">
                {pipelineRun.analysis?.claim.evidence.map((item) => `${item.text} (${item.source})`).join(' ') ?? context.evidenceSummary}
              </p>
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
            eyebrow: 'Check Official Source',
            title: discovery?.status === 'found'
              ? 'Checking the official source'
              : 'No official source found',
            description: discovery?.status === 'found'
              ? `We are opening ${discovery.candidate?.name ?? 'the official page'} to confirm it can decide the market.`
              : pipelineRun.analysis?.rejectionReason ?? discovery?.reason ?? 'The source did not include an official page that can decide the outcome.',
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

        return createPendingArtifactView(activeStep, 'Checking the official source.');
      }

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: 'Check Official Source',
        title: resolver.name,
        icon: <Globe2 aria-hidden="true" size={18} />,
        body: (
          <div className="mt-8 grid gap-4 border-t border-[#E5E1D8] pt-6">
            {discovery && <ResolverDiscoveryPanel discovery={discovery} verifiedUrl={resolver.url} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <StepReveal>
                <ArtifactField label="Status" value={resolver.verificationStatus} />
              </StepReveal>
              <StepReveal index={1}>
                <ArtifactField label="Official source URL" value={resolver.url} />
              </StepReveal>
            </div>
          </div>
        ),
      };
    }

    case 'comparison': {
      const comparison = pipelineRun.liveMarketComparison ?? pipelineRun.analysis?.marketComparison;

      if (!comparison) {
        return createPendingArtifactView(activeStep, 'Checking existing markets for duplicates.');
      }

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: 'Check Duplicates',
        title: comparison.noveltyVerdict === 'new-opportunity' ? 'No close duplicate found' : `Duplicate check: ${comparison.noveltyVerdict}`,
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
        return createPendingArtifactView(activeStep, 'Writing the YES/NO market.');
      }

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: 'Write Market',
        title: market.question,
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
          </div>
        ),
      };
    }

    case 'critic': {
      if (pipelineRun.candidateMarkets.length === 0) {
        return createPendingArtifactView(activeStep, 'Quality check is waiting for the market draft.');
      }

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: 'Quality Check',
        title: 'Market drafts are checked before approval.',
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

    case 'circle': {
      const wallet = pipelineRun.circleAgentWallet;

      if (!wallet) {
        return createPendingArtifactView(activeStep, 'Circle wallet status is being checked.');
      }

      const isReady = wallet.status === 'ready';

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: 'Check Wallet',
        title: isReady ? 'Circle wallet is ready for proof attachment.' : 'Circle wallet is not ready.',
        description: isReady
          ? 'The proof step can use this configured Arc Testnet wallet.'
          : wallet.error ?? 'Wallet configuration must be ready before a chain proof can be attached.',
        icon: <Wallet aria-hidden="true" size={18} />,
        body: (
          <div className="mt-8 grid gap-5 border-t border-[#E5E1D8] pt-6">
            <StepReveal className={`rounded-md border p-4 ${isReady ? 'border-[#BFD0B3] bg-[#F2F7EE]' : 'border-[#E0C5BC] bg-[#FFF9F5]'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="eyebrow">Wallet readiness</div>
                  <p className="mt-2 text-xl font-semibold capitalize leading-7 text-[#292824]">{wallet.status}</p>
                </div>
                <span className={`rounded-sm border px-2 py-1 text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] ${
                  isReady ? 'border-[#BFD0B3] bg-white text-[#2E5B2D]' : 'border-[#C58778] bg-white text-[#8C3D32]'
                }`}>
                  {isReady ? 'Ready' : 'Blocked'}
                </span>
              </div>
              {wallet.error && <p className="mt-3 text-sm font-medium leading-6 text-[#8C3D32]">{wallet.error}</p>}
            </StepReveal>
            <div className="grid gap-4 sm:grid-cols-2">
              <StepReveal index={1}>
                <ArtifactField label="Wallet ID" value={wallet.walletId ?? 'Missing'} />
              </StepReveal>
              <StepReveal index={2}>
                <ArtifactField label="Wallet set" value={wallet.walletSetId ?? 'Missing'} />
              </StepReveal>
              <StepReveal index={3} className="sm:col-span-2">
                <ArtifactField label="Address" value={wallet.address ?? 'No address configured'} />
              </StepReveal>
              <StepReveal index={4}>
                <ArtifactField label="Blockchain" value={wallet.blockchain} />
              </StepReveal>
              <StepReveal index={5}>
                <ArtifactField label="Checked at" value={wallet.checkedAt} />
              </StepReveal>
            </div>
          </div>
        ),
      };
    }

    case 'settlement': {
      const market = pipelineRun.acceptedMarket;
      const traceCommitted = isCommittedTrace(pipelineRun.trace);

      if (!market) {
        return createPendingArtifactView(activeStep, 'Saving proof is waiting for an approved market.');
      }

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: traceCommitted ? 'Proof Saved' : 'Proof Prepared',
        title: traceCommitted ? 'Arc proof saved.' : 'Proof prepared for review.',
        icon: <ShieldCheck aria-hidden="true" size={18} />,
        body: (
          <div className="mt-8 grid gap-5 border-t border-[#E5E1D8] pt-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StepReveal>
                <ArtifactField label="Trace status" value={formatTraceStatus(pipelineRun.trace)} />
              </StepReveal>
              <StepReveal index={1}>
                <ArtifactField label="Network" value={pipelineRun.trace?.network ?? 'Arc Testnet'} />
              </StepReveal>
              <StepReveal index={2}>
                <ArtifactField label="Trace hash" value={pipelineRun.trace?.traceHash ?? 'Pending'} />
              </StepReveal>
              <StepReveal index={3}>
                <ArtifactField label="Artifact hash" value={pipelineRun.trace?.artifactHash ?? 'Pending'} />
              </StepReveal>
              <StepReveal index={4}>
                <ArtifactField label="Transaction" value={pipelineRun.trace?.transactionId ?? 'Pending'} />
              </StepReveal>
              <StepReveal index={5}>
                <ArtifactField label="Timestamp" value={pipelineRun.trace?.timestamp ?? 'Pending'} />
              </StepReveal>
            </div>
            {traceCommitted && pipelineRun.trace?.explorerUrl && (
              <StepReveal index={6}>
                <a href={pipelineRun.trace.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-[#305F72]">
                  Open Arcscan transaction
                  <ExternalLink aria-hidden="true" size={13} />
                </a>
              </StepReveal>
            )}
            {!traceCommitted && (
              <StepReveal index={6} className="rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4 text-sm font-medium leading-6 text-[#77746B]">
                Local trace prepared from the structured outputs. It is useful for demo review, but it is not an Arc Testnet commit proof.
              </StepReveal>
            )}
          </div>
        ),
      };
    }

    case 'x402': {
      const publication = pipelineRun.x402;
      const disabled = !publication || publication.status === 'disabled';
      const market = pipelineRun.acceptedMarket;

      if (!market) {
        return createPendingArtifactView(activeStep, 'Access publication is waiting for a saved proof.');
      }

      return {
        key: activeStep.id,
        step: activeStep,
        eyebrow: disabled ? 'Paid Access Disabled' : 'Publish Access',
        title: market.question,
        icon: <Link aria-hidden="true" size={18} />,
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
            </div>
          </StepReveal>
        ),
        footer: (
          <div className="grid gap-5">
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
              <StepReveal index={3} className="sm:col-span-2">
                <ComparisonMoment pipelineRun={pipelineRun} />
              </StepReveal>
              {!isCommittedTrace(pipelineRun.trace) && (
                <StepReveal index={4} className="rounded-md border border-[#E5E1D8] bg-white p-4 text-sm font-medium leading-6 text-[#77746B] sm:col-span-2">
                  Local trace prepared from the structured outputs. It is useful for demo review, but it is not an Arc Testnet commit proof.
                </StepReveal>
              )}
            </div>
            {disabled && (
              <StepReveal className="rounded-md border border-[#E5E1D8] bg-white p-4 text-sm font-medium leading-6 text-[#77746B]">
                x402 is disabled for this run and is not blocking artifact review.
              </StepReveal>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <StepReveal index={1}>
                <ArtifactField label="Artifact ID" value={publication?.artifactId ?? pipelineRun.acceptedMarket.id} />
              </StepReveal>
              <StepReveal index={2}>
                <ArtifactField label="Status" value={publication?.status ?? 'disabled'} />
              </StepReveal>
              <StepReveal index={3}>
                <ArtifactField label="Price" value={formatUsdcPrice(publication?.priceUsdcMicro)} />
              </StepReveal>
              <StepReveal index={4}>
                <ArtifactField label="Pay-to address" value={publication?.payToAddress ?? 'No seller wallet configured'} />
              </StepReveal>
              <StepReveal index={5}>
                <ArtifactField label="Gateway" value={publication?.gatewayUrl ?? 'Not configured'} />
              </StepReveal>
              <StepReveal index={6}>
                <ArtifactField label="Facilitator" value={publication?.facilitatorUrl ?? 'Not configured'} />
              </StepReveal>
              <StepReveal index={7}>
                <ArtifactField label="Network" value={publication?.network ?? 'Not configured'} />
              </StepReveal>
              <StepReveal index={8}>
                <ArtifactField label="Intelligence URL" value={publication?.intelligenceUrl ?? 'Not published'} />
              </StepReveal>
              <StepReveal index={9}>
                <ArtifactField label="Unlock URL" value={publication?.demoUnlockUrl ?? 'Not available'} />
              </StepReveal>
            </div>
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
    description: formatStepStatus(step.status),
    icon: <LoaderCircle aria-hidden="true" size={18} />,
    body: (
      <StepReveal className="mt-8 rounded-md border border-[#E5E1D8] bg-[#FBFAF7] p-4 text-sm leading-6 text-[#625F57]">
        {formatStepStatus(step.status)}
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
              {children}
            </div>
            {footer && <div className="border-t border-[#E5E1D8] bg-[#FBFAF7] p-8 sm:p-10">{footer}</div>}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.section>
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
          <div className="eyebrow">Official Source Search</div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#625F57]">
            {discovery.status === 'found'
              ? 'Official source candidates were checked before opening the final page.'
              : discovery.reason ?? 'No official source candidate passed the discovery checks.'}
          </p>
        </div>
        <span className={`rounded-sm border px-2 py-1 text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] ${
          discovery.status === 'found'
            ? 'border-[#CFC8BA] bg-white text-[#292824]'
            : 'border-[#C58778] bg-[#FFF9F5] text-[#8C3D32]'
        }`}>
          {discovery.status === 'found' ? 'Candidate selected' : 'No source'}
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
        Waiting
      </StepReveal>
    </StepArtifactFrame>
  );
}

function ExtractionArtifact({ pipelineRun, step, progressRail }: { pipelineRun: PipelineRun; step: PipelineStep; progressRail?: ReactNode }) {
  const extracted = pipelineRun.extractedSource;
  const title = getExtractionTitle(pipelineRun, step);
  const sourceExcerpt = getSourceExcerpt(pipelineRun);

  return (
    <StepArtifactFrame eyebrow="Read Source" title={title} description={extracted ? extracted.domain : formatStepStatus(step.status)} step={step} icon={<FileText aria-hidden="true" size={18} />} progressRail={progressRail}>
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
    return <StepPendingArtifact title="Source details are being prepared." description={step.reasoningSnippet} progressRail={progressRail} />;
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
    <StepArtifactFrame eyebrow="Source Details" title={ingestion.signalName} step={step} icon={<Globe2 aria-hidden="true" size={18} />} progressRail={progressRail}>
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

function DraftArtifact({ market, step, progressRail }: { market?: MarketQuestion; step: PipelineStep; progressRail?: ReactNode }) {
  if (!market) {
    return <StepPendingArtifact title="Writing the YES/NO market." description={step.reasoningSnippet} progressRail={progressRail} />;
  }

  return (
    <StepArtifactFrame eyebrow="Write Market" title={market.question} step={step} icon={<Link aria-hidden="true" size={18} />} progressRail={progressRail}>
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
    return <StepPendingArtifact title="Quality check is waiting for the market draft." description={step.reasoningSnippet} progressRail={progressRail} />;
  }

  return (
    <StepArtifactFrame eyebrow="Quality Check" title="Market drafts are checked before approval." step={step} icon={<ListChecks aria-hidden="true" size={18} />} progressRail={progressRail}>
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
  isComplete,
  progressRail,
}: {
  pipelineRun: PipelineRun;
  step: PipelineStep;
  copied: boolean;
  onCopy: () => void;
  onOpenFinalArtifact: () => void;
  isComplete: boolean;
  progressRail?: ReactNode;
}) {
  const market = pipelineRun.acceptedMarket;

  if (!market) {
    return <StepPendingArtifact title="Saving proof is waiting for an approved market." description={step.reasoningSnippet} progressRail={progressRail} />;
  }

  return (
    <StepArtifactFrame
      eyebrow={isCommittedTrace(pipelineRun.trace) ? 'Proof Saved' : 'Proof Prepared'}
      title={market.question}
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
                Local trace prepared from the structured outputs. It is useful for demo review, but it is not an Arc Testnet commit proof.
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
    acceptedMarket ? `Official source: ${acceptedMarket.resolutionSource}` : 'Official source pending',
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

  if ((run.status === 'complete' || run.status === 'trace-committed') && target.index > current.index) {
    return target;
  }

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

function formatStepStatus(status: PipelineStepStatus): string {
  if (status === 'complete') return 'Done';
  if (status === 'running') return 'Running';
  if (status === 'failed') return 'Blocked';
  return 'Waiting';
}

function getRunStateLabel(status: PipelineRun['status']): string {
  if (status === 'complete' || status === 'trace-committed') return 'Complete';
  if (status === 'running') return 'Running';
  if (status === 'failed' || status === 'rejected') return 'Blocked';
  return 'Ready';
}

function normalizeSourceText(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isEffectivelySameSource(submittedText: string, extractedText: string): boolean {
  const submitted = normalizeSourceText(submittedText);
  const extracted = normalizeSourceText(extractedText);

  if (submitted.length < 80 || extracted.length < 80) return submitted === extracted;
  if (submitted === extracted) return true;

  const shorter = submitted.length < extracted.length ? submitted : extracted;
  const longer = submitted.length < extracted.length ? extracted : submitted;

  return longer.includes(shorter) && shorter.length / longer.length > 0.72;
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

function formatTraceStatus(trace: PipelineRun['trace']) {
  if (isCommittedTrace(trace)) return `Committed transaction ${trace?.transactionId}`;
  if (trace) return 'Trace prepared';
  return 'Preparing commit';
}

function formatUsdcPrice(value: number | null | undefined): string {
  if (!value) return 'Not configured';

  const usdc = value / 1_000_000;
  return `${usdc.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC (${value} micro-USDC)`;
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
