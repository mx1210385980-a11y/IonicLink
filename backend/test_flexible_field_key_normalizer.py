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
