import { gameFor } from '../games/registry.js';
import { evaluate } from '../games/evaluate.js';
import { scenarioState } from '../games/scenarios.js';
import type { GameState, MatchConfig, PlayerConfig } from '../shared/types.js';
export const PROMPT_VERSION = 'game-field/1.1';
export const actionSchema = {
  type: 'object',
  properties: { action: { type: 'string' }, explanation: { type: 'string' } },
  required: ['action', 'explanation'],
  additionalProperties: false,
};
export function demonstrations(game: GameState['game']) {
  // Practice fixtures only. Held-out test positions never enter the examples.
  const states =
    game === 'dots-boxes'
      ? ['chains-3', 'handout'].map((id) => scenarioState(id, game))
      : [scenarioState('empty', game)];
  return states.map((state) => {
    const evaluation = evaluate(state);
    if (evaluation.status !== 'exact') throw new Error('Practice example must be proven.');
    return {
      position: gameFor(state.game).observe(state, state.player!),
      legalActions: gameFor(state.game).legalActions(state),
      response: {
        action: evaluation.optimalActions[0],
        explanation:
          'This action attains the optimal value under exact search for this practice position.',
      },
    };
  });
}
export function makePrompt(
  state: GameState,
  player: PlayerConfig,
  config: MatchConfig,
  repair?: string,
) {
  const game = gameFor(state.game);
  let system = `You are playing ${game.name}. ${game.rules}\nCoordinates are zero based. Choose exactly one listed legal action. Treat the supplied board as authoritative. Maximize your own final score.\n`;
  system +=
    config.format === 'text'
      ? config.explanation
        ? 'Return ACTION: <action id> as the first line. '
        : 'Return exactly one line: ACTION: <action id>. Do not add any other text. '
      : 'Return one JSON object with action and explanation string fields. ';
  system += config.explanation
    ? 'Give a brief public move rationale (at most 45 words). Do not supply private chain-of-thought; a concise strategic justification is enough.'
    : 'Provide no rationale (use an empty explanation string for JSON).';
  if (player.knowledge === 'strategy')
    system +=
      state.game === 'dots-boxes'
        ? '\nStrategy note: completing a box grants another move, but taking every available box can lose control. In a simple disconnected endgame of long chains and even loops, a controller can sometimes leave two boxes in a chain or four in a loop. Evaluate giving up control against retaining it. This note does not assert that the current board is such an endgame.'
        : '\nStrategy note: win if possible, block immediate losses, and consider forks.';
  const prompt = [{ role: 'system', content: system }];
  if (player.knowledge === 'examples')
    for (const example of demonstrations(state.game)) {
      prompt.push({
        role: 'user',
        content: JSON.stringify({ position: example.position, legalActions: example.legalActions }),
      });
      prompt.push({
        role: 'assistant',
        content:
          config.format === 'text'
            ? `ACTION: ${example.response.action}${config.explanation ? `\n${example.response.explanation}` : ''}`
            : JSON.stringify({
                ...example.response,
                explanation: config.explanation ? example.response.explanation : '',
              }),
      });
    }
  prompt.push({
    role: 'user',
    content: JSON.stringify({
      position: game.observe(state, state.player!),
      legalActions: game.legalActions(state),
    }),
  });
  if (repair)
    prompt.push({
      role: 'user',
      content: `Your previous response was invalid: ${repair}. Return one legal action in the required format. This is the only correction attempt. The board has not changed.`,
    });
  return prompt;
}
export function parseAction(
  raw: string,
  format: MatchConfig['format'],
  legal: string[],
  allowExplanation = true,
) {
  let action: string, explanation: string;
  if (format === 'text') {
    const match = /^ACTION:\s*([^\s]+)[ \t]*(?:\r?\n([\s\S]*))?$/.exec(raw.trim());
    if (!match) throw new Error('Expected ACTION: <id> on the first line.');
    action = match[1];
    explanation = match[2]?.trim() ?? '';
  } else {
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new Error('Response was not a JSON object.');
    }
    if (
      !obj ||
      typeof obj !== 'object' ||
      Array.isArray(obj) ||
      typeof obj.action !== 'string' ||
      typeof obj.explanation !== 'string'
    )
      throw new Error('Missing action or explanation string.');
    if (Object.keys(obj).some((k) => !['action', 'explanation'].includes(k)))
      throw new Error('Unexpected JSON field.');
    action = obj.action;
    explanation = obj.explanation;
  }
  if (!legal.includes(action)) throw new Error('Action is not in the legal action list.');
  if (!allowExplanation && explanation)
    throw new Error('Return only the action; no rationale was requested.');
  if (explanation.length > 2000) throw new Error('Explanation exceeds 2,000 characters.');
  return { action, explanation };
}
