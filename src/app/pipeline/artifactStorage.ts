import { sampleArticle } from '../sampleArticleData';
import { createDemoArtifactRun, createPendingPipelineRun } from './simulatedProvider';
import type { PipelineRun } from './types';

const STORAGE_PREFIX = 'agorababel:pipelineRun:';
export const DEFAULT_MARKET_SLUG: string = sampleArticle.id;

export function getMarketSlugFromPath(pathname = window.location.pathname) {
  const match = pathname.match(/^\/markets\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : DEFAULT_MARKET_SLUG;
}

export function getMarketPath(slug = DEFAULT_MARKET_SLUG) {
  return `/markets/${encodeURIComponent(slug)}`;
}

export function getPipelineRunSlug(run: PipelineRun) {
  if (!run.acceptedMarket) return DEFAULT_MARKET_SLUG;
  return slugify(run.acceptedMarket.question) || run.acceptedMarket.id || DEFAULT_MARKET_SLUG;
}

export function persistCompletedPipelineRun(run: PipelineRun, slug = DEFAULT_MARKET_SLUG) {
  if (typeof window === 'undefined' || run.status !== 'complete' || !run.acceptedMarket) return;

  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${slug}`, JSON.stringify(run));
  } catch {
    // Persistence is best-effort; the bundled fallback keeps the submission route usable.
  }
}

export function hydratePipelineRunForSlug(slug: string): PipelineRun {
  const storedRun = readStoredPipelineRun(slug);
  if (storedRun) return storedRun;
  if (slug === DEFAULT_MARKET_SLUG) return createDemoArtifactRun();

  return createPendingPipelineRun('');
}

function readStoredPipelineRun(slug: string): PipelineRun | null {
  if (typeof window === 'undefined') return null;

  try {
    const rawValue = window.localStorage.getItem(`${STORAGE_PREFIX}${slug}`);
    if (!rawValue) return null;

    const parsed = JSON.parse(rawValue) as PipelineRun;
    if (parsed?.status === 'complete' && parsed.acceptedMarket) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140);
}
