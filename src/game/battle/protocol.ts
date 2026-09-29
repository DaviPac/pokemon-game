/**
 * Leitor do protocolo do Pokemon Showdown.
 *
 * O simulador escreve o combate como linhas de texto (`|move|p1a: ...|Tackle`)
 * -- o mesmo formato que o cliente do Showdown recebe pela rede. Aqui essas
 * linhas viram os eventos que a tela de batalha ja sabe animar, com o texto de
 * cada acontecimento em portugues.
 *
 * O leitor guarda o HP de cada Pokemon conforme o log avanca, para que cada
 * evento carregue o estado daquele instante e nao o do fim do turno.
 */
import type { Pokemon } from '../pokemon/pokemon.js';
import type { BattleEvent, Effectiveness, Side } from './types.js';
import type { StatusName } from '../data/types.js';

/** Quem o log esta citando, ja traduzido para a equipe do jogo. */
export interface Resolved {
  side: Side;
  /** Posicao na equipe do jogo (nao na do simulador, que se reordena). */
  index: number;
  pokemon: Pokemon;
}

/** O que o leitor precisa saber do motor para contar a historia. */
export interface ReaderHost {
  kind: 'wild' | 'trainer';
  foeName?: string;
  /** Traduz "p1a: m2" (ou "p1: m2") para o Pokemon do jogo. */
  resolve(ident: string): Resolved | null;
  /** Nome como aparece no texto: "Pidgey", "Pidgey selvagem"... */
  label(side: Side, pokemon: Pokemon): string;
  /** So o nome (ou apelido), sem "selvagem" nem "adversario". */
  plain(pokemon: Pokemon): string;
  /** Nome de um golpe a partir do identificador do Showdown. */
  moveName(id: string): string;
  /** Chamado quando alguem entra em campo. */
  onSwitchIn(side: Side, index: number): void;
  /** Eventos extras depois de um nocaute (EXP, nivel...). */
  onFaint(side: Side, index: number): BattleEvent[];
}

const STATUS_IDS: StatusName[] = ['brn', 'par', 'slp', 'frz', 'psn', 'tox'];

/** Nome do atributo e o artigo que combina com ele. */
const STATS: Record<string, { name: string; article: 'O' | 'A' }> = {
  atk: { name: 'Ataque', article: 'O' },
  def: { name: 'Defesa', article: 'A' },
  spa: { name: 'Ataque Especial', article: 'O' },
  spd: { name: 'Defesa Especial', article: 'A' },
  spe: { name: 'Velocidade', article: 'A' },
  accuracy: { name: 'Precisao', article: 'A' },
  evasion: { name: 'Evasao', article: 'A' },
};

const WEATHER: Record<string, { start: string; upkeep: string; end: string; damage?: string }> = {
  raindance: {
    start: 'Comecou a chover!',
    upkeep: 'A chuva continua caindo.',
    end: 'A chuva parou.',
  },
  sunnyday: {
    start: 'A luz do sol ficou forte!',
    upkeep: 'O sol esta forte.',
    end: 'A luz do sol voltou ao normal.',
  },
  sandstorm: {
    start: 'Uma tempestade de areia se formou!',
    upkeep: 'A tempestade de areia continua.',
    end: 'A tempestade de areia passou.',
    damage: '[P] foi castigado pela tempestade de areia!',
  },
  hail: {
    start: 'Comecou a cair granizo!',
    upkeep: 'O granizo continua caindo.',
    end: 'O granizo parou.',
    damage: '[P] foi castigado pelo granizo!',
  },
  desolateland: {
    start: 'A luz do sol ficou extremamente forte!',
    upkeep: 'O sol continua ardendo.',
    end: 'O sol extremo se foi.',
  },
  primordialsea: {
    start: 'Uma chuva torrencial comecou!',
    upkeep: 'A chuva torrencial continua.',
    end: 'A chuva torrencial passou.',
  },
  deltastream: {
    start: 'Ventos misteriosos protegem os Pokemon voadores!',
    upkeep: 'Os ventos misteriosos continuam.',
    end: 'Os ventos misteriosos se foram.',
  },
};

const STATUS_TEXT: Record<
  StatusName,
  { start: string; end: string; cant?: string; damage?: string; already: string }
> = {
  brn: {
    start: '[P] foi queimado!',
    end: 'A queimadura de [P] sarou!',
    damage: '[P] sofre com a queimadura!',
    already: '[P] ja esta queimado!',
  },
  par: {
    start: '[P] foi paralisado! Talvez nao consiga se mexer!',
    end: '[P] se curou da paralisia!',
    cant: '[P] esta paralisado! Nao consegue se mexer!',
    already: '[P] ja esta paralisado!',
  },
  slp: {
    start: '[P] caiu no sono!',
    end: '[P] acordou!',
    cant: '[P] esta dormindo profundamente.',
    already: '[P] ja esta dormindo!',
  },
  frz: {
    start: '[P] foi congelado!',
    end: '[P] descongelou!',
    cant: '[P] esta congelado!',
    already: '[P] ja esta congelado!',
  },
  psn: {
    start: '[P] foi envenenado!',
    end: '[P] se curou do veneno!',
    damage: '[P] sofre com o veneno!',
    already: '[P] ja esta envenenado!',
  },
  tox: {
    start: '[P] foi gravemente envenenado!',
    end: '[P] se curou do veneno!',
    damage: '[P] sofre com o veneno!',
    already: '[P] ja esta envenenado!',
  },
};

