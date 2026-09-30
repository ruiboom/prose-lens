/**
 * prompt.ts — what we ask Claude.
 *
 * The model sees the text as numbered sentences and answers per sentence
 * NUMBER. It never has to count characters, which language models do badly;
 * the spine turns numbers back into exact offsets.
 */
import type { Spine } from "../spine";

export const SYSTEM_PROMPT = `You analyse the argument structure of a piece of writing.
You will receive the text as numbered sentences, like "[3] Sentence text". A blank line separates paragraphs.

For EVERY sentence, give:
- "n": the sentence number.
- "role": one of "claim" (a position the writer wants accepted, stated or implied), "evidence" (facts, data, examples or sources offered in support), "warrant" (reasoning that links evidence to a claim), "counterclaim" (an opposing view or concession), or "none".
- "support": only for claims: "supported" if evidence for it appears in the text, otherwise "unsupported". Use null for every other role.
- "register": "formal", "neutral" or "informal".
- "quote": the shortest phrase, copied exactly from that sentence, that shows its role. Use "" when the role is "none".
- "note": at most 15 words on why.

Reply with JSON only, no other text, in exactly this shape:
{"sentences":[{"n":1,"role":"claim","support":"unsupported","register":"neutral","quote":"...","note":"..."}]}`;

/** Build the system prompt and the numbered-sentence user message. */
export function buildPrompt(spine: Spine): { system: string; user: string } {
  const lines: string[] = [];
  spine.sentences.forEach((s, i) => {
    // A blank line wherever a new paragraph starts.
    if (i > 0 && s.paragraph !== spine.sentences[i - 1]!.paragraph) lines.push("");
    // Collapse internal line breaks so each sentence sits on one line.
    lines.push(`[${s.index + 1}] ${s.text.replace(/\s+/g, " ")}`);
  });
  return { system: SYSTEM_PROMPT, user: lines.join("\n") };
}
