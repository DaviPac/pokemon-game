/**
 * Icones da barra inferior.
 *
 * Sao desenhados em SVG, e nao com caracteres, por dois motivos: o mesmo
 * simbolo aparece igual em qualquer aparelho, e a espessura do traco acompanha
 * o tamanho quando o icone cresce sob o dedo.
 */

import type { ReactNode } from 'react';

interface IconProps {
  size?: number;
}

const BASE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Svg({ size = 24, children }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...BASE}>
      {children}
    </svg>
  );
}

/** Pokedex: o aparelho de tampa, com a lente e as luzes. */
export function DexIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="3" width="17" height="18" rx="3" />
      <path d="M3.5 12h17" />
      <circle cx="8" cy="7.5" r="2.2" />
      <path d="M14 7h3M14 9.5h3M8 16h8" />
    </Svg>
  );
}

/** Equipe: a Pokebola, o simbolo mais direto de "seus Pokemon". */
export function BallIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M3.4 12h5.2M15.4 12h5.2" />
      <circle cx="12" cy="12" r="2.8" />
    </Svg>
  );
}

/** Mapa: o alfinete de lugar, que e para onde esta aba leva. */
export function MapIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 21.5c4.2-4.6 6.3-8 6.3-10.6A6.3 6.3 0 0 0 5.7 10.9c0 2.6 2.1 6 6.3 10.6Z" />
      <circle cx="12" cy="10.8" r="2.4" />
    </Svg>
  );
}

/** Mochila. */
export function BagIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 9.5h15a1 1 0 0 1 1 1V19a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-8.5a1 1 0 0 1 1-1Z" />
      <path d="M8.5 9.5V7a3.5 3.5 0 0 1 7 0v2.5" />
      <path d="M3.5 14h17" />
    </Svg>
  );
}

/** Perfil do treinador. */
export function TrainerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8.2" r="3.7" />
      <path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" />
    </Svg>
  );
}