/** Efeitos que comecam num Pokemon (`-start`) e acabam (`-end`). */
const VOLATILE_TEXT: Record<string, { start?: string; end?: string; activate?: string }> = {
  confusion: {
    start: '[P] ficou confuso!',
    end: '[P] saiu da confusao!',
    activate: '[P] esta confuso!',
  },
  substitute: {
    start: '[P] criou um substituto!',
    end: 'O substituto de [P] sumiu!',
    activate: 'O substituto levou o golpe no lugar de [P]!',
  },
  leechseed: { start: '[P] foi semeado!', end: '[P] se livrou do Leech Seed!' },
  taunt: { start: '[P] caiu na provocacao!', end: '[P] nao esta mais provocado.' },
  encore: { start: '[P] ganhou um bis!', end: 'O bis de [P] acabou!' },
  disable: { start: 'O golpe [M] de [P] foi desativado!', end: '[P] pode usar seus golpes de novo.' },
  attract: { start: '[P] se apaixonou!', end: '[P] superou a paixao.' },
  yawn: { start: '[P] ficou sonolento!' },
  focusenergy: { start: '[P] esta se concentrando para o golpe!' },
  curse: { start: '[S] cortou o proprio HP e amaldicoou [P]!' },
  nightmare: { start: '[P] comecou a ter um pesadelo!' },
  ingrain: { start: '[P] fincou raizes!' },
  aquaring: { start: '[P] se cercou de um veu de agua!' },
  magnetrise: { start: '[P] levitou com o eletromagnetismo!', end: 'O eletromagnetismo de [P] acabou!' },
  stockpile: { start: '[P] acumulou energia!' },
  charge: { start: '[P] comecou a carregar energia!' },
  foresight: { start: '[P] foi identificado!' },
  odorsleuth: { start: '[P] foi identificado!' },
  miracleeye: { start: '[P] foi identificado!' },
  torment: { start: '[P] esta sendo atormentado!', end: '[P] nao esta mais atormentado.' },
  embargo: { start: '[P] nao pode mais usar itens!', end: '[P] pode usar itens de novo.' },
  healblock: { start: '[P] nao pode mais se curar!', end: '[P] pode se curar de novo.' },
  smackdown: { start: '[P] caiu no chao!' },
  flashfire: { start: 'O poder dos golpes de fogo de [P] aumentou!' },
  bide: { start: '[P] esta guardando energia!', end: '[P] liberou a energia!' },
  uproar: { start: '[P] comecou a fazer algazarra!', end: '[P] se acalmou.' },
  destinybond: { activate: '[P] levou o oponente junto!' },
  perish3: { start: 'A contagem de [P] caiu para 3!' },
  perish2: { start: 'A contagem de [P] caiu para 2!' },
  perish1: { start: 'A contagem de [P] caiu para 1!' },
  perish0: { start: 'A contagem de [P] chegou a 0!' },
  mustrecharge: {},
  typechange: { start: '[P] mudou de tipo!' },
  telekinesis: { start: '[P] foi erguido no ar!', end: '[P] voltou ao chao.' },
  autotomize: { start: '[P] ficou mais leve!' },
  imprison: { start: '[P] selou os golpes do oponente!' },
  powertrick: { start: '[P] trocou Ataque por Defesa!' },
  slowstart: { start: '[P] nao consegue engrenar!', end: '[P] finalmente engrenou!' },
  protect: { activate: '[P] se protegeu!' },
  kingsshield: { activate: '[P] se protegeu!' },
  spikyshield: { activate: '[P] se protegeu!' },
  endure: { activate: '[P] aguentou o golpe!' },
  sturdy: { activate: '[P] aguentou firme!' },
  focussash: { activate: '[P] aguentou firme com a Focus Sash!' },
  focusband: { activate: '[P] aguentou firme com a Focus Band!' },
  trapped: { start: '[P] nao pode mais fugir!' },
  struggle: { activate: '[P] nao tem mais golpes!' },
  magiccoat: { activate: '[P] rebateu o golpe!' },
  quickguard: { activate: 'O Quick Guard protegeu [P]!' },
  wideguard: { activate: 'O Wide Guard protegeu [P]!' },
  safeguard: { activate: '[P] esta protegido pelo Safeguard!' },
  mist: { activate: '[P] esta protegido pela nevoa!' },
  lockon: { activate: '[S] mirou em [P]!' },
  mindreader: { activate: '[S] mirou em [P]!' },
  painsplit: { activate: 'Os dois dividiram a dor!' },
  spite: { activate: 'O PP de [M] de [P] foi reduzido!' },
  grudge: { activate: 'O rancor tirou todo o PP de [M]!' },
  sketch: { activate: '[P] copiou [M]!' },
  mimic: { activate: '[P] aprendeu [M]!' },
  skillswap: { activate: '[P] trocou de habilidade com o oponente!' },
  trick: { activate: '[P] trocou de item com o oponente!' },
  switcheroo: { activate: '[P] trocou de item com o oponente!' },
  healbell: { activate: 'Um sino tocou!' },
  aromatherapy: { activate: 'Um aroma calmante se espalhou!' },
  pursuit: { activate: '[P] vai ser atacado na saida!' },
};

/** Golpes presos que prendem e machucam por turnos. */
const PARTIAL_TRAP = new Set([
  'bind',
  'wrap',
  'firespin',
  'clamp',
  'whirlpool',
  'sandtomb',
  'magmastorm',
  'infestation',
]);

const SIDE_TEXT: Record<string, { start: string; end?: string }> = {
  reflect: {
    start: 'Reflect aumentou a resistencia de [T] a golpes fisicos!',
    end: 'O Reflect de [T] acabou!',
  },
  lightscreen: {
    start: 'Light Screen aumentou a resistencia de [T] a golpes especiais!',
    end: 'A Light Screen de [T] acabou!',
  },
  safeguard: {
    start: '[T] ficou envolta num veu mistico!',
    end: '[T] nao esta mais protegida pelo Safeguard!',
  },
  mist: { start: '[T] ficou envolta em nevoa!', end: 'A nevoa de [T] se dissipou!' },
  tailwind: { start: 'Um vento de cauda soprou atras de [T]!', end: 'O vento de cauda de [T] parou!' },
  luckychant: { start: 'O Lucky Chant protege [T] de criticos!', end: 'O Lucky Chant de [T] acabou!' },
  spikes: { start: 'Espinhos se espalharam aos pes de [T]!', end: 'Os espinhos de [T] sumiram!' },
  toxicspikes: {
    start: 'Espinhos venenosos se espalharam aos pes de [T]!',
    end: 'Os espinhos venenosos de [T] sumiram!',
  },
  stealthrock: {
    start: 'Pedras pontudas flutuam em volta de [T]!',
    end: 'As pedras pontudas em volta de [T] sumiram!',
  },
  stickyweb: { start: 'Uma teia pegajosa se espalhou sob [T]!', end: 'A teia sob [T] sumiu!' },
};

