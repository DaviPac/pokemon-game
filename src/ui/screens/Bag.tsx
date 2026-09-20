/**
 * Mochila: itens por categoria, com uso direto na equipe.
 */
import { useState } from 'react';
import { itemInfo, type ItemCategory } from '../../game/data/items.js';
import { BATTLE_ITEMS } from '../../game/battle/engine.js';
import {
  displayName,
  isFainted,
  maxHp,
  type Pokemon,
  type PokemonContext,
} from '../../game/pokemon/pokemon.js';
import { iconSprite } from '../../game/pokemon/sprites.js';
import type { SaveData } from '../../game/save/schema.js';
import { useGame } from '../../state/game.js';
import { haptic } from '../../state/settings.js';
import { Sheet } from '../shell/Sheet.js';

const CATEGORY_LABELS: Record<ItemCategory, string> = {
  ball: 'Bolas',
  medicine: 'Remedios',
  other: 'Outros',
};

export function Bag({
  ctx,
  save,
  onMessage,
}: {
  ctx: PokemonContext;
  save: SaveData;
  onMessage: (text: string) => void;
}) {
  const [using, setUsing] = useState<string | null>(null);
  const update = useGame((s) => s.update);

  const entries = Object.entries(save.bag).filter(([, count]) => count > 0);
  const grouped = new Map<ItemCategory, [string, number][]>();
  for (const entry of entries) {
    const category = itemInfo(entry[0]).category;
    grouped.set(category, [...(grouped.get(category) ?? []), entry]);
  }

  const applyItem = (itemId: string, target: Pokemon) => {
    const effect = BATTLE_ITEMS[itemId];
    if (!effect) return;
    const hpMax = maxHp(ctx, target);

    if (effect.revive && !isFainted(target)) {
      onMessage('Esse Pokemon nao esta desmaiado.');
      return;
    }
    if (effect.heal && target.hp >= hpMax) {
      onMessage(`${displayName(ctx, target)} ja esta com o HP cheio.`);
      return;
    }
    if (effect.cure && !target.status) {
      onMessage(`${displayName(ctx, target)} esta bem.`);
      return;
    }

    haptic(14);
    update((s) => {
      s.party = s.party.map((p) => {
        if (p.uid !== target.uid) return p;
        const copy = { ...p, moves: p.moves.map((m) => ({ ...m })) };
        if (effect.revive) copy.hp = Math.floor(hpMax / 2);
        if (effect.heal) copy.hp = Math.min(hpMax, copy.hp + effect.heal);
        if (effect.cure && (effect.cure === 'all' || effect.cure === copy.status)) {
          copy.status = null;
          copy.sleepTurns = 0;
        }
        return copy;
      });
      s.bag = { ...s.bag, [itemId]: (s.bag[itemId] ?? 1) - 1 };
    });
    onMessage(`Voce usou ${itemInfo(itemId).name} em ${displayName(ctx, target)}.`);
    setUsing(null);
  };

  return (
    <div className="screen">
      <header className="screen-head">
        <h1 className="screen-title">Mochila</h1>
        <p className="screen-sub">₽ {save.money.toLocaleString('pt-BR')}</p>
      </header>

      {entries.length === 0 && <p className="paragraph">Sua mochila esta vazia.</p>}

      {(['ball', 'medicine', 'other'] as ItemCategory[]).map((category) => {
        const items = grouped.get(category);
        if (!items || items.length === 0) return null;
        return (
          <section key={category}>
            <h3 className="section-title">{CATEGORY_LABELS[category]}</h3>
            <div className="item-list">
              {items.map(([id, count]) => {
                const info = itemInfo(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className="item-row"
                    disabled={!info.usableOnParty}
                    onClick={() => setUsing(id)}
                  >
                    <span className="item-main">
                      <span className="item-name">{info.name}</span>
                      <span className="item-desc">{info.description}</span>
                    </span>
                    <span className="item-count">×{count}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {using && (
        <Sheet title={`Usar ${itemInfo(using).name}`} onClose={() => setUsing(null)} height={60}>
          <div className="mon-list">
            {save.party.map((pokemon) => (
              <button
                key={pokemon.uid}
                type="button"
                className="mon-card"
                onClick={() => applyItem(using, pokemon)}
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
                  <div className="mon-meta">
                    <span>
                      {Math.max(0, pokemon.hp)}/{maxHp(ctx, pokemon)}
                    </span>
                    {pokemon.status && <span>{pokemon.status.toUpperCase()}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
