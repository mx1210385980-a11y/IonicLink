# Field Frequency Layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve open-ended extraction variables such as current and iron-oxide additive ratio under stable canonical keys so later field-frequency audits can define core, extension, and flexible layers from real data.

**Architecture:** Add a zero-dependency backend key normalizer, a flexible-field integration helper that stores canonicalized variables under `field_evidence_json["_flexible_fields"]`, and a minimal extraction hook in `file_service.py`. Add frontend helper support so current/current-density flexible conditions can appear in the condition microbar/evidence flow without bloating the main table.

**Tech Stack:** Python 3, pytest, FastAPI backend service modules, Vue 3/TypeScript helper tests with Vitest.

---

### Task 1: Backend Key Normalizer

**Files:**
- Create: `backend/services/flexible_field_key_normalizer.py`
- Test: `backend/test_flexible_field_key_normalizer.py`

- [ ] **Step 1: Write failing tests**

Create `backend/test_flexible_field_key_normalizer.py` with tests covering:

```python
from services.flexible_field_key_normalizer import KeyNormalizer, rule_clean


def test_current_aliases_collapse_to_current():
    normalizer = KeyNormalizer()

    assert normalizer.normalize("Current").canonical_key == "current"
    assert normalizer.normalize("applied_current").canonical_key == "current"
    assert normalizer.normalize("electric current").canonical_key == "current"


def test_iron_oxide_loading_aliases_collapse_to_additive_ratio():
    normalizer = KeyNormalizer()

    result = normalizer.normalize("Fe2O3 loading")

    assert result.canonical_key == "iron_oxide_additive_ratio"
    assert result.stage == "alias"
    assert result.resolved is True


def test_unknown_field_is_preserved_as_unresolved_new_key():
    normalizer = KeyNormalizer()

    result = normalizer.normalize("contact_pressure")

    assert result.canonical_key == "contact_pressure"
    assert result.stage == "new"
    assert result.resolved is False


def test_semantic_stage_suggests_but_never_auto_merges():
    def fake_embedder(key: str):
        tokens = set(rule_clean(key).split("_"))
        return [1.0 if token in tokens else 0.0 for token in ["additive", "concentration", "loading"]]

    normalizer = KeyNormalizer(
        aliases={"additive_loading": ["additive loading"]},
        embedder=fake_embedder,
        semantic_threshold=0.5,
    )

    result = normalizer.normalize("additive concentration")

    assert result.stage == "semantic"
    assert result.canonical_key == "additive_concentration"
    assert result.suggested_merge == "additive_loading"
    assert result.resolved is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest backend/test_flexible_field_key_normalizer.py -q`

Expected: FAIL because `services.flexible_field_key_normalizer` does not exist.

- [ ] **Step 3: Implement normalizer**

Create `backend/services/flexible_field_key_normalizer.py` based on `/Users/julyanffzz/Downloads/files/key_normalizer.py`, preserving:

- `NormalizationResult`
- `DEFAULT_ALIASES`
- `rule_clean`
- `KeyNormalizer`
- semantic suggestions that never auto-merge
- zero external dependencies

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest backend/test_flexible_field_key_normalizer.py -q`

Expected: PASS.

### Task 2: Flexible Field Integration Helper

**Files:**
- Create: `backend/services/flexible_field_integration.py`
- Test: `backend/test_flexible_field_integration.py`

- [ ] **Step 1: Write failing tests**

Create `backend/test_flexible_field_integration.py` with tests covering:

```python
from services.flexible_field_integration import (
    extract_raw_flexible_fields,
    merge_into_field_evidence_json,
    normalize_flexible_fields,
)
from services.flexible_field_key_normalizer import KeyNormalizer


def test_normalize_flexible_fields_keeps_collisions_as_list():
    payload, review_queue = normalize_flexible_fields(
        {
            "Current": {"label": "Current", "value": "0.5", "unit": "A", "category": "condition"},
            "applied_current": {"label": "Applied current", "value": "1.0", "unit": "A", "category": "condition"},
        },
        KeyNormalizer(),
    )

    assert "current" in payload
    assert isinstance(payload["current"], list)
    assert [entry["value"] for entry in payload["current"]] == ["0.5", "1.0"]
    assert review_queue == []


