import { geometry, boxEdges, applyDots, legalDots } from './dots-boxes.js';
import { applyTic, legalTic, ticOutcome } from './tic-tac-toe.js';
import type { Component, DotsState, Evaluation, GameState, TicState } from '../shared/types.js';

export function components(state: DotsState): Component[] | null {
  const unclaimed = state.owners.flatMap((v, i) => (v === null ? [i] : []));
  const edges = geometry(state.rows, state.cols).filter((e) => state.drawn[e.id] === undefined);
  const incident = new Map(unclaimed.map((i) => [i, edges.filter((e) => e.boxes.includes(i))]));
  if (unclaimed.some((i) => incident.get(i)!.length !== 2)) return null;
  const seen = new Set<number>(),
    result: Component[] = [];
  for (const first of unclaimed) {
    if (seen.has(first)) continue;
    const queue = [first],
      boxes: number[] = [],
      actions = new Set<string>();
    let ports = 0;
    while (queue.length) {
      const b = queue.pop()!;
      if (seen.has(b)) continue;
      seen.add(b);
      boxes.push(b);
      for (const e of incident.get(b)!) {
        actions.add(e.id);
        if (e.boxes.length === 1) ports++;
        for (const other of e.boxes) if (other !== b && !seen.has(other)) queue.push(other);
      }
    }
    if (ports === 2 && boxes.length >= 3)
      result.push({ kind: 'chain', length: boxes.length, boxes, actions: [...actions] });
    else if (ports === 0 && boxes.length >= 4 && boxes.length % 2 === 0)
      result.push({ kind: 'loop', length: boxes.length, boxes, actions: [...actions] });
    else return null;
  }
  return result;
}
export function componentValue(
  parts: Component[],
  budget = 100000,
): { value: number; nodes: number } {
  const memo = new Map<string, number>();
  let nodes = 0;
  function solve(items: { kind: string; length: number }[]): number {
    if (!items.length) return 0;
    const key = items
      .map((x) => `${x.kind}:${x.length}`)
      .sort()
      .join(',');
    if (memo.has(key)) return memo.get(key)!;
    if (++nodes > budget) throw new Error('Component search budget exceeded.');
    let best = Infinity;
    for (let i = 0; i < items.length; i++) {
      const k = items[i].kind === 'chain' ? 2 : 4;
      const rest = solve(items.filter((_, j) => j !== i));
      best = Math.min(best, items[i].length - k + Math.abs(rest - k));
    }
    memo.set(key, best);
    return best;
  }
  return { value: solve(parts), nodes };
}
export function evaluateDots(
  state: DotsState,
  options: { maxEdges?: number; maxNodes?: number; maxMs?: number; components?: boolean } = {},
): Evaluation {
  const legal = legalDots(state),
    player = state.player;
  if (player === null)
    return {
      status: 'exact',
      method: 'terminal',
      value: 0,
      actionValues: {},
      optimalActions: [],
      nodes: 0,
    };
  const margin = state.scores[player] - state.scores[1 - player];
  if (options.components !== false) {
    const parts = components(state);
    if (parts?.length)
      try {
        const values: Record<string, number> = {};
        let nodes = 0;
        for (let i = 0; i < parts.length; i++) {
          const rest = componentValue(
            parts.filter((_, j) => j !== i),
            options.maxNodes,
          );
          nodes += rest.nodes;
          const k = parts[i].kind === 'chain' ? 2 : 4;
          const v = margin - (parts[i].length - k + Math.abs(rest.value - k));
          for (const a of parts[i].actions) values[a] = v;
        }
        const value = Math.max(...Object.values(values));
        return {
          status: 'exact',
          method: 'chain/loop recurrence',
          value,
          actionValues: values,
          optimalActions: legal.filter((a) => values[a] === value),
          nodes,
          components: parts,
        };
      } catch {
        /* The independent edge solver may still fit its budget. */
      }
  }
  if (legal.length > (options.maxEdges ?? 16))
    return {
      status: 'unknown',
      method: 'outside search limit',
      value: null,
      optimalActions: [],
      actionValues: {},
      nodes: 0,
      note: 'No exact opening or middle-game value is claimed.',
    };
  const edges = geometry(state.rows, state.cols),
    all = (1n << BigInt(edges.length)) - 1n;
  let mask = 0n;
  edges.forEach((e, i) => {
    if (state.drawn[e.id] !== undefined) mask |= 1n << BigInt(i);
  });
  const boxMasks = state.owners.map((_, i) =>
    boxEdges(Math.floor(i / state.cols), i % state.cols).reduce(
      (acc, e) => acc | (1n << BigInt(edges.findIndex((x) => x.id === e))),
      0n,
    ),
  );
  const memo = new Map<bigint, number>(),
    started = performance.now();
  let nodes = 0;
  // Future score differential for the player to move. Captures retain the sign.
  function solve(m: bigint): number {
    if (m === all) return 0;
    if (memo.has(m)) return memo.get(m)!;
    if (
      ++nodes > (options.maxNodes ?? 120000) ||
      (nodes % 1024 === 0 && performance.now() - started > (options.maxMs ?? 60))
    )
      throw new Error('Search budget reached.');
    let best = -Infinity;
    for (let i = 0; i < edges.length; i++) {
      const bit = 1n << BigInt(i);
      if (m & bit) continue;
      const next = m | bit;
      const count = edges[i].boxes.filter((b) => (next & boxMasks[b]) === boxMasks[b]).length;
      best = Math.max(best, count ? count + solve(next) : -solve(next));
    }
    memo.set(m, best);
    return best;
  }
  try {
    const values: Record<string, number> = {};
    edges.forEach((e, i) => {
      const bit = 1n << BigInt(i);
      if (mask & bit) return;
      const next = mask | bit,
        count = e.boxes.filter((b) => (next & boxMasks[b]) === boxMasks[b]).length;
      values[e.id] = margin + (count ? count + solve(next) : -solve(next));
    });
    const value = Math.max(...Object.values(values));
    return {
      status: 'exact',
      method: 'exhaustive edge search',
      value,
      actionValues: values,
      optimalActions: legal.filter((a) => values[a] === value),
      nodes,
    };
  } catch {
    return {
      status: 'unknown',
      method: 'search budget reached',
      value: null,
      optimalActions: [],
      actionValues: {},
      nodes,
      note: 'Partial search results are not presented as exact.',
    };
  }
}
export function evaluateTic(state: TicState): Evaluation {
  let nodes = 0;
  const memo = new Map<string, number>();
  function solve(s: TicState): number {
    const outcome = ticOutcome(s);
    if (outcome) return outcome.winner === null ? 0 : -1;
    const key = JSON.stringify([s.cells, s.player]);
    if (memo.has(key)) return memo.get(key)!;
    nodes++;
    const value = Math.max(...legalTic(s).map((a) => -solve(applyTic(s, a).state as TicState)));
    memo.set(key, value);
    return value;
  }
  const actionValues = Object.fromEntries(
    legalTic(state).map((a) => [a, -solve(applyTic(state, a).state as TicState)]),
  );
  const value = Object.keys(actionValues).length ? Math.max(...Object.values(actionValues)) : 0;
  return {
    status: 'exact',
    method: 'exhaustive game tree',
    value: value || 0,
    actionValues,
    optimalActions: Object.keys(actionValues).filter((a) => actionValues[a] === value),
    nodes,
  };
}
export const evaluate = (s: GameState): Evaluation =>
  s.game === 'dots-boxes' ? evaluateDots(s) : evaluateTic(s);
