/**
 * Percorre o jogo inteiro num Chromium com viewport de celular e salva
 * screenshots de cada etapa: novo jogo, casa, dialogo, grama, batalha selvagem,
 * captura, batalha de ginasio e as abas do app.
 *
 * Usa o gancho `window.__overworld`, que so existe em desenvolvimento, para
 * posicionar o jogador sem depender de segurar setas por um tempo exato.
 *
 * Uso: npx tsx tools/playthrough.ts <url> <pasta-de-saida>
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
// Declara os ganchos de desenvolvimento no `window`.
import './lib/hooks.js';

const VIEWPORT = { width: 390, height: 844 }; // iPhone 14/15 em retrato

const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function main(): Promise<void> {
  const url = process.argv[2] ?? 'http://localhost:5173/';
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
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const shot = async (name: string) => {
    await page.screenshot({ path: join(outDir, `${name}.png`) });
    console.log(`  ${name}.png`);
  };

  // --- Menu inicial e abertura ----------------------------------------------
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await shot('01-menu-inicial');

  await page.locator('.title-action').first().click();
  await page.waitForTimeout(1200);
  await shot('02-oak');

  // As falas do Oak avancam com um toque cada.
  for (let i = 0; i < 6; i++) {
    await page.locator('.intro-scene').click().catch(() => undefined);
    await page.waitForTimeout(380);
  }
  await shot('03-nome');

  await page.fill('#trainer-name', 'Davi');
  await page.locator('.primary-button').click();
  await page.waitForTimeout(700);
  await shot('04-escolha-inicial');

  await page.locator('.starter-card').nth(1).click();
  await page.waitForTimeout(400);
  await page.locator('.primary-button').click();
  await page.waitForTimeout(800);
  await shot('05-despedida');

  for (let i = 0; i < 4; i++) {
    await page.locator('.intro-scene').click().catch(() => undefined);
    await page.waitForTimeout(520);
  }
  await page.waitForTimeout(2600);
  await shot('06-pallet-town');

  // --- Entrar em casa e falar com a mae -------------------------------------
  await hold(page, 'ArrowUp', 400);
  await page.waitForTimeout(1800);
  await shot('07-interior');

  await place(page, 8, 5, 'up');
  await page.keyboard.press('z');
  await page.waitForTimeout(1500);
  await shot('08-dialogo');
  await dismissDialogue(page);

  // --- Encontro selvagem na grama da Rota 1 ---------------------------------
  await teleport(page, 'MAP_ROUTE1', 12, 20);
  await page.waitForTimeout(2600);
  await shot('09-rota-1');

  if (await walkUntilBattle(page, 40)) {
    await page.waitForTimeout(3200);
    await shot('10-encontro');

    await clickIfPresent(page, '.action-fight');
    await page.waitForTimeout(600);
    await shot('11-golpes');
    await clickIfPresent(page, '.move-button');
    await page.waitForTimeout(3400);
    await shot('12-golpe-aplicado');

    await clickIfPresent(page, '.action-bag');
    await page.waitForTimeout(600);
    await clickIfPresent(page, '.bag-item');
    await page.waitForTimeout(6000);
    await shot('13-pokebola');
  } else {
    console.log('  (nenhum encontro nas tentativas)');
  }

  // --- Batalha de ginasio ---------------------------------------------------
  // Sai da batalha selvagem antes: com ela aberta, trocar de mapa nao muda a tela.
  await leaveBattle(page);
  await dismissDialogue(page);
  await teleport(page, 'MAP_PEWTER_CITY_GYM', 5, 12);
  await page.waitForTimeout(2600);
  await shot('14-ginasio');

  if (await faceNpcWithScript(page, 'Brock')) {
    await page.keyboard.press('z');
    await page.waitForTimeout(4200);
    await shot('15-batalha-brock');
  } else {
    console.log('  (Brock nao encontrado no ginasio)');
  }

  // --- Abas do app ----------------------------------------------------------
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot('16-menu-com-save');
  await page.locator('.title-continue').click();
  await page.waitForTimeout(2600);

  for (const [index, tab] of ['Pokedex', 'Equipe', 'Mochila', 'Perfil'].entries()) {
    const button = page.locator('.nav-item', { hasText: tab }).first();
    if (await button.count()) {
      await button.click();
      await page.waitForTimeout(1200);
      await shot(`1${index + 7}-${tab.toLowerCase()}`);
    }
  }

  const addExpedition = page.locator('.expedition-add').first();
  if (await addExpedition.count()) {
    await addExpedition.click();
    await page.waitForTimeout(1200);
    await shot('22-expedicao');
  }

  // --- Modos de locomocao ---------------------------------------------------
  for (const [index, mode] of ['legacy-dpad', 'legacy-stick', 'oldschool-dual', 'touch'].entries()) {
    await setMovementMode(page, mode);
    await page.locator('.title-continue').click().catch(() => undefined);
    await page.waitForTimeout(2400);
    await shot(`3${index}-modo-${mode}`);
  }
  await setMovementMode(page, 'new');

  if (errors.length > 0) {
    console.log(`\nerros (${errors.length}):`);
    for (const err of [...new Set(errors)].slice(0, 8)) console.log(`  - ${err}`);
  } else {
    console.log('\nsem erros no console');
  }

  await browser.close();
}

async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(140);
}

/** Coloca o jogador num tile do mapa atual (gancho de desenvolvimento). */
async function place(page: Page, x: number, y: number, dir: string): Promise<void> {
  await page.evaluate(
    ({ x, y, dir }) => {
      const overworld = window.__overworld;
      if (!overworld) return;
      Object.assign(overworld.player, { x, y, fromX: x, fromY: y, dir, progress: 0, moving: false });
    },
    { x, y, dir },
  );
  await page.waitForTimeout(400);
}

/** Troca de mapa direto, sem andar o caminho todo. */
async function teleport(page: Page, map: string, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ map, x, y }) => {
      return window.__overworld?.swapTo(map, x, y, 'down');
    },
    { map, x, y },
  );
}

/** Procura um NPC cujo script contenha `name` e encara ele. */
async function faceNpcWithScript(page: Page, name: string): Promise<boolean> {
  return page.evaluate((needle) => {
    const overworld = window.__overworld;
    if (!overworld) return false;
    const npc = overworld.npcs.find((n) => n.data.script.includes(needle));
    if (!npc) return false;
    Object.assign(overworld.player, {
      x: npc.x,
      y: npc.y + 1,
      fromX: npc.x,
      fromY: npc.y + 1,
      dir: 'up',
      progress: 0,
      moving: false,
    });
    return true;
  }, name);
}

async function walkUntilBattle(page: Page, attempts: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    await hold(page, 'ArrowUp', 900);
    if (await page.locator('.battle').count()) return true;
    await hold(page, 'ArrowDown', 700);
    if (await page.locator('.battle').count()) return true;
  }
  return false;
}

/** Foge da batalha em andamento, se houver, e espera voltar ao mapa. */
async function leaveBattle(page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.battle').count())) return;
    await clickIfPresent(page, '.action-run');
    await page.waitForTimeout(1800);
    await dismissDialogue(page);
  }
}

async function dismissDialogue(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    if (!(await page.locator('.dialogue-box').count())) return;
    await page.keyboard.press('z');
    await page.waitForTimeout(350);
  }
}

async function clickIfPresent(page: Page, selector: string): Promise<void> {
  const element = page.locator(selector).first();
  if (await element.count()) await element.click({ timeout: 4000 }).catch(() => undefined);
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
