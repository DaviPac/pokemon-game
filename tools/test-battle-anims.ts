/**
 * Confere a batalha sobre o Pokemon Showdown: o simulador decide o turno, os
 * textos saem em portugues e cada golpe toca a animacao do Showdown no campo
 * 3D -- com os efeitos caindo em cima do alvo certo.
 *
 * Usa os ganchos de desenvolvimento; aponte para o servidor `npm run dev`.
 *
 * Uso: npx tsx tools/test-battle-anims.ts <url> <pasta-de-saida>
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { startNewGame, teleport, walkUntilBattle } from './lib/play.js';

const VIEWPORT = { width: 390, height: 844 };
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/**
 * Analisadores nas saidas de efeito e de musica, depois de um passa-alta em
 * 500 Hz: e o que um alto-falante de celular consegue tocar.
 */
const PROBE_START = `(() => {
  const a = window.__audio;
  const ctx = a.context;
  const tap = (node) => {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 500;
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    node.connect(hp);
    hp.connect(an);
    return an;
  };
  const sfx = tap(a.sfxGain);
  const music = tap(a.musicGain);
  const buf = new Float32Array(2048);
  const rms = (an) => {
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.sqrt(sum / buf.length);
  };
  a.lastImpact = null;
  window.__probe = { log: [] };
  window.__probe.timer = setInterval(() => window.__probe.log.push([rms(sfx), rms(music)]), 20);
})()`;

const PROBE_STOP = `(() => {
  clearInterval(window.__probe.timer);
  const log = window.__probe.log;
  let at = 0;
  for (let i = 0; i < log.length; i++) if (log[i][0] > log[at][0]) at = i;
  const around = log.slice(Math.max(0, at - 1), at + 2).map((x) => x[1]);
  const a = window.__audio;
  return {
    peak: log[at][0],
    musicThen: Math.max(...around),
    musicLevel: a.musicGain.gain.value,
    musicVolume: a.musicVolume,
    impact: a.lastImpact,
  };
})()`;

interface Sample {
  time: number;
  effects: number;
  /** Centro de cada efeito visivel, em pixels da tela. */
  centers: { x: number; y: number }[];
  player: { x: number; y: number; opacity: number };
  foe: { x: number; y: number; opacity: number };
  background: number;
  message: string;
}

