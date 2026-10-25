import data from './viewer-study.json' with { type: 'json' };
import type { ViewerStudy } from './viewerData.js';

const study: ViewerStudy = data;
export const { summary, diagnostics, provenance } = study;
export type StudyTemperature = 0 | 1;
export const studies = {
  0: { path: 'research/temperature-zero' },
  1: { path: 'research/temperature-one' },
} as const;
