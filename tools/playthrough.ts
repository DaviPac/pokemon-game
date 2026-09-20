/**
 * Faz um "playthrough" automatico no navegador para conferir o jogo de ponta a
 * ponta: novo jogo, escolha do inicial, caminhada ate a grama alta, encontro,
 * batalha e captura. Salva screenshots de cada etapa.
 *
 * Uso: npx tsx tools/playthrough.ts <url> <pasta-de-saida>
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';

const VIEWPORT = { width: 390, height: 844 };
const CHROMIUM =
  process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function main(): Promise<void> {
  const url = process.argv[2] ?? 'http://localhost:5173/';
  const outDir = process.argv[3] ?? 'screenshots';
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    // O ambiente de CI roda atras de um proxy com CA propria; sem isto os
    // sprites vindos do CDN nao carregam no navegador de teste.
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err).split('\n')[0]));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const shot = async (name: string) => {
    await page.screenshot({ path: join(outDir, `${name}.png`) });
    console.log(`  ${name}.png`);
  };

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot('10-novo-jogo');

  // Novo jogo: nome + inicial.
  await page.fill('#trainer-name', 'Davi');
  await page.click('.starter-card:nth-child(2)');
  await page.waitForTimeout(400);
  await shot('11-inicial-escolhido');
  await page.click('.primary-button');
  await page.waitForTimeout(3000);
  await shot('12-overworld');

  // Coloca o jogador no meio da grama da Rota 1: andar ate la a partir de
  // Pallet Town levaria minutos e nao e o que este teste quer verificar.
  await teleport(page, 'MAP_ROUTE1', 12, 20);
  await page.waitForTimeout(2500);

  // Sobe ate a Rota 1 e fica andando na grama ate aparecer um encontro.
  const battleAppeared = await walkUntilBattle(page, 60);
  if (!battleAppeared) {
    console.log('  (nenhum encontro nas tentativas — seguindo assim mesmo)');
  } else {
    await page.waitForTimeout(2200);
    await shot('13-batalha');

    // Abre o menu de golpes e ataca.
    await clickIfPresent(page, '.action-fight');
    await page.waitForTimeout(500);
    await shot('14-golpes');
    await clickIfPresent(page, '.move-button');
    await page.waitForTimeout(3200);
    await shot('15-depois-do-golpe');

    // Tenta capturar.
    await clickIfPresent(page, '.action-bag');
    await page.waitForTimeout(500);
    await shot('16-mochila');
    await clickIfPresent(page, '.bag-item');
    await page.waitForTimeout(5000);
    await shot('17-captura');
  }

  if (errors.length > 0) {
    console.log(`\nerros (${errors.length}):`);
    for (const err of [...new Set(errors)].slice(0, 8)) console.log(`  - ${err}`);
  } else {
    console.log('\nsem erros no console');
  }

  await browser.close();
}

/** Reescreve a posicao no save em IndexedDB e recarrega a pagina. */
async function teleport(page: Page, map: string, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ map, x, y }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('pokedeluge', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('saves', 'readwrite');
          const store = tx.objectStore('saves');
          const get = store.get('main');
          get.onsuccess = () => {
            const save = get.result;
            save.position = { map, x, y, dir: 'down' };
            store.put(save, 'main');
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    { map, x, y },
  );
  await page.reload({ waitUntil: 'networkidle' });
}

async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(120);
}

async function walkUntilBattle(page: Page, attempts: number): Promise<boolean> {
  // Na grama da Rota 1: anda para cima e para baixo ate cair um encontro.
  for (let i = 0; i < attempts; i++) {
    await hold(page, 'ArrowUp', 900);
    if (await page.locator('.battle').count()) return true;
    await hold(page, 'ArrowDown', 700);
    if (await page.locator('.battle').count()) return true;
  }
  return false;
}

async function clickIfPresent(page: Page, selector: string): Promise<void> {
  const element = page.locator(selector).first();
  if (await element.count()) await element.click({ timeout: 4000 }).catch(() => undefined);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
