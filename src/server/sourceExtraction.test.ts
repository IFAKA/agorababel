import assert from 'node:assert/strict';
import test from 'node:test';
import { extractOutboundUrls, extractSource, sourceExtractionTestInternals } from './sourceExtraction.ts';

const redditUrl = 'https://www.reddit.com/r/test/comments/abc123/example_post/';

test('extracts Reddit JSON post text, metadata, and linked source context', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.endsWith('/example_post.json')) {
      return jsonResponse([
        {
          data: {
            children: [
              {
                data: {
                  title: 'Central bank vote expected before deadline',
                  selftext: 'Officials said the public resolution will be posted before 2026-08-20. Background: https://example.com/article',
                  subreddit_name_prefixed: 'r/test',
                  author: 'analyst',
                  score: 42,
                  num_comments: 7,
                  url: 'https://example.com/article',
                },
              },
            ],
          },
        },
      ]);
    }

    if (url === 'https://r.jina.ai/http://example.com/article') {
      return textResponse(`Title: Linked report
URL Source: https://example.com/article
Markdown Content:
${'The linked report confirms the official publication timeline. '.repeat(18)}`);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const source = await extractSource(redditUrl);

    assert.equal(source.inputType, 'url');
    assert.equal(source.domain, 'reddit.com');
    assert.equal(source.url, redditUrl);
    assert.match(source.text, /Reddit post title: Central bank vote expected/);
    assert.match(source.text, /Subreddit: r\/test/);
    assert.match(source.text, /Author: u\/analyst/);
    assert.match(source.text, /Supporting linked source 1: Linked report/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fails cleanly when Reddit JSON and public extraction do not expose post text', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.endsWith('/example_post.json')) {
      return jsonResponse([{ data: { children: [] } }]);
    }

    if (url.startsWith('https://r.jina.ai/')) {
      return textResponse('Title: Reddit\n\nMarkdown Content:\n');
    }

    if (url === redditUrl) {
      return textResponse('<html><head><meta property="og:title" content="Blocked"></head></html>');
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    await assert.rejects(
      () => extractSource(redditUrl),
      /social URL could not be read publicly|Paste the post text directly/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extracts outbound URLs once and limits linked fetch candidates', () => {
  const urls = extractOutboundUrls(
    'https://example.com/a https://example.com/a#section https://b.test/path, https://c.test/x https://d.test/y',
  );

  assert.deepEqual(urls.map((url) => url.href), [
    'https://example.com/a',
    'https://b.test/path',
    'https://c.test/x',
  ]);
});

test('treats pasted source text containing URLs as text input', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url === 'https://r.jina.ai/http://example.com/story') {
      return textResponse(`Title: Linked context
URL Source: https://example.com/story
Markdown Content:
${'Supporting source text. '.repeat(40)}`);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const source = await extractSource(`Post text to analyze first.
https://example.com/story
${'The pasted article body contains enough detail to be analyzed as text. '.repeat(4)}`);

    assert.equal(source.inputType, 'text');
    assert.equal(source.url, null);
    assert.match(source.text, /Post text to analyze first/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('caps primary and supporting linked context before LLM input', () => {
  const text = sourceExtractionTestInternals.appendSupportingSources(
    'Primary. '.repeat(500),
    [
      { title: 'One', text: 'Linked one. '.repeat(1000) },
      { title: 'Two', text: 'Linked two. '.repeat(1000) },
      { title: 'Three', text: 'Linked three. '.repeat(1000) },
      { title: 'Four', text: 'Linked four. '.repeat(1000) },
    ],
  );

  assert.ok(text.length <= 24000);
  assert.match(text, /Supporting linked source 1: One/);
  assert.match(text, /Supporting linked source 3: Three/);
  assert.doesNotMatch(text, /Supporting linked source 4: Four/);
});

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}
