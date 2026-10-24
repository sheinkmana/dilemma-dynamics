import { z } from 'zod';
import type { MatchConfig } from './types.js';

export function actionOnlyConfig(config: MatchConfig): MatchConfig {
  const result = structuredClone(config);
  result.format = 'text';
  result.explanation = false;
  for (const player of result.players) {
    player.reasoning = 'off';
    player.maxTokens = 128;
  }
  return result;
}

export function isActionOnly(config: MatchConfig): boolean {
  return (
    config.format === 'text' &&
    !config.explanation &&
    config.players.every((p) => p.kind !== 'nebius' || p.reasoning === 'off')
  );
}

export const playerSchema = z.object({
  kind: z.enum(['human', 'random', 'heuristic', 'solver', 'nebius']),
  name: z.string().trim().min(1).max(80),
  model: z.string().max(200).default(''),
  knowledge: z.enum(['rules', 'examples', 'strategy']).default('rules'),
  reasoning: z.enum(['default', 'on', 'off']).default('default'),
  maxTokens: z.number().int().min(128).max(16384).default(2048),
  temperature: z.number().min(0).max(2).default(0),
});
export const matchSchema = z.object({
  game: z.enum(['dots-boxes', 'tic-tac-toe']).default('dots-boxes'),
  rows: z.number().int().min(1).max(6).default(3),
  cols: z.number().int().min(1).max(6).default(3),
  scenario: z.string().default('empty'),
  seed: z.number().int().min(0).max(2147483647).default(42),
  players: z.tuple([playerSchema, playerSchema]),
  maxUsd: z.number().positive().max(100).default(0.25),
  repairAttempts: z.number().int().min(0).max(1).default(1),
  explanation: z.boolean().default(true),
  format: z.enum(['text', 'json_object', 'json_schema']).default('text'),
  maxMoves: z.number().int().positive().max(200).optional(),
  openingMoves: z.number().int().min(0).max(8).default(0),
  moveDelayMs: z.number().int().min(0).max(5000).default(700),
});
export const experimentSchema = z.object({
  kind: z.enum(['paired', 'positions']),
  pairs: z.number().int().min(1).max(20).default(3),
  match: matchSchema,
  maxUsd: z.number().positive().max(100).default(1),
});
export const defaultConfig = matchSchema.parse({
  players: [
    { kind: 'heuristic', name: 'Greedy baseline' },
    { kind: 'random', name: 'Random baseline' },
  ],
});

export function simpleMatchConfig(
  game: MatchConfig['game'],
  players: MatchConfig['players'],
): MatchConfig {
  return actionOnlyConfig({
    ...structuredClone(defaultConfig),
    game,
    rows: 3,
    cols: 3,
    scenario: 'empty',
    players: players.map((p) => ({
      ...p,
      knowledge: 'rules',
      temperature: 0,
    })) as MatchConfig['players'],
    maxUsd: 0.05,
    moveDelayMs: 700,
  });
}
