/**
 * Entity correction guards: pure functions plus correctTranscript against a mock model, no stack needed.
 * Run: node --import tsx --test test/entities.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import type { Word } from "@reelsaw/shared";
import { correctTranscript, findCandidates, isCommonWord } from "../src/pipeline/entities.js";

describe("isCommonWord", () => {
  it("counts contractions as their base word", () => {
    for (const w of ["don't", "didn't", "Hasn't", "you're", "can't", "won't", "it's", "I'm", "we'll", "they've", "she'd", "don’t"])
      assert.equal(isCommonWord(w), true, w);
  });
  it("counts casual spoken spellings", () => {
    for (const w of ["gonna", "wanna", "gotta", "kinda", "yeah", "okay", "cool", "sorry", "ain't", "y'all"]) assert.equal(isCommonWord(w), true, w);
  });
  it("counts regular inflections of a listed word", () => {
    for (const w of ["noticing", "noticed", "running", "doing", "meeting", "stories", "tried", "watches", "shortly", "teams"])
      assert.equal(isCommonWord(w), true, w);
  });
  it("still treats names as names, possessives included", () => {
    for (const w of ["Zorvax", "Brindle", "Kaelan", "Kaelan's", "Hera", "Fred", "Wes", "Yonnah"]) assert.equal(isCommonWord(w), false, w);
  });
});

/** A made-up stream intro, dense with handle-like names that sound like everyday words. */
const TRANSCRIPT =
  "hey everyone I don't know if you're gonna believe it but I'm noticing that Zorvacks is here tonight and the Brindel crew didn't show up so we're gonna start without them";
const ENTITIES = ["DrDonnut", "Yonnah", "YourRAZE", "Nicewyg", "Zorvax", "Brindle"];

const words = (text: string): Word[] => text.split(" ").map((t, i) => ({ text: t, start: i, end: i + 0.9 }));

/** A model that over-claims: every name is a name, every candidate a confident replacement. */
function overclaimingModel() {
  return new MockLanguageModelV4({
    doGenerate: async (opts) => {
      const prompt = JSON.stringify(opts.prompt);
      const text = prompt.includes("From the list below")
        ? JSON.stringify({ names: ENTITIES })
        : JSON.stringify({ decisions: [...prompt.matchAll(/#(\d+):/g)].map((m) => ({ id: Number(m[1]), replace: true, confidence: 0.95 })) });
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
        warnings: [],
      };
    },
  });
}

describe("correctTranscript with an over-claiming model", () => {
  const raw = words(TRANSCRIPT);

  it("the transcript does produce everyday-word candidates (the case this guards)", () => {
    const heard = findCandidates(raw, ENTITIES).map((c) => c.heard);
    for (const w of ["don't", "you're", "gonna", "noticing", "didn't"]) assert.ok(heard.includes(w), `expected a candidate for "${w}"`);
  });

  it("never auto-applies a fix over an everyday word, however confident the model is", async () => {
    const res = await correctTranscript(overclaimingModel(), raw, ENTITIES, { title: "Stream intro" });
    const auto = res.flags.filter((f) => f.status === "auto").map((f) => f.heard);
    assert.deepEqual(auto.sort(), ["Brindel", "Zorvacks"]);
    const pending = res.flags.filter((f) => f.status === "pending").map((f) => f.heard);
    for (const w of ["don't", "you're", "gonna", "noticing", "didn't"]) assert.ok(pending.includes(w), `"${w}" should wait for review`);
    const text = res.words.map((w) => w.text).join(" ");
    assert.match(text, /I don't know if you're gonna believe it but I'm noticing that Zorvax is here/);
    assert.match(text, /Brindle crew didn't show/);
  });
});
