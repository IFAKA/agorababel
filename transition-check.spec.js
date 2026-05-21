import { test, expect } from '@playwright/test';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:5173';

test('judge path runs the curated sample and opens a persisted honest artifact', async ({ browser, request }) => {
  test.setTimeout(120000);
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

  await page.getByRole('button', { name: /Run sample analysis/i }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole('button', { name: /Open artifact/i })).toBeEnabled({ timeout: 60000 });
  await expect(page.getByText('Validated artifact', { exact: true })).toBeVisible();
  await expect(page.getByText('YES', { exact: true })).toBeVisible();
  await expect(page.getByText('NO', { exact: true })).toBeVisible();
  await expect(page.getByText('Naive output vs AgoraBabel artifact').first()).toBeVisible();
  await expect(page.getByText('Will Chile approve the Laguna Verde lithium deal by June 30, 2026?').first()).toBeVisible();
  await expect(page.getByText(/terms agreed.*ratification still pending/i).first()).toBeVisible();
  await expect(page.getByText('Local trace prepared from the structured outputs. It is useful for demo review, but it is not an Arc Testnet commit proof.')).toBeVisible();

  await page.getByRole('button', { name: /Open artifact/i }).click();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/markets\/chile-laguna-verde-ceol-ratification-2026$/);
  await expect(page.locator('article h1').getByText(/Laguna Verde|CEOL|Chile/i)).toBeVisible();
  await expect(page.getByText(/Original-language source:/)).toBeVisible();
  await expect(page.getByText(/Spanish \/ Diario Financiero \/ Chile/)).toBeVisible();
  await expect(page.getByText('Naive output vs AgoraBabel artifact').first()).toBeVisible();
  await expect(page.getByText(/Official Government of Chile publication or Contraloria ratification/).first()).toBeVisible();
  await expect(page.getByText('Candidate Markets Rejected').first()).toBeVisible();
  await expect(page.getByText(/news coverage is downstream attention/i).first()).toBeVisible();
  await expect(page.getByText(/stock movement is not proof of official action/i).first()).toBeVisible();
  await expect(page.getByText(/company statement is weaker than official government publication/i).first()).toBeVisible();
  await expect(page.getByText('No persisted artifact')).toHaveCount(0);
  await expect(page.getByRole('article').getByText('Local Trace Prepared', { exact: true })).toBeVisible();
  await expect(page.getByRole('article').getByText('Local trace prepared from the structured outputs. It is useful for demo review, but it is not an Arc Testnet commit proof.')).toBeVisible();
  await expect(page.getByText('Disabled for this run')).toBeVisible();

  if (runtimeResponse.ok() && runtimeStatus?.services?.x402?.status === 'configured') {
    expect(runtimeStatus.missing).toEqual([]);
    const liveAnalysis = await request.post(`${baseUrl}/api/analyze`, {
      data: {
        sourceText:
          'Diario Financiero Chile informa que el Ministerio de Mineria y Minera Laguna Verde acordaron los terminos de un CEOL para explotar litio en la zona de Laguna Verde, pero la ratificacion oficial del Gobierno y la toma de razon de Contraloria siguen pendientes. Funcionarios indicaron que el acuerdo podria publicarse antes del 2026-06-30 si se completa la revision administrativa. La fuente oficial de resolucion seria una publicacion del Gobierno de Chile o de la Contraloria General de la Republica en https://www.contraloria.cl/.',
      },
      timeout: 90000,
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

  await page.reload();
  await expect(page.locator('article h1').getByText(/Laguna Verde|CEOL|Chile/i)).toBeVisible();
  await expect(page.getByText('No persisted artifact')).toHaveCount(0);

  const directContext = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const directPage = await directContext.newPage();
  await directPage.goto(`${baseUrl}/markets/chile-laguna-verde-ceol-ratification-2026`);
  await directPage.waitForLoadState('networkidle');
  await expect(directPage.locator('article h1').getByText(/Laguna Verde|CEOL|Chile/i)).toBeVisible({ timeout: 12000 });
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
