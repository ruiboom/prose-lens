/**
 * main.ts — browser entry point.
 *
 * 1. Mounts the app with the lanes that load instantly, plus the Claude lane
 *    (empty until you press "Analyse with Claude").
 * 2. Adds the Claude controls to the side column.
 * 3. Fetches the 4.7 MB pronouncing dictionary in the background (Vite splits
 *    it into its own file) and slots the Prosody lane in when it arrives.
 */
import "./styles.css";
import { buildRegistry, mountApp } from "./app";
import { createLlmLane } from "./analysers/llm";
import { createLlmPanel } from "./llm/panel";
import { createClaudeClient } from "./llm/client";
import type { Analyser } from "./analysers/types";

/** A deliberately flawed sample, so every lane has something to show. */
const SAMPLE = `It was decided that the implementation of the new policy would be postponed. The committee was informed. The budget was reviewed. The staff were told.

At the end of the day, the organisation must facilitate a transformation of its operations, and this transformation, however difficult, is necessary because the alternative is a slow and quiet decline (Harlow, 2021). Therefore, we should act before it is far too late to act. Critics say the risk is small [2].

We tried. It failed. So we tried again, harder this time, and it worked. The big bold plan was a record of what we had learned, and we were proud of it.

References
Harlow, P. (2021). Quiet Decline. Northgate Press.
[1] Osei, A. Change Management. 2018.`;

const root = document.getElementById("app");
if (root) {
  const llm = createLlmLane();
  let prosody: Analyser | undefined;
  const registry = () => buildRegistry({ prosody, llm: llm.analyser });

  const app = mountApp(root, { initialText: SAMPLE, registry: registry() });

  // Claude controls go at the top of the side column.
  app.side.prepend(
    createLlmPanel({
      lane: llm,
      getSpine: app.getSpine,
      onUpdate: app.refresh,
      makeClient: (apiKey) => createClaudeClient({ apiKey }),
    }),
  );

  // Load the dictionary and prosody code lazily, then add the lane.
  Promise.all([import("cmu-pronouncing-dictionary"), import("./analysers/prosody")])
    .then(([{ dictionary }, { cmuPronouncer, createProsodyAnalyser }]) => {
      prosody = createProsodyAnalyser(cmuPronouncer(dictionary));
      app.setRegistry(registry());
    })
    .catch((err) => console.error("Prosody lane failed to load:", err));
}
