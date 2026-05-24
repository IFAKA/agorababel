import { useEffect, useRef, useState } from 'react';
import { LOADING_MIN_VISIBLE_MS, LOADING_SHOW_DELAY_MS } from '../pipeline/presentationTiming';

export function useCallLoadingPresentation<T>(
  actualState: T,
  isLoadingState: (state: T) => boolean,
  getStateKey: (state: T) => string = String,
): T {
  const [visibleState, setVisibleState] = useState(actualState);
  const visibleStateRef = useRef(actualState);
  const loadingVisibleSinceRef = useRef<number | null>(isLoadingState(actualState) ? Date.now() : null);
  const isLoadingStateRef = useRef(isLoadingState);
  const getStateKeyRef = useRef(getStateKey);

  useEffect(() => {
    isLoadingStateRef.current = isLoadingState;
    getStateKeyRef.current = getStateKey;
  }, [getStateKey, isLoadingState]);

  useEffect(() => {
    const showState = (nextState: T) => {
      visibleStateRef.current = nextState;
      loadingVisibleSinceRef.current = isLoadingStateRef.current(nextState) ? Date.now() : null;
      setVisibleState(nextState);
    };

    const visibleLoading = isLoadingStateRef.current(visibleStateRef.current);
    const actualLoading = isLoadingStateRef.current(actualState);
    const sameState = getStateKeyRef.current(visibleStateRef.current) === getStateKeyRef.current(actualState);

    if (sameState) return;

    if (actualLoading && !visibleLoading) {
      const showTimer = window.setTimeout(() => showState(actualState), LOADING_SHOW_DELAY_MS);
      return () => window.clearTimeout(showTimer);
    }

    if (visibleLoading) {
      const visibleForMs = loadingVisibleSinceRef.current ? Date.now() - loadingVisibleSinceRef.current : 0;
      const remainingMs = Math.max(LOADING_MIN_VISIBLE_MS - visibleForMs, 0);

      if (remainingMs > 0) {
        const settleTimer = window.setTimeout(() => showState(actualState), remainingMs);
        return () => window.clearTimeout(settleTimer);
      }
    }

    showState(actualState);
  }, [actualState]);

  return visibleState;
}
