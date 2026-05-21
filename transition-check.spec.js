import { test, expect } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:5173';

test('judge path runs the curated sample and opens a persisted honest artifact', async ({ browser, request }) => {
  test.setTimeout(120000);
  const runtimeResponse = await request.get(`${baseUrl}/api/runtime-status`);
  const runtimeStatus = await runtimeResponse.json().catch(() => ({ status: 'not-ready' }));
  const runtimeReady = runtimeStatus.status === 'ready';
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

  await page.goto(baseUrl);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Operational intelligence for prediction-market teams' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Analyze source$/i })).toHaveCount(1);

  await page.getByRole('button', { name: /Run sample analysis/i }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole('button', { name: /Open artifact/i })).toBeEnabled({ timeout: 60000 });
  await expect(page.getByText('Validated artifact', { exact: true })).toBeVisible();
  await expect(page.getByText('YES', { exact: true })).toBeVisible();
  await expect(page.getByText('NO', { exact: true })).toBeVisible();

  if (runtimeReady) {
    await expect(page.getByText(/Committed transaction 0x[a-f0-9]{64}/i)).toBeVisible();
  } else {
    await expect(page.getByText('Local trace prepared from the structured outputs. It is useful for demo review, but it is not an Arc Testnet commit proof.')).toBeVisible();
  }

  await page.getByRole('button', { name: /Open artifact/i }).click();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/markets\/turkey-emergency-rate-intervention-2026$/);
  await expect(page.getByRole('article').getByRole('heading', { name: /Turkey|Turkish|TCMB|central-bank|central bank/i })).toBeVisible();
  await expect(page.getByText(/Original-language source:/)).toBeVisible();
  await expect(page.getByText('Candidate Markets Rejected').first()).toBeVisible();
  await expect(page.getByText('No persisted artifact')).toHaveCount(0);

  if (runtimeReady) {
    await expect(page.getByText('Circle Wallet')).toBeVisible();
    await expect(page.getByText(/ready \/ ARC-TESTNET/i)).toBeVisible();
    await expect(page.getByText('Arc Testnet Commit')).toBeVisible();
    await expect(page.getByText(/0x[a-f0-9]{64}/i).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Arcscan/i })).toBeVisible();
  } else {
    await expect(page.getByRole('article').getByText('Local Trace Prepared', { exact: true })).toBeVisible();
    await expect(page.getByRole('article').getByText('Local trace prepared from the structured outputs. It is useful for demo review, but it is not an Arc Testnet commit proof.')).toBeVisible();
    await expect(page.getByText('Disabled for this run')).toBeVisible();
  }

  await page.reload();
  await expect(page.getByRole('article').getByRole('heading', { name: /Turkey|Turkish|TCMB|central-bank|central bank/i })).toBeVisible();
  await expect(page.getByText('No persisted artifact')).toHaveCount(0);

  const directContext = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const directPage = await directContext.newPage();
  await directPage.goto(`${baseUrl}/markets/turkey-emergency-rate-intervention-2026`);
  await directPage.waitForLoadState('networkidle');
  await expect(directPage.getByRole('article').getByRole('heading', { name: /Turkey|Turkish|TCMB|central-bank|central bank/i })).toBeVisible({ timeout: 12000 });
  await expect(directPage.getByText('No persisted artifact')).toHaveCount(0);
  await directContext.close();

  await page.goto(`${baseUrl}/create`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Source analysis is ready.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Source' }).fill(
    'El Ministerio de Energia de Mexico informo que publicara una decision oficial sobre nuevos aranceles electricos antes del 2026-08-20. Funcionarios del ministerio dijeron que la resolucion aparecera en el boletin oficial y que podria aprobar o rechazar la medida propuesta.',
  );
  await expect(page.getByRole('button', { name: /Run analysis/i })).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/create`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Source analysis is ready.')).toBeVisible();
  await expect(page.locator('#main-content')).toBeVisible();

  const reducePage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  await reducePage.goto(`${baseUrl}/create`);
  await reducePage.waitForLoadState('networkidle');
  await expect(reducePage.getByText('Source analysis is ready.')).toBeVisible();
  await reducePage.close();

  expect(errors).toEqual([]);
});
