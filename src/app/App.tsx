import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { LandingScreen } from './components/LandingScreen';
import { ProcessingScreen, type SubmissionHistoryItem } from './components/ProcessingScreen';
import { MarketScreen } from './components/MarketScreen';
import { AgoraBabelTraceMark } from './components/AgoraBabelTraceMark';
import { sampleArticle } from './sampleArticleData';
import { DEFAULT_MARKET_SLUG, getMarketPath, getMarketSlugFromPath, getPipelineRunSlug, hydratePipelineRunForSlug, persistCompletedPipelineRun } from './pipeline/artifactStorage';
import { ApiPipelineProvider, createSubmission, runAgentPipeline, SimulatedPipelineProvider, type PipelineProvider, type PipelineRun } from './pipeline';

export type Screen = 'landing' | 'create' | 'market';

const screenTitles: Record<Screen, string> = {
  landing: 'Operational Intelligence',
  create: 'Source Analysis',
  market: 'Validated Prediction-Market Artifact',
};

const screenOrder: Record<Screen, number> = {
  landing: 0,
  create: 1,
  market: 2,
};

const screenTransition = {
  duration: 0.38,
  ease: [0.23, 1, 0.32, 1],
} as const;

const splashSeenSessionKey = 'agorababel:splashSeen';

function getInitialScreen(): Screen {
  const path = window.location.pathname.replace(/\/$/, '') || '/';

  if (path === '/create') return 'create';
  if (path.startsWith('/markets/')) return 'market';

  return 'landing';
}

function shouldShowInitialSplash(initialScreen: Screen) {
  if (initialScreen !== 'landing') {
    return false;
  }

  try {
    return window.sessionStorage.getItem(splashSeenSessionKey) !== 'true';
  } catch {
    return true;
  }
}

function hasSeenInitialSplash() {
  try {
    return window.sessionStorage.getItem(splashSeenSessionKey) === 'true';
  } catch {
    return false;
  }
}

function markInitialSplashSeen() {
  try {
    window.sessionStorage.setItem(splashSeenSessionKey, 'true');
  } catch {
    // Session storage can be unavailable in hardened browser contexts.
  }
}

function createSubmissionHistoryItem(run: PipelineRun, activeRunId: string): SubmissionHistoryItem | null {
  const source = run.sourceInput || run.submission.sourceText;
  if (!source.trim() || !isFinishedSubmission(run)) return null;

  const title = run.acceptedMarket?.question
    ?? run.ingestion?.signalName
    ?? getSubmissionTitle(source);
  const detail = run.error
    ? run.error
    : run.status === 'complete'
      ? 'Artifact accepted and ready to open.'
      : getSubmittedSourceSummary(source);

  return {
    id: run.submission.id,
    title,
    detail,
    status: run.status,
    timestamp: run.updatedAt || run.submission.submittedAt,
    active: run.id === activeRunId,
  };
}

function isFinishedSubmission(run: PipelineRun) {
  return run.status === 'complete' || run.status === 'failed' || run.status === 'rejected';
}

function getSubmissionTitle(source: string) {
  const trimmed = source.trim();
  try {
    const url = new URL(trimmed);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return trimmed.replace(/\s+/g, ' ').slice(0, 72) || 'Submitted source';
  }
}

function getSubmittedSourceSummary(source: string) {
  const compact = source.trim().replace(/\s+/g, ' ');
  return compact.length > 118 ? `${compact.slice(0, 118)}...` : compact;
}

function getPathForScreen(screen: Screen) {
  if (screen === 'create') return '/create';
  if (screen === 'market') return getMarketPath();
  return '/';
}