def test_merge_into_field_evidence_preserves_existing_keys():
    merged = merge_into_field_evidence_json(
        {"cof": {"value": "0.04"}},
        {"current": {"value": "0.5", "unit": "A"}},
    )

    assert merged["cof"]["value"] == "0.04"
    assert merged["_flexible_fields"]["current"]["value"] == "0.5"


def test_extract_raw_flexible_fields_picks_known_extra_variables_only():
    raw = extract_raw_flexible_fields({
        "material_name": "Steel",
        "ionic_liquid": "[EMIM][BF4]",
        "cof": "0.04",
        "Current": "0.5 A",
        "Fe2O3 loading": "1 wt%",
        "notes": "from table",
        "source_page": 4,
    })

    assert raw["Current"]["value"] == "0.5 A"
    assert raw["Current"]["category"] == "condition"
    assert raw["Fe2O3 loading"]["category"] == "lubricant_component"
    assert "material_name" not in raw
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest backend/test_flexible_field_integration.py -q`

Expected: FAIL because `services.flexible_field_integration` does not exist.

- [ ] **Step 3: Implement integration helper**

Create `backend/services/flexible_field_integration.py` based on `/Users/julyanffzz/Downloads/files/pipeline_integration.py`, with an additional `extract_raw_flexible_fields(item)` helper that:

- ignores fixed canonical fields already handled by the existing pipeline
- extracts current/current-density aliases
- extracts iron-oxide/additive-loading aliases
- turns scalar values into payloads with `label`, `value`, `unit`, `category`, `evidence`
- preserves structured payloads unchanged except for normalization metadata

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest backend/test_flexible_field_integration.py -q`

Expected: PASS.

### Task 3: Extraction Pipeline Hook

**Files:**
- Modify: `backend/services/file_service.py`
- Test: `backend/test_field_evidence_workflow.py`

- [ ] **Step 1: Write failing test**

Append a test to `backend/test_field_evidence_workflow.py`:

```python
def test_field_evidence_map_preserves_current_and_iron_oxide_flexible_fields():
    item = {
        "material_name": "304 stainless steel",
        "ionic_liquid": "[EMIM][BF4]",
        "cof": "0.04",
        "Current": "0.5 A",
        "Fe2O3 loading": "1 wt%",
        "source": "Table 2",
        "source_page": 4,
        "evidence": "Current was 0.5 A and Fe2O3 nanoparticles were added at 1 wt%.",
    }
    record = SimpleNamespace(
        source="Table 2",
        source_figure=None,
        source_page=4,
        evidence_page=None,
        evidence_bbox=None,
        sample_id=None,
    )

    field_map = _build_field_evidence_map(item, record, confidence=0.9, file_path=None)

    flexible = field_map["_flexible_fields"]
    assert flexible["current"]["value"] == "0.5 A"
    assert flexible["current"]["_raw_key"] == "Current"
    assert flexible["iron_oxide_additive_ratio"]["value"] == "1 wt%"
    assert flexible["iron_oxide_additive_ratio"]["category"] == "lubricant_component"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest backend/test_field_evidence_workflow.py::test_field_evidence_map_preserves_current_and_iron_oxide_flexible_fields -q`

Expected: FAIL because `_flexible_fields` is not added.

- [ ] **Step 3: Hook integration into `_build_field_evidence_map`**

Modify `backend/services/file_service.py` to import:

```python
from services.flexible_field_integration import (
    extract_raw_flexible_fields,
    merge_into_field_evidence_json,
    normalize_flexible_fields,
)
from services.flexible_field_key_normalizer import KeyNormalizer
```

Then, after fixed `entries` are built and provided field overrides are merged, call:

```python
raw_flexible_fields = extract_raw_flexible_fields(item)
if raw_flexible_fields:
    flexible_payload, flexible_review_queue = normalize_flexible_fields(raw_flexible_fields, KeyNormalizer())
    entries = merge_into_field_evidence_json(entries, flexible_payload)
    if flexible_review_queue:
        entries["_flexible_field_review_queue"] = flexible_review_queue
```

- [ ] **Step 4: Run focused backend tests**

Run:

