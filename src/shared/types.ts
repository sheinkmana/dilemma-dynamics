export type Player = 0 | 1;
export type EdgeOwner = Player | -1;
export type GameId = 'dots-boxes' | 'tic-tac-toe';
export interface BaseState {
  game: GameId;
  player: Player | null;
  scores: [number, number];
  ply: number;
  turn: number;
}
export interface DotsState extends BaseState {
  game: 'dots-boxes';
  rows: number;
  cols: number;
  drawn: Record<string, EdgeOwner>;
  owners: (Player | null)[];
}
export interface TicState extends BaseState {
  game: 'tic-tac-toe';
  cells: (Player | null)[];
}
export type GameState = DotsState | TicState;
export interface Outcome {
  winner: Player | null;
  scores: [number, number];
  reason: string;
}
export interface Transition {
  state: GameState;
  captured: number[];
  retained: boolean;
  outcome: Outcome | null;
}
export interface Evaluation {
  status: 'exact' | 'unknown';
  method: string;
  value: number | null;
  optimalActions: string[];
  actionValues: Record<string, number>;
  nodes: number;
  components?: Component[];
  note?: string;
}
export interface Component {
  kind: 'chain' | 'loop';
  length: number;
  boxes: number[];
  actions: string[];
}
export interface PlayerConfig {
  kind: 'human' | 'random' | 'heuristic' | 'solver' | 'nebius';
  name: string;
  model: string;
  knowledge: 'rules' | 'examples' | 'strategy';
  reasoning: 'default' | 'off' | 'on';
  maxTokens: number;
  temperature: number;
}
export interface MatchConfig {
  game: GameId;
  rows: number;
  cols: number;
  scenario: string;
  seed: number;
  players: [PlayerConfig, PlayerConfig];
  maxUsd: number;
  repairAttempts: number;
  explanation: boolean;
  format: 'text' | 'json_object' | 'json_schema';
  maxMoves?: number;
  openingMoves: number;
  moveDelayMs?: number;
}
export type MatchStatus =
  | 'ready'
  | 'running'
  | 'paused'
  | 'completed'
  | 'stopped'
  | 'interrupted'
  | 'forfeit'
  | 'budget';
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number | null;
}
export interface MoveRecord {
  index: number;
  action: string;
  player: Player;
  captured: number[];
  retained: boolean;
  state: GameState;
  explanation: string;
  explanationSource: 'model' | 'baseline' | 'human';
  attemptId: string;
  latencyMs: number;
  firstTokenMs: number | null;
  usage: Usage | null;
  costUsd: number;
  costKind: string;
  evaluation: Evaluation;
  regret: number | null;
}
export interface MatchRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  config: MatchConfig;
  initialState: GameState;
  state: GameState;
  moves: MoveRecord[];
  status: MatchStatus;
  message: string;
  outcome: Outcome | null;
  spentUsd: number;
  attempts: number;
  invalidAttempts: number;
  parent?: { id: string; move: number };
  experimentId?: string;
  promptVersion: string;
  pricingDate: string;
  endpoint: string;
  lastEventId: number;
}
export interface AttemptRecord {
  id: string;
  dilemmaId?: string;
  matchId: string | null;
  moveIndex: number;
  player: Player | null;
  startedAt: string;
  finishedAt?: string;
  model: string;
  endpoint: string;
  stateHash: string;
  promptHash: string;
  prompt: { role: string; content: string }[];
  request: Record<string, unknown>;
  raw: string;
  reasoning: string;
  outcome: 'pending' | 'accepted' | 'invalid' | 'error' | 'cancelled' | 'probe';
  error?: string;
  usage: Usage | null;
  reservedUsd: number;
  costUsd: number;
  costKind: 'reported' | 'upper-bound' | 'local';
  latencyMs: number;
  firstTokenMs: number | null;
  finishReason: string | null;
  providerRequestId: string | null;
  resolvedModel?: string | null;
  streamBytes?: number;
  generatedBytes?: number;
  streamComplete?: boolean;
  pricing?: { inputRate: number | null; outputRate: number | null; date: string };
}
export interface ModelInfo {
  id: string;
  name: string;
  parameters: string;
  inputRate: number | null;
  outputRate: number | null;
  pricingDate: string;
  available: boolean;
  source: 'catalog' | 'discovered';
  capabilities?: Capabilities;
}
export interface Capabilities {
  checkedAt: string;
  adapterVersion: string;
  endpoint: string;
  json: boolean;
  schema: boolean;
  reasoningControl: 'observed' | 'unverified';
  reasoningExposed: boolean;
  streaming: boolean;
  usage: boolean;
  notes: string[];
}
export interface Health {
  keyConfigured: boolean;
  baseUrl: string;
  sessionCapUsd: number;
  sessionSpentUsd: number;
  reservedUsd: number;
  token: string;
  version: string;
}
export interface Scenario {
  id: string;
  name: string;
  description: string;
  game: GameId;
  split: 'practice' | 'test';
}
export interface ExperimentConfig {
  kind: 'paired' | 'positions';
  pairs: number;
  match: MatchConfig;
  maxUsd: number;
}
export interface ExperimentTask {
  matchId: string;
  swapped: boolean;
  pair: number;
  contestant?: Player;
  scenario: string;
}
export interface ExperimentRecord {
  id: string;
  createdAt: string;
  config: ExperimentConfig;
  status: 'running' | 'paused' | 'completed' | 'stopped';
  tasks: ExperimentTask[];
  message: string;
}
