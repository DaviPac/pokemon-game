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
    // Equipe forte e inteira: a vitoria e o que este trecho quer testar, e nao
    // a sorte dos dados.
    await page.evaluate(() => {
      const game = window.__game?.getState();
      game?.update((save) => {
        save.party = save.party.map((p) => ({ ...p, level: 30 }));
      });
      game?.healParty();
    });
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
    // --- Derrota ------------------------------------------------------------
    console.log('\n6. derrota leva de volta ao Centro Pokemon');
    // Passar pelo Centro marca o ponto de retorno, como no jogo.
    await teleport(page, 'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F', 7, 5);
    await page.waitForTimeout(2000);
    await teleport(page, 'MAP_ROUTE1', 12, 24);
    await page.waitForTimeout(1600);
    // Um ponto de vida e so um golpe que nao machuca: a derrota e certa.
    await page.evaluate(() =>
      window.__game?.getState().update((save) => {
        save.party = save.party.map((p) => ({
          ...p,
          level: 2,
          hp: 1,
          moves: [{ id: 'growl', pp: 40, maxPp: 40 }],
        }));
      }),
    );

    if (await walkUntilBattle(page, 30)) {
      await page.waitForTimeout(3000);
      for (let i = 0; i < 14 && (await page.locator('.battle').count()); i++) {
        // Quando um Pokemon cai, a batalha pede o proximo antes de seguir.
        const bench = page.locator('.party-row:not([disabled])');
        if (await bench.count()) {
          await bench.first().click({ timeout: 2000 }).catch(() => undefined);
          await page.waitForTimeout(2600);
          continue;
        }
        await page.locator('.action-fight').click({ timeout: 2000 }).catch(() => undefined);
        await page.waitForTimeout(400);
        await page.locator('.move-button').first().click({ timeout: 2000 }).catch(() => undefined);
        await page.waitForTimeout(2600);
      }
      await page.waitForTimeout(1200);
      await page.locator('.dialogue-layer').click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(1800);
      const where = await page.evaluate(() => window.__overworld?.world.map.id ?? '?');
      check('jogador acordou no Centro Pokemon', /POKEMON_CENTER/.test(where), `mapa=${where}`);
      await shot('06-depois-da-derrota');
    } else {
      check('encontro para a derrota', false);
    }

    // --- Som ao sair do app -------------------------------------------------
    console.log('\n7. sair do app cala o som');
    const hide = (hidden: boolean) =>
      page.evaluate((value) => {
        Object.defineProperty(document, 'visibilityState', {
          value: value ? 'hidden' : 'visible',
          configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);

    check('som ligado antes', (await page.evaluate(() => window.__audio?.state)) === 'running');
    await hide(true);
    await page.waitForTimeout(600);
    check(
      'som parado em segundo plano',
      (await page.evaluate(() => window.__audio?.state)) === 'suspended',
      `${await page.evaluate(() => window.__audio?.state)}`,
    );
    await hide(false);
    await page.waitForTimeout(800);
    check(
      'som volta ao reabrir',
      (await page.evaluate(() => window.__audio?.state)) === 'running',
      `${await page.evaluate(() => window.__audio?.state)}`,
    );
    // --- Barra inferior estilo Dock ----------------------------------------
    console.log('\n8. barra inferior: vidro, lupa e recolher');
    await page.locator('.nav-item', { hasText: 'Mapa' }).first().click();
    // Pallet Town nao tem grama na porta de casa: da para andar sem encontro.
    await teleport(page, 'MAP_PALLET_TOWN', 6, 8);
    await page.waitForTimeout(2200);
    check('barra a vista com o jogador parado', await isShown(page, '.dock'));

    const dock = await page.locator('.dock').boundingBox();
    if (dock) {
      await page.mouse.move(dock.x + 30, dock.y + 28);
      await page.waitForTimeout(400);
      const zoom = await page.evaluate(() => {
        const items = [...document.querySelectorAll<HTMLElement>('.dock-item')];
        return items.map((item) => Number(item.style.getPropertyValue('--grow')));
      });
      check(
        'icone cresce sob o dedo e os vizinhos nem tanto',
        zoom[0] > 0.8 && zoom[1] < zoom[0] && zoom[4] < 0.05,
        zoom.map((v) => v.toFixed(2)).join(' '),
      );
      check(
        'so o icone apontado mostra o nome',
        await page.evaluate(() => {
          const labels = [...document.querySelectorAll<HTMLElement>('.dock-label')];
          const visible = labels.filter((l) => Number(getComputedStyle(l).opacity) > 0.3);
          return visible.length === 1 && visible[0].textContent === 'Pokedex';
        }),
      );
      await shot('08-barra-com-lupa');
      await page.mouse.move(5, 5);
      await page.waitForTimeout(300);
    }

    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(1600);
    await page.keyboard.up('ArrowLeft');
    check('barra recolhe enquanto anda', !(await isShown(page, '.dock')));
    check('sobra o risquinho na beirada', (await page.locator('.dock-handle').count()) === 1);
    await shot('09-barra-recolhida');

    await page.locator('.dock-handle').click();
    await page.waitForTimeout(600);
    check('o risquinho traz a barra de volta', await isShown(page, '.dock'));

    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(1500);
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(2200);
    check('barra volta sozinha quando o jogador para', await isShown(page, '.dock'));
  } finally {
    await browser.close();
  }

  // --- Grade sem costura ----------------------------------------------------
  // Numa densidade quebrada (2,75x e comum no Android) a escala fracionada
  // deixava uma linha do fundo entre um tile e outro.
  console.log('\n9. mapa sem linha entre os tiles');
  failures += await checkPixelGrid(url, outDir);

  if (errors.length > 0) {
    console.log(`\nerros no console (${errors.length}):`);
    for (const err of [...new Set(errors)].slice(0, 6)) console.log(`  - ${err}`);
  }
  console.log(failures === 0 ? '\ntudo certo' : `\n${failures} verificacao(oes) falharam`);
  process.exit(failures === 0 ? 0 : 1);
}

/**
 * Abre o jogo numa tela de densidade quebrada (2,75x e comum no Android) e
 * confere que o desenho sai pixel a pixel: o canvas do tamanho exato da tela e
 * cada pixel do mundo ocupando sempre o mesmo numero de pixels do aparelho.
 * Quando isso nao vale, o navegador reamostra a imagem e aparece a linha
 * fininha na borda de cada tile.
 */
async function checkPixelGrid(url: string, outDir: string): Promise<number> {
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  let failures = 0;
  const check = (label: string, ok: boolean, detail = '') => {
    console.log(`  ${ok ? 'ok  ' : 'FALHOU'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
  };

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2.75,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    await startNewGame(page);
    await page.waitForTimeout(2600);

    const canvas = await page.evaluate(() => {
      const element = document.querySelector('canvas');
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { ratio: element.width / rect.width, dpr: window.devicePixelRatio };
    });
    check(
      'canvas do tamanho exato da tela',
      canvas !== null && Math.abs(canvas.ratio - canvas.dpr) < 0.01,
      canvas ? `canvas=${canvas.ratio.toFixed(3)}x tela=${canvas.dpr}x` : 'sem canvas',
    );

    // Os pontinhos da grama sao todos do mesmo tamanho no mundo: se saem com
    // larguras diferentes na tela, a imagem foi esticada por um numero quebrado.
    const widths = await page.evaluate(() => {
      const element = document.querySelector('canvas');
      const ctx = element?.getContext('2d');
      if (!element || !ctx) return [];
      const x0 = Math.floor(element.width * 0.3);
      const y0 = Math.floor(element.height * 0.25);
      const w = Math.floor(element.width * 0.4);
      const h = Math.floor(element.height * 0.2);
      const data = ctx.getImageData(x0, y0, w, h).data;
      // Sem funcoes auxiliares aqui dentro: o compilador do script as embrulha
      // num ajudante que nao existe do lado do navegador.
      const pixels = new Int32Array(w * h);
      for (let i = 0; i < pixels.length; i++) {
        pixels[i] = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
      }

      // A cor mais comum e o chao; os pontinhos sao o resto.
      const tally = new Map<number, number>();
      for (const color of pixels) tally.set(color, (tally.get(color) ?? 0) + 1);
      const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      const dot = ranked[1]?.[0];
      if (dot === undefined) return [];

      const runs: number[] = [];
      for (let y = 0; y < h; y++) {
        let run = 0;
        for (let x = 0; x < w; x++) {
          if (pixels[y * w + x] === dot) {
            run++;
            continue;
          }
          // Corridas que encostam na borda do recorte sairiam cortadas.
          if (run > 0 && x - run > 0) runs.push(run);
          run = 0;
        }
      }
      return runs;
    });
    // Com a escala inteira, todo trecho de cor mede um numero redondo de
    // pixels do mundo: o maior divisor comum das larguras e o tamanho de um
    // pixel na tela. Numa escala quebrada um pixel sai com 6 e o vizinho com
    // 7, o divisor comum cai para 1 -- e e essa irregularidade que o olho le
    // como uma linha fina na borda de cada tile.
    const sizes = [...new Set(widths)].sort((a, b) => a - b);
    let unit = widths[0] ?? 0;
    for (const run of widths) {
      let [a, b] = [unit, run];
      while (b > 0) [a, b] = [b, a % b];
      unit = a;
    }
    check(
      'pixels do mundo todos do mesmo tamanho',
      widths.length > 20 && unit >= 2,
      `um pixel = ${unit} da tela; larguras=${sizes.slice(0, 8).join(', ')} (${widths.length} amostras)`,
    );

    await page.screenshot({ path: join(outDir, '07-densidade-quebrada.png') });
    return failures;
  } finally {
    await browser.close();
  }
}

/** True quando o elemento esta na tela, e nao recolhido para fora dela. */
async function isShown(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((css) => {
    const element = document.querySelector(css);
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return (
      Number(getComputedStyle(element).opacity) > 0.5 && rect.bottom <= window.innerHeight + 2
    );
  }, selector);
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
