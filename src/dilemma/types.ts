import type { Usage } from '../shared/types.js';
export type Action = 'C' | 'D';
export type Seat = 0 | 1;
export interface Participant {
  kind: 'human' | 'model' | 'demo-random' | 'demo-reciprocal';
  name: string;
  model: string;
}
export interface DilemmaConfig {
  mode: 'autonomous' | 'demo' | 'interactive';
  players: [Participant, Participant];
  protocol: 'actions' | 'forecasts';
  horizon: { kind: 'geometric' } | { kind: 'fixed'; rounds: number };
  mapping: 'X=C' | 'X=D';
  maxUsd: number;
  delayMs: number;
}
export interface Forecast {
  pOpponentC: number;
  futureIfC: number;
  futureIfD: number;
}
export interface Decision {
  action: Action;
  forecast: Forecast | null;
}
export interface DecisionAnalysis {
  immediateGainFromD: [number, number];
  requiredFutureAdvantage: [number, number] | null;
  knownFinalRound: boolean;
  expectedC: number | null;
  expectedD: number | null;
  reportedLoss: number | null;
  brier: number | null;
  finding: string;
}
export interface Round {
  index: number;
  beforeHash: string;
  actions: [Action, Action];
  payoffs: [number, number];
  scores: [number, number];
  forecasts: [Forecast | null, Forecast | null];
  analysis: [DecisionAnalysis, DecisionAnalysis];
  attemptIds: [string, string];
  costUsd: number;
  telemetry: [DecisionTelemetry, DecisionTelemetry];
  continuation: 'continued' | 'geometric-stop' | 'fixed-final';
  resolvedAt: string;
}
export interface DecisionTelemetry {
  latencyMs: number;
  usage: Usage | null;
  costUsd: number;
}
export type SessionStatus =
  | 'ready'
  | 'running'
  | 'paused'
  | 'completed'
  | 'interrupted'
  | 'stopped'
  | 'invalid'
  | 'budget';
export interface DilemmaSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  config: DilemmaConfig;
  rounds: Round[];
  scores: [number, number];
  status: SessionStatus;
  message: string;
  endReason: string | null;
  received: [boolean, boolean];
  pendingRound: number | null;
  spentUsd: number;
  reservedUsd: number;
  attempts: number;
  invalidAttempts: number;
  version: number;
  rulesVersion: string;
  protocolVersion: string;
  analysisVersion: string;
  endpoint: string;
  pricingDate: string;
}
export interface StoredSession extends DilemmaSession {
  environmentSeed: string;
  creationKey: string;
}
export type Messages = { role: string; content: string }[];
export interface PendingRound {
  index: number;
  beforeHash: string;
  messages: [Messages, Messages];
  sealed: [
    { decision: Decision; attemptId: string } | null,
    { decision: Decision; attemptId: string } | null,
  ];
}