async function main(): Promise<void> {
  const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
  const outDir = process.argv[3] ?? 'screenshots';
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err).split('\n')[0]));
  page.on('console', (msg) => {
    if (msg.type() === 'warning' && msg.text().includes('Showdown')) errors.push(msg.text());
  });

  let failures = 0;
  const check = (label: string, ok: boolean, detail = '') => {
    console.log(`  ${ok ? 'ok  ' : 'FALHOU'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
  };
  const shot = async (name: string) => {
    await page.screenshot({ path: join(outDir, `${name}.png`) });
    console.log(`  ${name}.png`);
  };

  try {
    console.log('\n1. batalha no simulador do Showdown');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    await startNewGame(page);
    await page.waitForTimeout(2200);
    await teleport(page, 'MAP_ROUTE1', 12, 24);
    await page.waitForTimeout(1600);

    // Golpes escolhidos pela animacao: dois de status, um que carrega e um
    // especial que viaja ate o alvo. O nivel baixo segura o oponente em pe.
    await page.evaluate(() => {
      const game = window.__game?.getState();
      game?.update((save) => {
        save.party = save.party.slice(0, 1).map((p) => ({
          ...p,
          level: 6,
          moves: [
            { id: 'swordsdance', pp: 20, maxPp: 20 },
            { id: 'fly', pp: 15, maxPp: 15 },
            { id: 'ember', pp: 25, maxPp: 25 },
            { id: 'thunderwave', pp: 20, maxPp: 20 },
          ],
        }));
      });
      game?.healParty();
    });

    const battled = await walkUntilBattle(page, 30);
    check('encontro selvagem apareceu', battled);
    if (!battled) throw new Error('sem encontro');
    await page.waitForTimeout(3600);
    await shot('20-batalha-aberta');

    const opening = await page.locator('.battle-message').textContent();
    check('texto de abertura em portugues', /Vai, /.test(opening ?? ''), opening ?? '');

    // --- Swords Dance: efeitos em volta do proprio Pokemon ---------------------
    console.log('\n2. Swords Dance: a animacao acontece no atacante');
    const dance = await useMove(page, 'Swords Dance', outDir, '21-swords-dance');
    const danceEffects = dance.filter((s) => s.effects > 0);
    check('efeitos do Showdown na tela', danceEffects.length > 0, `${Math.max(0, ...dance.map((s) => s.effects))} no pico`);
    check(
      'os efeitos ficam em volta do jogador, nao do oponente',
      nearer(danceEffects, 'player'),
      describe(danceEffects),
    );
    check(
      'o texto do golpe saiu em portugues',
      dance.some((s) => /usou Swords Dance/.test(s.message)),
      dance.map((s) => s.message).find((m) => m.includes('usou')) ?? '',
    );
    const boosted = dance.some((s) => /Ataque de .* subiu muito/.test(s.message));
    check('o simulador aplicou o +2 de Ataque', boosted, messages(dance));

    // --- Ember: o efeito viaja ate o oponente ----------------------------------
    console.log('\n3. Ember: o fogo vai do atacante ate o alvo');
    // Ouvido de celular: so o que passa de 500 Hz conta, e a musica e medida
    // no mesmo instante do golpe.
    await page.evaluate(PROBE_START);
    const ember = await useMove(page, 'Ember', outDir, '22-ember');
    await page.waitForTimeout(600);
    const sound = (await page.evaluate(PROBE_STOP)) as {
      peak: number;
      musicThen: number;
      musicLevel: number;
      musicVolume: number;
      impact: string | null;
    };
    const emberEffects = ember.filter((s) => s.effects > 0);
    check('efeitos do Showdown na tela', emberEffects.length > 0, `${Math.max(0, ...ember.map((s) => s.effects))} no pico`);
    check('o fogo termina em cima do oponente', nearer(emberEffects.slice(-3), 'foe'), describe(emberEffects.slice(-3)));
    check('o acerto tocou som', sound.impact !== null, `${sound.impact}`);
    check(
      'golpe e acerto soam por cima da musica, na faixa do alto-falante',
      sound.peak > sound.musicThen * 1.5 && sound.peak > 0.08,
      `efeito=${sound.peak.toFixed(3)} musica no instante=${sound.musicThen.toFixed(3)}`,
    );
    check(
      'a musica volta ao volume normal depois do golpe',
      Math.abs(sound.musicLevel - sound.musicVolume) < 0.01,
      `ganho=${sound.musicLevel.toFixed(2)} esperado=${sound.musicVolume.toFixed(2)}`,
    );

    // --- Fly: o Pokemon some no turno de preparo --------------------------------
    if (await page.locator('.battle').count()) {
      console.log('\n4. Fly: o Pokemon voa e some ate o turno seguinte');
      const fly = await useMove(page, 'Fly', outDir, '23-fly-preparo');
      check('texto do preparo', fly.some((s) => /voou bem alto/.test(s.message)), messages(fly));
      const end = fly[fly.length - 1];
      check('o Pokemon do jogador sumiu no ceu', end.player.opacity <= 0.3, `opacidade=${end.player.opacity.toFixed(2)}`);
      // O menu so volta quando o turno termina: no preparo, o proximo toque
      // em Lutar solta o golpe sozinho.
      const strike = await useMove(page, null, outDir, '24-fly-ataque');
      check(
        'o golpe sai no turno seguinte',
        strike.some((s) => /usou Fly/.test(s.message)),
        messages(strike),
      );
      const last = strike[strike.length - 1];
      check('o Pokemon volta ao campo depois do golpe', last.player.opacity > 0.8, `opacidade=${last.player.opacity.toFixed(2)}`);
    }

    check('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (err) {
    console.error(err);
    failures++;
    await shot('99-erro').catch(() => undefined);
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? '\ntudo certo' : `\n${failures} verificacao(oes) falharam`);
  process.exit(failures === 0 ? 0 : 1);
}

/**
 * Escolhe um golpe (ou so aperta Lutar, quando o Pokemon esta preso num golpe
 * de dois turnos) e amostra a tela a cada 90 ms ate o menu voltar.
 */
async function useMove(page: Page, name: string | null, outDir: string, shotName: string): Promise<Sample[]> {
  await page.locator('.action-fight').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.action-fight').click();
  await page.waitForTimeout(350);
  if (name) {
    await page.locator('.move-button', { hasText: name }).first().click();
  }
  const samples: Sample[] = [];
  const started = Date.now();
  let shotTaken = false;
  while (Date.now() - started < 14_000) {
    const sample = (await page.evaluate(`(() => {
      const center = (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      const sprite = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return { x: 0, y: 0, opacity: 0 };
        return { ...center(el), opacity: Number(getComputedStyle(el).opacity) };
      };
      const effects = [...document.querySelectorAll('.sd-effect')].filter(
        (el) => Number(getComputedStyle(el).opacity) > 0.05,
      );
      return {
        effects: effects.length,
        centers: effects.map(center),
        player: sprite('.battle-sprite-player'),
        foe: sprite('.battle-sprite-foe'),
        background: document.querySelectorAll('.sd-background').length,
        message: document.querySelector('.battle-message')?.textContent ?? '',
        menu: document.querySelectorAll('.action-fight').length > 0,
        battle: document.querySelectorAll('.battle').length > 0,
      };
    })()`)) as Sample & { menu: boolean; battle: boolean };
    samples.push({ ...sample, time: Date.now() - started });
    if (!shotTaken && sample.effects >= 2) {
      await page.screenshot({ path: join(outDir, `${shotName}.png`) });
      console.log(`  ${shotName}.png`);
      shotTaken = true;
    }
    if (samples.length > 4 && (sample.menu || !sample.battle)) break;
    await page.waitForTimeout(90);
  }
  if (!shotTaken) {
    await page.screenshot({ path: join(outDir, `${shotName}.png`) });
    console.log(`  ${shotName}.png (sem efeito no quadro)`);
  }
  return samples;
}

/** As falas que passaram pela tela, sem repetir. */
function messages(samples: Sample[]): string {
  return [...new Set(samples.map((s) => s.message).filter(Boolean))].join(' | ');
}

/** Os efeitos, na media, ficam mais perto de qual Pokemon? */
function nearer(samples: Sample[], side: 'player' | 'foe'): boolean {
  let own = 0;
  let other = 0;
  for (const sample of samples) {
    for (const c of sample.centers) {
      const dPlayer = Math.hypot(c.x - sample.player.x, c.y - sample.player.y);
      const dFoe = Math.hypot(c.x - sample.foe.x, c.y - sample.foe.y);
      if ((side === 'player' ? dPlayer : dFoe) < (side === 'player' ? dFoe : dPlayer)) own++;
      else other++;
    }
  }
  return own > other;
}

function describe(samples: Sample[]): string {
  const centers = samples.flatMap((s) => s.centers);
  if (centers.length === 0) return 'nenhum efeito';
  const x = centers.reduce((a, c) => a + c.x, 0) / centers.length;
  const y = centers.reduce((a, c) => a + c.y, 0) / centers.length;
  const s = samples[0];
  return `efeitos em (${x.toFixed(0)}, ${y.toFixed(0)}); jogador (${s.player.x.toFixed(0)}, ${s.player.y.toFixed(0)}), oponente (${s.foe.x.toFixed(0)}, ${s.foe.y.toFixed(0)})`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
