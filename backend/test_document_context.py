from utils.document_context import (
    apply_experimental_document_context,
    extract_experimental_document_context,
)
from services.normalization import normalize_extraction_row


def test_extract_experimental_document_context_recovers_shared_conditions():
    page_texts = {
        5: """
        EXPERIMENTAL
        An AISI 316 stainless steel-coated quartz crystal microbalance sensor was used as the substrate.
        The roughness of the stainless steel was measured by AFM. The RMS roughness was 0.89 nm.
        """,
        6: """
        Normal and friction force measurements were performed using a Bruker Multimode 8 AFM.
        Sharp Si tips with a nominal tip radius of 8 nm were used for this study.
        Friction measurements were performed using a scan size of 100 nm at a scan speed of 6.5 um s-1
        while the normal load was increased from 0 to 100 nN.
        Surface chromium readily reacts with oxygen in air to form a passivating layer of chromium oxide.
        """,
    }

    context = extract_experimental_document_context(page_texts)

    assert context["substrate_material"] == "Stainless steel"
    assert context["probe_material"] == "Silicon"
    assert context["probe_geometry"] == "Tip"
    assert context["probe_radius"] == "8 nm"
    assert context["speed_value"] == "6.5 μm/s"
    assert context["load_value"] == "0-100 nN"
    assert context["substrate_roughness"] == "RMS 0.89 nm"
    assert context["substrate_coating"] == "Chromium oxide"


def test_extract_experimental_document_context_uses_main_temperature_not_uncertainty():
    page_texts = {
        3: """
        The friction test was conducted at 25 ± 3 °C.
        The reciprocating frequency was 1 Hz under a normal load of 10 N.
        """,
    }

    context = extract_experimental_document_context(page_texts)

    assert context["temperature"] == "298.15 K"


def test_document_context_recovers_current_carrying_ball_plate_pair_and_overrides_generic_steel():
    page_texts = {
        2: """
        2.3. Friction tests
        For the friction pair, a 304 stainless steel ball with a diameter of 6 mm was selected
        as the upper sample. The lower sample was formed of a rectangular Q345 steel plate
        with a size of 10 x 10 x 5 mm.
        """,
    }

    context = extract_experimental_document_context(page_texts)

    assert context["material_name"] == "304 stainless steel ball / Q345 steel plate"
    assert context["probe_material"] == "304 stainless steel"
    assert context["probe_geometry"] == "Ball"
    assert context["probe_radius"] == "3 mm"
    assert context["substrate_material"] == "Q345 steel"

    enriched = apply_experimental_document_context(
        {
            "material_name": "Steel",
            "probe_material": "Steel",
            "substrate_material": "Steel",
        },
        context,
    )

    assert enriched["material_name"] == "304 stainless steel ball / Q345 steel plate"
    assert enriched["probe_material"] == "304 stainless steel"
    assert enriched["substrate_material"] == "Q345 steel"


def test_apply_experimental_document_context_overrides_false_probe_default():
    context = {
        "probe_material": "Silicon",
        "probe_geometry": "Tip",
        "probe_radius": "8 nm",
        "load_value": "0-100 nN",
        "speed_value": "6.5 μm/s",
        "substrate_material": "Stainless steel",
        "substrate_roughness": "RMS 0.89 nm",
    }
    record = {
        "material_name": "Stainless steel",
        "probe_material": "Stainless steel",
        "substrate_material": "Stainless steel",
        "probe_geometry": None,
        "probe_radius": None,
        "probe_roughness": None,
        "load_value": None,
        "speed_value": None,
    }

    enriched = apply_experimental_document_context(
        record,
        context,
        override_probe_material=True,
    )

    assert enriched["probe_material"] == "Silicon"
    assert enriched["probe_geometry"] == "Tip"
    assert enriched["probe_radius"] == "8 nm"
    assert enriched["load_value"] == "0-100 nN"
    assert enriched["speed_value"] == "6.5 μm/s"
    assert enriched["substrate_roughness"] == "RMS 0.89 nm"
    assert "surface_roughness" not in enriched


