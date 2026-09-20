import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RNG } from '../game/core/rng.js';
import { loadJsonAsset, loadMap } from '../game/data/assets.js';
import { Battle } from '../game/battle/engine.js';
import type { BattleOutcome } from '../game/battle/types.js';
import { createPokemon, isFainted, type Pokemon } from '../game/pokemon/pokemon.js';
import { isReady } from '../game/progression/expeditions.js';
import { advanceQuest, isComplete, rolloverDaily } from '../game/progression/quests.js';
import { rollEncounter } from '../game/world/encounters.js';
import {
  buildTrainerParty,
  trainerTitle,
  type EventsFile,
  type Interaction,
} from '../game/world/interactions.js';
import type { PlayerPosition } from '../game/world/overworld.js';
import { shinyChanceFor, useGame } from '../state/game.js';
import { haptic } from '../state/settings.js';
import { BattleScreen } from './battle/BattleScreen.js';
import { OverworldScreen } from './overworld/OverworldScreen.js';
import { Bag } from './screens/Bag.js';
import { NewGame } from './screens/NewGame.js';
import { Pokedex } from './screens/Pokedex.js';
import { Profile } from './screens/Profile.js';
import { SettingsSheet } from './screens/SettingsSheet.js';
import { Shop } from './screens/Shop.js';
import { Team } from './screens/Team.js';
import { BottomNav, type Tab } from './shell/BottomNav.js';
import { Dialogue } from './shell/Dialogue.js';

interface PendingBattle {
  battle: Battle;
  environment: { isCave: boolean; isWater: boolean; isNight: boolean };
  /** Treinador derrotado paga premio; selvagem, nao. */
  prize: number;
}

