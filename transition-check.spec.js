import { test, expect } from '@playwright/test';

test('judge path loads, runs the sample, persists the artifact, and shows local trace status', async ({ browser }) => {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Intelligence that unfolds into a decision.' })).toBeVisible();
  await page.getByRole('button', { name: /Start on \/create/i }).click();
  await expect(page).toHaveURL(/\/create$/);

  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Watch one source become one market.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Source' })).toBeVisible();
  await expect(page.getByText('The workflow is waiting for a source.')).toBeVisible();
  await expect(page.getByText('Final output panel')).toHaveCount(0);
  await expect(page.getByText('Local trace hash panel')).toHaveCount(0);
  await expect(page.getByText('Activity feed')).toHaveCount(0);

  await page.getByRole('button', { name: /Use sample source/i }).click();
  await expect(page.getByRole('button', { name: /Open final artifact/i })).toBeEnabled({ timeout: 8000 });
  await expect(page.getByText('Finalized artifact', { exact: true })).toBeVisible();
  await expect(page.getByText('YES', { exact: true })).toBeVisible();
  await expect(page.getByText('NO', { exact: true })).toBeVisible();
  await expect(page.getByText('Local trace hash, Arc commit pending')).toBeVisible();
  await expect(page.getByRole('button', { name: /Copy/i })).toBeEnabled();

  await page.getByRole('button', { name: /Open final artifact/i }).click();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/markets\/turkey-emergency-rate-intervention-2026$/);
  await expect(page.getByRole('article').getByRole('heading', { name: /Turkey|Turkish|TCMB|central-bank|central bank/i })).toBeVisible();
  await expect(page.getByText(/Original language source:/)).toBeVisible();
  await expect(page.getByText('Rejected candidate markets')).toBeVisible();
  await expect(page.getByText('Arc status')).toBeVisible();
  await expect(page.getByText('Arc commit pending.')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('article').getByRole('heading', { name: /Turkey|Turkish|TCMB|central-bank|central bank/i })).toBeVisible();
  await expect(page.getByText('Arc commit pending.')).toBeVisible();

  const directContext = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const directPage = await directContext.newPage();
  await directPage.goto('http://127.0.0.1:5173/markets/turkey-emergency-rate-intervention-2026');
  await directPage.waitForLoadState('networkidle');
  await expect(directPage.getByRole('article').getByRole('heading', { name: /Turkey|Turkish|TCMB|central-bank|central bank/i })).toBeVisible({ timeout: 12000 });
  await expect(directPage.getByText('Arc commit pending.')).toBeVisible();
  await directContext.close();

  await page.goto('http://127.0.0.1:5173/create');
  await page.waitForLoadState('networkidle');
  await page.getByRole('textbox', { name: 'Source' }).fill(
    'El Ministerio de Energia de Mexico informo que publicara una decision oficial sobre nuevos aranceles electricos antes del 2026-08-20. Funcionarios del ministerio dijeron que la resolucion aparecera en el boletin oficial y que podria aprobar o rechazar la medida propuesta.',
  );
  await page.getByRole('button', { name: /Analyze source/i }).click();
  await expect(page.getByRole('button', { name: /Open final artifact/i })).toBeEnabled({ timeout: 8000 });
  await expect(page.getByText('Local trace hash, Arc commit pending')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:5173/create');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Watch one source become one market.' })).toBeVisible();
  await expect(page.locator('#main-content')).toBeVisible();

  const reducePage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  await reducePage.goto('http://127.0.0.1:5173/create');
  await reducePage.waitForLoadState('networkidle');
  await expect(reducePage.getByRole('heading', { name: 'Watch one source become one market.' })).toBeVisible();
  await reducePage.close();

  expect(errors).toEqual([]);
});
