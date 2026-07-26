import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Atlas, AtlasCell } from "../../lib/predict/candidates";
import { describeIon } from "../../lib/predict/descriptors";
import { DESIGN_SPECS } from "../../lib/predict/specs";
import { DesignExplorer, moveAtlasFocus } from "./DesignExplorer";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const cations = [describeIon("[EMIM]", "cation"), describeIon("[BMIM]", "cation")];
const anions = [describeIon("[TFSI]", "anion"), describeIon("[BF4]", "anion"), describeIon("[Cl]", "anion")];

function makeAtlas(gated: boolean, kinds: AtlasCell["kind"][], usableN: number): Atlas {
  let index = 0;
  return {
    cations,
    anions,
    gated,
    usableN,
    cells: cations.map((cation) =>
      anions.map((anion) => {
        const kind = kinds[index++];
        return {
          cation,
          anion,
          pairKey: `${cation.key}|${anion.key}`,
          kind,
          measured: [],
          value: kind === "insufficient" ? null : 0.1 + index / 100,
          prediction: null,
          reviewOnly: false,
        };
      })
    ),
  };
}

function renderExplorer(atlas: Atlas): string {
  return renderToStaticMarkup(
    createElement(DesignExplorer, {
      spec: DESIGN_SPECS.diffusion,
      atlas,
      ranked: [],
      objective: "max",
      includeExtrapolated: false,
      constraints: {},
      modelHashValue: "test-model",
      onObjective: () => {},
      onIncludeExtrapolated: () => {},
      onConstraints: () => {},
      onPickPair: () => {},
    })
  );
}

function occurrences(html: string, token: string): number {
  return html.split(token).length - 1;
}

/* Zero measurements: render a compact growth state, not the full atlas DOM. */
{
  const html = renderExplorer(makeAtlas(true, Array(6).fill("insufficient"), 0));
  assert.match(html, /data-testid="design-explorer-empty"/);
  assert.match(html, /0 \/ 8 usable records/);
  assert.match(html, /No measured pairs yet/);
  assert.match(html, /href="\/diffusion\/extract"/);
  assert.match(html, /Extract a paper/);
  assert.doesNotMatch(html, /Cation by anion pair atlas/);
  assert.equal(occurrences(html, 'role="button"'), 0);
  assert.equal(occurrences(html, 'tabindex="0"'), 0);
}

/* Gated with sparse coverage: only measured cells remain actionable/focusable. */
{
  const html = renderExplorer(
    makeAtlas(true, ["measured", "insufficient", "insufficient", "insufficient", "insufficient", "measured"], 2)
  );
  assert.match(html, /Coverage mode/);
  assert.match(html, /only those measured pairs are interactive/);
  assert.match(html, /Cation by anion pair atlas/);
  assert.equal(occurrences(html, 'role="button"'), 2);
  assert.equal(occurrences(html, 'tabindex="0"'), 1);
  assert.equal(occurrences(html, 'tabindex="-1"'), 1);
  assert.doesNotMatch(html, /no estimate - load into bench/);
}

/* Once unlocked, every cell remains actionable but only one enters the Tab order. */
{
  const html = renderExplorer(
    makeAtlas(false, ["measured", "predicted", "insufficient", "predicted", "insufficient", "predicted"], 8)
  );
  assert.equal(occurrences(html, 'role="button"'), 6);
  assert.equal(occurrences(html, 'tabindex="0"'), 1);
  assert.equal(occurrences(html, 'tabindex="-1"'), 5);
  assert.match(html, /no estimate - load into bench/);
}

/* Arrow-key navigation is two-dimensional and skips unavailable cells. */
{
  const full = [
    [true, true, true],
    [true, true, true],
  ];
  assert.deepEqual(moveAtlasFocus(full, { row: 0, column: 0 }, "ArrowRight"), { row: 0, column: 1 });
  assert.deepEqual(moveAtlasFocus(full, { row: 0, column: 2 }, "ArrowRight"), { row: 1, column: 0 });
  assert.deepEqual(moveAtlasFocus(full, { row: 0, column: 1 }, "ArrowDown"), { row: 1, column: 1 });
  assert.deepEqual(moveAtlasFocus(full, { row: 0, column: 0 }, "ArrowUp"), { row: 0, column: 0 });

  const sparse = [
    [true, false, false],
    [false, false, true],
    [false, true, false],
  ];
  assert.deepEqual(moveAtlasFocus(sparse, { row: 0, column: 0 }, "ArrowRight"), { row: 1, column: 2 });
  assert.deepEqual(moveAtlasFocus(sparse, { row: 0, column: 0 }, "ArrowDown"), { row: 1, column: 2 });
  assert.deepEqual(moveAtlasFocus(sparse, { row: 1, column: 2 }, "ArrowDown"), { row: 2, column: 1 });
  assert.deepEqual(moveAtlasFocus(sparse, { row: 2, column: 1 }, "ArrowLeft"), { row: 1, column: 2 });
}

console.log("DesignExplorer accessibility tests passed");
