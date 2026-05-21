import { createHash } from 'node:crypto';

const MIN_ARTICLE_LENGTH = 120;
const MIN_URL_EXTRACTED_LENGTH = 600;
const MIN_SOCIAL_POST_LENGTH = 180;
const MAX_LINKED_SOURCES = 3;
const MAX_PRIMARY_TEXT_LENGTH = 12000;
const MAX_LINKED_SOURCE_LENGTH = 4500;
const MAX_EXTRACTED_TEXT_LENGTH = 24000;
const USER_AGENT = 'AgoraBabel-SaaS/2.0 (source extraction; contact: local-demo)';
const SOCIAL_HOSTS = ['reddit.com', 'x.com', 'twitter.com', 'linkedin.com', 'tiktok.com', 'facebook.com', 'instagram.com'];

export type ExtractedSourceContent = {
  inputType: 'text' | 'url';
  title: string;
  url: string | null;
  domain: string | null;
  outboundUrls: string[];
  text: string;
  extractedTextHash: string;
};

export async function extractSource(input: string): Promise<ExtractedSourceContent> {
  const trimmed = input.trim();

  if (!looksLikeUrl(trimmed)) {
    if (trimmed.length < MIN_ARTICLE_LENGTH) {
      throw new Error('Paste at least 120 characters of article or source text.');
    }

    const outboundUrls = extractOutboundUrls(trimmed);
    const linkedSources = await extractSupportingLinkedSources(outboundUrls);
    const text = appendSupportingSources(trimmed, linkedSources);

    return {
      inputType: 'text',
      title: 'Pasted source text',
      url: null,
      domain: null,
      outboundUrls: outboundUrls.map((url) => url.href),
      text,
      extractedTextHash: sha256Hex(text),
    };
  }

  const sourceUrl = new URL(trimmed);
  const domain = normalizeDomain(sourceUrl.hostname);
  const readableText = isSocialUrl(sourceUrl) ? await extractSocialUrl(sourceUrl) : await extractWithJinaReader(sourceUrl);
  const minimumTextLength = isSocialUrl(sourceUrl) ? MIN_SOCIAL_POST_LENGTH : MIN_URL_EXTRACTED_LENGTH;

  if (!readableText || readableText.text.length < minimumTextLength) {
    throw new Error(createExtractionFailureMessage(sourceUrl));
  }

  return {
    inputType: 'url',
    title: readableText.title,
    url: sourceUrl.href,
    domain,
    outboundUrls: extractOutboundUrls(readableText.text).map((url) => url.href),
    text: readableText.text,
    extractedTextHash: sha256Hex(readableText.text),
  };
}

type ReadableExtraction = {
  title: string;
  text: string;
};

async function extractSocialUrl(url: URL): Promise<ReadableExtraction | null> {
  const redditExtraction = isRedditUrl(url) ? await extractRedditJson(url) : null;
  const primary = redditExtraction ?? await extractSocialWithPublicMetadata(url);

  if (!primary) return null;

  const linkedSources = await extractSupportingLinkedSources(extractOutboundUrls(primary.text));
  const text = appendSupportingSources(primary.text, linkedSources);

  if (primary.text.length < MIN_SOCIAL_POST_LENGTH && (!isRedditUrl(url) || text.length < MIN_URL_EXTRACTED_LENGTH)) {
    return null;
  }

  return { title: primary.title, text };
}

