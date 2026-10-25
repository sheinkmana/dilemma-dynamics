import summary from '../../public/research/summary.json' with { type: 'json' };
import diagnostics from '../../public/research/diagnostics.json' with { type: 'json' };
import accounting from '../../public/research/accounting.json' with { type: 'json' };
import provenance from '../../public/research/provenance.json' with { type: 'json' };

export { summary, diagnostics, accounting, provenance };
export type StudyTemperature = 0 | 1;
export const studies = {
  0: { path: 'research/temperature-zero', date: '24–25 October 2026' },
  1: { path: 'research/temperature-one', date: '24–25 October 2026' },
} as const;
