# Prose Lens

Prose Lens shows many readings of a piece of writing at once. Paste in some text and six **lanes** each draw a strip with one cell per sentence, all lined up against the same text:

**Syntax · Diction · Prosody · Argument · Claude · References**

Think of it as a **mixing desk for prose**. Each lane is a track on one timeline. Click a sentence in any lane, or put the caret in the text, and every lane shows its reading of that sentence.

It is a small, light web app: TypeScript, no UI framework and no server. Everything runs in your browser. The only thing that ever leaves it is the text you choose to send to Claude with your own API key.

## Quick start

You need Node.js 20 or newer.

```bash
npm install        # install dependencies
npm run dev        # start the app at http://localhost:5173
npm test           # run the full test suite once
npm run test:watch # re-run tests on every save (for TDD)
npm run typecheck  # strict TypeScript check
npm run build      # production build into dist/
```

## Using it

- **Type or paste** into the editor on the left. The lanes update 250 ms after you stop typing.
- **Read a lane.** Each cell is one sentence, and its width is that sentence's share of the text, so a strip works like a minimap. Darker cells score higher on the lane's measure (see each lane below). A dark bar along the bottom of a cell means something was flagged there (a passive, a cliché, an orphan citation…). Hover a cell for details.
- **Line them up.** Click any cell, or click or arrow into a sentence in the editor. That sentence is outlined in every lane and selected in the editor. The detail panel shows it with each finding highlighted and lists every lane's reading.
- **Hide a lane** with its checkbox.
- **Ask Claude.** Paste your [Anthropic API key](https://console.anthropic.com/settings/keys) into the Claude panel and press **Analyse with Claude**. The Claude lane then fills in. It runs only when you press the button. Edited sentences lose their reading until you run it again.

### About your API key

The key is sent from your browser straight to `api.anthropic.com`, with Anthropic's `anthropic-dangerous-direct-browser-access` opt-in. There is no server in between. Prose Lens keeps the key in memory only. It never goes into localStorage, sessionStorage, cookies or the URL, and it's gone when you close the tab. Any code running in the page could still read it, so:

- use a key you can revoke, ideally with a spending limit set in the Anthropic Console
- don't host this app publicly with your key in it

Each run sends the whole text and costs a few cents for a typical essay.

## How it works

```
editor text ──▶ spine ──▶ analysers ──▶ spans ──▶ lane model ──▶ lanes + detail
                  ▲                                                   │
                  └───────────── click / caret (linked selection) ◀───┘
```

| Part | File | Job |
|---|---|---|
| Text spine | `src/spine.ts` | Splits text into paragraphs, sentences and words with exact character offsets. It's the shared timeline every lane lines up against. |
| Span + Analyser types | `src/analysers/types.ts` | The single output shape every analyser returns: `{ start, end, layer, label, score?, note? }`. |
| Registry | `src/analysers/registry.ts` | Runs every analyser. An analyser that throws is isolated, and invalid spans are dropped instead of drawn. |
| Lane order | `buildRegistry` in `src/app.ts` | Fixed order, with optional lanes slotting in so nothing jumps around. |
| Lanes | `src/lanes.ts` | Summarises spans into one cell per sentence (pure `buildLaneModel`) and draws the SVG strips (`renderLanes`). |
| Detail panel | `src/detail.ts` | Shows the selected sentence with overlapping highlights and each lane's notes. |
| App shell | `src/app.ts` | Wires the editor, debounce, linked selection and lane toggles together. |
| Entry point | `src/main.ts` | Mounts the app, adds the Claude panel and lazy-loads the Prosody lane. |

**Offsets** are UTF-16 indices, JavaScript's native string positions. They match `textarea.selectionStart`, so a click in the editor maps straight onto the spine, and `text.slice(start, end)` always returns a unit's own text.

**Cell rules** are the same for every lane, so a new analyser needs no UI code:

- **shade** = the highest `score` among the lane's spans in that sentence
- **marker** = at least one span there with no `score` (for example `passive` or `cliche`)
- **width** = the sentence's share of all sentence text
- **colour** = the CSS variable `--lane-<id>` (with a positional fallback), so colours don't shift when a lane loads late

**Loading.** The main bundle is about 27 KB. The Prosody lane needs a 4.7 MB pronouncing dictionary (about 1 MB gzipped), which Vite splits into its own file. It loads in the background, and the lane appears when it arrives.

## The lanes

Every lane except Claude is heuristic: fast rules, not understanding. Each one lists its blind spots below.

### Syntax (`src/analysers/syntax.ts`)

| Label | What it marks | Shades? |
|---|---|---|
| `length` | Every sentence; score = words ÷ 40, capped at 1 | Yes |
| `monotone` | 3+ sentences in a row whose lengths differ by 2 words or fewer | Marker |
| `passive` | A form of *to be* + past participle, with an optional *-ly* adverb between: "was quickly passed" | Marker |
| `nominalisation` | Nouns ending *-tion, -sion, -ment, -ness, -ity, -ance, -ence, -ism* (7+ letters) | Marker |

Blind spots:
- Passives without *to be* ("got fired") are missed.
- Adjectives ending in *-ed* that aren't on the stoplist ("was *devoted*") are marked as passive.
- The nominalisation check is suffix-based, with a stoplist ("station", "moment").

### Diction (`src/analysers/diction.ts`)

| Label | What it marks | Shades? |
|---|---|---|
| `density` | Every sentence; score = share of words flagged, reaching 1 at 30% | Yes |
| `latinate` | Words of 7+ letters with Latinate suffixes (*-tion, -ity, -ous, -ive, -ate…*) | Marker |
| `long-word` | Words of 12+ letters | Marker |
| `repetition` | A content word used again within 30 words; the note says how far back | Marker |
| `cliche` | Phrases from a built-in list; matches across line breaks | Marker |

Blind spots:
- Word origin is guessed from suffixes, not a real etymology check.
- Repetition matches exact words only ("model" and "models" count as different).

### Prosody (`src/analysers/prosody.ts`)

Stress comes from the [CMU Pronouncing Dictionary](https://github.com/words/cmu-pronouncing-dictionary) (135,000 words). One-syllable function words ("the", "was") are read as unstressed, as they are in speech.

| Label | What it marks | Shades? |
|---|---|---|
| `rhythm` | Every sentence. The note spells out the stress pattern word by word: `x` unstressed, `/` stressed, `\` secondary, `?` unknown. Score = share of stressed syllables, rescaled so 25% → 0 and 75% → 1: dark is heavy and emphatic, pale is light and quick. | Yes |
| `weak-ending` | The sentence ends on a function word ("…noticed it.") or on two unstressed syllables ("…beautifully.") | Marker |
| `alliteration` | 2+ content words, at most one word apart, starting with the same consonant **sound** ("phone" and "fish" count; "cat" and "city" don't) | Marker |
| `ambiguous-stress` | Words whose stress changes with meaning ("reCORD" / "REcord") | Marker |
| `uncertain` | Words not in the dictionary. Syllables are guessed with [syllable](https://github.com/words/syllable), and their stress is left out of the score. | Marker |

Blind spots:
- The dictionary gives each word its stress in isolation, so sentence-level emphasis is invisible.
- For ambiguous words, the first listed pronunciation is used.

### Argument (`src/analysers/argument.ts`)

Finds the bones of an argument from discourse markers.

| Label | What it marks | Shades? |
|---|---|---|
| `role` | Every sentence with a role. The note says what it does and what backs it. Score: **1** = unsupported claim (no evidence in the sentence or the ones either side, within the paragraph), **0.5** = supported claim, **0** = evidence or counterclaim. | Yes |
| `claim` | "therefore", "thus", "must", "should", "in conclusion"… | Marker |
| `evidence` | "because", "for example", "found that", percentages, (Smith, 2020), [3]… | Marker |
| `counterclaim` | "however", "although", "critics"… | Marker |

Blind spots:
- Only explicit arguments are found; implicit claims ("Cats are better than dogs.") are missed. That's what the Claude lane is for.
- "since" and "but" are counted even when they aren't argumentative.

### Claude (`src/analysers/llm.ts`, `src/llm/`)

Claude reads the text as **numbered sentences** and answers per sentence number, never by character position. Language models count characters badly; the spine maps numbers back to exact offsets. For each sentence, Claude gives:
- a role: claim, evidence, warrant, counterclaim or none
- for claims, whether they are supported
- the register: formal, neutral or informal
- a short quote and a one-line reason

| Label | What it marks | Shades? |
|---|---|---|
| `reading` | Every sentence Claude read, on the same scale as Argument (**1** unsupported claim, **0.5** supported claim, **0** otherwise), so the two lanes can be compared at a glance. The note gives the role, support, register and reason. | Yes |
| `claim` / `evidence` / `warrant` / `counterclaim` | The phrase Claude quoted, if it really appears in the sentence | Marker |

Safety rails:
- The reply is validated like user input. Malformed JSON, unknown roles or registers, sentence numbers out of range and duplicates are dropped and counted, never drawn.
- Readings are stored by **sentence text**, so editing one sentence drops only its reading, and inserting text above doesn't shift readings onto the wrong sentences.
- Model: `claude-sonnet-5-5` (change `DEFAULT_MODEL` in `src/llm/client.ts`).

### References (`src/analysers/references.ts`)

Checks in-text citations against the reference list: every line after the last heading called *References*, *Bibliography*, *Works Cited*, *Sources*, *Reference List* or *Literature Cited* (a Markdown `#` or a trailing `:` is fine).

| Label | What it marks | Shades? |
|---|---|---|
| `sourcing` | Every sentence holding a citation or entry; **1** if it has a problem, **0.4** if all is well | Yes |
| `citation` | A citation that matches the list (or there's no list to check against) | Marker |
| `orphan-citation` | Cites at least one source missing from the list; the note names it | Marker |
| `entry` | A reference-list entry that is cited | Marker |
| `uncited` | A reference-list entry that is never cited | Marker |

Supported citation styles:
- Author–date: `(Smith, 2020)`, `(Brown & Lee, 2018; Green, 2017)`, `(Lee et al., 2019, p. 4)`
- Narrative: `Jones (2019)`
- Numbered: `[1]`, `[3, 4]`, `[2–5]`

Matching uses the first author's surname plus year.

Blind spots:
- Footnote styles (Chicago notes) aren't supported.
- Two authors with the same surname and year can't be told apart.
- DOIs aren't checked against Crossref yet.

## Adding an analyser (TDD)

1. **Write the failing test first.** Create `tests/<name>.test.ts`, call `analyserContract(yourAnalyser)` and add golden fixtures: short sentences with the exact spans you expect. Run `npm run test:watch` and watch it go red.
2. **Implement** `src/analysers/<name>.ts`, exporting an object that matches `Analyser` (`id`, `name`, `description`, `analyse(spine)`).
   - Give spans a `score` (0–1) to shade the lane, or leave `score` out to show a marker.
   - Always write a `note` that says *why* a span was labelled.
3. **Register it** in `buildRegistry()` in `src/app.ts`, and give it a colour as `--lane-<id>` in `src/styles.css`.
4. **Document it** by adding a section to *The lanes* above, including its blind spots.

`analyse` must be fast and synchronous. For slow or paid work, copy the Claude lane's pattern: do the work on demand elsewhere, store the results, and let `analyse` just redraw them.

The analyser contract (`tests/contract.ts`) checks every analyser for:
- spans inside the text, with start < end
- the right `layer`
- spans sorted by start
- no overlapping spans with the same label
- scores between 0 and 1
- deterministic output

## Testing

About 300 tests, all in [Vitest](https://vitest.dev) with jsdom, so no browser and no network are needed.

| File | Covers |
|---|---|
| `tests/spine.test.ts` | Offsets for the tricky cases: abbreviations, initials, curly quotes, emoji, blank lines, contractions |
| `tests/contract.ts` | The shared analyser contract, run from each analyser's test file |
| `tests/registry.test.ts` | Error isolation and dropping invalid spans, proved with fake analysers |
| `tests/syntax.test.ts`, `diction.test.ts`, `prosody.test.ts`, `argument.test.ts`, `references.test.ts` | Golden fixtures per label. Prosody uses a tiny hand-made dictionary, plus one smoke test against the real one. |
| `tests/llm.test.ts` | Prompt, parsing and validation, the API client, lane mapping and the panel. A fake `fetch` replays `tests/fixtures/claude-response.json`. |
| `tests/lanes.test.ts`, `tests/lanes-order.test.ts` | The pure lane model, SVG rendering, colours and lane order |
| `tests/app.test.ts` | The whole flow: typing, the debounce, clicking cells, caret selection, toggles and swapping lanes |

## What's next

- **Crossref check** for references with DOIs
- **Correctable labels:** click a finding to reject or relabel it, and have your corrections override the heuristics
- **Draft comparison:** diff each lane between two versions of a text
- **Baselines:** compare lanes against an author or a genre corpus
- **Export** the analysis as JSON

## Project layout

```
index.html                 page shell
src/main.ts                entry point: sample text, Claude panel, lazy Prosody
src/app.ts                 app shell, events, lane order
src/spine.ts               text spine
src/lanes.ts               lane model + SVG strips
src/detail.ts              detail panel
src/styles.css             styles (light + dark)
src/analysers/             types, registry, lexicon, syntax, diction,
                           prosody, argument, references, llm
src/llm/                   prompt, parse, client, panel (the Claude lane's plumbing)
tests/                     Vitest suites, analyser contract, fixtures
```

## License

[MIT](LICENSE) © 2026 ruiboom
