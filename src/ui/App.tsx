import { useCallback, useEffect, useRef, useState } from 'react';
import { RNG } from '../game/core/rng.js';
import { loadMap } from '../game/data/assets.js';
import { Battle } from '../game/battle/engine.js';
import type { BattleOutcome } from '../game/battle/types.js';
import { isFainted, type Pokemon } from '../game/pokemon/pokemon.js';
import { rollEncounter } from '../game/world/encounters.js';
import { shinyChanceFor, useGame } from '../state/game.js';
import { haptic } from '../state/settings.js';
import { BattleScreen } from './battle/BattleScreen.js';
import { OverworldScreen } from './overworld/OverworldScreen.js';
import { NewGame } from './screens/NewGame.js';
import { SettingsSheet } from './screens/SettingsSheet.js';
import { Dialogue } from './shell/Dialogue.js';

interface PendingBattle {
  battle: Battle;
  environment: { isCave: boolean; isWater: boolean; isNight: boolean };
}

export function App() {
  const { ctx, chart, save, loading, boot } = useGame();
  const [dialogue, setDialogue] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [battle, setBattle] = useState<PendingBattle | null>(null);
  const rngRef = useRef(new RNG());

  useEffect(() => {
    void boot();
  }, [boot]);

  const startEncounter = useCallback(
    async (kind: 'land' | 'water', mapId: string) => {
      const state = useGame.getState();
      if (!state.ctx || !state.chart || !state.save) return;
      if (state.save.party.every(isFainted)) return;

      const map = await loadMap(mapId);
      const encounter = rollEncounter(state.ctx, rngRef.current, map, kind, {
        shinyChanceFor: (species) => shinyChanceFor(state.save, species),
      });
      if (!encounter) return;

      state.registerSeen(encounter.pokemon.species);
      const party = state.save.party.map(cloneMon);
      setBattle({
        battle: new Battle(state.ctx, state.chart, rngRef.current, party, [encounter.pokemon], {
          kind: 'wild',
          canRun: true,
          mapId,
        }),
        environment: {
          isCave: map.type === 'MAP_TYPE_UNDERGROUND' || map.name.includes('Cave'),
          isWater: kind === 'water',
          isNight: isNight(),
        },
      });
    },
    [],
  );

  const finishBattle = useCallback((outcome: BattleOutcome, caught: Pokemon | null) => {
    const state = useGame.getState();
    const current = battleRef.current;
    if (state.ctx && current) {
      // Devolve ao save o estado (HP, EXP, niveis) com que a equipe saiu do combate.
      state.update((s) => {
        s.party = current.battle.player.party;
        if (outcome === 'win') s.stats = { ...s.stats, battlesWon: s.stats.battlesWon + 1 };
      });
    }

    if (caught) {
      state.registerCaught(caught);
      const where = state.addToParty(caught);
      state.addTrainerXp(120);
      setDialogue(
        where === 'party'
          ? `${caught.nickname ?? ''} entrou na sua equipe!`.trim()
          : 'Sua equipe esta cheia. O Pokemon foi para a caixa.',
      );
    } else if (outcome === 'win') {
      state.addTrainerXp(45);
    } else if (outcome === 'loss') {
      state.healParty();
      setDialogue('Voce nao tem mais Pokemon em condicao de lutar. De volta ao Centro Pokemon.');
      haptic([40, 80, 40]);
    }

    setBattle(null);
  }, []);

  const battleRef = useRef<PendingBattle | null>(null);
  battleRef.current = battle;

  if (loading || !ctx || !chart) {
    return <div className="boot-screen">Carregando…</div>;
  }

  if (!save) {
    return <NewGame ctx={ctx} />;
  }

  return (
    <div className="app">
      {!battle && (
        <OverworldScreen
          startMap={save.position.map}
          startX={save.position.x}
          startY={save.position.y}
          onEncounter={(kind, mapId) => void startEncounter(kind, mapId)}
          onInteract={setDialogue}
          onMenu={() => setSettingsOpen(true)}
        />
      )}

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

      {dialogue && <Dialogue text={dialogue} onClose={() => setDialogue(null)} />}
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
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
