import type { ModelInfo, Usage } from '../shared/types.js';
export const PRICING_DATE = '2026-10-17';
export const ADAPTER_VERSION = 'nebius/1.0';
export const catalog: ModelInfo[] = [
  ['nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B', 'Nemotron 3 Nano', '30B total · 3B active', 0.06, 0.24],
  ['nvidia/nemotron-3-super-120b-a12b', 'Nemotron 3 Super', '120B total · 12B active', 0.3, 0.9],
  ['nvidia/Nemotron-3_5-Lightning', 'Nemotron 3.5 Lightning', '30B total · 3B active', 0.06, 0.24],
  ['nvidia/Nemotron-3-Ultra-550b-a55b', 'Nemotron 3 Ultra', '550B total · 55B active', 1, 3],
].map(([id, name, parameters, inputRate, outputRate]) => ({
  id: String(id),
  name: String(name),
  parameters: String(parameters),
  inputRate: Number(inputRate),
  outputRate: Number(outputRate),
  pricingDate: PRICING_DATE,
  available: false,
  source: 'catalog',
}));
export function estimateReservation(body: Record<string, unknown>, model: ModelInfo): number {
  if (model.inputRate === null || model.outputRate === null)
    throw new Error('No verified price estimate for this model.');
  // UTF-8 byte count plus chat-template overhead intentionally overestimates common tokenizers.
  const input = Buffer.byteLength(JSON.stringify(body.messages), 'utf8') + 2048;
  return (input * model.inputRate + Number(body.max_tokens) * model.outputRate) / 1e6;
}
export function usageCost(usage: Usage, model: Pick<ModelInfo, 'inputRate' | 'outputRate'>) {
  return (usage.promptTokens * model.inputRate! + usage.completionTokens * model.outputRate!) / 1e6;
}
