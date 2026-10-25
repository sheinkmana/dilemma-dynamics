import { z } from 'zod';
import { payoff } from './spec.js';

const action = z.enum(['C', 'D']);
const episodeSchema = z.object({
  id: z.string(),
  matchedId: z.string(),
  temperature: z.union([z.literal(0), z.literal(1)]),
  track: z.enum(['A', 'B']),
  cell: z.string(),
  block: z.number().int().min(0).max(47),
  stratum: z.number().int().min(0).max(3),
  mapping: z.enum(['X=C', 'X=D']),
  subjectSeat: z.union([z.literal(0), z.literal(1), z.null()]),
  players: z.tuple([z.string(), z.string()]),
  horizon: z.union([
    z.object({ kind: z.literal('geometric'), delta: z.string() }),
    z.object({ kind: z.literal('fixed'), rounds: z.number().int().positive() }),
  ]),
  rounds: z.number().int().positive(),
  status: z.literal('completed'),
  history: z.array(z.tuple([action, action])).min(1),
  scores: z.tuple([z.number(), z.number()]),
  normalisedOracleLoss: z.number().nullable(),
});
export type RecordedEpisode = z.infer<typeof episodeSchema>;

export function recordedScore(episode: Pick<RecordedEpisode, 'history'>, through: number) {
  if (!Number.isInteger(through) || through < 0 || through > episode.history.length)
    throw new Error('Round is outside this recording.');
  return episode.history.slice(0, through).reduce<[number, number]>(
    (score, pair) => {
      const points = payoff(...pair);
      return [score[0] + points[0], score[1] + points[1]];
    },
    [0, 0],
  );
}

export function parseRecordedEpisodes(data: unknown): RecordedEpisode[] {
  const rows = z.array(episodeSchema).min(1).parse(data);
  if (new Set(rows.map((r) => r.id)).size !== rows.length)
    throw new Error('Duplicate recorded episode IDs.');
  for (const row of rows) {
    if (
      row.rounds !== row.history.length ||
      recordedScore(row, row.rounds).some((score, i) => score !== row.scores[i])
    )
      throw new Error('Recorded actions do not match their published score.');
  }
  return rows;
}

export function playerLabel(id: string) {
  const labels: Record<string, string> = {
    'nano-direct': 'Nemotron Nano · Direct',
    'nano-draft': 'Nemotron Nano · Draft',
    'super-direct': 'Nemotron Super · Direct',
    'super-draft': 'Nemotron Super · Draft',
    allc: 'Always cooperate',
    alld: 'Always defect',
    tft: 'Tit-for-Tat',
    grim: 'Grim trigger',
  };
  return labels[id] ?? id;
}
