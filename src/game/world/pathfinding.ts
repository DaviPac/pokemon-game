/**
 * A* em grade para o modo de locomocao por toque. Limitamos a busca para que um
 * toque num ponto inalcancavel nao trave o quadro no celular.
 */
import type { Direction } from '../data/types.js';
import type { Overworld } from './overworld.js';
import { directionDelta } from './world.js';

const MAX_NODES = 4000;
const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

export interface PathNode {
  x: number;
  y: number;
}

export function findPath(
  overworld: Overworld,
  from: PathNode,
  to: PathNode,
): PathNode[] | null {
  if (from.x === to.x && from.y === to.y) return [];

  const key = (x: number, y: number) => `${x},${y}`;
  const open: { node: PathNode; f: number; g: number }[] = [
    { node: from, f: heuristic(from, to), g: 0 },
  ];
  const cameFrom = new Map<string, PathNode>();
  const gScore = new Map<string, number>([[key(from.x, from.y), 0]]);
  const closed = new Set<string>();
  let expanded = 0;

  while (open.length > 0 && expanded < MAX_NODES) {
    // Lista pequena: uma busca linear pelo menor f custa menos que um heap.
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIndex].f) bestIndex = i;
    }
    const current = open.splice(bestIndex, 1)[0];
    const currentKey = key(current.node.x, current.node.y);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    expanded++;

    if (current.node.x === to.x && current.node.y === to.y) {
      return reconstruct(cameFrom, current.node, from);
    }

    for (const dir of DIRECTIONS) {
      const { dx, dy } = directionDelta(dir);
      const nx = current.node.x + dx;
      const ny = current.node.y + dy;
      const nKey = key(nx, ny);
      if (closed.has(nKey)) continue;
      if (!overworld.isPassable(nx, ny, dir)) continue;

      const tentative = current.g + 1;
      if (tentative >= (gScore.get(nKey) ?? Infinity)) continue;
      gScore.set(nKey, tentative);
      cameFrom.set(nKey, current.node);
      open.push({
        node: { x: nx, y: ny },
        g: tentative,
        f: tentative + heuristic({ x: nx, y: ny }, to),
      });
    }
  }

  return null;
}

function heuristic(a: PathNode, b: PathNode): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function reconstruct(
  cameFrom: Map<string, PathNode>,
  end: PathNode,
  start: PathNode,
): PathNode[] {
  const path: PathNode[] = [end];
  let current = end;
  while (current.x !== start.x || current.y !== start.y) {
    const previous = cameFrom.get(`${current.x},${current.y}`);
    if (!previous) break;
    current = previous;
    if (current.x === start.x && current.y === start.y) break;
    path.push(current);
  }
  return path.reverse();
}
