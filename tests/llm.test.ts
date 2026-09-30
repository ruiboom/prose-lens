/**
 * M10 — LLM lane.
 *
 * Never touches the network: a fake `fetch` replays a recorded Claude API
 * response (tests/fixtures/claude-response.json).
 *
 * The model labels sentences by NUMBER, never by character offset; the spine
 * maps numbers back to exact offsets, and anything invalid is dropped.
 */
import { analyserContract, CONTRACT_SAMPLES } from "./contract";
import { buildSpine } from "../src/spine";
import { buildPrompt } from "../src/llm/prompt";
import { parseReadings, type Reading } from "../src/llm/parse";
import { createClaudeClient, DEFAULT_MODEL } from "../src/llm/client";
import { createLlmLane } from "../src/analysers/llm";
import { createLlmPanel } from "../src/llm/panel";
import recorded from "./fixtures/claude-response.json";

const TEXT = "Sales fell 20% last year. Therefore, we must act now. Cats are better than dogs.";
const RECORDED_TEXT = recorded.content[0]!.text;

/** A fetch stand-in that returns a fixed JSON body with a status, and records calls. */
function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

// ---- Contract: run with readings loaded for one sample, so real spans are checked.
const contractLane = createLlmLane();
{
  const sample = buildSpine(CONTRACT_SAMPLES[1]!);
  contractLane.setReadings(sample, [
    { n: 1, role: "claim", support: "unsupported", register: "neutral", quote: "cat sat", note: "Test." },
  ]);
}
analyserContract(contractLane.analyser);

describe("buildPrompt", () => {
  it("numbers the sentences and asks for JSON only", () => {
    const { system, user } = buildPrompt(buildSpine(TEXT));
    expect(user).toContain("[1] Sales fell 20% last year.");
    expect(user).toContain("[3] Cats are better than dogs.");
    expect(system).toMatch(/JSON/);
    for (const role of ["claim", "evidence", "warrant", "counterclaim"]) expect(system).toContain(role);
  });

  it("marks paragraph breaks with a blank line", () => {
    expect(buildPrompt(buildSpine("One.\n\nTwo.")).user).toContain("[1] One.\n\n[2] Two.");
  });
});

describe("parseReadings", () => {
  it("reads the recorded response, even inside a ```json fence", () => {
    const { readings } = parseReadings(RECORDED_TEXT, 3);
    expect(readings.map((r) => [r.n, r.role, r.support, r.register])).toEqual([
      [1, "evidence", null, "neutral"],
      [2, "claim", "supported", "formal"],
      [3, "claim", "unsupported", "informal"],
    ]);
  });

  it("drops out-of-range sentence numbers and counts them", () => {
    expect(parseReadings(RECORDED_TEXT, 3).dropped).toBe(1);
  });

  it("drops unknown roles, bad numbers and duplicates", () => {
    const json = JSON.stringify({
      sentences: [
        { n: 1, role: "claim", register: "neutral" },
        { n: 1, role: "claim", register: "neutral" }, // duplicate
        { n: 2, role: "vibes", register: "neutral" }, // unknown role
        { n: 2.5, role: "claim", register: "neutral" }, // not an integer
        { n: 3, role: "claim", register: "shouty" }, // unknown register
      ],
    });
    const { readings, dropped } = parseReadings(json, 3);
    expect(readings.map((r) => r.n)).toEqual([1]);
    expect(dropped).toBe(4);
  });

  it("fills missing text fields and clears support on non-claims", () => {
    const json = JSON.stringify({ sentences: [{ n: 1, role: "evidence", support: "supported", register: "formal" }] });
    expect(parseReadings(json, 1).readings[0]).toEqual({
      n: 1, role: "evidence", support: null, register: "formal", quote: "", note: "",
    });
  });

  it("reports malformed JSON as an error instead of throwing", () => {
    const result = parseReadings("Sorry, I can't help with that.", 3);
    expect(result.readings).toEqual([]);
    expect(result.error).toMatch(/JSON/);
  });
});

describe("createClaudeClient", () => {
  it("calls the Messages API from the browser with the user's key", async () => {
    const { fn, calls } = fakeFetch(recorded);
    const client = createClaudeClient({ apiKey: "sk-test", fetch: fn });
    const text = await client.complete("SYSTEM", "USER");

    expect(text).toBe(RECORDED_TEXT);
    const { url, init } = calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: DEFAULT_MODEL, system: "SYSTEM", messages: [{ role: "user", content: "USER" }] });
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it("turns an API error into a readable message", async () => {
    const { fn } = fakeFetch({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401);
    const client = createClaudeClient({ apiKey: "bad", fetch: fn });
    await expect(client.complete("S", "U")).rejects.toThrow(/401.*invalid x-api-key/);
  });

  it("explains a network failure", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const client = createClaudeClient({ apiKey: "k", fetch: failing });
    await expect(client.complete("S", "U")).rejects.toThrow(/could not reach/i);
  });
});

