import { createHash } from 'node:crypto';

const MIN_ARTICLE_LENGTH = 120;
const MIN_URL_EXTRACTED_LENGTH = 600;

export type ExtractedSourceContent = {
  inputType: 'text' | 'url';
  title: string;
  url: string | null;
  domain: string | null;
  text: string;
  extractedTextHash: string;
};

export async function extractSource(input: string): Promise<ExtractedSourceContent> {
  const trimmed = input.trim();

  if (!looksLikeUrl(trimmed)) {
    if (trimmed.length < MIN_ARTICLE_LENGTH) {
      throw new Error('Paste at least 120 characters of article or source text.');
    }

    return {
      inputType: 'text',
      title: 'Pasted source text',
      url: null,
      domain: null,
      text: trimmed,
      extractedTextHash: sha256Hex(trimmed),
    };
  }

  const sourceUrl = new URL(trimmed);
  const readableText = await extractWithJinaReader(sourceUrl);

  if (!readableText || readableText.text.length < MIN_URL_EXTRACTED_LENGTH) {
    throw new Error('URL extraction failed: the readable source text was too short. Paste the article text or use a public readable URL.');
  }

  return {
    inputType: 'url',
    title: readableText.title,
    url: sourceUrl.href,
    domain: sourceUrl.hostname.replace(/^www\./, ''),
    text: readableText.text,
    extractedTextHash: sha256Hex(readableText.text),
  };
}

async function extractWithJinaReader(url: URL): Promise<{ title: string; text: string } | null> {
  const readerUrl = `https://r.jina.ai/http://${url.href.replace(/^https?:\/\//i, '')}`;
  const response = await fetch(readerUrl, {
    headers: {
      Accept: 'text/plain',
      'User-Agent': 'AgoraBabel-SaaS/2.0',
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

function looksLikeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
