/**
 * O que acontece quando o jogador aperta A de frente para alguma coisa.
 * Tudo se resolve pelo rotulo de script e pelo grafico do NPC, que vieram do
 * decomp junto com os mapas.
 */
import type { RNG } from '../core/rng.js';
import {
  createPokemon,
  defaultMoveset,
  makeMoveSlot,
  maxHp,
  type Pokemon,
  type PokemonContext,
} from '../pokemon/pokemon.js';
import type { NpcState, Overworld } from './overworld.js';

export interface TrainerParty {
  species: number;
  level: number;
  moves: string[];
}

export interface TrainerData {
  name: string;
  trainerClass: string;
  party: TrainerParty[];
}

export interface EventsFile {
  trainers: Record<string, TrainerData>;
  byScript: Record<string, string>;
  dialogue: Record<string, string>;
}

export type Interaction =
  | { kind: 'talk'; text: string; npc: NpcState }
  | { kind: 'trainer'; trainerId: string; trainer: TrainerData; npc: NpcState }
  | { kind: 'heal'; npc: NpcState }
  | { kind: 'shop'; npc: NpcState }
  | { kind: 'sign'; text: string }
  | { kind: 'pc' }
  | null;

/** Classes de treinador em pt-BR, para a tela de batalha. */
export const TRAINER_CLASS_PT: Record<string, string> = {
  LEADER: 'Lider de Ginasio',
  ELITE_FOUR: 'Elite dos Quatro',
  CHAMPION: 'Campeao',
  RIVAL: 'Rival',
  YOUNGSTER: 'Jovem',
  LASS: 'Garota',
  BUG_CATCHER: 'Caçador de Insetos',
  HIKER: 'Montanhista',
  FISHERMAN: 'Pescador',
  SWIMMER_M: 'Nadador',
  SWIMMER_F: 'Nadadora',
  SAILOR: 'Marinheiro',
  SUPER_NERD: 'Nerd',
  SCIENTIST: 'Cientista',
  TEAM_ROCKET: 'Equipe Rocket',
  GAMER: 'Jogador',
  BURGLAR: 'Ladrao',
  ENGINEER: 'Engenheiro',
  JUGGLER: 'Malabarista',
  PSYCHIC_M: 'Psiquico',
  PSYCHIC_F: 'Psiquica',
  BIRD_KEEPER: 'Criador de Aves',
  BLACK_BELT: 'Faixa Preta',
  BIKER: 'Motoqueiro',
  CUE_BALL: 'Brigao',
  TAMER: 'Domador',
  BEAUTY: 'Beldade',
  POKEMANIAC: 'Pokemaniaco',
  ROCKER: 'Roqueiro',
  CHANNELER: 'Medium',
  GENTLEMAN: 'Cavalheiro',
  COOLTRAINER_M: 'Treinador Experiente',
  COOLTRAINER_F: 'Treinadora Experiente',
  CRUSH_GIRL: 'Lutadora',
  CRUSH_KIN: 'Dupla Lutadora',
  PAINTER: 'Pintora',
  TUBER_M: 'Menino de Boia',
  TUBER_F: 'Menina de Boia',
  CAMPER: 'Campista',
  PICNICKER: 'Piquenista',
  SCHOOL_KID_M: 'Estudante',
  SCHOOL_KID_F: 'Estudante',
};

export function trainerTitle(trainer: TrainerData): string {
  const label = TRAINER_CLASS_PT[trainer.trainerClass] ?? 'Treinador';
  return trainer.name ? `${label} ${trainer.name}` : label;
}

export function resolveInteraction(
  overworld: Overworld,
  events: EventsFile | null,
): Interaction {
  const facing = overworld.facingTile();
  const npc = overworld.npcAt(facing.x, facing.y);

  if (npc) {
    const script = npc.data.script;

    const trainerId = events?.byScript[script];
    if (trainerId && events?.trainers[trainerId]) {
      return { kind: 'trainer', trainerId, trainer: events.trainers[trainerId], npc };
    }

    if (isNurse(npc)) return { kind: 'heal', npc };
    if (isClerk(npc)) return { kind: 'shop', npc };

    const text = events?.dialogue[script];
    return { kind: 'talk', text: text ?? '…', npc };
  }

  const tile = overworld.world.tileAt(facing.x, facing.y);
  if (tile.behavior === 'pc') return { kind: 'pc' };
  if (tile.behavior === 'sign') {
    const sign = tile.map.signs.find((s) => s.x === tile.localX && s.y === tile.localY);
    const text = sign?.script ? events?.dialogue[sign.script] : undefined;
    return { kind: 'sign', text: text ?? 'Uma placa gasta pelo tempo.' };
  }
  return null;
}

function isNurse(npc: NpcState): boolean {
  return npc.data.gfx.includes('NURSE') || /Nurse/i.test(npc.data.script);
}

function isClerk(npc: NpcState): boolean {
  return npc.data.gfx.includes('CLERK') || /Clerk|Mart/i.test(npc.data.script);
}

/** Monta o time do treinador do jeito que o jogo original o define. */
export function buildTrainerParty(
  ctx: PokemonContext,
  rng: RNG,
  trainer: TrainerData,
): Pokemon[] {
  return trainer.party.map((entry) => {
    const moves =
      entry.moves.length > 0
        ? entry.moves.filter((id) => ctx.moves[id])
        : defaultMoveset(ctx, entry.species, entry.level);
    const pokemon = createPokemon(ctx, rng, {
      species: entry.species,
      level: entry.level,
      shinyChance: 0,
      moves,
    });
    // Times de treinador do FireRed tem IVs baixos; o jogador leva vantagem.
    pokemon.ivs = pokemon.ivs.map(() => 10);
    pokemon.moves = moves.slice(0, 4).map((id) => makeMoveSlot(ctx, id));
    // Os IVs mudaram depois da criacao, entao o HP precisa ser recalculado.
    pokemon.hp = maxHp(ctx, pokemon);
    return pokemon;
  });
}
