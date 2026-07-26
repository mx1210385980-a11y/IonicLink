import assert from "node:assert/strict";
import {
  fitArrhenius,
  GAS_CONSTANT,
  medianEa,
  translateArrhenius,
  vftUnlocked,
} from "./arrhenius";

const GROUP = { groupKey: "test", groupLabel: "[X][Y]", cationFamily: "imidazolium" };

/* ---- fit recovers a synthetic activation energy exactly ---- */
{
  const ea = 20000; // J/mol
  const A = 100;
  const y = (T: number) => A * Math.exp(-ea / (GAS_CONSTANT * T));
  const fit = fitArrhenius(
    [300, 320, 340].map((T) => ({ tempK: T, y: y(T), ids: ["#x"] })),
    GROUP
  );
  assert.ok(fit, "fit must exist for 3 distinct temperatures");
  assert.ok(Math.abs(fit.eaJmol - ea) < 1, `Ea ${fit.eaJmol}`);
  assert.ok(Math.abs(fit.lnA - Math.log(A)) < 1e-6);
  assert.deepEqual(fit.tempRange, [300, 340]);
}

/* ---- translation round-trips along the law ---- */
{
  const ea = 25000;
  const y300 = 0.5;
  const y340 = translateArrhenius(y300, 300, 340, ea);
  assert.ok(y340 > y300, "conductivity rises with temperature");
  const back = translateArrhenius(y340, 340, 300, ea);
  assert.ok(Math.abs(back - y300) < 1e-12);
}

/* ---- the live [BMIM][BF4] seed data fits Ea ≈ 19.6 kJ/mol ---- */
{
  const fit = fitArrhenius(
    [
      { tempK: 298.15, y: 0.35, ids: ["#001"] },
      { tempK: 353.15, y: 1.2, ids: ["#002"] },
    ],
    GROUP
  );
  assert.ok(fit);
  assert.ok(fit.eaJmol > 19000 && fit.eaJmol < 20300, `seed Ea ${fit.eaJmol}`);
  assert.equal(fit.nPoints, 2);
}

/* ---- no fit from a single temperature ---- */
{
  assert.equal(fitArrhenius([{ tempK: 298, y: 1, ids: [] }], GROUP), null);
  assert.equal(
    fitArrhenius(
      [
        { tempK: 298, y: 1, ids: [] },
        { tempK: 298, y: 1.1, ids: [] },
      ],
      GROUP
    ),
    null,
    "two points at the SAME temperature cannot fit a slope"
  );
}

/* ---- median Ea ---- */
{
  const mk = (ea: number) => ({ ...GROUP, eaJmol: ea, lnA: 0, nPoints: 2, tempRange: [298, 353] as [number, number], points: [] });
  assert.equal(medianEa([mk(10), mk(30), mk(20)]), 20);
  assert.equal(medianEa([mk(10), mk(20)]), 15);
  assert.equal(medianEa([]), null);
}

/* ---- VFT stays locked below 4 temps spanning 60 K ---- */
{
  assert.equal(
    vftUnlocked([
      { tempK: 298, y: 1, ids: [] },
      { tempK: 353, y: 2, ids: [] },
    ]),
    false
  );
  assert.equal(
    vftUnlocked([298, 320, 340, 360].map((T) => ({ tempK: T, y: 1, ids: [] }))),
    true
  );
  assert.equal(
    vftUnlocked([298, 305, 310, 315].map((T) => ({ tempK: T, y: 1, ids: [] }))),
    false,
    "4 temps spanning < 60 K stay locked"
  );
}

console.log("predict/arrhenius tests passed");
