import { test, expect } from '@playwright/test';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const redditUrl = 'https://www.reddit.com/r/lhdapodcast/comments/1tj1lk0/el_banco_central_de_la_rep%C3%BAblica_argentina_bcra/';

test.skip(process.env.RUN_REDDIT_URL_LIVE !== 'true', 'Set RUN_REDDIT_URL_LIVE=true to run the live Reddit URL validation.');

test('live Reddit URL either produces an artifact or fails cleanly at extraction', async ({ browser, request }) => {
  test.setTimeout(180000);

  const runtimeResponse = await request.get(`${baseUrl}/api/runtime-status`);
  const runtimeStatus = await runtimeResponse.json().catch(() => null);

  expect(
    runtimeResponse.ok(),
    `Runtime status must be ready before live URL validation. HTTP ${runtimeResponse.status()}: ${JSON.stringify(runtimeStatus)}`,
  ).toBeTruthy();
  expect(
    runtimeStatus?.status,
    `Runtime status must be ready before live URL validation: ${JSON.stringify(runtimeStatus)}`,
  ).toBe('ready');

  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('/api/runtime-status') && !text.includes('status of 503')) {
        errors.push(text);
      }
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`${baseUrl}/create`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Source analysis is ready.')).toBeVisible();

  await page.getByRole('textbox', { name: 'Source' }).fill(redditUrl);
  await expect(page.getByText(/Social URL accepted|URL accepted|Readable article URL accepted/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Run analysis/i })).toBeEnabled();

  await page.getByRole('button', { name: /Run analysis/i }).click();

  const openArtifactButton = page.getByRole('button', { name: /Open artifact/i });
  const stoppedState = page.getByText('Stopped', { exact: true });

  const outcome = await Promise.race([
    openArtifactButton.waitFor({ state: 'visible', timeout: 150000 }).then(() => 'success'),
    stoppedState.waitFor({ state: 'visible', timeout: 150000 }).then(() => 'failure'),
  ]);

  if (outcome === 'success') {
    await expect(openArtifactButton).toBeEnabled();
    console.log('reddit-url-result: success');

    await openArtifactButton.click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/markets\//);
    await expect(page.locator('article h1')).toBeVisible();
    await expect(page.getByText(/Original-language source:.*reddit\.com/i)).toBeVisible();

    const x402Status = runtimeStatus?.services?.x402?.status;
    const intelligenceUrl = await page
      .getByText(/\/api\/markets\/.+\/intelligence/)
      .first()
      .textContent()
      .catch(() => null);

    if (x402Status === 'configured' && intelligenceUrl) {
      const unpaid = await request.get(`${baseUrl}${intelligenceUrl.trim()}`);
      expect(unpaid.status()).toBe(402);
      expect(unpaid.headers()['payment-required']).toBeTruthy();
    }
  } else {
    console.log('reddit-url-result: extraction-blocked');
    await expect(page.getByText('AgoraBabel pipeline failure')).toBeVisible();
    await expect(page.getByText(/URL extraction failed|paste the post text|readable source text was too short|source could not be extracted/i).first()).toBeVisible();
    await expect(page.getByText(/source-extraction|Source Extraction/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /New analysis/i })).toBeEnabled();
    await expect(openArtifactButton).toHaveCount(0);
  }

  const unexpectedErrors = outcome === 'failure'
    ? errors.filter((text) => !text.includes('status of 422'))
    : errors;
  expect(unexpectedErrors).toEqual([]);
});