export function App() {
  const { ctx, chart, save, loading, boot } = useGame();
  const [tab, setTab] = useState<Tab>('map');
  const [dialogue, setDialogue] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [battle, setBattle] = useState<PendingBattle | null>(null);
  const [events, setEvents] = useState<EventsFile | null>(null);
  const rngRef = useRef(new RNG());
  const battleRef = useRef<PendingBattle | null>(null);
  battleRef.current = battle;

  useEffect(() => {
    void boot();
    void loadJsonAsset<EventsFile>('data/events.json').then(setEvents).catch(() => setEvents(null));
  }, [boot]);

  // Virada do dia: zera as missoes e atualiza o streak de login.
  useEffect(() => {
    if (!save) return;
    const state = useGame.getState();
    state.update((s) => {
      rolloverDaily(s);
    });
    // Roda uma vez por sessao.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save !== null]);

  const startWildBattle = useCallback(async (kind: 'land' | 'water', mapId: string) => {
    const state = useGame.getState();
    if (!state.ctx || !state.chart || !state.save) return;
    if (state.save.party.every(isFainted)) return;

    const map = await loadMap(mapId);
    const encounter = rollEncounter(state.ctx, rngRef.current, map, kind, {
      shinyChanceFor: (species) => shinyChanceFor(state.save, species),
    });
    if (!encounter) return;

    state.registerSeen(encounter.pokemon.species);
    setBattle({
      battle: new Battle(
        state.ctx,
        state.chart,
        rngRef.current,
        state.save.party.map(cloneMon),
        [encounter.pokemon],
        { kind: 'wild', canRun: true, mapId },
      ),
      environment: {
        isCave: map.type === 'MAP_TYPE_UNDERGROUND' || /Cave|Tunnel|Mt/i.test(map.name),
        isWater: kind === 'water',
        isNight: isNight(),
      },
      prize: 0,
    });
  }, []);

  const handleInteraction = useCallback((interaction: Interaction) => {
    if (!interaction) return;
    const state = useGame.getState();
    if (!state.ctx || !state.chart || !state.save) return;

    switch (interaction.kind) {
      case 'talk':
      case 'sign':
        setDialogue(interaction.text);
        break;

      case 'heal':
        state.healParty();
        haptic([14, 60, 14]);
        setDialogue('Sua equipe foi tratada e esta em plena forma. Ate a proxima!');
        break;

      case 'shop':
        setShopOpen(true);
        break;

      case 'pc':
        setTab('team');
        break;

      case 'trainer': {
        if (state.save.party.every(isFainted)) {
          setDialogue('Seus Pokemon estao esgotados. Passe num Centro Pokemon antes.');
          return;
        }
        const party = buildTrainerParty(state.ctx, rngRef.current, interaction.trainer);
        const highest = Math.max(...interaction.trainer.party.map((p) => p.level));
        setBattle({
          battle: new Battle(
            state.ctx,
            state.chart,
            rngRef.current,
            state.save.party.map(cloneMon),
            party,
            {
              kind: 'trainer',
              foeName: trainerTitle(interaction.trainer),
              canRun: false,
            },
          ),
          environment: { isCave: false, isWater: false, isNight: isNight() },
          prize: highest * 60,
        });
        break;
      }
    }
  }, []);

  const finishBattle = useCallback((outcome: BattleOutcome, caught: Pokemon | null) => {
    const state = useGame.getState();
    const current = battleRef.current;
    if (!current) return;

    state.update((s) => {
      // A equipe volta do combate com HP, EXP e niveis atualizados.
      s.party = current.battle.player.party;
      if (outcome === 'win') {
        s.stats = { ...s.stats, battlesWon: s.stats.battlesWon + 1 };
        s.money += current.prize;
        advanceQuest(s, 'win');
      }
      if (outcome === 'fled' || outcome === 'loss') {
        s.stats = { ...s.stats, catchStreak: 0 };
      }
      if (caught) advanceQuest(s, 'catch');
    });

    if (caught) {
      state.registerCaught(caught);
      const where = state.addToParty(caught);
      state.addTrainerXp(120);
      const name = state.ctx ? state.ctx.species[String(caught.species)].n : 'O Pokemon';
      setDialogue(
        where === 'party'
          ? `${name} entrou na sua equipe!`
          : `${name} foi capturado e enviado para a caixa.`,
      );
    } else if (outcome === 'win') {
      state.addTrainerXp(current.prize > 0 ? 110 : 45);
      if (current.prize > 0) {
        setDialogue(`Voce venceu e recebeu ₽ ${current.prize.toLocaleString('pt-BR')}.`);
      }
    } else if (outcome === 'loss') {
      state.healParty();
      state.update((s) => {
        s.position = { ...s.respawn, dir: 'down' };
      });
      haptic([40, 80, 40]);
      setDialogue('Voce ficou sem Pokemon em condicao de lutar e voltou ao Centro Pokemon.');
    }

    setBattle(null);
  }, []);

  const handlePosition = useCallback((position: PlayerPosition) => {
    useGame.getState().update((s) => {
      s.position = position;
      if (!s.visited.includes(position.map)) s.visited = [...s.visited, position.map];
      // Centros Pokemon viram ponto de retorno.
      if (/PokemonCenter/i.test(position.map)) {
        s.respawn = { map: position.map, x: position.x, y: position.y };
      }
    });
  }, []);

  const handleStep = useCallback((steps: number) => {
    const state = useGame.getState();
    if (!state.ctx) return;
    state.update((s) => {
      s.stats = { ...s.stats, steps: s.stats.steps + 1 };
      advanceQuest(s, 'step');

      // Ovos chocam por passos, como nos jogos.
      if (s.eggs.length > 0) {
        const hatched = s.eggs.filter((egg) => egg.stepsLeft <= 1);
        s.eggs = s.eggs
          .map((egg) => ({ ...egg, stepsLeft: egg.stepsLeft - 1 }))
          .filter((egg) => egg.stepsLeft > 0);
        for (const egg of hatched) {
          const baby = createPokemon(state.ctx!, rngRef.current, {
            species: egg.species,
            level: 5,
          });
          if (s.party.length < 6) s.party = [...s.party, baby];
          else s.box = [...s.box, baby];
          if (!s.caught.includes(baby.species)) s.caught = [...s.caught, baby.species];
          setDialogue(`Um ovo chocou! Nasceu um ${state.ctx!.species[String(baby.species)].n}.`);
        }
      }
    });
    void steps;
  }, []);

  const questBadge = useMemo(() => {
    if (!save) return false;
    const questReady = Object.values(save.quests).some(isComplete);
    const expeditionReady = save.expeditions.some((e) => !e.collected && isReady(e));
    return questReady || expeditionReady;
  }, [save]);

  if (loading || !ctx || !chart) {
    return <div className="boot-screen">Carregando…</div>;
  }

  if (!save) {
    return <NewGame ctx={ctx} />;
  }

  const overlayOpen = dialogue !== null || settingsOpen || shopOpen || tab !== 'map';

  return (
    <div className="app">
      {/* O mundo fica montado mesmo nas outras abas: voltar ao mapa e instantaneo. */}
      <div className={tab === 'map' && !battle ? 'layer' : 'layer layer-hidden'}>
        <OverworldScreen
          start={save.position}
          events={events}
          paused={overlayOpen || battle !== null}
          onEncounter={(kind, mapId) => void startWildBattle(kind, mapId)}
          onInteract={handleInteraction}
          onPosition={handlePosition}
          onStep={handleStep}
          onMenu={() => setSettingsOpen(true)}
        />
      </div>

      {battle && (
        <BattleScreen
          battle={battle.battle}
          ctx={ctx}
          bag={save.bag}
          environment={battle.environment}
          playerLevel={save.trainerLevel}
          onUseItem={(item) => useGame.getState().consumeItem(item)}
          onFinish={finishBattle}
        />
      )}

      {!battle && tab === 'pokedex' && <Pokedex ctx={ctx} save={save} />}
      {!battle && tab === 'team' && <Team ctx={ctx} save={save} />}
      {!battle && tab === 'bag' && <Bag ctx={ctx} save={save} onMessage={setDialogue} />}
      {!battle && tab === 'profile' && (
        <Profile
          ctx={ctx}
          save={save}
          onMessage={setDialogue}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {!battle && <BottomNav active={tab} onChange={setTab} badge={questBadge} />}

      {dialogue && (
        <Dialogue
          text={dialogue}
          playerName={save.playerName}
          onClose={() => setDialogue(null)}
        />
      )}
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {shopOpen && <Shop save={save} onClose={() => setShopOpen(false)} onMessage={setDialogue} />}
    </div>
  );
}

/** Copia profunda o bastante para o combate nao corromper o save direto. */
function cloneMon(pokemon: Pokemon): Pokemon {
  return {
    ...pokemon,
    ivs: [...pokemon.ivs],
    evs: [...pokemon.evs],
    moves: pokemon.moves.map((m) => ({ ...m })),
  };
}

function isNight(): boolean {
  const hour = new Date().getHours();
  return hour >= 20 || hour < 6;
}
