import { z } from 'zod';
import type { Action, DilemmaConfig } from './types.js';
export { payoff, continuationWeight, futureBound } from './spec.js';
export const RULES_VERSION = 'dilemma/1';
export const PROTOCOL_VERSION = 'dilemma-actions-forecasts/1';
const participant = z
  .object({
    kind: z.enum(['human', 'model', 'demo-random', 'demo-reciprocal']),
    name: z.string().trim().min(1).max(80),
    model: z.string().max(200).default(''),
  })
  .strict();
export const configSchema = z
  .object({
    mode: z.enum(['autonomous', 'demo', 'interactive']).default('autonomous'),
    players: z.tuple([participant, participant]),
    protocol: z.enum(['actions', 'forecasts']).default('actions'),
    horizon: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('geometric') }).strict(),
        z.object({ kind: z.literal('fixed'), rounds: z.number().int().min(1).max(50) }).strict(),
      ])
      .default({ kind: 'geometric' }),
    mapping: z.enum(['X=C', 'X=D']).default('X=C'),
    maxUsd: z.number().finite().min(0.001).max(5).default(0.05),
    delayMs: z.number().int().min(0).max(5000).default(700),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      c.mode !== 'interactive' &&
      c.players.some(
        (p) => (p.kind === 'model') !== (c.mode === 'autonomous') || p.kind === 'human',
      )
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Autonomous sessions require two models; demos require two explicitly local players.',
      });
    if (c.mode === 'interactive' && c.players.filter((p) => p.kind === 'human').length !== 1)
      ctx.addIssue({
        code: 'custom',
        message: 'Interactive play requires exactly one human player.',
      });
    if (c.mode !== 'autonomous' && c.protocol !== 'actions')
      ctx.addIssue({
        code: 'custom',
        message:
          'Local demonstrations and human play use actions only; forecasts are not fabricated.',
      });
    if (c.players.some((p) => p.kind === 'model' && !p.model))
      ctx.addIssue({ code: 'custom', message: 'Choose an ID for each model player.' });
  });
export function token(action: Action, mapping: DilemmaConfig['mapping']): 'X' | 'Y' {
  return (action === 'C') === (mapping === 'X=C') ? 'X' : 'Y';
}
export function canonical(t: 'X' | 'Y', mapping: DilemmaConfig['mapping']): Action {
  return (t === 'X') === (mapping === 'X=C') ? 'C' : 'D';
}