describe("LLM lane — mapping readings onto the text", () => {
  const readings: Reading[] = parseReadings(RECORDED_TEXT, 3).readings;

  it("scores each read sentence: unsupported claim 1, supported claim 0.5, other 0", () => {
    const lane = createLlmLane();
    const spine = buildSpine(TEXT);
    lane.setReadings(spine, readings);
    const scores = lane.analyser.analyse(spine).filter((s) => s.label === "reading").map((s) => s.score);
    expect(scores).toEqual([0, 0.5, 1]);
  });

  it("marks the quoted phrase with the role, at exact offsets", () => {
    const lane = createLlmLane();
    const spine = buildSpine(TEXT);
    lane.setReadings(spine, readings);
    const claims = lane.analyser.analyse(spine).filter((s) => s.label === "claim");
    expect(claims.map((s) => TEXT.slice(s.start, s.end))).toEqual(["we must act now", "Cats are better"]);
  });

  it("drops a sentence's reading once that sentence is edited", () => {
    const lane = createLlmLane();
    lane.setReadings(buildSpine(TEXT), readings);
    const edited = "Sales fell 20% last year. Therefore, we must act at once. Cats are better than dogs.";
    const read = lane.analyser.analyse(buildSpine(edited)).filter((s) => s.label === "reading");
    expect(read.map((s) => edited.slice(s.start, s.end))).toEqual(["Sales fell 20% last year.", "Cats are better than dogs."]);
  });

  it("keeps the reading but skips the phrase mark when the quote isn't in the sentence", () => {
    const lane = createLlmLane();
    const spine = buildSpine("We must act.");
    lane.setReadings(spine, [{ n: 1, role: "claim", support: "unsupported", register: "neutral", quote: "invented words", note: "" }]);
    expect(lane.analyser.analyse(spine).map((s) => s.label)).toEqual(["reading"]);
  });

  it("counts sentences changed since the last run", () => {
    const lane = createLlmLane();
    lane.setReadings(buildSpine(TEXT), readings);
    expect(lane.staleCount(buildSpine(TEXT))).toBe(0);
    expect(lane.staleCount(buildSpine(TEXT + " A new sentence."))).toBe(1);
  });
});

describe("LLM panel", () => {
  /** Mount a panel around a lane, a fixed text and a fake client. */
  function setup(opts: { reply?: string; fail?: string; text?: string } = {}) {
    const lane = createLlmLane();
    const spine = buildSpine(opts.text ?? TEXT);
    const complete = vi.fn(async (_system: string, _user: string) => {
      if (opts.fail) throw new Error(opts.fail);
      return opts.reply ?? RECORDED_TEXT;
    });
    const makeClient = vi.fn(() => ({ complete }));
    const onUpdate = vi.fn();
    const panel = createLlmPanel({ lane, getSpine: () => spine, onUpdate, makeClient });
    const key = panel.querySelector<HTMLInputElement>("input.llm-key")!;
    const button = panel.querySelector<HTMLButtonElement>("button.llm-run")!;
    const status = () => panel.querySelector(".llm-status")!.textContent;
    return { lane, spine, complete, makeClient, onUpdate, panel, key, button, status };
  }

  /** Let pending promises settle. */
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("asks for the key in a password field that browsers won't autofill", () => {
    const { key } = setup();
    expect(key.type).toBe("password");
    expect(key.autocomplete).toBe("off");
  });

  it("refuses to run without a key", async () => {
    const { button, status, makeClient } = setup();
    button.click();
    await settle();
    expect(status()).toMatch(/enter your claude api key/i);
    expect(makeClient).not.toHaveBeenCalled();
  });

  it("runs the prompt, stores the readings and redraws", async () => {
    const { key, button, status, makeClient, complete, onUpdate, lane, spine } = setup();
    key.value = "sk-test";
    button.click();
    expect(button.disabled).toBe(true);
    expect(status()).toMatch(/analysing/i);
    await settle();

    expect(makeClient).toHaveBeenCalledWith("sk-test");
    expect(complete.mock.calls[0]![1]).toContain("[1] Sales fell 20% last year.");
    expect(onUpdate).toHaveBeenCalled();
    expect(lane.analyser.analyse(spine).filter((s) => s.label === "reading")).toHaveLength(3);
    expect(status()).toMatch(/read 3 sentences/i);
    expect(button.disabled).toBe(false);
  });

  it("reports dropped readings", async () => {
    const { key, button, status } = setup({ text: TEXT });
    key.value = "k";
    button.click();
    await settle();
    // The fixture includes one reading for a sentence that doesn't exist.
    expect(status()).toMatch(/1 invalid reading dropped/i);
  });

  it("shows an API error and lets the user try again", async () => {
    const { key, button, status } = setup({ fail: "Claude API error 401: invalid x-api-key" });
    key.value = "bad";
    button.click();
    await settle();
    expect(status()).toMatch(/invalid x-api-key/);
    expect(button.disabled).toBe(false);
  });

  it("says so when there is nothing to analyse", async () => {
    const { key, button, status, makeClient } = setup({ text: "" });
    key.value = "k";
    button.click();
    await settle();
    expect(status()).toMatch(/nothing to analyse/i);
    expect(makeClient).not.toHaveBeenCalled();
  });

  it("never writes the key to browser storage", async () => {
    localStorage.clear();
    sessionStorage.clear();
    const { key, button } = setup();
    key.value = "sk-secret";
    button.click();
    await settle();
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });
});
