import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { LandingScreen } from './components/LandingScreen';
import { ProcessingScreen } from './components/ProcessingScreen';
import { MarketScreen } from './components/MarketScreen';
import { sampleArticle } from './sampleArticleData';
import { DEFAULT_MARKET_SLUG, getMarketPath, getMarketSlugFromPath, getPipelineRunSlug, hydratePipelineRunForSlug, persistCompletedPipelineRun } from './pipeline/artifactStorage';
import { ApiPipelineProvider, createSubmission, runAgentPipeline, type PipelineRun } from './pipeline';

export type Screen = 'landing' | 'create' | 'market';

const screenTitles: Record<Screen, string> = {
  landing: 'Intelligent Workflow',
  create: 'Source to Artifact',
  market: 'Final Market Artifact',
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

function getInitialScreen(): Screen {
  const path = window.location.pathname.replace(/\/$/, '') || '/';

  if (path === '/create') return 'create';
  if (path.startsWith('/markets/')) return 'market';

  return 'landing';
}

function getPathForScreen(screen: Screen) {
  if (screen === 'create') return '/create';
  if (screen === 'market') return getMarketPath();
  return '/';
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>(getInitialScreen);
  const [sourceText, setSourceText] = useState('');
  const [runId, setRunId] = useState(0);
  const [pipelineRun, setPipelineRun] = useState<PipelineRun>(() =>
    getInitialScreen() === 'market'
      ? hydratePipelineRunForSlug(getMarketSlugFromPath())
      : runAgentPipeline(createSubmission('')),
  );
  const [transitionDirection, setTransitionDirection] = useState(1);
  const currentScreenRef = useRef(currentScreen);
  const reduceMotion = useReducedMotion();
  const apiPipelineProvider = useMemo(() => new ApiPipelineProvider(), []);

  useEffect(() => {
    currentScreenRef.current = currentScreen;
  }, [currentScreen]);

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
    const slug = pipelineRun.sourceInput === sampleArticle.sourceText ? DEFAULT_MARKET_SLUG : getPipelineRunSlug(pipelineRun);
    const path = getMarketPath(slug);
    persistCompletedPipelineRun(pipelineRun, slug);
    const hydratedRun = pipelineRun.status === 'complete' && pipelineRun.acceptedMarket
      ? pipelineRun
      : hydratePipelineRunForSlug(slug);

    setPipelineRun(hydratedRun);
    window.history.pushState({}, '', path);
    setTransitionDirection(screenOrder.market >= screenOrder[currentScreenRef.current] ? 1 : -1);
    setCurrentScreen('market');
  };

  const handleGenerateMarket = (input: string) => {
    const submission = createSubmission(input);
    setSourceText(submission.sourceText);
    setPipelineRun(runAgentPipeline(submission));
    setRunId((currentRunId) => currentRunId + 1);
    handleNavigate('create');
  };

  const handleSourceTextChange = (value: string) => {
    setSourceText(value);

    if (pipelineRun.status !== 'running' && pipelineRun.status !== 'trace-committed') {
      setPipelineRun(runAgentPipeline(createSubmission(value)));
      setRunId(0);
    }
  };

  const handleRunSampleArticle = () => {
    handleGenerateMarket(sampleArticle.sourceText);
  };

  useEffect(() => {
    if (runId === 0) {
      return;
    }

    let cancelled = false;
    const runSourceText = sourceText;

    async function runPipeline() {
      const pipelineUpdates = apiPipelineProvider.run({ sourceText: runSourceText });

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
    };
  }, [runId, apiPipelineProvider]);

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
    if (currentScreen === 'market') {
      const hydratedRun = hydratePipelineRunForSlug(getMarketSlugFromPath());
      setPipelineRun(hydratedRun);

      if (!hydratedRun.acceptedMarket && runId === 0) {
        setSourceText(sampleArticle.sourceText);
        setRunId((currentRunId) => currentRunId + 1);
      }
    }
  }, [currentScreen, runId]);

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

  return (
    <MotionConfig reducedMotion="user" transition={screenTransition}>
      <div className="fixed inset-0 overflow-hidden text-[#191A1C]">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <div className="app-shell relative mx-auto flex h-full min-h-0 w-full flex-col overflow-hidden">
          <div id="main-content" className="relative min-h-0 min-w-0 flex-1 overflow-hidden" tabIndex={-1}>
            <AnimatePresence initial={false} mode="popLayout" custom={transitionDirection}>
              <motion.div
                key={currentScreen}
                className="absolute inset-0 min-h-0 min-w-0 overflow-hidden"
                style={{ transformOrigin: '50% 18%' }}
                {...pageMotion}
              >
                {currentScreen === 'landing' && (
                  <LandingScreen onNavigate={handleNavigate} />
                )}
                {currentScreen === 'create' && (
                  <ProcessingScreen
                    sourceText={sourceText}
                    onSourceTextChange={handleSourceTextChange}
                    runId={runId}
                    pipelineRun={pipelineRun}
                    onRunPipeline={handleGenerateMarket}
                    onNavigate={handleNavigate}
                    onOpenFinalArtifact={handleOpenFinalArtifact}
                    onRunSampleArticle={handleRunSampleArticle}
                  />
                )}
                {currentScreen === 'market' && <MarketScreen pipelineRun={pipelineRun} onRunSampleArticle={handleRunSampleArticle} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
