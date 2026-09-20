/**
 * Enderecos dos sprites de batalha.
 *
 * Ate o #649 usamos os GIFs animados de Pokemon Black/White (geracao V), que
 * sao exatamente o visual pedido. De #650 a #721 a geracao V nao existe, entao
 * caimos nos sprites de X/Y (geracao VI), do mesmo estilo de pixel.
 *
 * Os arquivos vem do repositorio do PokeAPI e ficam em cache no service worker,
 * entao cada Pokemon visto continua disponivel offline.
 */

const CDN = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const LAST_ANIMATED = 649;

export type SpriteFacing = 'front' | 'back';

export function battleSprite(species: number, facing: SpriteFacing, shiny: boolean): string {
  if (species <= LAST_ANIMATED) {
    const parts = ['versions/generation-v/black-white/animated'];
    if (facing === 'back') parts.push('back');
    if (shiny) parts.push('shiny');
    return `${CDN}/${parts.join('/')}/${species}.gif`;
  }

  const parts = ['versions/generation-vi/x-y'];
  if (facing === 'back') parts.push('back');
  if (shiny) parts.push('shiny');
  return `${CDN}/${parts.join('/')}/${species}.png`;
}

/** Sprite estatico, usado em listas onde animar 30 GIFs seria desperdicio. */
export function iconSprite(species: number, shiny = false): string {
  const parts = ['versions/generation-viii/icons'];
  if (shiny) parts.push('shiny');
  return `${CDN}/${parts.join('/')}/${species}.png`;
}

/** Arte oficial, para telas grandes como a ficha da Pokedex. */
export function artwork(species: number, shiny = false): string {
  return shiny
    ? `${CDN}/other/official-artwork/shiny/${species}.png`
    : `${CDN}/other/official-artwork/${species}.png`;
}

/** True quando o sprite e um GIF animado (muda como a UI o trata). */
export function isAnimated(species: number): boolean {
  return species <= LAST_ANIMATED;
}
