import type { PipelineRun } from './pipeline/types';

export function looksLikeUrl(value: string): boolean {
  return parseArticleUrl(value) !== null;
}

export function parseArticleUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

const socialUrlHosts = ['facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'tiktok.com', 'x.com', 'twitter.com'];

export function createSourceExcerpt(sourceInput: string, maxLength = 360) {
  const trimmed = sourceInput.trim().replace(/\s+/g, ' ');
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed || 'No source text available.';
}

export function getRunSourceExcerpt(run: PipelineRun): string {
  const text = run.extractedSource?.text ?? run.sourceInput;
  return createSourceExcerpt(text, 227);
}

export function getSubmittedSourceSummary(sourceText: string): { kind: string; text: string } {
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

export function isSocialUrlHost(hostname: string): boolean {
  const normalizedHost = hostname.toLowerCase().replace(/^www\./, '');
  return socialUrlHosts.some((host) => normalizedHost === host || normalizedHost.endsWith(`.${host}`));
}

export function isCommittedTrace(trace: PipelineRun['trace']) {
  return trace?.status === 'committed' && Boolean(trace.transactionId?.startsWith('0x')) && Boolean(trace.explorerUrl);
}

export function describeTraceForMemo(trace: PipelineRun['trace']) {
  if (!trace) return 'No trace prepared.';
  if (isCommittedTrace(trace)) {
    return `Committed on ${trace.network}: ${trace.transactionId}`;
  }
  return `Prepared local trace hash: ${trace.traceHash}`;
}

export function formatRejectedReason(rule: string) {
  const normalized = rule.toLowerCase();
  if (normalized === 'weak resolution') return 'Weak resolution source';
  if (normalized === 'subjective wording') return 'Subjective wording';
  if (normalized === 'no deadline') return 'Missing deadline';
  if (normalized === 'duplicate') return 'Duplicate risk';
  if (normalized === 'placeholder wording') return 'Placeholder wording';
  return 'Ambiguous market';
}