const FIELD_TEXT: Record<string, { start: string; end: string }> = {
  trickroom: { start: '[S] distorceu as dimensoes!', end: 'As dimensoes voltaram ao normal!' },
  gravity: { start: 'A gravidade se intensificou!', end: 'A gravidade voltou ao normal!' },
  magicroom: {
    start: 'Uma area estranha anulou os itens seguros!',
    end: 'Os itens voltaram a funcionar!',
  },
  wonderroom: {
    start: 'Uma area estranha trocou Defesa por Defesa Especial!',
    end: 'Defesa e Defesa Especial voltaram ao normal!',
  },
  mudsport: { start: 'A eletricidade ficou mais fraca!', end: 'O efeito do Mud Sport passou.' },
  watersport: { start: 'O fogo ficou mais fraco!', end: 'O efeito do Water Sport passou.' },
  electricterrain: { start: 'Uma corrente eletrica cobriu o campo!', end: 'A eletricidade sumiu do campo.' },
  grassyterrain: { start: 'A grama cresceu e cobriu o campo!', end: 'A grama sumiu do campo.' },
  mistyterrain: { start: 'Uma nevoa cobriu o campo!', end: 'A nevoa sumiu do campo.' },
  psychicterrain: { start: 'O campo ficou esquisito!', end: 'O campo voltou ao normal.' },
};

/** Falas do primeiro turno de golpes que carregam antes de atacar. */
const PREPARE_TEXT: Record<string, string> = {
  solarbeam: '[P] absorveu a luz do sol!',
  fly: '[P] voou bem alto!',
  dig: '[P] cavou um buraco!',
  dive: '[P] mergulhou!',
  bounce: '[P] saltou bem alto!',
  skullbash: '[P] abaixou a cabeca!',
  razorwind: '[P] criou um redemoinho!',
  skyattack: '[P] esta envolto numa luz forte!',
  shadowforce: '[P] sumiu num piscar de olhos!',
  phantomforce: '[P] sumiu num piscar de olhos!',
  freezeshock: '[P] esta envolto em gelo!',
  iceburn: '[P] esta envolto em ar gelado!',
  geomancy: '[P] esta absorvendo energia!',
  skydrop: '[P] levou [T] para o ceu!',
};

/** Parte o texto "tipo: Nome" em partes. */
function splitEffect(effect: string): { kind: string; name: string; id: string } {
  const match = /^(move|ability|item|pokemon):\s*(.*)$/.exec(effect);
  const kind = match ? match[1] : '';
  const name = match ? match[2] : effect;
  return { kind, name, id: toId(name) };
}

export function toId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Le "25/31 par", "0 fnt" etc. */
function parseHealth(text: string): { hp: number; maxHp: number | null; status: StatusName | null; fainted: boolean } {
  const [amounts, status] = text.split(' ');
  const [hp, max] = amounts.split('/');
  const known = STATUS_IDS.includes(status as StatusName) ? (status as StatusName) : null;
  return {
    hp: Number(hp) || 0,
    maxHp: max ? Number(max) : null,
    status: known,
    fainted: status === 'fnt',
  };
}

interface Tracked {
  hp: number;
  maxHp: number;
}

interface Pending {
  crit: boolean;
  effectiveness: Effectiveness;
}

export class ProtocolReader {
  private readonly host: ReaderHost;
  /** HP conhecido de cada Pokemon, por "lado:indice". */
  private health = new Map<string, Tracked>();
  /** Quem esta em campo de cada lado, pela posicao na equipe do jogo. */
  private active: Record<Side, number | null> = { player: null, foe: null };
  private fainted = new Set<string>();
  /** Critico e efetividade chegam antes do dano; o texto sai depois dele. */
  private pending = new Map<Side, Pending>();
  private weather: string | null = null;
  private events: BattleEvent[] = [];

  constructor(host: ReaderHost) {
    this.host = host;
  }

  /** HP que o log mostrou por ultimo para este Pokemon. */
  healthOf(side: Side, index: number): Tracked | null {
    return this.health.get(`${side}:${index}`) ?? null;
  }

  /** Acerta o HP conhecido depois de algo feito por fora do simulador. */
  setHealth(side: Side, index: number, hp: number, maxHp: number): void {
    this.health.set(`${side}:${index}`, { hp, maxHp });
    if (hp > 0) this.fainted.delete(`${side}:${index}`);
  }

