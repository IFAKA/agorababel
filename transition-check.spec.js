import { test, expect } from '@playwright/test';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const sampleSource =
  'Diario Financiero Chile informa que el Ministerio de Mineria y Minera Laguna Verde acordaron los terminos de un CEOL para explotar litio en la zona de Laguna Verde, pero la ratificacion oficial del Gobierno y la toma de razon de Contraloria siguen pendientes. Funcionarios indicaron que el acuerdo podria publicarse antes del 2026-06-30 si se completa la revision administrativa. La fuente oficial de resolucion seria una publicacion del Gobierno de Chile o de la Contraloria General de la Republica en https://www.contraloria.cl/.';

test('sample and manual submissions produce equivalent openable artifacts', async ({ browser, request }) => {
  test.setTimeout(240000);
  const runtimeResponse = await request.get(`${baseUrl}/api/runtime-status`);
  const runtimeStatus = await runtimeResponse.json().catch(() => ({ status: 'not-ready' }));
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

  const sampleArtifact = await runSampleFlow(page);
  await verifyArtifactReload(browser, sampleArtifact.url);

  const manualArtifact = await runManualFlow(page);
  await verifyArtifactReload(browser, manualArtifact.url);

  expect(manualArtifact.url).toBe(sampleArtifact.url);
  expect(manualArtifact.title).toMatch(/CEOL/i);
  expect(manualArtifact.title).toMatch(/Laguna Verde/i);
  expect(sampleArtifact.title).toMatch(/CEOL/i);
  expect(sampleArtifact.title).toMatch(/Laguna Verde/i);
  expect(manualArtifact.proofStatus).toBe(sampleArtifact.proofStatus);
  expect(manualArtifact.accessStatus).toBe(sampleArtifact.accessStatus);

  if (runtimeResponse.ok() && runtimeStatus?.services?.x402?.status === 'configured') {
    expect(runtimeStatus.missing).toEqual([]);
    const liveAnalysis = await request.post(`${baseUrl}/api/analyze`, {
      data: { sourceText: sampleSource },
      timeout: 120000,
    });
    const liveArtifact = await liveAnalysis.json().catch(() => null);

    if (liveAnalysis.ok() && liveArtifact?.x402?.intelligenceUrl) {
      const unpaid = await request.get(`${baseUrl}${liveArtifact.x402.intelligenceUrl}`);
      expect(unpaid.status()).toBe(402);
      expect(unpaid.headers()['payment-required']).toBeTruthy();

      const unlock = await request.post(`${baseUrl}${liveArtifact.x402.demoUnlockUrl}`, { timeout: 120000 });
      const unlockPayload = await unlock.json().catch(() => null);
      expect(unlock.ok(), JSON.stringify(unlockPayload)).toBeTruthy();
      expect(unlockPayload?.status).toBe('unlocked');
      expect(unlockPayload?.receipt?.seller).toBe(liveArtifact.x402.payToAddress);
    }
  }

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

async function runSampleFlow(page) {
  await page.goto(baseUrl);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /Run sample analysis/i }).click();
  await expect(page).toHaveURL(/\/create$/);
  return openAndReadArtifact(page);
}

async function runManualFlow(page) {
  await page.goto(`${baseUrl}/create`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('textbox', { name: 'Source' }).fill(sampleSource);
  await page.getByRole('button', { name: /Run analysis/i }).click();
  return openAndReadArtifact(page);
}

async function openAndReadArtifact(page) {
  await expect(page.getByRole('button', { name: /Open artifact/i })).toBeEnabled({ timeout: 120000 });
  await expect(page.getByText('Validated artifact', { exact: true })).toBeVisible();
  await expect(page.getByText('YES', { exact: true })).toBeVisible();
  await expect(page.getByText('NO', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Open artifact/i }).click();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/markets\/chile-laguna-verde-ceol-ratification-2026$/);
  await expect(page.locator('article h1')).toBeVisible();
  await expect(page.getByText(/Original-language source:/)).toBeVisible();
  await expect(page.getByText('Official Source').first()).toBeVisible();
  await expect(page.getByText('Question Overlap Check').first()).toBeVisible();
  await expect(page.getByText('Test Wallet').first()).toBeVisible();
  await expect(page.getByText(/Arc Testnet Commit|Local Trace Prepared/).first()).toBeVisible();
  await expect(page.getByText('x402 Intelligence API').first()).toBeVisible();
  await expect(page.getByText('Candidate Markets Rejected').first()).toBeVisible();
  await expect(page.getByText('No persisted artifact')).toHaveCount(0);

  return {
    url: new URL(page.url()).pathname,
    title: (await page.locator('article h1').innerText()).trim(),
    proofStatus: (await page.getByText(/Arc Testnet Commit|Local Trace Prepared/).first().innerText()).trim(),
    accessStatus: (await page.getByText('x402 Intelligence API').first().locator('xpath=..').innerText()).replace(/\s+/g, ' ').trim(),
  };
}

async function verifyArtifactReload(browser, path) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}${path}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('article h1')).toBeVisible({ timeout: 12000 });
  await expect(page.getByText('No persisted artifact')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('article h1')).toBeVisible({ timeout: 12000 });
  await expect(page.getByText('No persisted artifact')).toHaveCount(0);
  await context.close();
}
