/**
 * references.ts — the References lane.
 *
 * Checks in-text citations against the reference list, like a librarian
 * ticking each citation off against the shelf.
 *
 * Finds:
 *   - the reference list: every line after the last heading called
 *     "References", "Bibliography", "Works Cited", "Sources", "Reference List"
 *     or "Literature Cited" (Markdown "#" and a trailing ":" are fine)
 *   - author–date citations: (Smith, 2020), (Brown & Lee, 2018; Green, 2017),
 *     (Lee et al., 2019, p. 4), and narrative ones: Jones (2019)
 *   - numbered citations: [1], [3, 4], [2–5]
 *
 * Labels:
 *   - citation         matches the list (or there's no list to check against)
 *   - orphan-citation  cites at least one source missing from the list
 *   - entry            a reference-list entry cited at least once
 *   - uncited          a reference-list entry never cited
 *   - sourcing         one span per sentence holding any of the above;
 *                      score 1 if it holds a problem, 0.4 if all is well
 *
 * Author–date keys are the first author's surname + year ("smith|2020").
 * Crossref/DOI checking is not built yet (see README).
 */
import type { Spine } from "../spine";
import type { Analyser, Span } from "./types";

const LAYER = "references";

/** A heading line that starts the reference list. */
const HEADING = /^[ \t]*(?:#{1,6}[ \t]*)?(?:references|bibliography|works cited|sources|reference list|literature cited)[ \t]*:?[ \t]*$/gim;
/** Anything in round brackets that contains a year. */
const PARENTHETICAL = /\(([^()]*?\d{4}[a-z]?[^()]*?)\)/g;
/** One source inside brackets: "Smith, 2020", "Brown & Lee, 2018", "see Lee et al., 2019". */
const AUTHOR_YEAR = /^(?:(?:see|cf\.|e\.g\.,?)\s+)?([\p{Lu}][\p{L}'’-]+)[^;]*?,?\s+(\d{4}[a-z]?)\b/u;
/** Just a year (and maybe a page): "2019", "2019, p. 4" — a narrative citation. */
const YEAR_ONLY = /^(\d{4}[a-z]?)(?:,\s*pp?\.\s*[\d–-]+)?$/;
/** The author name just before a narrative citation's bracket: "Smith", "Smith and Lee", "Lee et al.". */
const NARRATIVE_NAME = /([\p{Lu}][\p{L}'’-]+)(?:\s+(?:et\s+al\.|and|&)(?:\s+[\p{Lu}][\p{L}'’-]+)?)?\s*$/u;
/** Numbered citations. */
const NUMBERED = /\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g;

/** A source a citation points at: a key for matching, a label for notes. */
interface Source {
  key: string;
  label: string;
}

interface Citation {
  start: number;
  end: number;
  sources: Source[];
}

interface Entry {
  start: number;
  end: number;
  source: Source;
}

export const referencesAnalyser: Analyser = {
  id: LAYER,
  name: "References",
  description: "Citations checked against the reference list.",

  analyse(spine: Spine): Span[] {
    const text = spine.text;
    const heading = [...text.matchAll(HEADING)].at(-1);
    const bodyEnd = heading ? heading.index : text.length;

    const citations = [...authorDateCitations(text, bodyEnd), ...numberedCitations(text, bodyEnd)];
    const entries = heading ? parseEntries(text, heading.index + heading[0].length) : [];
    const listed = new Set(entries.map((e) => e.source.key));
    const cited = new Map<string, number>(); // key → times cited
    for (const c of citations) for (const s of c.sources) cited.set(s.key, (cited.get(s.key) ?? 0) + 1);

    const spans: Span[] = [];

    for (const c of citations) {
      const missing = c.sources.filter((s) => !listed.has(s.key));
      const base = { start: c.start, end: c.end, layer: LAYER };
      if (!heading) {
        spans.push({ ...base, label: "citation", note: "No reference list found to check this against" });
      } else if (missing.length) {
        spans.push({ ...base, label: "orphan-citation", note: `Not in the reference list: ${missing.map((s) => s.label).join(", ")}` });
      } else {
        spans.push({ ...base, label: "citation", note: `Cites: ${c.sources.map((s) => s.label).join(", ")}` });
      }
    }

    for (const e of entries) {
      const times = cited.get(e.source.key) ?? 0;
      spans.push(
        times
          ? { start: e.start, end: e.end, layer: LAYER, label: "entry", note: `Cited ${times} time${times > 1 ? "s" : ""}` }
          : { start: e.start, end: e.end, layer: LAYER, label: "uncited", note: "Never cited in the text" },
      );
    }

    spans.push(...sourcingSpans(spine, spans));
    return spans.sort((a, b) => a.start - b.start);
  },
};

/** Find author–date citations in text[0, end). */
function authorDateCitations(text: string, end: number): Citation[] {
  const body = text.slice(0, end);
  const out: Citation[] = [];

  for (const m of body.matchAll(PARENTHETICAL)) {
    let start = m.index;
    const sources: Source[] = [];

    for (const raw of m[1]!.split(";")) {
      const part = raw.trim();
      const full = AUTHOR_YEAR.exec(part);
      if (full) {
        sources.push(source(full[1]!, full[2]!));
        continue;
      }
      const year = YEAR_ONLY.exec(part);
      if (year) {
        // Narrative citation: the author's name comes just before the bracket.
        const before = body.slice(Math.max(0, m.index - 60), m.index);
        const name = NARRATIVE_NAME.exec(before);
        if (name) {
          sources.push(source(name[1]!, year[1]!));
          start = m.index - before.length + name.index;
        }
      }
    }
    if (sources.length) out.push({ start, end: m.index + m[0].length, sources });
  }
  return out;
}

/** Find numbered citations in text[0, end), expanding "2–5" into 2, 3, 4, 5. */
function numberedCitations(text: string, end: number): Citation[] {
  return [...text.slice(0, end).matchAll(NUMBERED)].map((m) => {
    const numbers: number[] = [];
    for (const part of m[1]!.split(",")) {
      const [a, b] = part.split(/[–-]/).map((n) => Number(n.trim()));
      for (let n = a!; n <= (b ?? a!); n++) numbers.push(n);
    }
    return {
      start: m.index,
      end: m.index + m[0].length,
      sources: numbers.map((n) => ({ key: `#${n}`, label: `[${n}]` })),
    };
  });
}

/** Parse each non-empty line after the heading into a reference-list entry. */
function parseEntries(text: string, from: number): Entry[] {
  const entries: Entry[] = [];
  let lineStart = from;

  for (const line of text.slice(from).split("\n")) {
    const lead = line.length - line.trimStart().length;
    const trimmed = line.trim();
    const start = lineStart + lead;
    lineStart += line.length + 1; // +1 for the "\n"
    if (!trimmed) continue;

    const numbered = /^\[(\d+)\]|^(\d+)\.\s/.exec(trimmed);
    if (numbered) {
      const n = numbered[1] ?? numbered[2]!;
      entries.push({ start, end: start + trimmed.length, source: { key: `#${n}`, label: `[${n}]` } });
      continue;
    }
    const surname = /^([\p{Lu}][\p{L}'’-]+)/u.exec(trimmed)?.[1];
    const year = (/\((\d{4}[a-z]?)\)/.exec(trimmed) ?? /\b(\d{4}[a-z]?)\b/.exec(trimmed))?.[1];
    if (surname && year) entries.push({ start, end: start + trimmed.length, source: source(surname, year) });
  }
  return entries;
}

/** One span per sentence that holds citations or entries, scored by trouble. */
function sourcingSpans(spine: Spine, found: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spine.sentences) {
    const inside = found.filter((f) => f.start < s.end && f.end > s.start);
    if (!inside.length) continue;
    const problems = inside.filter((f) => f.label === "orphan-citation" || f.label === "uncited").length;
    out.push({
      start: s.start,
      end: s.end,
      layer: LAYER,
      label: "sourcing",
      score: problems ? 1 : 0.4,
      note: problems ? `${problems} reference problem${problems > 1 ? "s" : ""}` : "References check out",
    });
  }
  return out;
}

/** Build a matching key and a readable label for an author–date source. */
function source(surname: string, year: string): Source {
  return { key: `${surname.toLowerCase()}|${year}`, label: `${surname} ${year}` };
}