  read(lines: string[]): BattleEvent[] {
    this.events = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('|split|')) {
        // A linha seguinte e a versao exata (com o HP em pontos); a outra e a
        // mesma coisa para o espectador, e so repete o acontecimento.
        if (i + 1 < lines.length) this.line(lines[i + 1]);
        i += 2;
        continue;
      }
      this.line(line);
    }
    this.flushPending();
    return this.events;
  }

  // --- Saida ----------------------------------------------------------------

  private push(event: BattleEvent): void {
    this.events.push(event);
  }

  private say(text: string): void {
    if (text) this.events.push({ t: 'text', text });
  }

  /** Troca [P], [S], [T] e [M] pelos nomes. */
  private fill(template: string, names: { p?: string; s?: string; t?: string; m?: string }): string {
    return template
      .replace(/\[P\]/g, names.p ?? '')
      .replace(/\[S\]/g, names.s ?? '')
      .replace(/\[T\]/g, names.t ?? '')
      .replace(/\[M\]/g, names.m ?? '');
  }

  private name(who: Resolved | null): string {
    return who ? this.host.label(who.side, who.pokemon) : '';
  }

  /** Critico e efetividade que nao chegaram a virar dano (substituto, por ex.). */
  private flushPending(): void {
    for (const [, pending] of this.pending) this.sayPending(pending);
    this.pending.clear();
  }

  private sayPending(pending: Pending): void {
    if (pending.crit) this.say('Foi um acerto critico!');
    if (pending.effectiveness === 'super') this.say('Foi super eficaz!');
    if (pending.effectiveness === 'resisted') this.say('Nao foi muito eficaz...');
  }

  private pendingFor(side: Side): Pending {
    let pending = this.pending.get(side);
    if (!pending) {
      pending = { crit: false, effectiveness: 'normal' };
      this.pending.set(side, pending);
    }
    return pending;
  }

  // --- Linhas ---------------------------------------------------------------

  private line(line: string): void {
    if (!line.startsWith('|')) return;
    const parts = line.slice(1).split('|');
    const kind = parts[0];
    const args: string[] = [];
    const tags: Record<string, string> = {};
    for (const part of parts.slice(1)) {
      const tag = /^\[(\w+)\]\s?(.*)$/.exec(part);
      if (tag) tags[tag[1]] = tag[2];
      else args.push(part);
    }

    if (kind !== '-crit' && kind !== '-supereffective' && kind !== '-resisted' && kind !== '-damage') {
      this.flushPending();
    }

    switch (kind) {
      case 'switch':
      case 'drag':
      case 'replace':
        this.switchIn(kind, args);
        break;
      case 'move':
        this.move(args, tags);
        break;
      case '-anim':
        this.anim(args);
        break;
      case 'cant':
        this.cant(args);
        break;
      case 'faint':
        this.faint(args);
        break;
      case '-damage':
        this.damage(args, tags);
        break;
      case '-heal':
        this.heal(args, tags);
        break;
      case '-sethp':
        this.setHp(args, tags);
        break;
      case '-status':
        this.status(args, tags);
        break;
      case '-curestatus':
        this.cureStatus(args, tags);
        break;
      case '-cureteam':
        this.cureTeam(args);
        break;
      case '-boost':
      case '-unboost':
        this.boost(kind === '-boost' ? 1 : -1, args, tags);
        break;
      case '-setboost':
        this.setBoost(args, tags);
        break;
      case '-clearboost':
      case '-clearallboost':
      case '-clearnegativeboost':
      case '-invertboost':
      case '-swapboost':
      case '-copyboost':
        this.clearBoost(kind, args);
        break;
      case '-weather':
        this.weatherLine(args, tags);
        break;
      case '-fieldstart':
      case '-fieldend':
        this.field(kind === '-fieldstart', args, tags);
        break;
      case '-sidestart':
      case '-sideend':
        this.sideCondition(kind === '-sidestart', args);
        break;
      case '-start':
        this.volatileStart(args, tags);
        break;
      case '-end':
        this.volatileEnd(args, tags);
        break;
      case '-activate':
        this.activate(args, tags);
        break;
      case '-crit':
        this.flag(args, (p) => (p.crit = true));
        break;
      case '-supereffective':
        this.flag(args, (p) => (p.effectiveness = 'super'));
        break;
      case '-resisted':
        this.flag(args, (p) => (p.effectiveness = 'resisted'));
        break;
      case '-immune':
        this.immune(args, tags);
        break;
      case '-miss':
        this.miss(args);
        break;
      case '-fail':
        this.fail(args, tags);
        break;
      case '-block':
        this.say(`${this.name(this.host.resolve(args[0]))} bloqueou o golpe!`);
        break;
      case '-notarget':
        this.say('Mas nao havia alvo...');
        break;
      case '-ohko':
        this.say('Foi um nocaute de um golpe so!');
        break;
      case '-hitcount': {
        const hits = Number(args[1]) || 1;
        this.say(hits === 1 ? 'Acertou 1 vez!' : `Acertou ${hits} vezes!`);
        break;
      }
      case '-prepare':
        this.prepare(args);
        break;
      case '-nothing':
        this.say('Mas nada aconteceu!');
        break;
      case '-singleturn':
      case '-singlemove':
        this.singleTurn(args);
        break;
      case '-item':
        this.item(args, tags);
        break;
      case '-enditem':
        this.endItem(args, tags);
        break;
      case '-ability':
        this.ability(args, tags);
        break;
      case '-transform': {
        const who = this.host.resolve(args[0]);
        const into = this.host.resolve(args[1]);
        this.say(`${this.name(who)} se transformou em ${into ? this.host.plain(into.pokemon) : 'outro Pokemon'}!`);
        break;
      }
      case '-formechange':
      case 'detailschange':
        break;
      case '-mustrecharge':
      case '-hint':
      case '-center':
      case '-combine':
      case '-waiting':
      case '-zpower':
      case '-mega':
      case '-primal':
      case '-endability':
        break;
      case '-message':
        this.say(args[0] ?? '');
        break;
      default:
        // turn, upkeep, t:, player, gen, win... ficam com o motor ou nao
        // aparecem na tela.
        break;
    }
  }

  private switchIn(kind: string, args: string[]): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const health = parseHealth(args[2] ?? '');
    const key = `${who.side}:${who.index}`;
    const maxHp = health.maxHp ?? this.health.get(key)?.maxHp ?? health.hp;
    this.health.set(key, { hp: health.hp, maxHp });

    const previous = this.active[who.side];
    const trainer = this.host.foeName ?? 'O oponente';
    const name = this.name(who);

    if (kind === 'drag') {
      this.say(`${name} foi arrastado para a batalha!`);
    } else if (who.side === 'player') {
      if (previous !== null && previous !== who.index && !this.fainted.has(`player:${previous}`)) {
        const old = this.host.resolve(`p1: m${previous}`);
        if (old) this.say(`Volte, ${this.name(old)}!`);
      }
      this.say(`Vai, ${name}!`);
    } else if (this.host.kind === 'wild') {
      if (previous === null) this.say(`Um ${name} apareceu!`);
    } else {
      if (previous !== null && previous !== who.index && !this.fainted.has(`foe:${previous}`)) {
        const old = this.host.resolve(`p2: m${previous}`);
        if (old) this.say(`${trainer} recolheu ${this.host.plain(old.pokemon)}!`);
      }
      this.say(`${trainer} enviou ${this.host.plain(who.pokemon)}!`);
    }

    this.active[who.side] = who.index;
    this.host.onSwitchIn(who.side, who.index);
    this.push({
      t: 'sendOut',
      side: who.side,
      index: who.index,
      hp: health.hp,
      maxHp,
      status: health.status,
      entrance: who.side === 'player' ? 'player' : this.host.kind === 'trainer' || kind === 'drag' ? 'trainer' : 'wild',
    });
  }

  private move(args: string[], tags: Record<string, string>): void {
    const user = this.host.resolve(args[0]);
    if (!user) return;
    const id = toId(args[1] ?? '');
    const target = args[2] ? this.host.resolve(args[2]) : null;
    this.say(`${this.name(user)} usou ${this.host.moveName(id)}!`);
    this.push({
      t: 'useMove',
      side: user.side,
      move: id,
      target: target?.side ?? null,
      miss: 'miss' in tags || undefined,
      still: 'still' in tags || undefined,
    });
  }

  private anim(args: string[]): void {
    const user = this.host.resolve(args[0]);
    if (!user) return;
    const target = args[2] ? this.host.resolve(args[2]) : null;
    this.push({ t: 'useMove', side: user.side, move: toId(args[1] ?? ''), target: target?.side ?? null });
  }

  private cant(args: string[]): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const reason = splitEffect(args[1] ?? '');
    const name = this.name(who);
    const move = args[2] ? this.host.moveName(toId(args[2])) : 'o golpe';

    const status = STATUS_TEXT[reason.id as StatusName];
    if (status?.cant) {
      this.push({ t: 'anim', side: who.side, anim: reason.id });
      this.say(this.fill(status.cant, { p: name }));
      return;
    }

    switch (reason.id) {
      case 'flinch':
        this.say(`${name} recuou e nao conseguiu se mexer!`);
        return;
      case 'recharge':
        this.say(`${name} precisa recarregar!`);
        return;
      case 'nopp':
        this.say(`${name} usou ${move}! Mas nao sobrou PP para o golpe!`);
        return;
      case 'attract':
        this.push({ t: 'anim', side: who.side, anim: 'attracted' });
        this.say(`${name} esta apaixonado e nao consegue atacar!`);
        return;
      case 'disable':
        this.say(`${name} nao pode usar ${move} porque foi desativado!`);
        return;
      case 'taunt':
        this.say(`${name} nao pode usar ${move} depois da provocacao!`);
        return;
      case 'imprison':
        this.say(`${name} nao pode usar o golpe selado ${move}!`);
        return;
      case 'healblock':
        this.say(`${name} nao pode usar ${move} porque nao pode se curar!`);
        return;
      case 'gravity':
        this.say(`${name} nao pode usar ${move} por causa da gravidade!`);
        return;
      case 'truant':
        this.say(`${name} esta de preguica!`);
        return;
      case 'focuspunch':
        this.say(`${name} perdeu a concentracao e nao conseguiu se mexer!`);
        return;
      default:
        this.say(`${name} nao conseguiu se mexer!`);
    }
  }

  private faint(args: string[]): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const key = `${who.side}:${who.index}`;
    this.fainted.add(key);
    const tracked = this.health.get(key);
    if (tracked) tracked.hp = 0;
    this.push({ t: 'faint', side: who.side, uid: who.pokemon.uid });
    this.say(`${this.name(who)} desmaiou!`);
    for (const event of this.host.onFaint(who.side, who.index)) this.push(event);
  }

  /** Aplica o novo HP e devolve quanto mudou. */
  private track(who: Resolved, text: string): { hp: number; maxHp: number; delta: number; status: StatusName | null } {
    const health = parseHealth(text);
    const key = `${who.side}:${who.index}`;
    const before = this.health.get(key);
    const maxHp = health.maxHp ?? before?.maxHp ?? health.hp;
    const previous = before?.hp ?? maxHp;
    this.health.set(key, { hp: health.hp, maxHp });
    return { hp: health.hp, maxHp, delta: health.hp - previous, status: health.status };
  }

  private isActive(who: Resolved): boolean {
    return this.active[who.side] === who.index;
  }

  private damage(args: string[], tags: Record<string, string>): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const { hp, maxHp, delta } = this.track(who, args[1] ?? '');
    const name = this.name(who);
    const from = tags.from ? splitEffect(tags.from) : null;
    const source = tags.of ? this.host.resolve(tags.of) : null;
    const pending = this.pending.get(who.side);
    this.pending.delete(who.side);

    // Dano de status: a animacao do veneno ou da queimadura vem antes.
    const status = from ? STATUS_TEXT[from.id as StatusName] : undefined;
    if (status?.damage) this.push({ t: 'anim', side: who.side, anim: from!.id });
    if (from?.id === 'confusion') this.push({ t: 'anim', side: who.side, anim: 'confusedselfhit' });

    if (this.isActive(who)) {
      this.push({
        t: 'damage',
        side: who.side,
        amount: Math.max(0, -delta),
        hp,
        maxHp,
        effectiveness: pending?.effectiveness ?? 'normal',
        crit: pending?.crit ?? false,
        cause: from?.id,
      });
    }
    if (pending) this.sayPending(pending);
    if (!from || 'silent' in tags) return;

    if (status?.damage) {
      this.say(this.fill(status.damage, { p: name }));
      return;
    }
    const weather = WEATHER[from.id];
    if (weather?.damage) {
      this.say(this.fill(weather.damage, { p: name }));
      return;
    }
    if ('partiallytrapped' in tags || PARTIAL_TRAP.has(from.id)) {
      this.say(`${name} sofre com ${from.name}!`);
      return;
    }

    switch (from.id) {
      case 'recoil':
        this.say(`${name} sofreu com o recuo!`);
        return;
      case 'confusion':
        this.say('Ele se machucou na propria confusao!');
        return;
      case 'leechseed':
        this.say(`O Leech Seed sugou a energia de ${name}!`);
        return;
      case 'spikes':
        this.say(`${name} foi ferido pelos espinhos!`);
        return;
      case 'stealthrock':
        this.say(`Pedras pontudas feriram ${name}!`);
        return;
      case 'curse':
        this.say(`${name} sofre com a maldicao!`);
        return;
      case 'nightmare':
        this.say(`${name} esta preso num pesadelo!`);
        return;
      case 'highjumpkick':
      case 'jumpkick':
        this.say(`${name} errou e caiu no chao!`);
        return;
      case 'lifeorb':
        this.say(`${name} perdeu um pouco de HP!`);
        return;
      default:
        if (from.kind === 'item') {
          this.say(`${name} foi ferido pelo ${from.name}${source && source.index !== who.index ? ` de ${this.name(source)}` : ''}!`);
        } else if (from.kind === 'ability') {
          this.say(`${name} foi ferido pela habilidade ${from.name}${source ? ` de ${this.name(source)}` : ''}!`);
        } else {
          this.say(`${name} foi ferido por ${from.name}!`);
        }
    }
  }

  private heal(args: string[], tags: Record<string, string>): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const { hp, maxHp, delta } = this.track(who, args[1] ?? '');
    if (this.isActive(who)) this.push({ t: 'heal', side: who.side, amount: Math.max(0, delta), hp, maxHp });
    if ('silent' in tags) return;

    const name = this.name(who);
    const from = tags.from ? splitEffect(tags.from) : null;
    if (!from) {
      this.say(`${name} recuperou HP.`);
      return;
    }
    if (from.id === 'drain') {
      const source = tags.of ? this.host.resolve(tags.of) : null;
      this.say(`A energia de ${source ? this.name(source) : 'o oponente'} foi drenada!`);
    } else if (from.kind === 'item') {
      this.say(`${name} recuperou um pouco de HP com ${from.name}!`);
    } else if (from.kind === 'ability') {
      this.say(`${name} recuperou HP com ${from.name}!`);
    } else if (from.id === 'ingrain') {
      this.say(`${name} absorveu nutrientes pelas raizes!`);
    } else if (from.id === 'aquaring') {
      this.say(`O veu de agua restaurou o HP de ${name}!`);
    } else if (from.id === 'wish') {
      this.say(`O desejo se realizou!`);
    } else {
      this.say(`${name} recuperou HP.`);
    }
  }

  private setHp(args: string[], tags: Record<string, string>): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const { hp, maxHp, delta } = this.track(who, args[1] ?? '');
    if (this.isActive(who) && delta !== 0) {
      if (delta > 0) this.push({ t: 'heal', side: who.side, amount: delta, hp, maxHp });
      else {
        this.push({
          t: 'damage',
          side: who.side,
          amount: -delta,
          hp,
          maxHp,
          effectiveness: 'normal',
          crit: false,
          cause: 'sethp',
        });
      }
    }
    if (tags.from && toId(tags.from).includes('painsplit')) this.say('Os dois dividiram a dor!');
  }

  private status(args: string[], tags: Record<string, string>): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const id = args[1] as StatusName;
    const text = STATUS_TEXT[id];
    if (!text) return;
    if (this.isActive(who)) {
      this.push({ t: 'anim', side: who.side, anim: id });
      this.push({ t: 'status', side: who.side, status: id });
    }
    if ('silent' in tags) return;
    const name = this.name(who);
    const from = tags.from ? splitEffect(tags.from) : null;
    if (from?.id === 'rest') this.say(`${name} dormiu e recuperou a saude!`);
    else if (from?.kind === 'item') this.say(`${this.fill(text.start, { p: name }).replace(/!$/, '')} pelo ${from.name}!`);
    else this.say(this.fill(text.start, { p: name }));
  }

  private cureStatus(args: string[], tags: Record<string, string>): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const id = args[1] as StatusName;
    if (this.isActive(who)) this.push({ t: 'status', side: who.side, status: null });
    if ('silent' in tags) return;
    const name = this.name(who);
    const from = tags.from ? splitEffect(tags.from) : null;
    if (from?.kind === 'item') {
      this.say(`${from.name} curou ${name}!`);
      return;
    }
    const text = STATUS_TEXT[id];
    this.say(text ? this.fill(text.end, { p: name }) : `${name} se curou!`);
  }

  private cureTeam(args: string[]): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const active = this.active[who.side];
    if (active !== null) this.push({ t: 'status', side: who.side, status: null });
    this.say('A equipe se curou de todos os problemas de status!');
  }

  private boost(sign: 1 | -1, args: string[], tags: Record<string, string>): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const stat = args[1] ?? '';
    const amount = Number(args[2]) || 0;
    const label = STATS[stat] ?? { name: stat, article: 'O' as const };
    const name = this.name(who);

    if (amount !== 0) {
      this.push({
        t: 'boost',
        side: who.side,
        stat: stat as 'atk',
        delta: sign * amount,
      });
    }
    if ('silent' in tags) return;

    const subject = `${label.article} ${label.name} de ${name}`;
    if (amount === 0) {
      this.say(`${subject} nao pode ${sign > 0 ? 'subir' : 'cair'} mais!`);
      return;
    }
    const verb = sign > 0 ? 'subiu' : 'caiu';
    const how = amount >= 3 ? ' drasticamente' : amount === 2 ? ' muito' : '';
    const from = tags.from ? splitEffect(tags.from) : null;
    if (from?.kind === 'item') this.say(`${from.name} fez ${label.article.toLowerCase()} ${label.name} de ${name} ${sign > 0 ? 'subir' : 'cair'}${how}!`);
    else this.say(`${subject} ${verb}${how}!`);
  }

  private setBoost(args: string[], tags: Record<string, string>): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const from = tags.from ? splitEffect(tags.from) : null;
    this.push({ t: 'boost', side: who.side, stat: (args[1] ?? 'atk') as 'atk', delta: 6 });
    if (from?.id === 'bellydrum') this.say(`${this.name(who)} cortou o proprio HP e maximizou o Ataque!`);
    else if (from?.id === 'angerpoint') this.say(`${this.name(who)} ficou furioso e maximizou o Ataque!`);
  }

  private clearBoost(kind: string, args: string[]): void {
    const who = args[0] ? this.host.resolve(args[0]) : null;
    const name = this.name(who);
    switch (kind) {
      case '-clearallboost':
        this.say('Todas as mudancas de atributo foram eliminadas!');
        return;
      case '-clearboost':
        this.say(`As mudancas de atributo de ${name} foram removidas!`);
        return;
      case '-clearnegativeboost':
        this.say(`Os atributos de ${name} voltaram ao normal!`);
        return;
      case '-invertboost':
        this.say(`As mudancas de atributo de ${name} se inverteram!`);
        return;
      case '-swapboost':
        this.say(`${name} trocou as mudancas de atributo com o alvo!`);
        return;
      case '-copyboost':
        this.say(`${name} copiou as mudancas de atributo do alvo!`);
        return;
    }
  }

  private weatherLine(args: string[], tags: Record<string, string>): void {
    const id = toId(args[0] ?? '');
    if (id === 'none' || !id) {
      const previous = this.weather ? WEATHER[this.weather] : undefined;
      if (previous) this.say(previous.end);
      this.weather = null;
      this.push({ t: 'weather', weather: null });
      return;
    }
    const text = WEATHER[id];
    if ('upkeep' in tags) {
      if (text) this.say(text.upkeep);
      return;
    }
    this.weather = id;
    this.push({ t: 'weather', weather: id });
    const from = tags.from ? splitEffect(tags.from) : null;
    if (from?.kind === 'ability' && tags.of) {
      const who = this.host.resolve(tags.of);
      this.say(`${from.name} de ${this.name(who)} mudou o clima!`);
    }
    if (text) this.say(text.start);
  }

  private field(start: boolean, args: string[], tags: Record<string, string>): void {
    const effect = splitEffect(args[0] ?? '');
    const text = FIELD_TEXT[effect.id];
    const source = tags.of ? this.host.resolve(tags.of) : null;
    if (text) this.say(this.fill(start ? text.start : text.end, { s: this.name(source) || 'Alguem' }));
    else this.say(start ? `${effect.name} tomou conta do campo!` : `${effect.name} acabou.`);
  }

  private sideCondition(start: boolean, args: string[]): void {
    const side = (args[0] ?? '').startsWith('p1') ? 'player' : 'foe';
    const team = side === 'player' ? 'sua equipe' : 'a equipe adversaria';
    const effect = splitEffect(args[1] ?? '');
    const text = SIDE_TEXT[effect.id];
    const template = text ? (start ? text.start : text.end) : undefined;
    if (template) {
      const filled = this.fill(template, { t: team });
      this.say(filled.charAt(0).toUpperCase() + filled.slice(1));
    } else {
      this.say(start ? `${effect.name} comecou para ${team}!` : `${effect.name} acabou para ${team}.`);
    }
  }

  private volatileStart(args: string[], tags: Record<string, string>): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const effect = splitEffect(args[1] ?? '');
    const name = this.name(who);
    const source = tags.of ? this.host.resolve(tags.of) : null;
    const extra = args[2] ? this.host.moveName(toId(args[2])) : '';

    if (effect.id === 'confusion') {
      this.push({ t: 'anim', side: who.side, anim: 'confused' });
      this.say('fatigue' in tags ? `${name} ficou confuso de cansaco!` : `${name} ficou confuso!`);
      return;
    }
    if (effect.id === 'typechange') {
      this.say(`${name} virou do tipo ${args[2] ?? '?'}!`);
      return;
    }
    if ('silent' in tags) return;
    const text = VOLATILE_TEXT[effect.id];
    if (text?.start) {
      this.say(this.fill(text.start, { p: name, s: this.name(source) || name, m: extra }));
      return;
    }
    if (text) return;
    if (effect.kind === 'ability') this.say(`A habilidade ${effect.name} de ${name} entrou em acao!`);
    else this.say(`${name} esta sob o efeito de ${effect.name}!`);
  }

  private volatileEnd(args: string[], tags: Record<string, string>): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    if ('silent' in tags) return;
    const effect = splitEffect(args[1] ?? '');
    const name = this.name(who);
    if ('partiallytrapped' in tags || PARTIAL_TRAP.has(effect.id)) {
      this.say(`${name} se livrou de ${effect.name}!`);
      return;
    }
    const text = VOLATILE_TEXT[effect.id];
    if (text?.end) {
      this.say(this.fill(text.end, { p: name }));
      return;
    }
    if (text || effect.id === 'yawn' || effect.id === 'stockpile' || effect.id === 'focusenergy') return;
    this.say(`O efeito de ${effect.name} em ${name} acabou.`);
  }

  private activate(args: string[], tags: Record<string, string>): void {
    const who = args[0] ? this.host.resolve(args[0]) : null;
    const effect = splitEffect(args[1] ?? '');
    const name = this.name(who);
    const source = tags.of ? this.host.resolve(tags.of) : null;

    if (effect.id === 'confusion' && who) {
      this.push({ t: 'anim', side: who.side, anim: 'confused' });
    }
    if (PARTIAL_TRAP.has(effect.id)) {
      this.say(`${name} ficou preso por ${effect.name}${source ? ` de ${this.name(source)}` : ''}!`);
      return;
    }
    const text = VOLATILE_TEXT[effect.id];
    if (text?.activate) {
      const move = args[2] ? this.host.moveName(toId(args[2])) : '';
      this.say(this.fill(text.activate, { p: name, s: this.name(source), m: move }));
    }
  }

  private flag(args: string[], apply: (pending: Pending) => void): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    apply(this.pendingFor(who.side));
  }

  private immune(args: string[], tags: Record<string, string>): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const name = this.name(who);
    const from = tags.from ? splitEffect(tags.from) : null;
    if ('ohko' in tags) this.say(`${name} nao foi afetado!`);
    else if (from?.kind === 'ability') this.say(`${name} nao foi afetado gracas a ${from.name}!`);
    else this.say(`Nao afeta ${name}...`);
  }

  private miss(args: string[]): void {
    const user = this.host.resolve(args[0]);
    const target = args[1] ? this.host.resolve(args[1]) : null;
    if (user) this.push({ t: 'miss', side: user.side });
    if (target) this.say(`${this.name(target)} desviou do ataque!`);
    else this.say(`O ataque de ${this.name(user)} errou!`);
  }

  private fail(args: string[], tags: Record<string, string>): void {
    const who = this.host.resolve(args[0]);
    const name = this.name(who);
    const what = splitEffect(args[1] ?? '');
    const status = STATUS_TEXT[what.id as StatusName];
    if (status) {
      this.say(this.fill(status.already, { p: name }));
      return;
    }
    if (what.id === 'unboost') {
      this.say(`Os atributos de ${name} nao foram reduzidos!`);
      return;
    }
    if (what.id === 'heal') {
      this.say(`O HP de ${name} ja esta cheio!`);
      return;
    }
    if (what.id === 'substitute' && 'weak' in tags) {
      this.say(`${name} nao tem HP para criar um substituto!`);
      return;
    }
    if ('silent' in tags) return;
    this.say('Mas falhou!');
  }

  private prepare(args: string[]): void {
    const user = this.host.resolve(args[0]);
    if (!user) return;
    const id = toId(args[1] ?? '');
    const target = args[2] ? this.host.resolve(args[2]) : null;
    this.push({ t: 'prepare', side: user.side, move: id, target: target?.side ?? null });
    const text = PREPARE_TEXT[id] ?? '[P] esta se preparando!';
    this.say(this.fill(text, { p: this.name(user), t: this.name(target) }));
  }

  private singleTurn(args: string[]): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const effect = splitEffect(args[1] ?? '');
    const name = this.name(who);
    switch (effect.id) {
      case 'protect':
      case 'detect':
      case 'kingsshield':
      case 'spikyshield':
        this.say(`${name} se protegeu!`);
        return;
      case 'endure':
        this.say(`${name} se preparou para aguentar!`);
        return;
      case 'focuspunch':
        this.say(`${name} esta concentrando energia!`);
        return;
      case 'snatch':
        this.say(`${name} esta esperando o oponente usar um golpe!`);
        return;
      case 'magiccoat':
        this.say(`${name} se envolveu num manto magico!`);
        return;
      case 'destinybond':
        this.say(`${name} quer levar o oponente junto!`);
        return;
      case 'grudge':
        this.say(`${name} quer que o oponente guarde rancor!`);
        return;
      default:
        return;
    }
  }

  private item(args: string[], tags: Record<string, string>): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const item = args[1] ?? '';
    const name = this.name(who);
    if ('identify' in tags) this.say(`${name} esta segurando ${item}!`);
    else if (tags.from) this.say(`${name} ficou com ${item}!`);
  }

  private endItem(args: string[], tags: Record<string, string>): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const item = args[1] ?? '';
    const name = this.name(who);
    const from = tags.from ? splitEffect(tags.from) : null;
    if ('silent' in tags) return;
    if ('eat' in tags) this.say(`${name} comeu sua ${item}!`);
    else if (from?.id === 'stealeat') this.say(`${this.name(tags.of ? this.host.resolve(tags.of) : null)} roubou e comeu a ${item}!`);
    else if (from?.kind === 'move') this.say(`${name} perdeu seu ${item}!`);
    else this.say(`${name} usou seu ${item}!`);
  }

  private ability(args: string[], tags: Record<string, string>): void {
    const who = this.host.resolve(args[0]);
    if (!who) return;
    const ability = args[1] ?? '';
    const name = this.name(who);
    if ('silent' in tags) return;
    switch (toId(ability)) {
      case 'intimidate':
        this.say(`${name} intimidou o oponente!`);
        return;
      case 'pressure':
        this.say(`${name} esta exercendo pressao!`);
        return;
      case 'moldbreaker':
        this.say(`${name} quebra as regras!`);
        return;
      case 'unnerve':
        this.say('O oponente ficou nervoso demais para comer frutas!');
        return;
      case 'anticipation':
        this.say(`${name} estremeceu!`);
        return;
      default: {
        const from = tags.from ? splitEffect(tags.from) : null;
        if (from?.id === 'trace' && tags.of) {
          this.say(`${name} copiou a habilidade ${ability} de ${this.name(this.host.resolve(tags.of))}!`);
        } else {
          this.say(`A habilidade ${ability} de ${name} entrou em acao!`);
        }
      }
    }
  }
}
