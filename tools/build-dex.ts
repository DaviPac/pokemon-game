/**
 * Gera os dados de Pokemon usados pelo jogo (Gen 1 a 6, #1-721).
 *
 * Duas fontes se completam:
 *  - @pkmn/dex (npm): especies, tipos, stats-base, habilidades, evolucoes,
 *    learnsets por nivel e a tabela de golpes.
 *  - CSVs do veekun/pokedex: taxa de captura, exp base, EV yield, grupo de
 *    crescimento e ciclos de choco -- coisas que o dado competitivo nao traz.
 *
 * Saida: public/assets/data/{species,moves,learnsets,typechart,natures}.json
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Dex } from '@pkmn/dex';
import { fetchText } from './lib/net.js';

const OUT_DATA = join(process.cwd(), 'public', 'assets', 'data');
const MAX_DEX = 721; // ate Volcanion, o fim de X/Y + ORAS
const GEN = 6;

const STAT_ORDER = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
const GROWTH_RATES: Record<number, string> = {
  1: 'slow',
  2: 'medium',
  3: 'fast',
  4: 'medium-slow',
  5: 'erratic',
  6: 'fluctuating',
};
/** Os 18 tipos que existem em X/Y. */
const GEN6_TYPES = [
  'Normal',
  'Fire',
  'Water',
  'Electric',
  'Grass',
  'Ice',
  'Fighting',
  'Poison',
  'Ground',
  'Flying',
  'Psychic',
  'Bug',
  'Rock',
  'Ghost',
  'Dragon',
  'Dark',
  'Steel',
  'Fairy',
] as const;

