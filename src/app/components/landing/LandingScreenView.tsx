import { useEffect, useState } from 'react';
import { ArrowRight, Check, Clock3, FileText, Github, Globe2, LoaderCircle, Pause, Play, RotateCcw, ShieldCheck, Star } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { AgoraBabelTraceMark } from '../AgoraBabelTraceMark';
import { pageContainerClassName } from '../pageLayout';

const workflow = ['Read Source', 'Explain Context', 'Quality Check', 'Save Proof'];
const repositoryUrl = 'https://github.com/IFAKA/agorababel';
const demoSourceUrl = 'diariofinanciero.example/chile/laguna-verde-ceol';

const validationSteps = [
  { label: 'Find the claim', detail: 'Laguna Verde CEOL identified', icon: FileText },
  { label: 'Explain the context', detail: 'Terms agreed; ratification pending', icon: Globe2 },
  { label: 'Check the rules', detail: 'Official source required', icon: ShieldCheck },
] as const;

const microdemoReadingDelaySeconds = 7.2;
const microdemoStageSeconds = 3.1;
const microdemoStartBlinkMs = 260;
const microdemoReadingDelayMs = microdemoReadingDelaySeconds * 1000;
const microdemoStageMs = microdemoStageSeconds * 1000;
const validationStepperCompletionRatio = 0.72;
const landingEase = [0.23, 1, 0.32, 1] as const;
const landingItemTransition = {
  type: 'spring',
  duration: 0.64,
  bounce: 0,
} as const;

const landingSequenceMotion = (reduceMotion: boolean | null, introActive: boolean) => reduceMotion
  ? {}
  : {
    initial: 'hidden',
    animate: 'visible',
    variants: {
      hidden: {},
      visible: {
        transition: {
          delayChildren: introActive ? 1.85 : 0.04,
          staggerChildren: 0.1,
        },
      },
    },
  };

const landingItemMotion = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: landingItemTransition,
  },
};

const workflowSequenceMotion = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: 0.22,
      staggerChildren: 0.07,
    },
  },
};

const heroSequenceMotion = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.075,
    },
  },
};

const workflowItemMotion = {
  hidden: { opacity: 0, x: -8 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.42, ease: landingEase },
  },
};

export function LandingScreen({
  introActive = false,
  onAnalyzeSource,
  onRunSampleArticle,
}: {
  introActive?: boolean;
  onAnalyzeSource: () => void;
  onRunSampleArticle: () => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F7F6F1] text-[#191A1C]">
      <main className="min-h-0 flex-1 overflow-y-auto">
        <motion.div
          {...landingSequenceMotion(reduceMotion, introActive)}
          className={`${pageContainerClassName} min-h-full content-center`}
        >
          <motion.header
            variants={reduceMotion || introActive ? undefined : landingItemMotion}
            className="flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3">
              <div
                data-agorababel-mark-target
                className="grid size-8 place-items-center rounded-md border border-[#D8D3C8] bg-white text-[#191A1C]"
                style={{ opacity: introActive && !reduceMotion ? 0 : 1 }}
              >
                <AgoraBabelTraceMark className="size-5" />
              </div>
              <motion.div
                data-agorababel-wordmark-target
                className="text-sm font-semibold"
                style={{ opacity: introActive && !reduceMotion ? 0 : 1 }}
              >
                AgoraBabel
              </motion.div>
            </div>
            <a
              href={repositoryUrl}
              target="_blank"
              rel="noreferrer"
              className="secondary-button pressable inline-flex min-h-10 items-center justify-center gap-2 px-3 text-sm"
            >
              <Github aria-hidden="true" size={15} />
              <span className="hidden sm:inline">Star repo</span>
              <Star aria-hidden="true" className="sm:hidden" size={14} />
            </a>
          </motion.header>

          <motion.section
            variants={reduceMotion ? undefined : heroSequenceMotion}
            className="grid gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(25rem,0.7fr)] lg:items-start"
          >
            <motion.div variants={reduceMotion ? undefined : heroSequenceMotion} className="min-w-0">
              <motion.p variants={reduceMotion ? undefined : landingItemMotion} className="mb-5 text-sm font-medium text-[#6C6B66]">
                Internal operational intelligence tooling for prediction markets.
              </motion.p>
              <motion.h1 variants={reduceMotion ? undefined : landingItemMotion} className="max-w-4xl text-4xl font-semibold leading-[0.98] tracking-normal text-[#171717] sm:text-5xl lg:text-6xl">
                Operational intelligence for prediction-market teams
              </motion.h1>
              <motion.p variants={reduceMotion ? undefined : landingItemMotion} className="mt-7 max-w-2xl text-lg leading-8 text-[#55534D]">
                Convert local-language news into verified market drafts with resolution criteria, source-backed analysis, and audit trails.
              </motion.p>
              <motion.div variants={reduceMotion ? undefined : landingItemMotion} className="mt-7 flex flex-wrap gap-2">
                <button type="button" onClick={onAnalyzeSource} className="primary-button pressable px-5">
                  <span className="inline-flex items-center justify-center gap-2">
                    Analyze source
                    <ArrowRight aria-hidden="true" size={15} />
                  </span>
                </button>
                <button type="button" onClick={onRunSampleArticle} className="secondary-button pressable px-5">
                  <span className="inline-flex items-center justify-center gap-2">
                    <Play aria-hidden="true" size={15} />
                    Run sample analysis
                  </span>
                </button>
              </motion.div>
            </motion.div>

            <MicrodemoCard reduceMotion={reduceMotion} />
          </motion.section>

          <WorkflowStrip reduceMotion={reduceMotion} />
        </motion.div>
      </main>
    </div>
  );
}