def test_extract_experimental_document_context_recovers_silicon_nitride_snl_probe():
    page_texts = {
        2: """
        Force Measurements The friction force measurements were performed by a Bruker Dimension Icon
        atomic force microscopy (AFM) in contact mode. The SNL probes (silicon nitride, radius of 2 nm)
        for friction measurements were from Bruker. The highly oriented pyrolytic graphite (HOPG)
        was purchased from Mikromasch as the supporting substrate for the ILs.
        """,
    }

    context = extract_experimental_document_context(page_texts)

    assert context["probe_material"] == "Silicon nitride"
    assert context["probe_geometry"] == "Tip"
    assert context["probe_radius"] == "2 nm"
    assert context["substrate_material"] == "HOPG"


def test_extract_experimental_document_context_prefers_snl_tip_over_generic_colloid_mentions():
    page_texts = {
        2: """
        Friction measurements were performed using AFM in contact mode. The SNL probes
        (silicon nitride, radius of 2 nm) were used for the graphite experiments.
        A different calibration paragraph mentions a colloidal probe only as background.
        """,
    }

    context = extract_experimental_document_context(page_texts)

    assert context["probe_material"] == "Silicon nitride"
    assert context["probe_geometry"] == "Tip"


def test_extract_experimental_document_context_prefers_explicit_si_tip_over_background_mica_pair():
    page_texts = {
        6: """
        Normal and friction force measurements were performed using a Bruker Multimode 8 AFM.
        Sharp Si tips with a nominal tip radius of 8 nm were used for this study on stainless steel.
        A literature-background sentence elsewhere mentions ionic liquids between mica surfaces.
        """,
    }

    context = extract_experimental_document_context(page_texts)

    assert context["probe_material"] == "Silicon"
    assert context["probe_geometry"] == "Tip"
    assert context["probe_radius"] == "8 nm"


def test_extract_experimental_document_context_recovers_radius_r_tip_notation():
    page_texts = {
        2: """
        Friction was measured between a sharp Si AFM tip (radius R = 7 nm; AC204TS, Olympus)
        and a gold coated silicon wafer which acted as a working electrode.
        """,
    }

    context = extract_experimental_document_context(page_texts)

    assert context["probe_material"] == "Silicon"
    assert context["probe_geometry"] == "Tip"
    assert context["probe_radius"] == "7 nm"


def test_extract_experimental_document_context_recovers_sharp_silicon_afm_tip_material():
    page_texts = {
        2: """
        A Veeco Nanoscope IV AFM was used for both friction and normal force measurements.
        Au(111) surfaces and sharp silicon AFM tips (NSC36, Mikromasch) with spring constants
        of 0.7 ± 0.3 N m-1 were cleaned before use.
        """,
    }

    context = extract_experimental_document_context(page_texts)

    assert context["probe_material"] == "Silicon"
    assert context["probe_geometry"] == "Tip"


def test_extract_experimental_document_context_recovers_sharp_silicon_afm_probe_material():
    page_texts = {
        2: """
        Lateral force measurements were performed using a Veeco Nanoscope IV AFM in contact mode.
        Sharp silicon AFM probe (spring constant = 0.8 ± 0.2 N/m) from the same batch
        (model NSC36, Mikromasch) were used over the course of the investigation.
        """,
    }

    context = extract_experimental_document_context(page_texts)

    assert context["probe_material"] == "Silicon"
    assert context["probe_geometry"] == "Tip"


def test_extract_experimental_document_context_recovers_silica_colloid_probe_over_tipless_cantilever():
    page_texts = {
        2: """
        Earlier literature studied liquids confined between two mica surfaces.
        A background sentence mentions that earlier work used an AFM tip to study interfacial forces.
        Atomic force microscopy was used to study EAN confined between mica and a silica colloid probe.
        A silica particle was attached to a tipless cantilever with epoxy glue. The particle radius
        was 3.4 um and all normal force and friction measurements were performed using colloidal probe AFM.
        """,
    }

    context = extract_experimental_document_context(page_texts)

    assert context["probe_material"] == "Silica"
    assert context["probe_geometry"] == "Colloid probe"
    assert context["probe_radius"] == "3.4 um"


