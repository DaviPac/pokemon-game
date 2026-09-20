/**
 * Loja Pokemon. O estoque melhora conforme as insignias.
 */
import { useState } from 'react';
import { itemInfo, shopStock } from '../../game/data/items.js';
import type { SaveData } from '../../game/save/schema.js';
import { useGame } from '../../state/game.js';
import { haptic } from '../../state/settings.js';
import { Sheet } from '../shell/Sheet.js';

export function Shop({
  save,
  onClose,
  onMessage,
}: {
  save: SaveData;
  onClose: () => void;
  onMessage: (text: string) => void;
}) {
  const [quantity, setQuantity] = useState<Record<string, number>>({});
  const update = useGame((s) => s.update);
  const stock = shopStock(save.badges.length);

  const buy = (id: string) => {
    const info = itemInfo(id);
    const count = quantity[id] ?? 1;
    const cost = info.price * count;
    if (cost > save.money) {
      onMessage('Voce nao tem dinheiro suficiente.');
      return;
    }
    haptic(12);
    update((s) => {
      s.money -= cost;
      s.bag = { ...s.bag, [id]: (s.bag[id] ?? 0) + count };
    });
    onMessage(`Comprou ${info.name} ×${count} por ₽ ${cost.toLocaleString('pt-BR')}.`);
  };

  return (
    <Sheet title="Loja Pokemon" onClose={onClose} height={78}>
      <p className="screen-sub">Voce tem ₽ {save.money.toLocaleString('pt-BR')}</p>

      <div className="item-list">
        {stock.map((id) => {
          const info = itemInfo(id);
          const count = quantity[id] ?? 1;
          return (
            <div key={id} className="shop-row">
              <div className="item-main">
                <span className="item-name">{info.name}</span>
                <span className="item-desc">{info.description}</span>
                <span className="item-price">₽ {info.price.toLocaleString('pt-BR')}</span>
              </div>
              <div className="shop-controls">
                <div className="stepper">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => ({ ...q, [id]: Math.max(1, count - 1) }))}
                    aria-label="Diminuir"
                  >
                    −
                  </button>
                  <span>{count}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => ({ ...q, [id]: Math.min(99, count + 1) }))}
                    aria-label="Aumentar"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className="buy-button"
                  disabled={info.price * count > save.money}
                  onClick={() => buy(id)}
                >
                  Comprar
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
