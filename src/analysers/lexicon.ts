/**
 * lexicon.ts — word lists shared by more than one lane.
 */

/**
 * Function words (articles, pronouns, auxiliaries, prepositions, conjunctions).
 * - Diction never flags their repetition.
 * - Prosody reads the one-syllable ones as unstressed, as they are in speech.
 * - Alliteration ignores them.
 */
export const STOPWORDS: ReadonlySet<string> = new Set(
  ("a an and are as at be been but by can could did do does for from had has have he her " +
    "here him his how i if in into is it its just may me might more most my no nor not of " +
    "on or our out she should so some such than that the their them then there these they " +
    "this those through to too under up us very was we were what when where which while who " +
    "why will with would you your also about after again all any because before being both " +
    "each few other over own same only once until").split(" "),
);

/** Is this word (any case, straight or curly apostrophe) a function word? */
export function isStopword(word: string): boolean {
  return STOPWORDS.has(word.toLowerCase().replace(/’/g, "'"));
}
