/**
 * Traz as animacoes de golpe do Pokemon Showdown para o jogo.
 *
 * O cliente do Showdown e AGPLv3 no todo, mas as partes usadas aqui tem
 * licencas proprias, escritas nos cabecalhos dos arquivos:
 *
 * - battle-animations-moves.ts (a tabela de golpes) e CC0, dominio publico;
 * - battle-animations.ts (efeitos, animacoes gerais e de status) e MIT, com a
 *   maior parte em CC0 -- inclusive as imagens da pasta fx/;
 * - das imagens, icicle.png e lightning.png sao CC-BY-SA-3.0 (Clint
 *   Bellanger, creditado no README), e rocks.png, rock1.png, rock2.png (GPLv3)
 *   e bone.png ficam de fora: a cena troca essas por outras imagens livres.
 *
 * Do segundo arquivo so entra o trecho das tabelas (de `interface AnimData`
 * em diante), sem a classe BattleScene, que depende do resto do cliente.
 * A cena compativel fica em src/ui/battle/showdown/scene.ts.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fetchSource, fetchText, mapLimit } from './lib/net.js';

const SRC = 'play.pokemonshowdown.com/src';
const FX = 'play.pokemonshowdown.com/fx';
const OUT = join(process.cwd(), 'src', 'vendor', 'showdown');
const FX_OUT = join(process.cwd(), 'public', 'assets', 'fx');

/** Fundos de clima que o Showdown mostra enquanto dura chuva, sol, areia... */
const WEATHER_FX = ['weather-raindance.jpg', 'weather-sunnyday.jpg', 'weather-sandstorm.png', 'weather-hail.png'];

/** Imagens que nao sao livres para redistribuir junto com o jogo. */
export const EXCLUDED_FX = ['rocks.png', 'rock1.png', 'rock2.png', 'bone.png'];

const HEADER = (source: string, license: string) => `// @ts-nocheck
/* eslint-disable */
/**
 * Gerado por tools/build-showdown-anims.ts a partir de
 * https://github.com/smogon/pokemon-showdown-client/blob/master/${source}
 * Licenca do original: ${license}. Nao edite a mao.
 */
`;

const NOTICE = `# Animacoes do Pokemon Showdown

Os arquivos desta pasta sao gerados por \`tools/build-showdown-anims.ts\` a partir
de https://github.com/smogon/pokemon-showdown-client. Nao edite a mao.

- \`moves.ts\` vem de \`battle-animations-moves.ts\`, de Guangcong Luo e
  colaboradores do Pokemon Showdown, publicado sob CC0-1.0 (dominio publico).
- \`other.ts\` vem do trecho final de \`battle-animations.ts\` (efeitos, animacoes
  gerais e de status), publicado sob a licenca MIT, com a maior parte em CC0:

  Copyright (c) 2011-2026 Guangcong Luo and other contributors
  http://pokemonshowdown.com/

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in
  all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
  THE SOFTWARE.

As imagens em \`public/assets/fx/\` vem da pasta \`fx/\` do mesmo repositorio e sao
CC0, exceto \`icicle.png\` e \`lightning.png\`, de Clint Bellanger, usadas sob
CC-BY-SA 3.0 (http://opengameart.org/content/icicle-spell e
http://opengameart.org/content/lightning-shock-spell). \`rocks.png\`, \`rock1.png\`,
\`rock2.png\` (GPLv3) e \`bone.png\` nao sao distribuidas.
`;

async function main(): Promise<void> {
  const moves = await fetchText('showdown', `${SRC}/battle-animations-moves.ts`);
  const engine = await fetchText('showdown', `${SRC}/battle-animations.ts`);
  if (!moves || !engine) throw new Error('nao foi possivel baixar as animacoes do Showdown');

  if (!/@license CC0-1\.0/.test(moves)) throw new Error('licenca da tabela de golpes mudou; revise');
  if (!/@license MIT/.test(engine) || !/This license DOES extend to all images in the fx\/ folder/.test(engine)) {
    throw new Error('licenca das animacoes mudou; revise');
  }

  // Tabela de golpes: so as importacoes mudam.
  const movesOut = moves
    .replace(
      /import \{ type AnimTable, BattleOtherAnims \} from '\.\/battle-animations';/,
      "import { type AnimTable, BattleOtherAnims } from './other';",
    )
    .replace(
      /import \{ Config \} from '\.\/client-main';/,
      // As imagens de fundo apontam para o servidor do Showdown; a cena troca
      // este marcador pela pasta local de efeitos.
      "const Config = { routes: { client: '__SHOWDOWN_FX__' } };",
    );
  if (movesOut.includes("from './client-main'") || movesOut.includes("from './battle-animations'")) {
    throw new Error('importacoes da tabela de golpes mudaram; revise');
  }

  // Animacoes gerais: da interface AnimData ate o fim, sem o trecho que
  // depende do objeto Dex do cliente.
  const start = engine.indexOf('interface AnimData');
  if (start < 0) throw new Error('estrutura de battle-animations.ts mudou');
  const license = engine.slice(engine.indexOf('/*\n\nMost of this file is'), engine.indexOf('*/', engine.indexOf('Most of this file is')) + 2);
  let otherOut = engine.slice(start);
  otherOut = otherOut.replace(/\(\(\) => \{\n\tif \(!window\.Dex[\s\S]*?\n\}\)\(\);\n/, '');
  otherOut = otherOut.replace('const BattleEffects:', 'export const BattleEffects:');
  if (otherOut.includes('window.Dex')) throw new Error('o trecho que usa Dex continua no arquivo');

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'moves.ts'), HEADER(`${SRC}/battle-animations-moves.ts`, 'CC0-1.0') + movesOut);
  await writeFile(
    join(OUT, 'other.ts'),
    HEADER(`${SRC}/battle-animations.ts`, 'MIT (maior parte CC0)') +
      `${license}\n\n` +
      otherOut,
  );
  await writeFile(join(OUT, 'LICENSE.md'), NOTICE);
  console.log(`animacoes: ${(movesOut.length / 1024).toFixed(0)} KB de golpes, ${(otherOut.length / 1024).toFixed(0)} KB gerais`);

  // Imagens: as dos efeitos e os fundos usados por backgroundEffect.
  const images = new Set<string>();
  for (const match of otherOut.matchAll(/url: '([^']+)'/g)) images.add(match[1]);
  for (const match of movesOut.matchAll(/\/fx\/([a-z0-9.-]+\.(?:png|jpg|gif))/g)) images.add(match[1]);
  for (const name of WEATHER_FX) images.add(name);
  const wanted = [...images].filter((name) => !EXCLUDED_FX.includes(name)).sort();

  await mkdir(FX_OUT, { recursive: true });
  const missing: string[] = [];
  await mapLimit(wanted, 8, async (name) => {
    const target = join(FX_OUT, name);
    if (existsSync(target)) return;
    const data = await fetchSource('showdown', `${FX}/${name}`);
    if (!data) {
      missing.push(name);
      return;
    }
    await writeFile(target, data);
  });
  console.log(`efeitos: ${wanted.length - missing.length} imagens em public/assets/fx`);
  if (missing.length) console.log(`  sem arquivo: ${missing.join(', ')}`);
}

await main();
