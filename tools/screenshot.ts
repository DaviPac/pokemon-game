/**
 * Abre o jogo num Chromium com viewport de celular e salva screenshots.
 * Uso: npx tsx tools/screenshot.ts <url> <pasta-de-saida> [cenas...]
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';

const VIEWPORT = { width: 390, height: 844 }; // iPhone 14/15 em retrato

async function main(): Promise<void> {
  const url = process.argv[2] ?? 'http://localhost:5173/';
  const outDir = process.argv[3] ?? 'screenshots';
  const scenes = process.argv.slice(4);
  await mkdir(outDir, { recursive: true });

  // O ambiente ja traz um Chromium; nao tentamos baixar outro.
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const shot = async (name: string) => {
    await page.screenshot({ path: join(outDir, `${name}.png`) });
    console.log(`  ${name}.png`);
  };

  await shot('01-overworld');

  if (scenes.includes('walk')) {
    // Anda alguns passos para conferir a animacao e a camera.
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(1400);
    await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(400);
    await shot('02-walk');
  }

  if (scenes.includes('modes')) {
    for (const [index, mode] of ['legacy-dpad', 'legacy-stick', 'oldschool-dual', 'touch'].entries()) {
      await setMovementMode(page, mode);
      await page.waitForTimeout(900);
      await shot(`03-${index + 1}-${mode}`);
    }
    await setMovementMode(page, 'new');
  }

  if (scenes.includes('settings')) {
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.face-start')?.click();
    });
    await page.waitForTimeout(700);
    await shot('04-settings');
  }

  if (errors.length > 0) {
    console.log(`\nerros no console (${errors.length}):`);
    for (const err of errors.slice(0, 10)) console.log(`  - ${err}`);
  } else {
    console.log('\nsem erros no console');
  }

  await browser.close();
}

async function setMovementMode(page: Page, mode: string): Promise<void> {
  await page.evaluate((value) => {
    const raw = localStorage.getItem('pokedeluge:settings');
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    parsed.state = { ...parsed.state, movementMode: value };
    localStorage.setItem('pokedeluge:settings', JSON.stringify(parsed));
  }, mode);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
