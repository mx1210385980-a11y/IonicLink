# Control Strip Grouped Cards Design

## Goal

Make repeated control experiments easier to compare inside the existing grouped IL cards. When records share the same paper, ionic liquid, and tribological system, and differ mainly by one control variable, the UI should collapse those repeated rows into one compact response strip instead of repeating the same card row.

## Problem

The current `Merged IL` view groups by paper and ionic liquid, then splits systems by tribopair plus potential and water. This preserves data, but it makes common control series look repetitive. Many papers vary only one condition, such as potential, load, speed, temperature, water content, concentration, film thickness, or test duration. Those rows need a small visual grammar that says: "same system, one controlled variable changed, here is the response."

## Design

Introduce a **Control Strip** inside each existing grouped IL card. The card shell, typography, borders, evidence affordances, and compact row style remain the same. The only change is the row layout under each system group.

A control strip row contains:

- The stable system label, such as `SiO2 vs. Au(111)`.
- A short summary, such as `Potential response · 7 points` or `Load response · 4 points`.
- The stable conditions as chips, excluding the active control variable.
- A compact row of chips, one per control value.
- Each chip shows `control value` and the COF response.
- Each chip remains clickable through the original record so evidence/workspace access is not lost.

Example:

```text
SiO2 vs. Au(111)        Potential response · 7 points
Dry · 10 nN · 1 um/s
[-2 V 0.12] [-1 V 0.16] [-0.5 V 0.20] [0 V 0.23] [+0.5 V 0.28] [+1 V 0.35]
```

If the same control value has repeated measurements, the chip displays a range and count:

```text
[-1 V 0.062-0.099 · n=6]
```

If the group has too many chips, the first display may stay compact, but the data model must retain all points for a later expand interaction.

## Grouping Rules

Control strips are built after the existing paper + ionic liquid grouping.

For a record set to become a strip:

1. Records must share the same stable system identity.
2. At least two records must have non-empty values for the same control variable.
3. Exactly one supported control variable should vary across the records.
4. Other stable comparison fields should be identical after normalization.

Supported control variables, in priority order:

1. `potential`
2. `load`
3. `speed`
4. `temperature`
5. `water`
6. `concentration`
7. `film`
8. `duration`

The priority only resolves ambiguous cases. If more than one variable varies, keep the existing row-per-record display to avoid hiding multi-factor experiments.

## Behavior

- Database `Merged IL` cards render control strips where eligible.
- Non-eligible rows keep the current compact row layout.
- Upload preview grouped cards use the same grouping concept, with editable/verified candidate rows preserved.
- Clicking a database strip chip opens that record's existing evidence/workspace.
- Clicking a preview strip chip toggles the existing preview detail row; editing/verification remains available.
- Control chips use subtle COF tone only: low, medium, high. The UI should not become chart-heavy.

## Non-Goals

- Do not replace the existing card design with a full chart or pivot table.
- Do not infer scientific equivalence beyond matching structured fields.
- Do not merge multi-factor experiments.
- Do not change backend schemas.

## Verification

- Unit tests prove that same-system potential-only records collapse into one strip.
- Unit tests prove that load-only and water-only controls also collapse.
- Unit tests prove that multi-factor changes stay as individual rows.
- Structure tests prove Database and preview components render the control strip.
- Build must pass.
- The server must be synchronized after verification.