async function main(): Promise<void> {
  await mkdir(OUT_DATA, { recursive: true });
  const dex = Dex.forGen(GEN);
  const veekun = await loadVeekun();

  // --- Especies -----------------------------------------------------------
  const species: Record<number, unknown> = {};
  const byName = new Map<string, number>();
  const base = dex.species
    .all()
    .filter((s) => s.num >= 1 && s.num <= MAX_DEX && !s.forme && s.gen <= GEN);

  for (const s of base) {
    byName.set(s.id, s.num);
  }

  for (const s of base) {
    const extra = veekun.get(s.num);
    const abilities = [s.abilities[0], s.abilities[1], s.abilities.H].filter(Boolean) as string[];
    species[s.num] = {
      n: s.name,
      t: s.types,
      bs: STAT_ORDER.map((k) => s.baseStats[k]),
      ab: abilities,
      hidden: s.abilities.H ?? null,
      eg: s.eggGroups,
      // Proporcao de machos; -1 quando nao tem genero.
      gr: s.genderRatio ? s.genderRatio.M : s.gender === 'N' ? -1 : 0.5,
      w: s.weightkg,
      h: extra?.height ?? 0,
      catch: extra?.captureRate ?? 45,
      baseExp: extra?.baseExperience ?? 100,
      growth: extra?.growthRate ?? 'medium',
      ev: extra?.effort ?? [0, 0, 0, 0, 0, 0],
      hatch: extra?.hatchCounter ?? 20,
      friendship: extra?.baseHappiness ?? 70,
      evos: buildEvolutions(dex, s.name, byName),
      prevo: s.prevo ? (byName.get(toId(s.prevo)) ?? null) : null,
      legendary: extra?.legendary ?? false,
      mythical: extra?.mythical ?? false,
    };
  }
  console.log(`[dex] ${Object.keys(species).length} especies`);

  // --- Learnsets ----------------------------------------------------------
  const learnsets: Record<number, [number, string][]> = {};
  for (const s of base) {
    const merged = new Map<string, number>();
    // Herdar o que a linha evolutiva aprende: um Ivysaur selvagem de nivel 20
    // ainda conta com os golpes que Bulbasaur pegou cedo.
    for (const name of evolutionChain(dex, s.name)) {
      const data = await dex.learnsets.get(name);
      for (const [move, sources] of Object.entries(data?.learnset ?? {})) {
        for (const source of sources as string[]) {
          const match = /^6L(\d+)$/.exec(source);
          if (!match) continue;
          const level = Number(match[1]);
          const current = merged.get(move);
          if (current === undefined || level < current) merged.set(move, level);
        }
      }
    }
    const list = [...merged.entries()]
      .map(([move, level]): [number, string] => [level, move])
      .sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
    if (list.length > 0) learnsets[s.num] = list;
  }
  const learnCount = Object.values(learnsets).reduce((acc, l) => acc + l.length, 0);
  console.log(`[dex] ${learnCount} entradas de learnset`);

  // --- Golpes -------------------------------------------------------------
  const moves: Record<string, unknown> = {};
  for (const m of dex.moves.all()) {
    if (m.gen > GEN || m.isNonstandard) continue;
    if (!GEN6_TYPES.includes(m.type as (typeof GEN6_TYPES)[number])) continue;
    moves[m.id] = {
      n: m.name,
      t: m.type,
      cat: m.category, // Physical | Special | Status
      bp: m.basePower,
      acc: m.accuracy === true ? null : m.accuracy, // null = nunca erra
      pp: m.pp,
      pri: m.priority,
      target: m.target,
      contact: m.flags.contact === 1,
      protect: m.flags.protect === 1,
      sound: m.flags.sound === 1,
      punch: m.flags.punch === 1,
      crit: m.critRatio ?? 1,
      multihit: m.multihit ?? null,
      drain: m.drain ?? null,
      recoil: m.recoil ?? null,
      heal: m.heal ?? null,
      status: m.status ?? null,
      volatile: m.volatileStatus ?? null,
      boosts: m.boosts ?? null,
      self: m.self?.boosts ? { boosts: m.self.boosts } : null,
      secondary: normalizeSecondary(m.secondary),
      ohko: Boolean(m.ohko),
      forceSwitch: Boolean(m.forceSwitch),
      selfSwitch: m.selfSwitch ?? null,
      selfdestruct: m.selfdestruct ?? null,
      breaksProtect: Boolean(m.breaksProtect),
      thaws: Boolean(m.thawsTarget),
      willCrit: Boolean(m.willCrit),
      ignoreImmunity: m.ignoreImmunity === true,
      desc: m.shortDesc,
    };
  }
  console.log(`[dex] ${Object.keys(moves).length} golpes`);

  // --- Tabela de tipos ----------------------------------------------------
  // effectiveness[atacante][defensor] = multiplicador
  const typechart: Record<string, Record<string, number>> = {};
  for (const attacker of GEN6_TYPES) {
    typechart[attacker] = {};
    for (const defender of GEN6_TYPES) {
      const taken = dex.types.get(defender)?.damageTaken?.[attacker];
      typechart[attacker][defender] = taken === 1 ? 2 : taken === 2 ? 0.5 : taken === 3 ? 0 : 1;
    }
  }

  // --- Naturezas ----------------------------------------------------------
  const natures: Record<string, { plus: string | null; minus: string | null }> = {};
  for (const n of dex.natures.all()) {
    natures[n.id] = { plus: n.plus ?? null, minus: n.minus ?? null };
  }

  await writeFile(join(OUT_DATA, 'species.json'), JSON.stringify(species));
  await writeFile(join(OUT_DATA, 'learnsets.json'), JSON.stringify(learnsets));
  await writeFile(join(OUT_DATA, 'moves.json'), JSON.stringify(moves));
  await writeFile(join(OUT_DATA, 'typechart.json'), JSON.stringify(typechart));
  await writeFile(join(OUT_DATA, 'natures.json'), JSON.stringify(natures));
  console.log('[dex] pronto');
}

function normalizeSecondary(secondary: unknown): unknown {
  if (!secondary || typeof secondary !== 'object') return null;
  const s = secondary as Record<string, unknown>;
  return {
    chance: s.chance ?? 100,
    status: s.status ?? null,
    volatile: s.volatileStatus ?? null,
    boosts: s.boosts ?? null,
    self: (s.self as { boosts?: unknown })?.boosts ?? null,
  };
}

interface EvolutionEntry {
  to: number;
  kind: string;
  level: number | null;
  item: string | null;
  condition: string | null;
}