function WorkflowStrip({ reduceMotion }: { reduceMotion: boolean | null }) {
  return (
    <motion.nav
      variants={reduceMotion ? undefined : workflowSequenceMotion}
      aria-label="Workflow preview"
      className="grid gap-3 border-t border-[#E4E0D7] pt-5 sm:grid-cols-4"
    >
      {workflow.map((step, index) => (
        <motion.div
          key={step}
          variants={reduceMotion ? undefined : workflowItemMotion}
          className="group grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-3 rounded-md border border-transparent py-1.5 text-sm text-[#6B6962] transition-colors duration-200 hover:border-[#E4E0D7] hover:bg-white/45 sm:px-2"
        >
          <span className="grid size-7 place-items-center rounded-full bg-[#ECE8DF] text-xs font-semibold text-[#343330] transition-colors duration-200 group-hover:bg-[#191A1C] group-hover:text-white">
            {index + 1}
          </span>
          <span className="min-w-0 truncate font-medium">{step}</span>
        </motion.div>
      ))}
    </motion.nav>
  );
}

function MicrodemoCard({ reduceMotion }: { reduceMotion: boolean | null }) {
  const [activeStage, setActiveStage] = useState<number | null>(0);
  const [isRunning, setIsRunning] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [hasCompleted, setHasCompleted] = useState(false);
  const [validationCompletedCount, setValidationCompletedCount] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const typedSourceUrl = useTypedText(demoSourceUrl, {
    enabled: activeStage === 0,
    reduceMotion,
    replayKey: resetKey,
    startDelayMs: resetKey === 0 ? 520 : 120,
  });
  const showTypingCaret = activeStage === 0 && !reduceMotion && typedSourceUrl.length < demoSourceUrl.length;

  useEffect(() => {
    if (reduceMotion === null) {
      return undefined;
    }

    if (reduceMotion) {
      setActiveStage(0);
      setIsRunning(false);
      setHasCompleted(true);
      return undefined;
    }

    if (hasInteracted || hasCompleted) {
      return undefined;
    }

    setActiveStage(0);
    setIsRunning(false);
    let blinkTimer: number | undefined;
    const startDelayMs = resetKey === 0 ? microdemoReadingDelayMs : 0;
    const startTimer = window.setTimeout(() => {
      setActiveStage(null);

      blinkTimer = window.setTimeout(() => {
        setActiveStage(0);
        setIsRunning(true);
      }, microdemoStartBlinkMs);
    }, startDelayMs);

    return () => {
      window.clearTimeout(startTimer);

      if (blinkTimer !== undefined) {
        window.clearTimeout(blinkTimer);
      }
    };
  }, [hasCompleted, hasInteracted, reduceMotion, resetKey]);

  useEffect(() => {
    if (!isRunning || reduceMotion || activeStage === null) {
      return undefined;
    }

    const stageTimer = window.setTimeout(() => {
      if (activeStage >= 2) {
        setIsRunning(false);
        setHasCompleted(true);
        return;
      }

      setActiveStage((stage) => stage === null ? 0 : stage + 1);
    }, microdemoStageMs);

    return () => window.clearTimeout(stageTimer);
  }, [activeStage, isRunning, reduceMotion]);

  useEffect(() => {
    if (activeStage !== 1) {
      setValidationCompletedCount(activeStage !== null && activeStage > 1 ? validationSteps.length : 0);
      return undefined;
    }

    if (!isRunning || reduceMotion) {
      setValidationCompletedCount(reduceMotion ? validationSteps.length : 0);
      return undefined;
    }

    setValidationCompletedCount(0);
    const validationStepperWindowMs = microdemoStageMs * validationStepperCompletionRatio;
    const timers = validationSteps.map((_, index) => {
      const delay = Math.max(0, ((index + 1) * validationStepperWindowMs) / validationSteps.length);
      return window.setTimeout(() => {
        setValidationCompletedCount(index + 1);
      }, delay);
    });

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [activeStage, isRunning, reduceMotion]);

  const resetPreview = () => {
    setHasInteracted(false);
    setHasCompleted(false);
    setIsRunning(false);
    setActiveStage(0);
    setResetKey((key) => key + 1);
  };

  const selectStage = (stage: number) => {
    setActiveStage(stage);
    setIsRunning(false);
    setHasInteracted(true);
    setHasCompleted(false);
  };

  const stageMotion = (stage: number) => {
    const isActive = activeStage === stage;

    return reduceMotion
      ? {}
      : {
        animate: { height: isActive ? 'auto' : 58, opacity: activeStage === null || isActive ? 1 : 0.72 },
        transition: { duration: 0.34, ease: [0.23, 1, 0.32, 1] },
      };
  };

  const progressMotion = (stage: number) => reduceMotion || !isRunning || activeStage !== stage
    ? { animate: { scaleX: 0, opacity: 0 } }
    : {
      initial: { scaleX: 0, opacity: 1 },
      animate: { scaleX: 1, opacity: 1 },
      transition: { duration: microdemoStageSeconds, ease: 'linear' },
    };

  const statusLabel = hasCompleted ? 'Reset preview animation' : hasInteracted || reduceMotion ? 'Preview paused' : isRunning ? 'Preview running' : 'Preview starting';
  const StatusIcon = hasCompleted ? RotateCcw : hasInteracted || reduceMotion ? Pause : isRunning ? LoaderCircle : Clock3;
  const validationHeaderState = (activeStage !== null && activeStage > 1) || hasCompleted
    ? 'ok'
    : activeStage === 1
      ? validationCompletedCount === validationSteps.length
        ? 'ok'
        : 'working'
      : 'queued';

  return (
    <motion.article
      variants={reduceMotion ? undefined : landingItemMotion}
      className="w-full self-start overflow-hidden rounded-lg border border-[#DEDBD2] bg-white shadow-[0_24px_70px_rgba(29,28,24,0.08)] lg:mt-10"
    >
      <div className="border-b border-[#ECE8DF] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#8A877D]">Live preview</div>
            <div className="mt-1 text-sm font-medium text-[#242424]">Source to market artifact</div>
          </div>
          <button
            type="button"
            onClick={resetPreview}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-[#F1EFE7] text-[#5F5C53] hover:bg-[#E8E4DA] focus:outline-none focus:ring-2 focus:ring-[#B67332]/35"
            aria-label={statusLabel}
            title={statusLabel}
          >
            <motion.span
              aria-hidden="true"
              animate={isRunning && !hasInteracted && !reduceMotion ? { rotate: 360 } : { rotate: 0 }}
              transition={{ duration: 1.2, repeat: isRunning && !hasInteracted && !reduceMotion ? Infinity : 0, ease: 'linear' }}
              className="grid size-4 place-items-center"
            >
              <StatusIcon size={15} />
            </motion.span>
          </button>
        </div>
      </div>

      <LayoutGroup>
      <div className="relative grid gap-2 bg-[#F7F6F1]/55 p-3">
        <motion.div
          layout
          {...stageMotion(0)}
          className="relative overflow-hidden rounded-md border border-[#E7E3DA] bg-white"
        >
          <button
            type="button"
            onClick={() => selectStage(0)}
            className="flex h-[58px] w-full items-center gap-3 px-3 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#B67332]/35"
            aria-expanded={activeStage === 0}
          >
            <div className="grid size-8 shrink-0 place-items-center rounded-md bg-[#F1EFE7] text-[#343330]">
              <FileText aria-hidden="true" size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#8A877D]">Source snippet</div>
              <div className="truncate text-sm font-semibold text-[#252521]">Local-news claim detected</div>
            </div>
            <span className="shrink-0 rounded-full bg-[#F1EFE7] px-2 py-0.5 text-xs font-medium text-[#6B6962]">01</span>
          </button>
          <AnimatePresence initial={false}>
          {activeStage === 0 && (
            <motion.div
              key="source-preview"
              initial={reduceMotion ? false : { opacity: 0, y: -4 }}
              animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
              className="px-3 pb-3"
            >
              <div className="rounded-md bg-[#FBFAF7] p-3">
                <p className="text-sm font-semibold leading-5 text-[#252521]">
                  Laguna Verde CEOL terms agreed; ratification pending
                </p>
                <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-[#6B6962]">
                  <span className="size-1.5 shrink-0 rounded-full bg-[#B67332]" />
                  <span className="min-w-0 truncate" aria-label={demoSourceUrl}>
                    <span aria-hidden="true">{typedSourceUrl}</span>
                    {showTypingCaret && (
                      <motion.span
                        aria-hidden="true"
                        className="ml-0.5 inline-block h-3 w-px translate-y-0.5 bg-[#B67332]"
                        animate={{ opacity: [0, 1, 1, 0] }}
                        transition={{ duration: 0.78, repeat: Infinity, ease: 'linear' }}
                      />
                    )}
                  </span>
                </div>
              </div>
            </motion.div>
          )}
          </AnimatePresence>
          <motion.div
            key={`${resetKey}-0`}
            aria-hidden="true"
            {...progressMotion(0)}
            className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-[#B67332]"
          />
        </motion.div>

        <motion.div
          layout
          {...stageMotion(1)}
          className="relative overflow-hidden rounded-md border border-[#E7E3DA] bg-white"
        >
          <button
            type="button"
            onClick={() => selectStage(1)}
            className="flex h-[58px] w-full items-center gap-3 px-3 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#6D826E]/35"
            aria-expanded={activeStage === 1}
          >
            <div className="grid size-8 shrink-0 place-items-center rounded-md bg-[#F1EFE7] text-[#343330]">
              <ShieldCheck aria-hidden="true" size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#8A877D]">Validation</div>
              <div className="truncate text-sm font-semibold text-[#252521]">Extraction, context, schema</div>
            </div>
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              validationHeaderState === 'ok' ? 'bg-[#E8F0E9] text-[#2F6B48]' : 'bg-[#F1EFE7] text-[#4D4A43]'
            }`}>
              {validationHeaderState === 'ok' ? (
                <Check aria-hidden="true" size={11} strokeWidth={2.5} />
              ) : (
                <LoaderCircle aria-hidden="true" className={isRunning && activeStage === 1 && !reduceMotion ? 'animate-spin' : ''} size={11} />
              )}
              {validationHeaderState}
            </span>
          </button>
          <AnimatePresence initial={false}>
          {activeStage === 1 && (
            <motion.div
              key="validation-preview"
              initial={reduceMotion ? false : { opacity: 0, y: -4 }}
              animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
              className="px-3 pb-3"
            >
              <div className="relative grid gap-0">
                {validationSteps.map((step, index) => {
                  const Icon = step.icon;
                  const stepState = (activeStage !== null && activeStage > 1) || hasCompleted || index < validationCompletedCount
                    ? 'complete'
                    : activeStage === 1 && index === validationCompletedCount
                      ? 'working'
                      : 'pending';
                  const isComplete = stepState === 'complete';
                  const isWorking = stepState === 'working';
                  const isLast = index === validationSteps.length - 1;

                  return (
                    <motion.div
                      key={step.label}
                      initial={reduceMotion ? false : { opacity: 0, x: -8 }}
                      animate={reduceMotion ? undefined : { opacity: 1, x: 0 }}
                      transition={{ duration: 0.22, delay: reduceMotion ? 0 : index * 0.05, ease: [0.23, 1, 0.32, 1] }}
                      className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-2 px-1.5 py-1.5"
                    >
                      <div className="relative flex justify-center">
                        {!isLast && (
                          <span
                            aria-hidden="true"
                            className={`absolute left-1/2 top-5 h-[calc(100%+0.375rem)] w-px -translate-x-1/2 ${
                              isComplete ? 'bg-[#6D826E]' : 'bg-[#DDD8CE]'
                            }`}
                          />
                        )}
                        <div
                          className={`relative z-10 grid size-5 shrink-0 place-items-center rounded-full border ${
                            isComplete
                              ? 'border-[#6D826E] bg-[#6D826E] text-white'
                              : isWorking
                                ? 'border-[#343330] bg-white text-[#343330]'
                                : 'border-[#D8D3C8] bg-[#F7F6F1] text-[#8A877D]'
                          }`}
                        >
                          {isComplete ? (
                            <Check aria-hidden="true" size={12} strokeWidth={2.5} />
                          ) : isWorking ? (
                            <LoaderCircle aria-hidden="true" className={reduceMotion ? '' : 'animate-spin'} size={12} />
                          ) : (
                            <Icon aria-hidden="true" size={11} />
                          )}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-xs font-semibold leading-4 ${isWorking ? 'text-[#171717]' : 'text-[#2D2C28]'}`}>{step.label}</div>
                        <div className="truncate text-xs leading-4 text-[#77746B]">{step.detail}</div>
                      </div>
                      <div
                        className={`self-start rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-3 tracking-[0.06em] ${
                          isComplete
                            ? 'bg-[#E8F0E9] text-[#2F6B48]'
                            : isWorking
                              ? 'bg-[#F1EFE7] text-[#4D4A43]'
                              : 'bg-[#F7F6F1] text-[#8A877D]'
                        }`}
                      >
                        {stepState}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}
          </AnimatePresence>
          <motion.div
            key={`${resetKey}-1`}
            aria-hidden="true"
            {...progressMotion(1)}
            className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-[#6D826E]"
          />
        </motion.div>

        <motion.div
          layout
          {...stageMotion(2)}
          className="relative overflow-hidden rounded-md border border-[#DCD7CC] bg-[#191A1C] text-white shadow-[0_14px_36px_rgba(25,26,28,0.16)]"
        >
          <button
            type="button"
            onClick={() => selectStage(2)}
            className="flex h-[58px] w-full items-center gap-3 px-3 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#CFA36A]/40"
            aria-expanded={activeStage === 2}
          >
            <div className="grid size-8 shrink-0 place-items-center rounded-md bg-white/10 text-white">
              <Check aria-hidden="true" size={15} strokeWidth={2.5} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#C6C0B5]">Market artifact</div>
              <div className="truncate text-sm font-semibold text-white">Resolved question with criteria</div>
            </div>
            <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-[#F4F1EA]">final</span>
          </button>
          <AnimatePresence initial={false}>
          {activeStage === 2 && (
            <motion.div
              key="artifact-preview"
              initial={reduceMotion ? false : { opacity: 0, y: -4 }}
              animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
              className="px-3 pb-3"
            >
              <div className="rounded-md border border-white/10 bg-white/[0.06] p-3">
                <h2 className="text-sm font-semibold leading-5">
                  Will Chile officially ratify the Laguna Verde lithium CEOL before 2026-06-30?
                </h2>
                <div className="mt-2 grid gap-1.5 text-xs">
                  <div className="flex gap-2 rounded border border-white/10 bg-white/[0.08] px-2 py-1.5">
                    <div className="shrink-0 font-semibold text-[#F4F1EA]">YES</div>
                    <p className="min-w-0 truncate text-[#CFC8BB]">Government or Contraloria publishes ratification.</p>
                  </div>
                  <div className="flex gap-2 rounded border border-white/10 bg-white/[0.08] px-2 py-1.5">
                    <div className="shrink-0 font-semibold text-[#F4F1EA]">NO</div>
                    <p className="min-w-0 truncate text-[#CFC8BB]">No official publication by the deadline.</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
          </AnimatePresence>
          <motion.div
            key={`${resetKey}-2`}
            aria-hidden="true"
            {...progressMotion(2)}
            className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-[#CFA36A]"
          />
        </motion.div>
      </div>
      </LayoutGroup>
    </motion.article>
  );
}

function useTypedText(
  text: string,
  {
    enabled,
    reduceMotion,
    replayKey,
    startDelayMs = 360,
    characterDelayMs = 34,
  }: {
    enabled: boolean;
    reduceMotion: boolean | null;
    replayKey: number;
    startDelayMs?: number;
    characterDelayMs?: number;
  },
) {
  const [typedText, setTypedText] = useState(reduceMotion ? text : '');

  useEffect(() => {
    if (reduceMotion || !enabled) {
      setTypedText(text);
      return undefined;
    }

    setTypedText('');

    let currentCharacter = 0;
    let typeTimer: number | undefined;
    const startTimer = window.setTimeout(() => {
      typeTimer = window.setInterval(() => {
        currentCharacter += 1;
        setTypedText(text.slice(0, currentCharacter));

        if (currentCharacter >= text.length && typeTimer !== undefined) {
          window.clearInterval(typeTimer);
        }
      }, characterDelayMs);
    }, startDelayMs);

    return () => {
      window.clearTimeout(startTimer);

      if (typeTimer !== undefined) {
        window.clearInterval(typeTimer);
      }
    };
  }, [characterDelayMs, enabled, reduceMotion, replayKey, startDelayMs, text]);

  return typedText;
}
