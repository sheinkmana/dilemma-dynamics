import one from '../../public/research/summary.json' with { type: 'json' };
import zero from '../../public/research/temperature-zero/summary.json' with { type: 'json' };
import costsOne from '../../public/research/execution-costs.json' with { type: 'json' };
import costsZero from '../../public/research/temperature-zero/execution-costs.json' with { type: 'json' };

export type StudyTemperature = 0 | 1;
export const studies = {
  0: {
    summary: zero,
    costs: costsZero,
    path: 'research/temperature-zero',
    date: '23 October 2026',
  },
  1: { summary: one, costs: costsOne, path: 'research', date: '22 October 2026' },
} as const;