function buildEvolutions(
  dex: ReturnType<typeof Dex.forGen>,
  name: string,
  byName: Map<string, number>,
): EvolutionEntry[] {
  const parent = dex.species.get(name);
  const out: EvolutionEntry[] = [];
  for (const evoName of parent.evos ?? []) {
    const child = dex.species.get(evoName);
    const num = byName.get(child.id);
    if (num === undefined) continue; // forma de geracao posterior
    out.push({
      to: num,
      kind: child.evoType ?? 'level',
      level: child.evoLevel ?? null,
      item: child.evoItem ?? null,
      condition: child.evoCondition ?? null,
    });
  }
  return out;
}

/** Nome da especie e de todos os seus pre-evoluidos, do mais novo ao mais velho. */
function evolutionChain(dex: ReturnType<typeof Dex.forGen>, name: string): string[] {
  const chain: string[] = [];
  let current = dex.species.get(name);
  while (current) {
    chain.push(current.name);
    if (!current.prevo) break;
    current = dex.species.get(current.prevo);
  }
  return chain;
}

function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface VeekunEntry {
  height: number;
  captureRate: number;
  baseExperience: number;
  growthRate: string;
  effort: number[];
  hatchCounter: number;
  baseHappiness: number;
  legendary: boolean;
  mythical: boolean;
}

/** Le os CSVs do veekun com os numeros que o dado competitivo nao cobre. */
async function loadVeekun(): Promise<Map<number, VeekunEntry>> {
  const speciesCsv = parseCsv(await veekunFile('pokemon_species.csv'));
  const pokemonCsv = parseCsv(await veekunFile('pokemon.csv'));
  const statsCsv = parseCsv(await veekunFile('pokemon_stats.csv'));

  const effortBySpecies = new Map<number, number[]>();
  const defaultPokemonId = new Map<number, number>(); // species_id -> pokemon_id
  for (const row of pokemonCsv) {
    if (row.is_default !== '1') continue;
    defaultPokemonId.set(Number(row.species_id), Number(row.id));
  }
  const pokemonToSpecies = new Map<number, number>(
    [...defaultPokemonId.entries()].map(([species, pokemon]) => [pokemon, species]),
  );

  for (const row of statsCsv) {
    const speciesId = pokemonToSpecies.get(Number(row.pokemon_id));
    if (speciesId === undefined) continue;
    const statIndex = Number(row.stat_id) - 1; // 1..6 na mesma ordem de STAT_ORDER
    if (statIndex < 0 || statIndex > 5) continue;
    const arr = effortBySpecies.get(speciesId) ?? [0, 0, 0, 0, 0, 0];
    arr[statIndex] = Number(row.effort);
    effortBySpecies.set(speciesId, arr);
  }

  const baseExpBySpecies = new Map<number, number>();
  const heightBySpecies = new Map<number, number>();
  for (const row of pokemonCsv) {
    if (row.is_default !== '1') continue;
    baseExpBySpecies.set(Number(row.species_id), Number(row.base_experience || 100));
    // O CSV guarda altura em decimetros.
    heightBySpecies.set(Number(row.species_id), Number(row.height) / 10);
  }

  const out = new Map<number, VeekunEntry>();
  for (const row of speciesCsv) {
    const id = Number(row.id);
    if (id > MAX_DEX) continue;
    out.set(id, {
      height: heightBySpecies.get(id) ?? 0,
      captureRate: Number(row.capture_rate),
      baseExperience: baseExpBySpecies.get(id) ?? 100,
      growthRate: GROWTH_RATES[Number(row.growth_rate_id)] ?? 'medium',
      effort: effortBySpecies.get(id) ?? [0, 0, 0, 0, 0, 0],
      hatchCounter: Number(row.hatch_counter),
      baseHappiness: Number(row.base_happiness),
      legendary: row.is_legendary === '1',
      mythical: row.is_mythical === '1',
    });
  }
  return out;
}

async function veekunFile(name: string): Promise<string> {
  const text = await fetchText('veekun', `pokedex/data/csv/${name}`);
  if (!text) throw new Error(`CSV do veekun nao encontrado: ${name}`);
  return text;
}

/** Parser de CSV suficiente para os arquivos do veekun (aspas simples, sem \n dentro). */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) row[header[c]] = values[c] ?? '';
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else quoted = false;
      } else current += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(current);
      current = '';
    } else current += ch;
  }
  out.push(current);
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
