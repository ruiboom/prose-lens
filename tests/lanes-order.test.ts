/**
 * Lane order: optional lanes (Prosody loads late; Claude is opt-in) slot into
 * a fixed order, so the desk layout never jumps around.
 */
import { buildRegistry } from "../src/app";

const stub = (id: string) => ({ id, name: id, description: id, analyse: () => [] });

describe("buildRegistry", () => {
  it("uses the instant lanes when no optional lane is given", () => {
    expect(buildRegistry({}).list().map((a) => a.id)).toEqual(["syntax", "diction", "argument", "references"]);
  });

  it("puts Prosody after Diction and Claude after Argument", () => {
    const ids = buildRegistry({ prosody: stub("prosody"), llm: stub("llm") }).list().map((a) => a.id);
    expect(ids).toEqual(["syntax", "diction", "prosody", "argument", "llm", "references"]);
  });
});
