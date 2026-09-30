/**
 * client.ts — a minimal Claude Messages API client for the browser.
 *
 * The request goes straight from the user's browser to Anthropic with the
 * user's own key; there's no server in between. The
 * "anthropic-dangerous-direct-browser-access" header is Anthropic's opt-in
 * for this. It's "dangerous" because the key lives in the page. Prose Lens
 * keeps it in memory only (see panel.ts) and never stores it.
 */

export const API_URL = "https://api.anthropic.com/v1/messages";
export const DEFAULT_MODEL = "claude-sonnet-5-5";
/** Room for a JSON reading of a long document. */
const MAX_TOKENS = 8192;

export interface ClaudeClient {
  /** Send one system + user message; resolve with the reply's text. */
  complete(system: string, user: string): Promise<string>;
}

export interface ClientOptions {
  apiKey: string;
  model?: string;
  /** Injected for tests; defaults to the browser's fetch. */
  fetch?: typeof fetch;
}

export function createClaudeClient({ apiKey, model = DEFAULT_MODEL, fetch: doFetch = fetch }: ClientOptions): ClaudeClient {
  return {
    async complete(system, user) {
      let res: Response;
      try {
        res = await doFetch(API_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model,
            max_tokens: MAX_TOKENS,
            system,
            messages: [{ role: "user", content: user }],
          }),
        });
      } catch {
        throw new Error("Could not reach the Claude API. Check your connection.");
      }

      const body = (await res.json().catch(() => ({}))) as {
        content?: Array<{ type: string; text?: string }>;
        error?: { message?: string };
      };
      if (!res.ok) {
        throw new Error(`Claude API error ${res.status}: ${body.error?.message ?? res.statusText}`);
      }
      // Join the text blocks of the reply.
      return (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    },
  };
}