export default function App() {
  const initialScreen = useMemo(getInitialScreen, []);
  const [currentScreen, setCurrentScreen] = useState<Screen>(initialScreen);
  const [sourceText, setSourceText] = useState('');
  const [runId, setRunId] = useState(0);
  const [showSplash, setShowSplash] = useState(() => shouldShowInitialSplash(initialScreen));
  const [splashSettling, setSplashSettling] = useState(false);
  const [pipelineRun, setPipelineRun] = useState<PipelineRun>(() =>
    initialScreen === 'market'
      ? hydratePipelineRunForSlug(getMarketSlugFromPath())
      : runAgentPipeline(createSubmission('')),
  );
  const [transitionDirection, setTransitionDirection] = useState(1);
  const [activePipelineProvider, setActivePipelineProvider] = useState<PipelineProvider | null>(null);
  const [submissionRuns, setSubmissionRuns] = useState<PipelineRun[]>([]);
  const currentScreenRef = useRef(currentScreen);
  const sampleRunTimerRef = useRef<number | null>(null);
  const reduceMotion = useReducedMotion();
  const apiPipelineProvider = useMemo(() => new ApiPipelineProvider(), []);
  const demoPipelineProvider = useMemo(() => new SimulatedPipelineProvider(), []);

  useEffect(() => {
    currentScreenRef.current = currentScreen;
  }, [currentScreen]);

  useEffect(() => {
    if (showSplash) {
      markInitialSplashSeen();
    }
  }, [showSplash]);

  useEffect(() => {
    if (!showSplash) {
      return undefined;
    }

    const settleTimer = window.setTimeout(() => {
      setSplashSettling(true);
    }, reduceMotion ? 450 : 1800);
    const splashTimer = window.setTimeout(() => {
      setShowSplash(false);
      setSplashSettling(false);
    }, reduceMotion ? 650 : 2300);

    return () => {
      window.clearTimeout(settleTimer);
      window.clearTimeout(splashTimer);
    };
  }, [reduceMotion, showSplash]);

  useEffect(() => {
    if (currentScreen !== 'landing') {
      setShowSplash(false);
      setSplashSettling(false);
      return;
    }

    if (!showSplash && !hasSeenInitialSplash()) {
      setShowSplash(true);
    }
  }, [currentScreen, showSplash]);

  useEffect(() => {
    const handlePopState = () => {
      const nextScreen = getInitialScreen();
      setTransitionDirection(screenOrder[nextScreen] >= screenOrder[currentScreenRef.current] ? 1 : -1);
      setCurrentScreen(nextScreen);
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    document.title = `${screenTitles[currentScreen]} | AgoraBabel`;
    const mainContent = document.getElementById('main-content');
    if (mainContent && document.activeElement instanceof HTMLButtonElement) {
      mainContent.focus({ preventScroll: true });
    }
  }, [currentScreen]);

  const handleNavigate = (screen: Screen) => {
    if (screen === currentScreenRef.current) {
      return;
    }

    window.history.pushState({}, '', getPathForScreen(screen));
    setTransitionDirection(screenOrder[screen] >= screenOrder[currentScreenRef.current] ? 1 : -1);
    setCurrentScreen(screen);
  };

  const handleOpenFinalArtifact = () => {
    if (pipelineRun.status !== 'complete' || !pipelineRun.acceptedMarket) {
      return;
    }

    const slug = pipelineRun.sourceInput === sampleArticle.sourceText ? DEFAULT_MARKET_SLUG : getPipelineRunSlug(pipelineRun);
    const path = getMarketPath(slug);
    persistCompletedPipelineRun(pipelineRun, slug);

    setPipelineRun(pipelineRun);
    window.history.pushState({}, '', path);
    setTransitionDirection(screenOrder.market >= screenOrder[currentScreenRef.current] ? 1 : -1);
    setCurrentScreen('market');
  };

  const handleBackToWorkflow = () => {
    window.history.pushState({}, '', getPathForScreen('create'));
    setTransitionDirection(screenOrder.create >= screenOrder[currentScreenRef.current] ? 1 : -1);
    setCurrentScreen('create');
  };

  const handleGenerateMarket = (input: string) => {
    if (sampleRunTimerRef.current !== null) {
      window.clearTimeout(sampleRunTimerRef.current);
      sampleRunTimerRef.current = null;
    }

    const submission = createSubmission(input);
    setSourceText(submission.sourceText);
    setPipelineRun(runAgentPipeline(submission));
    setActivePipelineProvider(apiPipelineProvider);
    setRunId((currentRunId) => currentRunId + 1);
    handleNavigate('create');
  };

  const handleSourceTextChange = (value: string) => {
    if (sampleRunTimerRef.current !== null) {
      window.clearTimeout(sampleRunTimerRef.current);
      sampleRunTimerRef.current = null;
    }

    setSourceText(value);

    if (pipelineRun.status !== 'running' && pipelineRun.status !== 'trace-committed') {
      setPipelineRun(runAgentPipeline(createSubmission(value)));
      setRunId(0);
    }
  };

  const handleRunSampleArticle = () => {
    const submission = createSubmission(sampleArticle.sourceText);

    if (sampleRunTimerRef.current !== null) {
      window.clearTimeout(sampleRunTimerRef.current);
      sampleRunTimerRef.current = null;
    }

    setSourceText(submission.sourceText);
    setPipelineRun(runAgentPipeline(submission));
    handleNavigate('create');
    setActivePipelineProvider(demoPipelineProvider);
    setRunId((currentRunId) => currentRunId + 1);
  };

  const handleNewAnalysis = () => {
    if (sampleRunTimerRef.current !== null) {
      window.clearTimeout(sampleRunTimerRef.current);
      sampleRunTimerRef.current = null;
    }

    setSourceText('');
    setPipelineRun(runAgentPipeline(createSubmission('')));
    setActivePipelineProvider(null);
    setRunId(0);
    handleNavigate('create');
  };

  const handleSelectSubmission = (submissionId: string) => {
    const selectedRun = submissionRuns.find((run) => run.submission.id === submissionId);
    if (!selectedRun) return;

    if (sampleRunTimerRef.current !== null) {
      window.clearTimeout(sampleRunTimerRef.current);
      sampleRunTimerRef.current = null;
    }

    setSourceText(selectedRun.sourceInput || selectedRun.submission.sourceText);
    setPipelineRun(selectedRun);
    setActivePipelineProvider(null);
    setRunId(selectedRun.status === 'idle' ? 0 : 1);
    handleNavigate('create');
  };

  useEffect(() => {
    if (runId === 0 || !activePipelineProvider) {
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();
    const runSourceText = sourceText;

    async function runPipeline() {
      const pipelineUpdates = activePipelineProvider.run({ sourceText: runSourceText, signal: abortController.signal });

      for await (const update of pipelineUpdates) {
        if (cancelled) {
          break;
        }

        setPipelineRun(update.run);
      }
    }

    runPipeline();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [runId, activePipelineProvider]);

  useEffect(() => {
    if (pipelineRun.status === 'complete' && pipelineRun.acceptedMarket) {
      const slug = getPipelineRunSlug(pipelineRun);
      persistCompletedPipelineRun(pipelineRun, slug);
      if (pipelineRun.sourceInput === sampleArticle.sourceText) {
        persistCompletedPipelineRun(pipelineRun, DEFAULT_MARKET_SLUG);
      }
    }
  }, [pipelineRun]);

  useEffect(() => {
    if (!pipelineRun.sourceInput.trim() || runId === 0) return;

    setSubmissionRuns((currentRuns) => {
      const existingIndex = currentRuns.findIndex((run) => run.submission.id === pipelineRun.submission.id);
      const nextRuns = existingIndex >= 0
        ? currentRuns.map((run, index) => (index === existingIndex ? pipelineRun : run))
        : [pipelineRun, ...currentRuns];

      return nextRuns
        .slice()
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
        .slice(0, 8);
    });
  }, [pipelineRun, runId]);

  useEffect(() => {
    if (currentScreen === 'market') {
      const hydratedRun = hydratePipelineRunForSlug(getMarketSlugFromPath());
      setPipelineRun(hydratedRun);
    }
  }, [currentScreen]);

  useEffect(() => {
    return () => {
      if (sampleRunTimerRef.current !== null) {
        window.clearTimeout(sampleRunTimerRef.current);
      }
    };
  }, []);

  const pageMotion = reduceMotion
    ? {
        initial: { opacity: 1, x: 0, y: 0 },
        animate: { opacity: 1, x: 0, y: 0 },
        exit: { opacity: 1, x: 0, y: 0 },
        transition: { duration: 0 },
      }
    : {
        initial: { opacity: 0, y: transitionDirection > 0 ? 10 : -6, scale: 0.992, filter: 'blur(5px)' },
        animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
        exit: { opacity: 0, y: transitionDirection > 0 ? -6 : 10, scale: 0.996, filter: 'blur(4px)' },
        transition: screenTransition,
      };
  const submissionHistory = useMemo(
    () => submissionRuns
      .map((run) => createSubmissionHistoryItem(run, pipelineRun.id))
      .filter((item): item is SubmissionHistoryItem => item !== null),
    [pipelineRun.id, submissionRuns],
  );

  return (
    <MotionConfig reducedMotion="user" transition={screenTransition}>
      <LayoutGroup id="app-shell">
        <div className="fixed inset-0 overflow-hidden text-[#191A1C]">
          <a href="#main-content" className="skip-link">
            Skip to content
          </a>
          <div className="app-shell relative mx-auto flex h-full min-h-0 w-full flex-col overflow-hidden">
            <div id="main-content" className="relative min-h-0 min-w-0 flex-1 overflow-hidden" tabIndex={-1}>
              <AnimatePresence mode="popLayout" custom={transitionDirection}>
                <motion.div
                  key={currentScreen}
                  className="absolute inset-0 min-h-0 min-w-0 overflow-hidden"
                  style={{ transformOrigin: '50% 18%' }}
                  {...pageMotion}
                >
                  {currentScreen === 'landing' && (
                    <LandingScreen
                      introActive={showSplash}
                      onAnalyzeSource={handleNewAnalysis}
                      onRunSampleArticle={handleRunSampleArticle}
                    />
                  )}
                  {currentScreen === 'create' && (
                    <ProcessingScreen
                      sourceText={sourceText}
                      onSourceTextChange={handleSourceTextChange}
                      runId={runId}
                      pipelineRun={pipelineRun}
                      onRunPipeline={handleGenerateMarket}
                      onOpenFinalArtifact={handleOpenFinalArtifact}
                      onNewAnalysis={handleNewAnalysis}
                      submissionHistory={submissionHistory}
                      onSelectSubmission={handleSelectSubmission}
                    />
                  )}
                  {currentScreen === 'market' && <MarketScreen pipelineRun={pipelineRun} onBackToWorkflow={handleBackToWorkflow} />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
          <AnimatePresence>
            {showSplash && <SplashScreen settling={splashSettling} />}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}

function SplashScreen({ settling }: { settling: boolean }) {
  const reduceMotion = useReducedMotion();
  const markRef = useRef<HTMLDivElement>(null);
  const wordmarkRef = useRef<HTMLDivElement>(null);
  const [handoffTransform, setHandoffTransform] = useState<{
    mark: { x: number; y: number; scale: number } | null;
    wordmark: { x: number; y: number; scale: number } | null;
  }>({ mark: null, wordmark: null });
  const traceEase = [0.23, 1, 0.32, 1] as const;

  useLayoutEffect(() => {
    if (!settling || reduceMotion) {
      return;
    }

    const getTransform = (source: HTMLElement | null, targetSelector: string) => {
      const target = document.querySelector<HTMLElement>(targetSelector);

      if (!source || !target) {
        return null;
      }

      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();

      return {
        x: targetRect.left - sourceRect.left,
        y: targetRect.top - sourceRect.top,
        scale: targetRect.width / sourceRect.width,
      };
    };

    setHandoffTransform({
      mark: getTransform(markRef.current, '[data-agorababel-mark-target]'),
      wordmark: getTransform(wordmarkRef.current, '[data-agorababel-wordmark-target]'),
    });
  }, [reduceMotion, settling]);

  return (
    <motion.div
      key="splash"
      aria-hidden="true"
      className="fixed inset-0 z-50 grid place-items-center overflow-hidden text-[#171717]"
      initial={{ opacity: 1 }}
      animate={settling && !reduceMotion ? { opacity: 1, backgroundColor: 'rgba(247, 246, 241, 0)' } : { opacity: 1, backgroundColor: '#F7F6F1' }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, filter: 'blur(8px)' }}
      transition={{ duration: reduceMotion ? 0.2 : 0.4, ease: traceEase }}
    >
      <motion.div
        className="relative grid h-56 w-[min(86vw,42rem)] place-items-center"
        initial={reduceMotion ? false : { opacity: 1 }}
        animate={reduceMotion ? undefined : { opacity: 1 }}
      >
        {!reduceMotion && (
          <motion.div
            ref={markRef}
            className="absolute top-[calc(50%-5.7rem)] grid size-20 place-items-center rounded-md border border-[#D8D3C8] bg-white text-[#191A1C]"
            initial={{ opacity: 0, y: 10, scale: 0.9, filter: 'blur(7px)' }}
            animate={
              settling && handoffTransform.mark
                ? { opacity: 1, x: handoffTransform.mark.x, y: handoffTransform.mark.y, scale: handoffTransform.mark.scale, filter: 'blur(0px)' }
                : { opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)' }
            }
            style={{ transformOrigin: '0 0' }}
            transition={{
              duration: settling ? 0.42 : 0.5,
              delay: settling ? 0 : 0.08,
              ease: traceEase,
            }}
          >
            <AgoraBabelTraceMark animated className="size-14" />
          </motion.div>
        )}

        <motion.div
          ref={wordmarkRef}
          className="relative mt-16 text-4xl font-semibold leading-none tracking-normal sm:text-6xl"
          initial={reduceMotion ? false : { opacity: 0, y: 12, filter: 'blur(8px)' }}
          animate={
            reduceMotion
              ? undefined
              : settling && handoffTransform.wordmark
                ? { opacity: 1, x: handoffTransform.wordmark.x, y: handoffTransform.wordmark.y, scale: handoffTransform.wordmark.scale, filter: 'blur(0px)' }
                : { opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)' }
          }
          style={{ transformOrigin: '0 0' }}
          transition={{
            duration: settling ? 0.42 : reduceMotion ? 0 : 0.58,
            delay: settling || reduceMotion ? 0 : 0.48,
            ease: traceEase,
          }}
        >
          AgoraBabel
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
