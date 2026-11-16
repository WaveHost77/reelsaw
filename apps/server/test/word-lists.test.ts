/**
 * "Vocabularies come from data, not from code" (docs/PRINCIPLES.md): a long word list typed into the source must be a
 * closed set, and say so in its comment ("closed-class" / "closed set"). Open vocabularies come from a dataset.
 * Run: node --import tsx --test test/word-lists.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ROOTS = ["apps/server/src", "packages/shared/src", "apps/web/src"];

/**
 * Open word lists that predate the rule. Each is a tracked follow-up: move it to a dataset, a model or an
 * eval-backed rule, then delete its entry here. Never add one.
 */
const KNOWN_OPEN = new Set([
  // function words (closed) mixed with YouTube boilerplate ("subscribe", "episode"), which is open
  "apps/server/src/pipeline/entities.ts:STOP",
  // marketing verbs that start a non-name ("Try Copia")
  "apps/server/src/pipeline/entities.ts:GENERIC_LEAD",
  // words people double on purpose ("very very"): a judgement list
  "apps/server/src/pipeline/disfluency.ts:EMPHATIC",
]);

/** A string literal of 20 or more space-separated lowercase words. */
const LIST = /["'`]([a-z’']+ ){19,}[a-z’']+["'`]/;
const CLOSED = /closed[- ](class|set)/i;

function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(path.join(repo, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) yield* sources(rel);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) yield rel;
  }
}

interface Found {
  key: string;
  line: number;
  closed: boolean;
}

function wordLists(): Found[] {
  const out: Found[] = [];
  for (const root of ROOTS)
    for (const file of sources(root)) {
      const lines = readFileSync(path.join(repo, file), "utf8").split("\n");
      lines.forEach((text, i) => {
        if (!LIST.test(text)) return;
        // the declaration that owns the literal, and the comment just above it
        let d = i;
        while (d > 0 && d > i - 4 && !/\bconst \w+/.test(lines[d]!)) d--;
        const name = /\bconst (\w+)/.exec(lines[d]!)?.[1] ?? `line ${i + 1}`;
        let c = d - 1;
        const comment: string[] = [];
        while (c >= 0 && /^\s*(\/\*\*?|\*|\/\/)/.test(lines[c]!)) comment.push(lines[c--]!);
        out.push({ key: `${file}:${name}`, line: i + 1, closed: CLOSED.test(comment.join(" ")) });
      });
    }
  return out;
}

describe("word lists in the source", () => {
  const found = wordLists();

  it("are closed sets that say so, or a known open list being retired", () => {
    const open = found.filter((f) => !f.closed && !KNOWN_OPEN.has(f.key));
    assert.deepEqual(
      open.map((f) => `${f.key} (line ${f.line})`),
      [],
      "an open vocabulary belongs in a dataset (docs/PRINCIPLES.md, 'Vocabularies come from data'); a closed set says 'closed-class' or 'closed set' in its comment",
    );
  });

  it("the known-open baseline only lists lists that still exist", () => {
    const keys = new Set(found.map((f) => f.key));
    assert.deepEqual(
      [...KNOWN_OPEN].filter((k) => !keys.has(k)),
      [],
      "remove retired entries from KNOWN_OPEN",
    );
  });
});
