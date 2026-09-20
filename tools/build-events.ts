/**
 * Extrai o que os NPCs de Kanto fazem e dizem.
 *
 * Treinadores: objeto do mapa -> rotulo de script -> `trainerbattle TRAINER_X`
 * em scripts.inc -> gTrainers[TRAINER_X] -> sParty_X (nivel, especie, golpes).
 *
 * Falas: o mesmo rotulo de script -> `msgbox Map_Text_Y` -> o texto original em
 * text.inc. Os dialogos ficam no ingles dos jogos, como no original.
 *
 * Saida: public/assets/data/events.json
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchText, mapLimit } from './lib/net.js';
import traducoes from './i18n/dialogue.pt.json' with { type: 'json' };

const OUT_DATA = join(process.cwd(), 'public', 'assets', 'data');
const MAPS_DIR = join(OUT_DATA, 'maps');

interface PartyMon {
  species: number;
  level: number;
  moves: string[];
}

interface TrainerData {
  name: string;
  trainerClass: string;
  party: PartyMon[];
}

async function main(): Promise<void> {
  const speciesByName = await loadSpeciesIndex();
  const parties = parseParties(await required('src/data/trainer_parties.h'), speciesByName);
  const trainers = parseTrainers(await required('src/data/trainers.h'), parties);
  console.log(`[trainers] ${Object.keys(trainers).length} treinadores com time`);

  // Liga cada objeto de mapa ao treinador que ele representa.
  const mapFiles = await readdir(MAPS_DIR);
  const byScript: Record<string, string> = {};

  const dialogue: Record<string, string> = {};

  await mapLimit(mapFiles, 12, async (file) => {
    const map = JSON.parse(await readFile(join(MAPS_DIR, file), 'utf8'));
    const hasScripts =
      map.objects.length > 0 || map.signs.some((s: { script: string | null }) => s.script);
    if (!hasScripts) return;

    const [scripts, texts] = await Promise.all([
      fetchText('firered', `data/maps/${map.name}/scripts.inc`),
      fetchText('firered', `data/maps/${map.name}/text.inc`),
    ]);
    if (!scripts) return;

    for (const [label, trainerId] of parseScriptTrainers(scripts)) {
      byScript[label] = trainerId;
    }

    if (texts) {
      const strings = parseTexts(texts);
      for (const [label, textLabel] of parseScriptMessages(scripts)) {
        const text = strings.get(textLabel);
        if (text) dialogue[label] = translate(text);
      }
    }
  });

  // So guardamos os treinadores que algum NPC realmente usa.
  const used = new Set(Object.values(byScript));
  const filtered: Record<string, TrainerData> = {};
  for (const id of used) {
    if (trainers[id]) filtered[id] = trainers[id];
  }

  console.log(
    `[eventos] falas em portugues: ${Object.keys(dialogue).length - semTraducao}/${Object.keys(dialogue).length}` +
      (semTraducao > 0 ? ` (${semTraducao} ainda em ingles)` : ''),
  );

  await writeFile(
    join(OUT_DATA, 'events.json'),
    JSON.stringify({ trainers: filtered, byScript, dialogue }),
  );
  console.log(
    `[events] ${Object.keys(byScript).length} NPCs ligados a ${Object.keys(filtered).length} treinadores`,
  );
  console.log(`[events] ${Object.keys(dialogue).length} falas de NPC`);
}

/** Nome normalizado da especie -> numero da Pokedex. */
async function loadSpeciesIndex(): Promise<Map<string, number>> {
  const species = JSON.parse(await readFile(join(OUT_DATA, 'species.json'), 'utf8')) as Record<
    string,
    { n: string }
  >;
  const index = new Map<string, number>();
  for (const [id, data] of Object.entries(species)) {
    index.set(normalize(data.n), Number(id));
  }
  return index;
}

/** sParty_LeaderBrock -> [{ Geodude nivel 12, ... }] */
function parseParties(text: string, speciesByName: Map<string, number>): Map<string, PartyMon[]> {
  const parties = new Map<string, PartyMon[]>();
  const partyRe = /static const struct \w+ sParty_(\w+)\[\]\s*=\s*\{([\s\S]*?)\n\};/g;

  for (const match of text.matchAll(partyRe)) {
    const label = match[1];
    const body = match[2];
    const mons: PartyMon[] = [];

    // Cada Pokemon comeca em `.lvl`; usamos isso para recortar os blocos, ja
    // que `.moves = {...}` tem chaves aninhadas e confunde um match simples.
    const chunks = body.split(/(?=\.lvl\s*=)/).slice(1);
    for (const mon of chunks) {
      const level = Number(/\.lvl\s*=\s*(\d+)/.exec(mon)?.[1]);
      const speciesConstant = /\.species\s*=\s*SPECIES_(\w+)/.exec(mon)?.[1];
      if (!level || !speciesConstant) continue;

      const species = speciesByName.get(normalize(speciesConstant));
      if (species === undefined) continue;

      const movesMatch = /\.moves\s*=\s*\{([^}]*)\}/.exec(mon);
      const moves = movesMatch
        ? movesMatch[1]
            .split(',')
            .map((m) => m.trim().replace(/^MOVE_/, ''))
            .filter((m) => m.length > 0 && m !== 'NONE')
            .map((m) => normalize(m))
        : [];

      mons.push({ species, level, moves });
    }

    if (mons.length > 0) parties.set(label, mons);
  }
  return parties;
}