def test_extract_experimental_document_context_recovers_glass_colloidal_probe():
    page_texts = {
        4: """
        The force-distance curves were captured with AFM glass colloidal probe (20 μm in dimension).
        The borosilicate glass microspheres were stick to NSC35 tipless Cr-Au coated cantilevers.
        The IL-oil mixtures were tested on the titanium substrate.
        """,
    }

    context = extract_experimental_document_context(page_texts)

    assert context["probe_material"] == "Borosilicate glass"
    assert context["probe_geometry"] == "Colloid probe"
    assert context["probe_radius"] == "10 um"
    assert context["substrate_material"] == "Titanium"


def test_normalize_extraction_row_recovers_probe_from_fast_text_page_context():
    row = {
        "material_name": "Graphite",
        "substrate_material": "Graphite",
        "ionic_liquid": "[N88812][A12BMB]",
        "cof": "0.0013",
        "evidence": "The friction μ ≈0.0013 once the normal load exceeds ∼30 nN.",
    }
    page_context = """
    Force Measurements were performed by a Bruker Dimension Icon AFM in contact mode.
    The SNL probes (silicon nitride, radius of 2 nm) were used with graphite surfaces.
    """

    normalized = normalize_extraction_row(row, fallback_page=1, page_context=page_context)

    assert normalized["probe_material"] == "Silicon nitride"
    assert normalized["probe_geometry"] == "Tip"
    assert normalized["probe_radius"] == "2 nm"


def test_normalize_extraction_row_prefers_source_figure_colloid_context_over_neighbor_tip_caption():
    row = {
        "material_name": "silica",
        "substrate_material": "silica",
        "ionic_liquid": "[HMIM][TFSI]",
        "cof": "0.058",
        "source_figure": "Fig. 3b",
        "evidence": "Figure 3b gives speed-dependent friction force on the three silica substrates.",
    }
    page_context = """
    Figure 2. Load-dependent pull-off force measurements carried out with a sharp silicon tip.
    Tip radius R = 48 nm.
    Figure 3. Low-pressure (colloid) friction measurements. a) Load-dependent friction force
    on silica substrates measured with a silica colloid. b) Speed-dependent friction force on
    the three substrates at a constant load of 90 nN. Colloid radius = 5 µm.
    """

    normalized = normalize_extraction_row(row, fallback_page=4, page_context=page_context)

    assert normalized["probe_material"] == "Silica"
    assert normalized["probe_geometry"] == "Colloid probe"
    assert normalized["probe_radius"] == "5 µm"


def test_normalize_extraction_row_recovers_sharp_tip_source_figure_radius():
    row = {
        "material_name": "silica",
        "substrate_material": "silica",
        "ionic_liquid": "[HMIM][TFSI]",
        "cof": "0.036",
        "source_figure": "Fig. 4 discussion",
        "evidence": "For sharp-tip measurements, the smooth surface gives mu = 0.036 in regime III.",
    }
    page_context = """
    Pull-Off and Friction Force Measurements: Force measurements were obtained using either
    a silicon tip or silica colloids with nominal diameters of 10 um.
    Figure 3. Low-pressure (colloid) friction measurements. Colloid radius = 5 um.
    Figure 4. High-pressure (sharp tip) friction measurements. a) Friction versus normal load
    and b) friction versus sliding velocity. Radius of tip R = 47.8 nm.
    """

    normalized = normalize_extraction_row(row, fallback_page=5, page_context=page_context)

    assert normalized["probe_material"] == "Silicon"
    assert normalized["probe_geometry"] == "Tip"
    assert normalized["probe_radius"] == "47.8 nm"


def test_normalize_extraction_row_recovers_symmetric_mica_surface_pair():
    row = {
        "material_name": "mica",
        "substrate_material": "mica",
        "ionic_liquid": "[C10(C1Im)2][NTf2]2",
        "friction_force": "1.2 uN",
        "normal_load": "10 uN",
        "evidence": "Figure 2 shows kinetic friction force as a function of normal force for the ionic liquid between mica surfaces.",
    }

    normalized = normalize_extraction_row(row, fallback_page=11, page_context="")

    assert normalized["probe_material"] == "Mica"
    assert normalized["probe_geometry"] == "Surface pair"
    assert normalized["substrate_material"] == "mica"
