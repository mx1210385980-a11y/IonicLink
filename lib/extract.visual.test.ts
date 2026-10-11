import assert from "node:assert/strict";
import { selectVisualPageNumbers } from "./extract";
import { tribologyModule } from "./modules/tribology";

const taggedText = `[PAGE 1]
Title and abstract only.

[PAGE 4]
AFM methods and the applied load were described here.

[PAGE 5]
Friction coefficients are displayed in Figure 3b for the four probe-surface combinations.

[PAGE 6]
The discussion compares the coefficient of friction with values from other publications.

[PAGE 9]
References include several figures from cited papers.`;

assert.deepEqual(
  selectVisualPageNumbers("tribology", taggedText, 3),
  [5],
  "only the page that couples the target metric to a figure should be sent to the vision model",
);

assert.deepEqual(
  selectVisualPageNumbers("tribology", "Plain pasted text without page markers or figures."),
  [],
  "pasted text does not invent visual pages",
);

const missingCof = tribologyModule.ingest({
  paper: { title: "Figure-only COF" },
  cation: "[EtNH3]",
  anion: "[NO3]",
  substrate: "silica",
  temperature: "not stated",
  load: "0-80 nN",
  cof: null,
});
assert.equal(
  tribologyModule.acceptDraft?.(missingCof),
  false,
  "condition-only tribology drafts must not enter the review queue without a COF",
);

console.log("Visual evidence page selection tests passed");
