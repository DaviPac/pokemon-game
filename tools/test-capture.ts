/**
 * Confere o fim de batalha e o que ele deixa para tras: a musica certa tocando,
 * a tela da captura, a barra inferior fora do caminho dos botoes e o sprite de
 * corrida.
 *
 * Usa os ganchos `window.__overworld`, `__game` e `__audio`, que so existem em
 * desenvolvimento -- entao aponte para o servidor `npm run dev`.
 *
 * Uso: npx tsx tools/test-capture.ts <url> <pasta-de-saida>
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
// Declara os ganchos de desenvolvimento no `window`.
import './lib/hooks.js';

const VIEWPORT = { width: 390, height: 844 };
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function main(): Promise<void> {
  const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
  const outDir = process.argv[3] ?? 'screenshots';
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    // O ambiente roda atras de um proxy com CA propria; sem isto os sprites
    // vindos do CDN nao carregam no navegador de teste.
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

  let failures = 0;
  const check = (label: string, ok: boolean, detail = '') => {
    console.log(`  ${ok ? 'ok  ' : 'FALHOU'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
  };
  const shot = async (name: string) => {
    await page.screenshot({ path: join(outDir, `${name}.png`) });
    console.log(`  ${name}.png`);
  };
  const playing = () => page.evaluate(() => window.__audio?.nowPlaying ?? null);

  try {
    console.log('\n1. novo jogo');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    await startNewGame(page);
    await page.waitForTimeout(2200);

    // --- Barra inferior x botoes ------------------------------------------
    console.log('\n2. a barra inferior nao cobre botao nenhum');
    await openSettings(page);
    const sheetButtons = page.locator('.sheet-body button');
    const last = sheetButtons.nth((await sheetButtons.count()) - 1);
    await last.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    check('ultimo botao das configuracoes clicavel', await isClear(page, last));
    await shot('01-configuracoes-fim');

    // Os controles classicos sao os que encostam no rodape do mapa.
    await page.locator('.option', { hasText: 'Classico (direcional)' }).first().click();
    await page.waitForTimeout(300);
    await page.locator('.sheet-backdrop').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);
    await page.locator('.nav-item', { hasText: 'Mapa' }).first().click();
    await page.waitForTimeout(900);
    check('botao A acima da barra', await isClear(page, '.face-a'));
    check('direcional acima da barra', await isClear(page, '.dpad-down'));
    check('botao de menu acima da barra', await isClear(page, '.face-start'));
    await shot('02-mapa-controles');

    // --- Sprite de corrida --------------------------------------------------
    console.log('\n3. correr tem sprite proprio');
    await teleport(page, 'MAP_ROUTE1', 12, 24);
    await page.waitForTimeout(1600);
    const walking = await playerCrop(page, 'ArrowDown', false);
    const running = await playerCrop(page, 'ArrowDown', true);
    check('quadro de corrida diferente do de caminhada', walking !== running);

    // --- Captura ------------------------------------------------------------
    console.log('\n4. captura: musica, tela e volta ao mapa');
    await page.evaluate(() => window.__game?.getState().addItem('masterball', 5));
    const battled = await walkUntilBattle(page, 30);
    check('encontro selvagem apareceu', battled);
    if (!battled) throw new Error('sem encontro para testar a captura');

    await page.waitForTimeout(3200);
    check('tema de batalha tocando', (await playing())?.startsWith('mus_vs') === true, `${await playing()}`);

    await page.locator('.action-bag').click();
    await page.waitForTimeout(500);
    await page.locator('.bag-item', { hasText: 'Master Ball' }).first().click();
    await page.waitForTimeout(6500);

    const caughtVisible = await page
      .locator('.caught-screen')
      .waitFor({ state: 'visible', timeout: 12_000 })
      .then(() => true)
      .catch(() => false);
    check('tela de captura apareceu', caughtVisible);
    if (caughtVisible) {
      await page.waitForTimeout(900);
      await shot('03-tela-de-captura');
      check('tema da captura tocando', (await playing()) === 'mus_caught', `${await playing()}`);
      check('barra inferior escondida na captura', (await page.locator('.bottom-nav').count()) === 0);
    }

    await page.locator('.caught-continue').click();
    await page.waitForTimeout(2500);
    const afterSong = await playing();
    check('volta ao mapa', (await page.locator('.overworld-canvas').count()) > 0);
    check(
      'musica do mapa de volta, sem tema de batalha',
      afterSong !== null && !afterSong.startsWith('mus_vs') && afterSong !== 'mus_caught',
      `tocando=${afterSong}`,
    );
    await shot('04-de-volta-ao-mapa');

    // --- Vitoria ------------------------------------------------------------
    console.log('\n5. vitoria espera o tema antes de sair');
    // A equipe saiu machucada da captura anterior; sem isto o teste perde a luta.
    await page.evaluate(() => window.__game?.getState().healParty());
    const second = await walkUntilBattle(page, 30);
    check('segundo encontro apareceu', second);
    if (second) {
      await page.waitForTimeout(3000);
      for (let i = 0; i < 20; i++) {
        if (await page.locator('.battle-continue').count()) break;
        if ((await page.locator('.battle').count()) === 0) break;
        await page.locator('.action-fight').click({ timeout: 2000 }).catch(() => undefined);
        await page.waitForTimeout(400);
        // Golpe de dano: com um golpe de status a batalha nunca termina.
        const attack = page
          .locator('.move-button')
          .filter({ hasNot: page.locator('.move-cat', { hasText: 'Status' }) })
          .first();
        await attack.click({ timeout: 2000 }).catch(() => undefined);
        await page.waitForTimeout(2600);
      }
      const waited = await page.locator('.battle-continue').count();
      check(
        'batalha segura a tela com o tema de vitoria',
        waited > 0,
        waited > 0 ? '' : `batalha na tela=${await page.locator('.battle').count()}`,
      );
      if (waited === 0) await shot('05-vitoria-falhou');
      if (waited > 0) {
        check('tema de vitoria tocando', (await playing())?.startsWith('mus_victory') === true, `${await playing()}`);
        await shot('05-vitoria');
        await page.locator('.battle-continue').click();
        await page.waitForTimeout(2200);
        const back = await playing();
        check(
          'depois da vitoria volta a musica do mapa',
          back !== null && !back.startsWith('mus_vs') && !back.startsWith('mus_victory'),
          `tocando=${back}`,
        );
      }
    }
  } finally {
    await browser.close();
  }

  if (errors.length > 0) {
    console.log(`\nerros no console (${errors.length}):`);
    for (const err of [...new Set(errors)].slice(0, 6)) console.log(`  - ${err}`);
  }
  console.log(failures === 0 ? '\ntudo certo' : `\n${failures} verificacao(oes) falharam`);
  process.exit(failures === 0 ? 0 : 1);
}

/** True quando o elemento recebe o clique -- e nao algo por cima dele. */
async function isClear(page: Page, target: string | ReturnType<Page['locator']>): Promise<boolean> {
  const locator = typeof target === 'string' ? page.locator(target) : target;
  if ((await locator.count()) === 0) return false;
  const box = await locator.first().boundingBox();
  if (!box) return false;
  return page.evaluate(
    ({ x, y }) => {
      const top = document.elementFromPoint(x, y);
      return top instanceof Element && !top.closest('.bottom-nav');
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
}

/** Recorta o jogador no meio da tela para comparar um quadro com outro. */
async function playerCrop(page: Page, key: string, run: boolean): Promise<string> {
  if (run) await page.keyboard.down('Shift');
  await page.keyboard.down(key);
  await page.waitForTimeout(190);
  const buffer = await page.screenshot({
    clip: { x: VIEWPORT.width / 2 - 28, y: VIEWPORT.height / 2 - 40, width: 56, height: 70 },
  });
  await page.keyboard.up(key);
  if (run) await page.keyboard.up('Shift');
  await page.waitForTimeout(500);
  return buffer.toString('base64');
}

/** Configuracoes ficam na aba Perfil; o mapa nao tem botao proprio em todo modo. */
async function openSettings(page: Page): Promise<void> {
  await page.locator('.nav-item', { hasText: 'Perfil' }).first().click();
  await page.waitForTimeout(800);
  await page.locator('.secondary-button', { hasText: 'Configuracoes' }).first().click();
  await page.waitForTimeout(800);
}

async function teleport(page: Page, map: string, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ map, x, y }) => window.__overworld?.swapTo(map, x, y, 'down'),
    { map, x, y },
  );
}

async function walkUntilBattle(page: Page, attempts: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    for (const key of ['ArrowUp', 'ArrowDown']) {
      await page.keyboard.down(key);
      await page.waitForTimeout(900);
      await page.keyboard.up(key);
      await page.waitForTimeout(120);
      if (await page.locator('.battle').count()) return true;
    }
  }
  return false;
}

async function startNewGame(page: Page): Promise<void> {
  await page.locator('.title-action').first().click();
  await page.waitForTimeout(900);
  for (let i = 0; i < 6; i++) {
    await page.locator('.intro-scene').click().catch(() => undefined);
    await page.waitForTimeout(340);
  }
  await page.fill('#trainer-name', 'Davi');
  await page.locator('.primary-button').click();
  await page.waitForTimeout(600);
  await page.locator('.starter-card').nth(1).click();
  await page.locator('.primary-button').click();
  await page.waitForTimeout(700);
  for (let i = 0; i < 4; i++) {
    await page.locator('.intro-scene').click().catch(() => undefined);
    await page.waitForTimeout(520);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