```bash
python3 -m pytest \
  backend/test_flexible_field_key_normalizer.py \
  backend/test_flexible_field_integration.py \
  backend/test_field_evidence_workflow.py::test_field_evidence_map_preserves_current_and_iron_oxide_flexible_fields \
  -q
```

Expected: PASS.

### Task 4: Frontend Condition Visibility

**Files:**
- Modify: `frontend/src/lib/integratedExplorerHelpers.ts`
- Test: `frontend/src/lib/integratedExplorerHelpers.test.ts`
- Modify: `frontend/src/components/integrated-explorer/IntegratedExplorerWorkspace.vue`
- Test: `frontend/src/components/integrated-explorer/RecordTable.structure.test.ts`

- [ ] **Step 1: Write failing helper test**

Append a test to `frontend/src/lib/integratedExplorerHelpers.test.ts`:

```ts
it('shows current from flexible fields as an experimental condition', () => {
  const microbar = conditionMicrobarItems(createRecord({
    fieldEvidenceJson: {
      _flexible_fields: {
        current: {
          label: 'Current',
          value: '0.5',
          unit: 'A',
          category: 'condition',
        },
      },
    },
  }), 8)

  const current = microbar.items.find((item) => item.key === 'current')
  expect(current).toMatchObject({
    label: 'current',
    value: '0.5',
    unit: 'A',
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test -- src/lib/integratedExplorerHelpers.test.ts -t "shows current from flexible fields"`

Expected: FAIL because current is not read from `_flexible_fields`.

- [ ] **Step 3: Implement helper support**

Modify `integratedExplorerHelpers.ts` to:

- read `record.fieldEvidenceJson?._flexible_fields`
- include entries with `category === "condition"` and canonical keys `current` or `current_density`
- add symbols/priorities/display labels for `current` and `current_density`

- [ ] **Step 4: Write failing evidence-key source test**

Add assertions to `RecordTable.structure.test.ts` or an existing evidence-popover test that `IntegratedExplorerWorkspace.vue` includes `current` and `current_density` in condition evidence keys.

- [ ] **Step 5: Implement evidence-key support**

Modify `IntegratedExplorerWorkspace.vue` condition evidence key and semantic-type lists to include `current` and `current_density`.

- [ ] **Step 6: Run focused frontend tests**

Run:

```bash
npm --prefix frontend run test -- \
  src/lib/integratedExplorerHelpers.test.ts \
  src/components/integrated-explorer/RecordTable.structure.test.ts
```

Expected: PASS.

### Task 5: Verification and Sync

**Files:**
- No new files beyond implementation.

- [ ] **Step 1: Run backend focused tests**

Run:

```bash
python3 -m pytest \
  backend/test_flexible_field_key_normalizer.py \
  backend/test_flexible_field_integration.py \
  backend/test_field_evidence_workflow.py \
  -q
```

Expected: PASS.

- [ ] **Step 2: Run frontend focused tests and typecheck**

Run:

```bash
npm --prefix frontend run test -- \
  src/lib/integratedExplorerHelpers.test.ts \
  src/components/integrated-explorer/RecordTable.structure.test.ts
npm --prefix frontend run build
```

Expected: PASS and successful build.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add backend/services/flexible_field_key_normalizer.py \
  backend/services/flexible_field_integration.py \
  backend/test_flexible_field_key_normalizer.py \
  backend/test_flexible_field_integration.py \
  backend/test_field_evidence_workflow.py \
  frontend/src/lib/integratedExplorerHelpers.ts \
  frontend/src/lib/integratedExplorerHelpers.test.ts \
  frontend/src/components/integrated-explorer/IntegratedExplorerWorkspace.vue \
  frontend/src/components/integrated-explorer/RecordTable.structure.test.ts \
  docs/superpowers/plans/2026-06-07-field-frequency-layering.md
git commit -m "Preserve flexible extraction fields"
```

- [ ] **Step 4: Sync to remote server**

Run:

```bash
IONICLINK_HOST=ioniclink IONICLINK_REMOTE_DIR=/opt/ioniclink/repo scripts/deploy-server.sh all
```

Expected: frontend and backend code sync, frontend build completes, backend/frontend hot-swap completes.
