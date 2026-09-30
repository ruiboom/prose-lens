/**
 * parse.ts — turns Claude's reply into validated readings.
 *
 * Treat the model's output like user input: check every field, keep what's
 * valid, count what isn't. Nothing here throws, so a bad reply can never
 * break the app; it just draws less.
 */

export const ROLES = ["claim", "evidence", "warrant", "counterclaim", "none"] as const;
export const REGISTERS = ["formal", "neutral", "informal"] as const;

export type Role = (typeof ROLES)[number];
export type Register = (typeof REGISTERS)[number];

/** Claude's reading of one sentence (n is 1-based, as in the prompt). */
export interface Reading {
  n: number;
  role: Role;
  support: "supported" | "unsupported" | null;
  register: Register;
  quote: string;
  note: string;
}

export interface ParseResult {
  readings: Reading[];
  /** How many entries were thrown away as invalid. */
  dropped: number;
  /** Set when the reply couldn't be read as JSON at all. */
  error?: string;
}

/** Longest note we keep (the prompt asks for 15 words). */
const MAX_NOTE = 200;

/**
 * Parse and validate a reply for a text of `sentenceCount` sentences.
 * Accepts bare JSON, JSON in a ```json fence, or JSON surrounded by prose.
 */
export function parseReadings(reply: string, sentenceCount: number): ParseResult {
  // Take everything from the first "{" to the last "}": this strips fences and chatter.
  const first = reply.indexOf("{");
  const last = reply.lastIndexOf("}");
  let data: unknown;
  try {
    if (first < 0 || last < first) throw new Error("no object");
    data = JSON.parse(reply.slice(first, last + 1));
  } catch {
    return { readings: [], dropped: 0, error: "Claude's reply wasn't valid JSON" };
  }

  const items = (data as { sentences?: unknown }).sentences;
  if (!Array.isArray(items)) return { readings: [], dropped: 0, error: "Claude's JSON had no \"sentences\" list" };

  const readings: Reading[] = [];
  const seen = new Set<number>();
  let dropped = 0;

  for (const item of items) {
    const reading = validate(item, sentenceCount);
    if (!reading || seen.has(reading.n)) {
      dropped++;
      continue;
    }
    seen.add(reading.n);
    readings.push(reading);
  }
  return { readings, dropped };
}

/** Check one entry; return a clean Reading or undefined if it's unusable. */
function validate(item: unknown, sentenceCount: number): Reading | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const o = item as Record<string, unknown>;

  const n = o.n;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > sentenceCount) return undefined;
  if (!ROLES.includes(o.role as Role)) return undefined;
  if (!REGISTERS.includes(o.register as Register)) return undefined;

  const role = o.role as Role;
  // "support" only means something for claims; default an unmarked claim to unsupported.
  const support =
    role === "claim" ? (o.support === "supported" ? "supported" : "unsupported") : null;

  return {
    n,
    role,
    support,
    register: o.register as Register,
    quote: typeof o.quote === "string" ? o.quote : "",
    note: typeof o.note === "string" ? o.note.slice(0, MAX_NOTE) : "",
  };
}
