/** Only these scientific values may cross into the app. Operational records stay local. */
export interface ViewerInterval {
  estimate: number;
  interval: number[];
  coverage: number;
  blocksPerStratum: number[];
  interpretation: string;
}

export interface ViewerArm {
  temperature: number;
  arm: string;
  benchmarkCompleted: number;
  meanOracleLoss: number;
  zeroLossEpisodes: number;
  benchmarkDecisions: number;
  zeroGapDecisions: number;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  drafts: number;
  cappedDrafts: number;
  requestMedianSeconds: number;
  requestP95Seconds: number;
}

export interface ViewerCooperation {
  temperature: number;
  cell: string;
  completed: number;
  rounds: number;
  CC: number;
  CD: number;
  DC: number;
  DD: number;
  roundWeightedCC: number;
  episodeWeightedCC: number;
  firstCC: number;
  meanNormalisedJointReturn: number;
  breakdownCount: number;
  recoveryCount: number;
  breakdownOpportunities: number;
  recoveryOpportunities: number;
}

interface Effects {
  temperature: number;
  episodesPerArm: number;
  'nano-direct': number;
  'nano-draft': number;
  'super-direct': number;
  'super-draft': number;
  nanoEffect: number;
  superEffect: number;
}

export interface ViewerStudy {
  schemaVersion: number;
  summary: {
    selectedBlocksPerTemperature: number;
    scheduled: number;
    completed: number;
    complete: boolean;
    requestCount: number;
    arms: ViewerArm[];
    contrasts: (ViewerInterval & {
      family: string;
      contrast: string;
      model?: string;
      temperature?: number;
      direction?: string;
      arm?: string;
    })[];
    scheduledOutcomeBounds: {
      temperature: number;
      model: string;
      lower: number;
      upper: number;
      interpretation: string;
    }[];
    cooperation: ViewerCooperation[];
  };
  diagnostics: {
    scope: string;
    policyEffects: (Effects & { policy: string })[];
    conditions: (Effects & { condition: string })[];
    strata: {
      temperature: number;
      stratum: number;
      model: string;
      direct: number;
      draft: number;
      effect: number;
    }[];
    firstActions: {
      temperature: number;
      condition: string;
      arm: string;
      cooperate: number;
      episodes: number;
      optimalFirstActions: string[];
    }[];
    finiteHorizon: {
      temperature: number;
      arm: string;
      policy: string;
      episodes: number;
      optimalPaths: number;
      roundCooperations: number[];
      meanOwnPayoff: number;
    }[];
    autonomousContrasts: (ViewerInterval & {
      temperature: number;
      model: string;
      metric: string;
      contrast: string;
    })[];
    temperatureHistoryChanges: { arm: string; episodes: number; differentHistories: number }[];
    metadataSelectedExamples: {
      temperature: number;
      id: string;
      cell: string;
      block: number;
      loss: number;
      subjectPath: string;
    }[];
    requestDiagnostics: {
      temperature: number;
      arm: string;
      transmitted: number;
      successful: number;
      successfulDrafts: number;
      cappedDrafts: number;
      reportedModels: Partial<Record<string, number>>;
      systemFingerprints: Partial<Record<string, number>>;
    }[];
    autonomousPooled: {
      temperature: number;
      episodes: number;
      rounds: number;
      CC: number;
      episodeWeightedCC: number;
    }[];
    transportSegments: {
      temperature: number;
      arm: string;
      original: { episodes: number; meanLoss: number };
      recovery: { episodes: number; meanLoss: number };
    }[];
  };
  provenance: {
    study: string;
    finalElapsedHours: number;
    nativeScoredEpisodeCoverage: number;
    historicalDevelopmentEpisodesPooled: number;
  };
}
