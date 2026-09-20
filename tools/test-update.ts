/**
 * Testa o caminho que mais assusta num PWA instalado: sai uma versao nova e o
 * jogador precisa recebe-la sem limpar cache, reinstalar ou perder progresso.
 *
 * O roteiro e o real: abre a versao atual, cria um save, publica outra versao
 * por cima, espera o aviso aparecer, aplica a atualizacao e confere que o
 * progresso continua la e que as novidades sao mostradas.
 *
 * Uso: npx tsx tools/test-update.ts <url> <pasta-de-saida>
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';

const VIEWPORT = { width: 390, height: 844 };
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function main(): Promise<void> {
  const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
  const outDir = process.argv[3] ?? 'screenshots';
  await mkdir(outDir, { recursive: true });

  const pkgPath = join(process.cwd(), 'package.json');
  const originalPkg = await readFile(pkgPath, 'utf8');
  const notesPath = join(process.cwd(), 'src', 'data', 'patchNotes.ts');
  const originalNotes = await readFile(notesPath, 'utf8');

  const browser = await chromium.launch({
    executablePath: CHROMIUM,
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

  const shot = async (name: string) => {
    await page.screenshot({ path: join(outDir, `${name}.png`) });
    console.log(`  ${name}.png`);
  };

  let failures = 0;
  const check = (label: string, ok: boolean, detail = '') => {
    console.log(`  ${ok ? 'ok  ' : 'FALHOU'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
  };

  try {
    // --- 1. Versao instalada, com progresso -------------------------------
    console.log('\n1. instalando a versao atual e criando um save');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await startNewGame(page);
    await page.waitForTimeout(2500);

    const before = await readSave(page);
    check('save criado', before !== null && before.playerName === 'Davi', JSON.stringify(before));

    const swReady = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.some((r) => r.active !== null);
    });
    check('service worker ativo', swReady);
    await shot('01-antes-da-atualizacao');

    // --- 2. Publica uma versao nova ---------------------------------------
    console.log('\n2. publicando uma versao nova por cima');
    await writeFile(pkgPath, originalPkg.replace('"version": "0.3.0"', '"version": "0.3.1"'));
    await writeFile(
      notesPath,
      originalNotes.replace(
        'export const PATCH_NOTES: PatchNote[] = [',
        `export const PATCH_NOTES: PatchNote[] = [
  {
    version: '0.3.1',
    date: '2026-09-20',
    title: 'Versao de teste',
    changes: [{ kind: 'correcao', text: 'Entrada usada pelo teste de atualizacao.' }],
  },`,
      ),
    );
    execFileSync('npm', ['run', 'build'], { stdio: 'pipe' });
    console.log('  build da versao 0.3.1 publicado');

    // --- 3. O jogo percebe sozinho ----------------------------------------
    console.log('\n3. procurando a atualizacao com o app aberto');
    await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update()));
    });

    const bannerAppeared = await page
      .locator('.update-banner')
      .waitFor({ state: 'visible', timeout: 25_000 })
      .then(() => true)
      .catch(() => false);
    check('aviso de versao nova apareceu sem recarregar', bannerAppeared);
    if (bannerAppeared) await shot('02-aviso-de-atualizacao');

    // --- 4. Aplica e confere o progresso ----------------------------------
    console.log('\n4. aplicando a atualizacao');
    if (bannerAppeared) {
      await page.locator('.update-now').click();
      // A pagina recarrega e refaz o boot (dados de Kanto) antes de decidir se
      // mostra as novidades; da tempo de sobra.
      await page.waitForTimeout(9000);
    }

    const running = await page.evaluate(() => document.documentElement.dataset.version ?? '?');
    check('versao nova em execucao', running === '0.3.1', `rodando=${running}`);

    const seenVersion = await page.evaluate(
      () =>
        new Promise<string | null>((resolve) => {
          const request = indexedDB.open('pokedeluge', 1);
          request.onerror = () => resolve(null);
          request.onsuccess = () => {
            const get = request.result.transaction('saves', 'readonly').objectStore('saves').get('main');
            get.onsuccess = () => resolve(get.result?.lastSeenVersion ?? null);
            get.onerror = () => resolve(null);
          };
        }),
    );
    check('versao anotada no save', seenVersion === '0.3.1', `lastSeenVersion=${seenVersion}`);

    const after = await readSave(page);
    check(
      'save intacto depois de atualizar',
      after !== null && after.playerName === before?.playerName && after.party === before?.party,
      `antes=${JSON.stringify(before)} depois=${JSON.stringify(after)}`,
    );

    const notesShown = await page
      .locator('.patch-note')
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    check('novidades da versao mostradas', notesShown);
    if (notesShown) await shot('03-novidades');

    // --- 5. Continua offline ----------------------------------------------
    console.log('\n5. conferindo que a versao nova abre offline');
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const offlineOk = await page.evaluate(
      () => !!document.querySelector('.title') || !!document.querySelector('.overworld-canvas'),
    );
    check('abre offline depois da atualizacao', offlineOk);
    await context.setOffline(false);
    await shot('04-offline-apos-atualizar');
  } finally {
    // Devolve o repositorio ao estado original.
    await writeFile(pkgPath, originalPkg);
    await writeFile(notesPath, originalNotes);
    execFileSync('npm', ['run', 'build'], { stdio: 'pipe' });
    await browser.close();
  }

  if (errors.length > 0) {
    console.log(`\nerros no console (${errors.length}):`);
    for (const err of [...new Set(errors)].slice(0, 6)) console.log(`  - ${err}`);
  }

  console.log(failures === 0 ? '\ntudo certo' : `\n${failures} verificacao(oes) falharam`);
  process.exit(failures === 0 ? 0 : 1);
}

/** Le o save direto do IndexedDB, como o jogo faz. */
async function readSave(page: Page): Promise<{ playerName: string; party: number } | null> {
  return page.evaluate(
    () =>
      new Promise<{ playerName: string; party: number } | null>((resolve) => {
        const request = indexedDB.open('pokedeluge', 1);
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const tx = request.result.transaction('saves', 'readonly');
          const get = tx.objectStore('saves').get('main');
          get.onsuccess = () => {
            const save = get.result;
            resolve(save ? { playerName: save.playerName, party: save.party.length } : null);
          };
          get.onerror = () => resolve(null);
        };
      }),
  );
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
