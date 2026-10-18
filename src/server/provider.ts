import type { Usage } from '../shared/types.js';
export interface Completion {
  raw: string;
  reasoning: string;
  usage: Usage | null;
  latencyMs: number;
  firstTokenMs: number | null;
  finishReason: string | null;
  providerRequestId: string | null;
  resolvedModel: string | null;
}
export class ProviderError extends Error {
  constructor(
    message: string,
    public partial: Completion,
    public status?: number,
    public retryAfter?: string,
  ) {
    super(message);
  }
}
export function normalizedUsage(u: any): Usage | null {
  if (
    !u ||
    !Number.isFinite(u.prompt_tokens) ||
    !Number.isFinite(u.completion_tokens) ||
    u.prompt_tokens < 0 ||
    u.completion_tokens < 0
  )
    return null;
  return {
    promptTokens: u.prompt_tokens,
    completionTokens: u.completion_tokens,
    reasoningTokens: Number.isFinite(u.completion_tokens_details?.reasoning_tokens)
      ? u.completion_tokens_details.reasoning_tokens
      : null,
  };
}
export class Nebius {
  constructor(
    public baseUrl: string,
    private key: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  get configured() {
    return Boolean(this.key);
  }
  async models(): Promise<string[]> {
    if (!this.key) return [];
    const response = await this.fetcher(`${this.baseUrl}models`, {
      headers: { Authorization: `Bearer ${this.key}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new Error(
        `Model discovery failed (HTTP ${response.status}). Check the server key and endpoint.`,
      );
    const body = (await response.json()) as any;
    if (!Array.isArray(body.data)) throw new Error('Unexpected model discovery response.');
    return body.data.filter((m: any) => typeof m.id === 'string').map((m: any) => m.id);
  }
  async complete(
    body: Record<string, unknown>,
    signal: AbortSignal,
    onDelta?: (kind: 'content' | 'reasoning', text: string) => void,
  ): Promise<Completion> {
    const start = performance.now();
    const result: Completion = {
      raw: '',
      reasoning: '',
      usage: null,
      latencyMs: 0,
      firstTokenMs: null,
      finishReason: null,
      providerRequestId: null,
      resolvedModel: null,
    };
    if (!this.key)
      throw new ProviderError('NEBIUS_API_KEY is not configured on the server.', result);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.fetcher(`${this.baseUrl}chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
      });
      result.providerRequestId = response.headers.get('x-request-id');
      if (!response.ok)
        throw new ProviderError(
          `Nebius returned HTTP ${response.status}${response.status === 429 ? '; rate limited' : response.status === 401 || response.status === 403 ? '; check API access' : ''}.`,
          result,
          response.status,
          response.headers.get('retry-after') ?? undefined,
        );
      if (!response.body) throw new Error('Empty response stream.');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '',
        done = false,
        bytes = 0;
      const consume = (event: string) => {
        const data = event
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (!data) return;
        if (data === '[DONE]') {
          done = true;
          return;
        }
        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          throw new Error('Malformed provider stream event.');
        }
        if (chunk.error) throw new Error('Provider reported an error inside the stream.');
        if (typeof chunk.model === 'string') result.resolvedModel = chunk.model;
        const usage = normalizedUsage(chunk.usage);
        if (usage) result.usage = usage;
        const choice = chunk.choices?.[0];
        if (!choice) return;
        if (choice.finish_reason) result.finishReason = String(choice.finish_reason);
        const delta = choice.delta ?? {};
        for (const [kind, value] of [
          ['content', delta.content],
          ['reasoning', delta.reasoning_content ?? delta.reasoning],
        ] as const) {
          if (typeof value !== 'string' || !value) continue;
          if (result.firstTokenMs === null) result.firstTokenMs = performance.now() - start;
          if (kind === 'content') result.raw += value;
          else result.reasoning += value;
          onDelta?.(kind, value);
        }
      };
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2_000_000) throw new Error('Response exceeded the 2 MB safety limit.');
        buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
        // Normalize again so CRLF split across byte chunks is handled.
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          consume(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer.replace(/\r\n/g, '\n'));
      if (!done && !result.finishReason)
        throw new Error('Stream ended without a completion marker.');
      result.latencyMs = performance.now() - start;
      return result;
    } catch (error) {
      result.latencyMs = performance.now() - start;
      if (error instanceof ProviderError) {
        error.partial.latencyMs = result.latencyMs;
        throw error;
      }
      throw new ProviderError(
        signal.aborted
          ? 'Request cancelled; billing may still apply.'
          : error instanceof Error &&
              /Malformed|Stream ended|Response exceeded|Provider reported|Empty response/.test(
                error.message,
              )
            ? error.message
            : 'Network request failed or timed out; billing is uncertain.',
        result,
      );
    } finally {
      await reader?.cancel().catch(() => {});
    }
  }
}