/** gTrainers[TRAINER_LEADER_BROCK] -> nome, classe e time. */
function parseTrainers(text: string, parties: Map<string, PartyMon[]>): Record<string, TrainerData> {
  const out: Record<string, TrainerData> = {};
  const entryRe = /\[(TRAINER_\w+)\]\s*=\s*\{([\s\S]*?)\n\s*\},/g;

  for (const match of text.matchAll(entryRe)) {
    const id = match[1];
    const body = match[2];
    const partyLabel = /\.party\s*=\s*\w+\(\s*sParty_(\w+)\s*\)/.exec(body)?.[1];
    if (!partyLabel) continue;
    const party = parties.get(partyLabel);
    if (!party || party.length === 0) continue;

    out[id] = {
      name: titleCase(/\.trainerName\s*=\s*_\("([^"]*)"\)/.exec(body)?.[1] ?? ''),
      trainerClass: /\.trainerClass\s*=\s*TRAINER_CLASS_(\w+)/.exec(body)?.[1] ?? 'UNKNOWN',
      party,
    };
  }
  return out;
}

/**
 * Route22_EventScript_X:: ... trainerbattle_single TRAINER_Y
 * O rotulo vale ate o proximo rotulo, entao pegamos a primeira batalha dentro dele.
 */
function parseScriptTrainers(text: string): [string, string][] {
  const pairs: [string, string][] = [];
  const lines = text.split(/\r?\n/);
  let currentLabel: string | null = null;

  for (const line of lines) {
    const label = /^(\w+)::/.exec(line);
    if (label) {
      currentLabel = label[1];
      continue;
    }
    const battle = /^\s*trainerbattle\w*\s+(TRAINER_\w+)/.exec(line);
    if (battle && currentLabel) {
      pairs.push([currentLabel, battle[1]]);
      currentLabel = null; // so a primeira batalha do rotulo interessa
    }
  }
  return pairs;
}

/** Map_Text_X:: .string "..." -> texto ja limpo para a caixa de dialogo. */
function parseTexts(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const blockRe = /^(\w+)::\s*\n((?:\s*\.string\s+"[\s\S]*?"\s*\n?)+)/gm;

  for (const match of text.matchAll(blockRe)) {
    const pieces: string[] = [];
    for (const line of match[2].matchAll(/\.string\s+"([\s\S]*?)"/g)) pieces.push(line[1]);
    const joined = cleanText(pieces.join(''));
    if (joined) out.set(match[1], joined);
  }
  return out;
}

/**
 * As falas do decomp estao em ingles. A traducao para portugues fica num mapa
 * a parte (tools/i18n/dialogue.pt.json), feito a mao: o que nao estiver la
 * continua como no original, e o build avisa quantas faltam.
 */
const PT: Record<string, string> = traducoes;
let semTraducao = 0;

function translate(text: string): string {
  const pt = PT[text];
  if (pt) return pt;
  semTraducao++;
  return text;
}

/**
 * Codigos de controle do script: \n quebra a linha, \p troca a caixa de texto,
 * \l rola, $ termina. Aqui tudo vira um paragrafo so, legivel na tela.
 */
function cleanText(raw: string): string {
  return raw
    .replace(/\$$/, '')
    .replace(/\\p/g, ' ')
    .replace(/\\n/g, ' ')
    .replace(/\\l/g, ' ')
    // {PLAYER} fica: o nome do treinador entra na hora de mostrar a fala.
    .replace(/\{(?!PLAYER\})[A-Z_0-9]+\}/g, '')
    .replace(/POK\u00e9MON/gi, 'Pokemon')
    .replace(/POK\u00e9/gi, 'Poke')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Primeira fala alcancavel a partir de cada rotulo de script.
 *
 * Os scripts do decomp costumam desviar antes de falar (`goto_if_set`,
 * `call_if_eq`...), entao seguimos os desvios ate achar um `msgbox`.
 */
function parseScriptMessages(text: string): [string, string][] {
  const bodies = new Map<string, string[]>();
  let current: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    const label = /^(\w+)::/.exec(line);
    if (label) {
      current = label[1];
      bodies.set(current, []);
      continue;
    }
    if (current) bodies.get(current)!.push(line);
  }

  const resolve = (label: string, depth: number, seen: Set<string>): string | null => {
    if (depth > 4 || seen.has(label)) return null;
    seen.add(label);
    const body = bodies.get(label);
    if (!body) return null;

    for (const line of body) {
      const message = /^\s*(?:msgbox|message)\s+(\w+_Text_\w+)/.exec(line);
      if (message) return message[1];

      // Desvio: o texto pode estar no rotulo de destino.
      const jump = /^\s*(?:goto|call)(?:_if_\w+)?\s+(?:[^,]+,\s*)?(\w+_EventScript_\w+)/.exec(line);
      if (jump) {
        const found = resolve(jump[1], depth + 1, seen);
        if (found) return found;
      }
    }
    return null;
  };

  const pairs: [string, string][] = [];
  for (const label of bodies.keys()) {
    const textLabel = resolve(label, 0, new Set());
    if (textLabel) pairs.push([label, textLabel]);
  }
  return pairs;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function titleCase(value: string): string {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

async function required(path: string): Promise<string> {
  const text = await fetchText('firered', path);
  if (!text) throw new Error(`arquivo obrigatorio nao encontrado: ${path}`);
  return text;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
