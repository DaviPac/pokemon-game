/**
 * Perfil: nivel de treinador, streak, missoes diarias e as expedicoes -- o
 * painel de "o que fazer agora" e tambem o que rende com o app fechado.
 */
import { useEffect, useState } from 'react';
import { loadMap, loadWorldIndex } from '../../game/data/assets.js';
import { itemInfo } from '../../game/data/items.js';
import {
  EXPEDITION_OPTIONS,
  expeditionSlots,
  formatRemaining,
  isReady,
  remainingMs,
  resolveExpedition,
  startExpedition,
  type ExpeditionOption,
} from '../../game/progression/expeditions.js';
import {
  DAILY_QUESTS,
  isComplete,
  streakReward,
  advanceQuest,
} from '../../game/progression/quests.js';
import { displayName, type Pokemon, type PokemonContext } from '../../game/pokemon/pokemon.js';
import { iconSprite } from '../../game/pokemon/sprites.js';
import { trainerXpForLevel, type SaveData } from '../../game/save/schema.js';
import { sectionName } from '../../i18n/places.js';
import { useGame } from '../../state/game.js';
import { haptic } from '../../state/settings.js';
import { Sheet } from '../shell/Sheet.js';

export function Profile({
  ctx,
  save,
  onMessage,
  onOpenSettings,
}: {
  ctx: PokemonContext;
  save: SaveData;
  onMessage: (text: string) => void;
  onOpenSettings: () => void;
}) {
  const [planning, setPlanning] = useState(false);
  const update = useGame((s) => s.update);
  const addTrainerXp = useGame((s) => s.addTrainerXp);
  const addToParty = useGame((s) => s.addToParty);
  const registerCaught = useGame((s) => s.registerCaught);

  const slots = expeditionSlots(save.trainerLevel);
  const active = save.expeditions.filter((e) => !e.collected);
  const xpNeeded = trainerXpForLevel(save.trainerLevel);

  const collect = async (expeditionId: string) => {
    const expedition = save.expeditions.find((e) => e.id === expeditionId);
    if (!expedition || !isReady(expedition)) return;

    const rewards = await resolveExpedition(ctx, save, expedition);
    haptic([20, 50, 20]);

    update((s) => {
      s.expeditions = s.expeditions.map((e) =>
        e.id === expeditionId ? { ...e, collected: true } : e,
      );
      s.money += rewards.money;
      const bag = { ...s.bag };
      for (const item of rewards.items) bag[item.id] = (bag[item.id] ?? 0) + item.count;
      s.bag = bag;
      if (rewards.eggSpecies !== null) {
        const totalSteps = 1800;
        s.eggs = [
          ...s.eggs,
          {
            id: `${Date.now().toString(36)}-egg`,
            species: rewards.eggSpecies,
            stepsLeft: totalSteps,
            totalSteps,
            createdAt: Date.now(),
          },
        ];
      }
      advanceQuest(s, 'expedition');
      // A EXP ja foi aplicada nos objetos da equipe por resolveExpedition.
      s.party = [...s.party];
      s.box = [...s.box];
    });

    addTrainerXp(80);
    if (rewards.found) {
      registerCaught(rewards.found);
      addToParty(rewards.found);
    }

    const parts = [
      `Cada Pokemon ganhou ${rewards.expPerPokemon} de EXP`,
      `₽ ${rewards.money.toLocaleString('pt-BR')}`,
    ];
    if (rewards.items.length > 0) {
      parts.push(rewards.items.map((i) => `${itemInfo(i.id).name} ×${i.count}`).join(', '));
    }
    if (rewards.found) parts.push(`e trouxe um ${ctx.species[String(rewards.found.species)].n}!`);
    if (rewards.eggSpecies !== null) parts.push('Um ovo veio junto!');
    onMessage(`A expedicao voltou. ${parts.join(' · ')}`);
  };

  const claimQuest = (questId: string) => {
    const quest = save.quests[questId];
    const definition = DAILY_QUESTS.find((q) => q.id === questId);
    if (!quest || !definition || !isComplete(quest)) return;
    haptic([15, 40, 15]);
    update((s) => {
      s.quests = { ...s.quests, [questId]: { ...quest, claimed: true } };
      s.money += definition.reward.money ?? 0;
      const bag = { ...s.bag };
      for (const item of definition.reward.items ?? []) {
        bag[item.id] = (bag[item.id] ?? 0) + item.count;
      }
      s.bag = bag;
    });
    if (definition.reward.trainerXp) addTrainerXp(definition.reward.trainerXp);
    onMessage(`Missao concluida: ${definition.label}.`);
  };

  return (
    <div className="screen">
      <header className="screen-head">
        <h1 className="screen-title">{save.playerName}</h1>
        <p className="screen-sub">
          Treinador nivel {save.trainerLevel} · ₽ {save.money.toLocaleString('pt-BR')}
        </p>
        <div className="exp-track exp-track-wide">
          <div
            className="exp-fill"
            style={{ width: `${Math.min(100, (save.trainerXp / xpNeeded) * 100)}%` }}
          />
        </div>
      </header>

      <div className="stat-cards">
        <StatCard label="Capturas" value={save.stats.catches} />
        <StatCard label="Vitorias" value={save.stats.battlesWon} />
        <StatCard label="Passos" value={save.stats.steps} />
        <StatCard label="Shinies" value={save.stats.shiniesFound} />
      </div>

      <h3 className="section-title">Expedicoes ({active.length}/{slots})</h3>
      <p className="screen-note">
        Mande Pokemon explorar uma area ja visitada. Eles continuam trabalhando com o app fechado.
      </p>

      <div className="expedition-list">
        {active.map((expedition) => {
          const ready = isReady(expedition);
          const team = save.party
            .concat(save.box)
            .filter((p) => expedition.team.includes(p.uid));
          return (
            <div key={expedition.id} className={ready ? 'expedition expedition-ready' : 'expedition'}>
              <div className="expedition-head">
                <span className="expedition-place">{expedition.mapName}</span>
                <span className="expedition-time">{formatRemaining(remainingMs(expedition))}</span>
              </div>
              <div className="expedition-team">
                {team.map((p) => (
                  <img
                    key={p.uid}
                    className="mon-icon mon-icon-small"
                    src={iconSprite(p.species, p.shiny)}
                    alt={displayName(ctx, p)}
                    loading="lazy"
                    draggable={false}
                  />
                ))}
              </div>
              <button
                type="button"
                className="primary-button"
                disabled={!ready}
                onClick={() => void collect(expedition.id)}
              >
                {ready ? 'Receber recompensas' : 'Em andamento'}
              </button>
            </div>
          );
        })}

        {active.length < slots && (
          <button type="button" className="expedition-add" onClick={() => setPlanning(true)}>
            + Enviar uma expedicao
          </button>
        )}
      </div>

      <h3 className="section-title">Missoes de hoje</h3>
      <p className="screen-note">Dia {save.dailies.streak} seguido jogando.</p>
      <div className="quest-list">
        {DAILY_QUESTS.map((definition) => {
          const quest = save.quests[definition.id];
          if (!quest) return null;
          const ratio = Math.min(1, quest.progress / quest.goal);
          return (
            <div key={definition.id} className="quest">
              <div className="quest-top">
                <span className="quest-label">{definition.label}</span>
                <span className="quest-progress">
                  {Math.min(quest.progress, quest.goal)}/{quest.goal}
                </span>
              </div>
              <div className="hp-track">
                <div className="hp-fill" style={{ width: `${ratio * 100}%`, background: '#4f9dff' }} />
              </div>
              {quest.claimed ? (
                <span className="quest-done">Recompensa recebida</span>
              ) : (
                <button
                  type="button"
                  className="quest-claim"
                  disabled={!isComplete(quest)}
                  onClick={() => claimQuest(definition.id)}
                >
                  {isComplete(quest) ? 'Resgatar' : `₽ ${definition.reward.money ?? 0}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {save.eggs.length > 0 && (
        <>
          <h3 className="section-title">Ovos</h3>
          <div className="quest-list">
            {save.eggs.map((egg) => (
              <div key={egg.id} className="quest">
                <div className="quest-top">
                  <span className="quest-label">Ovo misterioso</span>
                  <span className="quest-progress">{egg.stepsLeft} passos</span>
                </div>
                <div className="hp-track">
                  <div
                    className="hp-fill"
                    style={{
                      width: `${((egg.totalSteps - egg.stepsLeft) / egg.totalSteps) * 100}%`,
                      background: '#ffcb3d',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="sheet-actions">
        <button type="button" className="secondary-button" onClick={onOpenSettings}>
          Configuracoes
        </button>
      </div>

      {planning && (
        <ExpeditionPlanner
          ctx={ctx}
          save={save}
          onClose={() => setPlanning(false)}
          onConfirm={async (mapId, mapName, team, option) => {
            const map = await loadMap(mapId);
            const expedition = startExpedition(map, team, option, mapName);
            update((s) => {
              s.expeditions = [...s.expeditions.filter((e) => !e.collected), expedition];
            });
            haptic(16);
            setPlanning(false);
            onMessage(`Expedicao enviada para ${mapName}. Volte em ${option.label}.`);
          }}
        />
      )}

      <p className="screen-footnote">
        Streak de {save.dailies.streak} dias · proximo bonus ₽{' '}
        {streakReward(save.dailies.streak + 1).money.toLocaleString('pt-BR')}
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <span className="stat-card-value">{value.toLocaleString('pt-BR')}</span>
      <span className="stat-card-label">{label}</span>
    </div>
  );
}

function ExpeditionPlanner({
  ctx,
  save,
  onClose,
  onConfirm,
}: {
  ctx: PokemonContext;
  save: SaveData;
  onClose: () => void;
  onConfirm: (
    mapId: string,
    mapName: string,
    team: Pokemon[],
    option: ExpeditionOption,
  ) => Promise<void>;
}) {
  const [areas, setAreas] = useState<{ id: string; name: string }[]>([]);
  const [area, setArea] = useState<string | null>(null);
  const [team, setTeam] = useState<string[]>([]);
  const [option, setOption] = useState<ExpeditionOption>(EXPEDITION_OPTIONS[0]);

  useEffect(() => {
    void (async () => {
      const world = await loadWorldIndex();
      // So areas com encontros (e de la que vem a recompensa) e por onde o
      // jogador ja passou: expedicao nao e atalho para o fim do jogo.
      const visited = new Set(save.visited);
      const list = world.maps
        .filter((m) => m.hasEncounters && visited.has(m.id))
        .map((m) => ({ id: m.id, name: sectionName(m.section) }));
      const unique = new Map(list.map((m) => [m.name, m]));
      setAreas([...unique.values()]);
    })();
  }, [save.visited]);

  const busy = new Set(
    save.expeditions.filter((e) => !e.collected).flatMap((e) => e.team),
  );
  const available = save.party.filter((p) => !busy.has(p.uid));

  const toggle = (uid: string) => {
    setTeam((current) =>
      current.includes(uid)
        ? current.filter((id) => id !== uid)
        : current.length >= 3
          ? current
          : [...current, uid],
    );
  };

  const selectedArea = areas.find((a) => a.id === area);
  const selectedTeam = available.filter((p) => team.includes(p.uid));
  const canConfirm = selectedArea && selectedTeam.length > 0;

  return (
    <Sheet title="Nova expedicao" onClose={onClose} height={86}>
      <h3 className="section-title">Para onde</h3>
      {areas.length === 0 && (
        <p className="paragraph">
          Explore uma area com Pokemon selvagens para liberar destinos de expedicao.
        </p>
      )}
      <div className="chip-row chip-row-wrap">
        {areas.map((a) => (
          <button
            key={a.id}
            type="button"
            className={area === a.id ? 'chip chip-active' : 'chip'}
            onClick={() => setArea(a.id)}
          >
            {a.name}
          </button>
        ))}
      </div>

      <h3 className="section-title">Quem vai (ate 3)</h3>
      {available.length === 0 && <p className="paragraph">Toda a equipe ja esta em expedicao.</p>}
      <div className="mon-list">
        {available.map((pokemon) => (
          <button
            key={pokemon.uid}
            type="button"
            className={team.includes(pokemon.uid) ? 'mon-card mon-card-active' : 'mon-card'}
            onClick={() => toggle(pokemon.uid)}
          >
            <img
              className="mon-icon"
              src={iconSprite(pokemon.species, pokemon.shiny)}
              alt=""
              loading="lazy"
              draggable={false}
            />
            <div className="mon-body">
              <div className="mon-top">
                <span className="mon-name">{displayName(ctx, pokemon)}</span>
                <span className="mon-level">Nv{pokemon.level}</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      <h3 className="section-title">Por quanto tempo</h3>
      <div className="chip-row">
        {EXPEDITION_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            className={option.id === o.id ? 'chip chip-active' : 'chip'}
            onClick={() => setOption(o)}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="sheet-actions">
        <button
          type="button"
          className="primary-button"
          disabled={!canConfirm}
          onClick={() => {
            if (!selectedArea) return;
            void onConfirm(selectedArea.id, selectedArea.name, selectedTeam, option);
          }}
        >
          Enviar expedicao
        </button>
      </div>
    </Sheet>
  );
}