async function extractWithJinaReader(url: URL): Promise<ReadableExtraction | null> {
  const readerUrl = `https://r.jina.ai/http://${url.href.replace(/^https?:\/\//i, '')}`;
  const response = await fetch(readerUrl, {
    headers: {
      Accept: 'text/plain',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) return null;

  const text = await response.text();
  const title = text.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || url.hostname.replace(/^www\./, '');
  const body = text
    .replace(/^Title:.*$/m, '')
    .replace(/^URL Source:.*$/m, '')
    .replace(/^Markdown Content:.*$/m, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return body ? { title, text: body } : null;
}

async function extractRedditJson(url: URL): Promise<ReadableExtraction | null> {
  const jsonUrl = new URL(url.href);
  jsonUrl.pathname = jsonUrl.pathname.replace(/\/?$/, '.json');
  jsonUrl.search = '';

  const response = await fetch(jsonUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) return null;

  const payload = await response.json().catch(() => null);
  const post = findRedditPost(payload);
  if (!post) return null;

  const title = cleanText(typeof post.title === 'string' ? post.title : '');
  const selftext = cleanText(typeof post.selftext === 'string' ? post.selftext : '');
  const subreddit = cleanText(typeof post.subreddit_name_prefixed === 'string' ? post.subreddit_name_prefixed : '');
  const author = cleanText(typeof post.author === 'string' ? post.author : '');
  const score = typeof post.score === 'number' ? post.score : null;
  const commentCount = typeof post.num_comments === 'number' ? post.num_comments : null;
  const outboundUrl = typeof post.url === 'string' && looksLikeUrl(post.url) && !isSameRedditUrl(url, post.url) ? post.url : '';

  const metadata = [
    subreddit ? `Subreddit: ${subreddit}` : '',
    author && author !== '[deleted]' ? `Author: u/${author}` : '',
    score !== null ? `Score: ${score}` : '',
    commentCount !== null ? `Comments: ${commentCount}` : '',
    outboundUrl ? `Outbound URL: ${outboundUrl}` : '',
  ].filter(Boolean);

  const text = [
    title ? `Reddit post title: ${title}` : '',
    selftext ? `Reddit post body:\n${selftext}` : '',
    metadata.length ? `Reddit metadata:\n${metadata.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  return title && text ? { title, text } : null;
}

async function extractSocialWithPublicMetadata(url: URL): Promise<ReadableExtraction | null> {
  const jinaExtraction = await extractWithJinaReader(url);
  if (jinaExtraction && jinaExtraction.text.length >= MIN_SOCIAL_POST_LENGTH) return jinaExtraction;

  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': USER_AGENT,
    },
  }).catch(() => null);

  if (!response?.ok) return null;

  const html = await response.text();
  const title = decodeHtmlEntities(extractMetaContent(html, 'og:title') || extractTitle(html) || normalizeDomain(url.hostname));
  const description = decodeHtmlEntities(extractMetaContent(html, 'og:description') || extractMetaContent(html, 'description') || '');
  const articleText = cleanText(`${title}\n\n${description}`);

  if (articleText.length < MIN_SOCIAL_POST_LENGTH) return null;
  return { title, text: articleText };
}

async function extractSupportingLinkedSources(urls: URL[]): Promise<ReadableExtraction[]> {
  const linkedSources: ReadableExtraction[] = [];

  for (const url of urls.slice(0, MAX_LINKED_SOURCES)) {
    const extraction = await extractWithJinaReader(url).catch(() => null);
    if (!extraction || extraction.text.length < MIN_ARTICLE_LENGTH) continue;

    linkedSources.push({
      title: extraction.title,
      text: extraction.text.slice(0, MAX_LINKED_SOURCE_LENGTH),
    });
  }

  return linkedSources;
}

function appendSupportingSources(primaryText: string, linkedSources: ReadableExtraction[]) {
  const sections = [primaryText.slice(0, MAX_PRIMARY_TEXT_LENGTH)];

  linkedSources.slice(0, MAX_LINKED_SOURCES).forEach((source, index) => {
    sections.push(`Supporting linked source ${index + 1}: ${source.title}\n\n${source.text.slice(0, MAX_LINKED_SOURCE_LENGTH)}`);
  });

  return sections.join('\n\n---\n\n').slice(0, MAX_EXTRACTED_TEXT_LENGTH).trim();
}

export const sourceExtractionTestInternals = {
  appendSupportingSources,
  findRedditPost,
};

export function extractOutboundUrls(text: string): URL[] {
  const urls = new Map<string, URL>();
  const matches = text.matchAll(/https?:\/\/[^\s<>"')\]}]+/gi);

  for (const match of matches) {
    const rawUrl = match[0].replace(/[.,;:!?]+$/g, '');

    try {
      const url = new URL(rawUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      const normalizedHref = normalizeUrlForDedupe(url);
      if (!urls.has(normalizedHref)) urls.set(normalizedHref, new URL(normalizedHref));
    } catch {
      continue;
    }
  }

  return Array.from(urls.values()).slice(0, MAX_LINKED_SOURCES);
}

function findRedditPost(payload: unknown): Record<string, unknown> | null {
  if (!Array.isArray(payload)) return null;
  const listing = payload[0] as Record<string, unknown> | undefined;
  const data = listing?.data as Record<string, unknown> | undefined;
  const children = data?.children;
  if (!Array.isArray(children)) return null;
  const firstChild = children[0] as Record<string, unknown> | undefined;
  const post = firstChild?.data;
  return post && typeof post === 'object' ? post as Record<string, unknown> : null;
}

function extractMetaContent(html: string, property: string) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${escapedProperty}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i');
  return html.match(pattern)?.[1]?.trim() ?? '';
}

function extractTitle(html: string) {
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? '';
}

function cleanText(value: string) {
  return decodeHtmlEntities(value)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function createExtractionFailureMessage(url: URL) {
  if (isSocialUrl(url)) {
    return 'URL extraction failed: this social URL could not be read publicly or did not expose enough post text. Paste the post text directly, including any linked article URL, and run analysis again.';
  }

  return 'URL extraction failed: the readable source text was too short. Paste the article text or use a public readable URL.';
}

function looksLikeUrl(value: string) {
  const trimmed = value.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return false;

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSocialUrl(url: URL) {
  const hostname = normalizeDomain(url.hostname);
  return SOCIAL_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function isRedditUrl(url: URL) {
  const hostname = normalizeDomain(url.hostname);
  return hostname === 'reddit.com' || hostname.endsWith('.reddit.com');
}

function isSameRedditUrl(sourceUrl: URL, candidate: string) {
  try {
    const candidateUrl = new URL(candidate);
    return isRedditUrl(candidateUrl) && candidateUrl.pathname.replace(/\/$/, '') === sourceUrl.pathname.replace(/\/$/, '');
  } catch {
    return false;
  }
}

function normalizeDomain(hostname: string) {
  return hostname.replace(/^www\./, '').toLowerCase();
}

function normalizeUrlForDedupe(url: URL) {
  const normalized = new URL(url.href);
  normalized.hash = '';
  normalized.hostname = normalized.hostname.toLowerCase();
  return normalized.href.replace(/\/$/, '');
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
