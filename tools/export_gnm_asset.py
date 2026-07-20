#!/usr/bin/env python3
"""Bake Google GNM v3 into a compact, named speech-rig GLB.

This exporter deliberately keeps GNM out of the browser runtime.  It evaluates
GNM's canonical topology offline, samples its learned expression manifold, and
exports only the named controls the coarticulation engine needs.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
from typing import Iterable

# GNM is a pinned research input; never write Python cache files into it.
sys.dont_write_bytecode = True

import h5py
import numpy as np
from scipy.spatial import cKDTree
from pygltflib import (
    ARRAY_BUFFER,
    ELEMENT_ARRAY_BUFFER,
    FLOAT,
    UNSIGNED_SHORT,
    Accessor,
    Asset,
    Attributes,
    Buffer,
    BufferView,
    GLTF2,
    Material,
    Mesh,
    Node,
    PbrMetallicRoughness,
    Primitive,
    Scene,
)


EXPRESSION_LABELS = (
    "surprise",
    "disgust",
    "suck",
    "compress_face",
    "stretch_face",
    "happy",
    "squint",
    "platysma",
    "blow",
    "funneler",
    "smile_wide",
    "corners_down",
    "pucker",
    "wink_left",
    "wink_right",
    "mouth_left",
    "mouth_right",
    "lips_roll_in",
    "snarl",
    "tongue_center",
)


@dataclasses.dataclass(frozen=True)
class MorphRecipe:
    name: str
    sources: tuple[tuple[str, float], ...]
    anatomical_correction: str | None = None
    oral: bool = True
    source_regions: tuple[str, ...] | None = None
    geometry_scope: str | None = None
    joint_rotations: tuple[tuple[str, tuple[float, float, float]], ...] = ()


# Compact target set used by the runtime.  These are articulator controls, not
# one-target-per-letter animation frames.  The runtime overlaps them.
MORPH_RECIPES = (
    # The semantic decoder labels describe facial expressions, not phonemes.
    # Small semantic blends establish the broad pose; explicit, bounded oral
    # corrections below establish contacts that the labels cannot guarantee.
    MorphRecipe("viseme_MBP", (("blow", 0.25),), "bilabial_seal"),
    MorphRecipe("viseme_FV", (("lips_roll_in", 0.25), ("snarl", 0.08)), "labiodental_contact"),
    MorphRecipe("viseme_L", (("tongue_center", 0.22), ("surprise", 0.08)), "lateral_contact"),
    MorphRecipe("viseme_TH", (("tongue_center", 0.48), ("surprise", 0.08)), "dental_protrusion"),
    MorphRecipe("viseme_TDN", (("tongue_center", 0.16), ("surprise", 0.06)), "alveolar_stop_contact"),
    MorphRecipe("viseme_SZ", (("suck", 0.08), ("stretch_face", 0.015)), "sibilant_groove"),
    MorphRecipe("viseme_CHSH", (("funneler", 0.28), ("suck", 0.06)), "postalveolar_groove"),
    MorphRecipe("viseme_KG", (("surprise", 0.22),), "velar_contact"),
    MorphRecipe("viseme_R", (("funneler", 0.12), ("corners_down", 0.04)), "rhotic_bunch"),
    MorphRecipe("viseme_WQ", (("pucker", 0.38), ("funneler", 0.08))),
    MorphRecipe("vowel_AA", (("surprise", 0.95), ("stretch_face", 0.04))),
    MorphRecipe("vowel_AE", (("stretch_face", 0.25), ("happy", 0.08))),
    MorphRecipe("vowel_AH", (("surprise", 0.72), ("stretch_face", 0.03))),
    MorphRecipe("vowel_EH", (("stretch_face", 0.14), ("smile_wide", 0.10))),
    MorphRecipe("vowel_IH", (("stretch_face", 0.08), ("smile_wide", 0.10))),
    MorphRecipe("vowel_EE", (("smile_wide", 0.30), ("stretch_face", 0.02))),
    MorphRecipe("vowel_OH", (("funneler", 0.36), ("surprise", 0.08))),
    MorphRecipe("vowel_OO", (("pucker", 0.28), ("funneler", 0.08))),
    MorphRecipe("jawOpen", (("surprise", 1.05),)),
    MorphRecipe("mouthFunnel", (("funneler", 0.50),)),
    MorphRecipe("mouthPucker", (("pucker", 0.45),)),
    MorphRecipe("tongueTipUp", (("tongue_center", 0.22), ("surprise", 0.08)), "alveolar_stop_contact"),

    # Atomic GNM speech controls.  The semantic samples keep broad motion on
    # GNM's learned lower-face manifold; bounded correctives isolate the named
    # articulator and create repeatable contacts.  Pure-contact targets have no
    # semantic source so the runtime can layer them over a vowel without
    # accidentally replacing its broad lip/jaw posture.
    MorphRecipe("jawForward", (), "jaw_forward"),
    MorphRecipe("upperLipRaise", (("snarl", 0.12),), "upper_lip_raise", source_regions=("lowerFace",)),
    MorphRecipe("lowerLipDepress", (("platysma", 0.12),), "lower_lip_depress", source_regions=("lowerFace",)),
    MorphRecipe("lipCompress", (("blow", 0.08),), "lip_compress", source_regions=("lowerFace",)),
    MorphRecipe("lipRollIn", (("lips_roll_in", 0.24),), "lip_roll_in", source_regions=("lowerFace",)),
    MorphRecipe("lipRollOut", (("pucker", 0.16),), "lip_roll_out", source_regions=("lowerFace",)),
    MorphRecipe("mouthCornersUp", (("happy", 0.20), ("smile_wide", 0.06)), "corners_up", source_regions=("lowerFace",)),
    MorphRecipe("mouthCornersDown", (("corners_down", 0.24),), "corners_down", source_regions=("lowerFace",)),
    MorphRecipe("mouthStretch", (("smile_wide", 0.24), ("stretch_face", 0.04)), "mouth_stretch", source_regions=("lowerFace",)),
    MorphRecipe("tongueTipLateral", (), "lateral_pose"),
    MorphRecipe("tongueBladeUp", (), "tongue_blade_up"),
    MorphRecipe("tongueBladeGroove", (), "tongue_blade_groove_pose"),
    MorphRecipe("tongueBodyHigh", (), "tongue_body_high"),
    MorphRecipe("tongueBodyBack", (), "tongue_body_back"),
    MorphRecipe("tongueBodyLow", (), "tongue_body_low"),
    MorphRecipe("tongueForward", (), "tongue_forward"),
    MorphRecipe("tongueRetract", (), "tongue_retract"),
    MorphRecipe("contactBilabial", (), "bilabial_seal"),
    MorphRecipe("contactLabiodental", (), "labiodental_contact"),
    MorphRecipe("contactDental", (), "dental_contact"),
    MorphRecipe("contactAlveolar", (), "alveolar_stop_contact"),
    MorphRecipe("contactLateral", (), "lateral_contact"),
    MorphRecipe("correctiveSibilantGroove", (), "tongue_blade_groove"),
    MorphRecipe("contactVelar", (), "velar_contact"),

    MorphRecipe(
        "eyeOpen",
        (("squint", -0.25),),
        oral=False,
        source_regions=("leftEye", "rightEye"),
        geometry_scope="upperFaceBilateral",
    ),
    MorphRecipe(
        "blinkLeft",
        (("wink_left", 0.88),),
        oral=False,
        source_regions=("leftEye",),
        geometry_scope="upperFaceLeft",
    ),
    MorphRecipe(
        "blinkRight",
        (("wink_right", 0.88),),
        oral=False,
        source_regions=("rightEye",),
        geometry_scope="upperFaceRight",
    ),
    MorphRecipe("smile", (("happy", 0.48), ("smile_wide", 0.20)), oral=False),
    MorphRecipe(
        "browConcern",
        (("corners_down", 0.58), ("squint", 0.28)),
        oral=False,
        source_regions=("leftEye", "rightEye"),
        geometry_scope="upperFaceBilateral",
    ),

    # Region-isolated performance controls.  The eye PCA regions deform the
    # eyelids, brows, orbit, and upper cheek while leaving the lower-face and
    # oral bases at zero. Bilateral targets are delta-symmetrized below so the
    # controller can add asymmetry deliberately rather than inheriting it from
    # one semantic decoder sample.
    MorphRecipe(
        "browLift",
        (("surprise", 1.10),),
        oral=False,
        source_regions=("leftEye", "rightEye"),
        geometry_scope="upperFaceBilateral",
    ),
    MorphRecipe(
        "browLiftLeft",
        (("surprise", 1.18),),
        oral=False,
        source_regions=("leftEye",),
        geometry_scope="upperFaceLeft",
    ),
    MorphRecipe(
        "browLiftRight",
        (("surprise", 1.18),),
        oral=False,
        source_regions=("rightEye",),
        geometry_scope="upperFaceRight",
    ),
    MorphRecipe(
        "browFurrow",
        (("disgust", 0.70), ("corners_down", 0.32)),
        oral=False,
        source_regions=("leftEye", "rightEye"),
        geometry_scope="upperFaceBilateral",
    ),
    MorphRecipe(
        "eyeWiden",
        (("squint", -0.72),),
        oral=False,
        source_regions=("leftEye", "rightEye"),
        geometry_scope="upperFaceBilateral",
    ),
    MorphRecipe(
        "eyeSquint",
        (("squint", 0.72),),
        oral=False,
        source_regions=("leftEye", "rightEye"),
        geometry_scope="upperFaceBilateral",
    ),
    MorphRecipe(
        "cheekRaise",
        (("happy", 0.95), ("squint", 0.28)),
        oral=False,
        source_regions=("leftEye", "rightEye"),
        geometry_scope="upperFaceBilateral",
    ),

    # Slower affective lower-face controls. They are sampled from GNM's
    # learned 150-coefficient lower-face region, but remain separate from the
    # immutable speech target contract. Runtime contact policies can therefore
    # retain readable corners/creases while phonetic jaw, lip and tongue
    # controls stay authoritative at their much higher update frequency.
    MorphRecipe(
        "smileMouth",
        (("happy", 0.82), ("smile_wide", 0.34)),
        oral=False,
        source_regions=("lowerFace",),
        geometry_scope="lowerFaceExpression",
    ),
    MorphRecipe(
        "surpriseMouth",
        (("surprise", 0.86),),
        oral=False,
        source_regions=("lowerFace",),
        geometry_scope="lowerFaceExpression",
    ),
    MorphRecipe(
        "concernMouth",
        (("corners_down", 0.76), ("platysma", 0.18)),
        oral=False,
        source_regions=("lowerFace",),
        geometry_scope="lowerFaceExpression",
    ),
    MorphRecipe(
        "curiosityMouth",
        (("funneler", 0.20), ("pucker", 0.10)),
        oral=False,
        source_regions=("lowerFace",),
        geometry_scope="lowerFaceExpression",
    ),
    MorphRecipe(
        "emphasisMouth",
        (("compress_face", 0.52), ("lips_roll_in", 0.10)),
        oral=False,
        source_regions=("lowerFace",),
        geometry_scope="lowerFaceExpression",
    ),

    # GNM's eye joints rotate the complete ocular components without moving
    # eyelid skin. These modest poses are baked as morph deltas so the browser
    # retains a compact morph-only contract and does not need a skeleton.
    MorphRecipe(
        "gazeLeft",
        (),
        oral=False,
        geometry_scope="ocular",
        joint_rotations=(
            ("left_eye", (0.0, 0.12, 0.0)),
            ("right_eye", (0.0, 0.12, 0.0)),
        ),
    ),
    MorphRecipe(
        "gazeRight",
        (),
        oral=False,
        geometry_scope="ocular",
        joint_rotations=(
            ("left_eye", (0.0, -0.12, 0.0)),
            ("right_eye", (0.0, -0.12, 0.0)),
        ),
    ),
    MorphRecipe(
        "gazeUp",
        (),
        oral=False,
        geometry_scope="ocular",
        joint_rotations=(
            ("left_eye", (-0.10, 0.0, 0.0)),
            ("right_eye", (-0.10, 0.0, 0.0)),
        ),
    ),
    MorphRecipe(
        "gazeDown",
        (),
        oral=False,
        geometry_scope="ocular",
        joint_rotations=(
            ("left_eye", (0.10, 0.0, 0.0)),
            ("right_eye", (0.10, 0.0, 0.0)),
        ),
    ),
)

ORAL_MORPH_TARGET_NAMES = tuple(recipe.name for recipe in MORPH_RECIPES if recipe.oral)

UPPER_FACE_MORPH_TARGET_NAMES = tuple(
    recipe.name
    for recipe in MORPH_RECIPES
    if recipe.geometry_scope is not None
    and recipe.geometry_scope.startswith("upperFace")
)
LOWER_FACE_EXPRESSION_TARGET_NAMES = tuple(
    recipe.name
    for recipe in MORPH_RECIPES
    if recipe.geometry_scope == "lowerFaceExpression"
)
GAZE_MORPH_TARGET_NAMES = tuple(
    recipe.name for recipe in MORPH_RECIPES if recipe.geometry_scope == "ocular"
)

# SHA-256 of the 46 pre-expression-expansion oral target names and their
# runtime-visible delta fingerprints, newline-delimited in target order. This
# is deliberately immutable: exporter refactors may append expressive targets
# but may not silently alter the proven speech basis.
BASELINE_ORAL_RUNTIME_CONTRACT_SHA256 = (
    "c68b0d2aed9e43891c0a8cc55e7d8ff789319beaa4e8eb491a137eb5eb2b8b88"
)
RUNTIME_TOPOLOGY_SHA256 = (
    "0edd9b3927c25224b5cbd63b9ec6b2940c12d1c0fe69ae65ef262fbfdfe34427"
)

ISOLATED_LIP_CORRECTIONS = {
    "upper_lip_raise",
    "lower_lip_depress",
    "lip_compress",
    "lip_roll_in",
    "lip_roll_out",
    "corners_up",
    "corners_down",
    "mouth_stretch",
}

# GNM v3's full expression vector is a region-partitioned learned space.  The
# compact runtime controls above are sampled from this full space offline; the
# browser never downloads the 383-dimensional source rig.
GNM_EXPRESSION_REGIONS = {
    "leftEye": (0, 100),
    "rightEye": (100, 200),
    "lowerFace": (200, 350),
    "tongue": (350, 382),
    "iris": (382, 383),
}


@dataclasses.dataclass(frozen=True)
class PrimitiveSpec:
    name: str
    vertex_group: str
    material: int
    include_morph_normals: bool = False


PRIMITIVES = (
    PrimitiveSpec("skin", "skin", 0, True),
    PrimitiveSpec("eye_sclera", "scleras", 1),
    PrimitiveSpec("eye_iris", "irises", 2),
    PrimitiveSpec("eye_pupil", "pupils", 3),
    PrimitiveSpec("eye_interior", "eye_interiors", 4),
    PrimitiveSpec("upper_teeth", "upper_teeth_and_gums", 5),
    PrimitiveSpec("lower_teeth", "lower_teeth_and_gums", 6),
    PrimitiveSpec("tongue", "tongue", 7),
)

SKIN_RUNTIME_TRIANGLE_MANIFEST = (
    Path(__file__).resolve().parent
    / "data"
    / "gnm_skin_runtime_triangle_indices.npy"
)
SKIN_RUNTIME_TRIANGLE_MANIFEST_SHA256 = (
    "d823908c9c0d0f2861f2a92081e60ce7f8272de4cdfba32a98b8c57157528152"
)
SKIN_RUNTIME_TRIANGLE_COUNT = 22_576


def primitive_triangle_indices(
    model: object,
    spec: PrimitiveSpec,
    neutral_vertices: np.ndarray,
) -> np.ndarray:
    """Select a primitive while retaining GNM's fixed central-neck topology.

    GNM Head includes a broad shoulder bib in ``skin``. A horizontal runtime
    clip removed that bib but visibly cut through the upper neck. The selected
    triangles are stored as an immutable manifest so regeneration cannot
    silently change topology, UV-split vertex counts, or semantic histograms.
    """
    triangle_indices = np.asarray(
        model.triangle_indices_for_group(spec.vertex_group), dtype=np.int32
    )
    if spec.name != "skin":
        return triangle_indices

    del neutral_vertices
    manifest_bytes = SKIN_RUNTIME_TRIANGLE_MANIFEST.read_bytes()
    digest = hashlib.sha256(manifest_bytes).hexdigest()
    if digest != SKIN_RUNTIME_TRIANGLE_MANIFEST_SHA256:
        raise ValueError(
            "GNM skin topology manifest checksum mismatch: "
            f"{digest} != {SKIN_RUNTIME_TRIANGLE_MANIFEST_SHA256}"
        )
    selected = np.load(
        SKIN_RUNTIME_TRIANGLE_MANIFEST,
        allow_pickle=False,
    ).astype(np.int32, copy=False)
    if selected.shape != (SKIN_RUNTIME_TRIANGLE_COUNT,):
        raise ValueError(
            "GNM skin topology manifest has the wrong triangle count: "
            f"{selected.shape}"
        )
    if len(np.unique(selected)) != len(selected):
        raise ValueError("GNM skin topology manifest contains duplicate triangles")
    if not np.all(np.isin(selected, triangle_indices)):
        raise ValueError("GNM skin topology manifest contains non-skin triangles")
    return selected


def audit_compact_morph_targets(
    model: object,
    neutral_vertices: np.ndarray,
    morph_positions: np.ndarray,
) -> dict[str, object]:
    """Reject inert/duplicate controls and summarize runtime-visible deltas."""
    tongue_corrections = {
        "alveolar_stop_contact",
        "lateral_contact",
        "lateral_pose",
        "dental_protrusion",
        "dental_contact",
        "sibilant_groove",
        "postalveolar_groove",
        "velar_contact",
        "rhotic_bunch",
        "tongue_blade_up",
        "tongue_blade_groove",
        "tongue_blade_groove_pose",
        "tongue_body_high",
        "tongue_body_back",
        "tongue_body_low",
        "tongue_forward",
        "tongue_retract",
    }
    component_sources: dict[str, np.ndarray] = {}
    for spec in PRIMITIVES:
        triangle_indices = primitive_triangle_indices(
            model, spec, neutral_vertices
        )
        component_sources[spec.name] = np.unique(
            np.asarray(model.triangles)[triangle_indices].reshape(-1)
        )

    target_diagnostics: dict[str, object] = {}
    fingerprints: dict[str, str] = {}
    for target_index, recipe in enumerate(MORPH_RECIPES):
        component_metrics: dict[str, object] = {}
        digest = hashlib.sha256()
        for component_name, source_vertices in component_sources.items():
            delta = np.asarray(
                morph_positions[target_index, source_vertices],
                dtype=np.float32,
            )
            lengths = np.linalg.norm(delta, axis=1)
            maximum = float(lengths.max(initial=0.0) * 1000.0)
            component_metrics[component_name] = {
                "maximumDeltaMillimeters": maximum,
                "rmsDeltaMillimeters": float(
                    np.sqrt(np.mean(np.square(lengths))) * 1000.0
                ),
                "movedVertexCountAbove0_01mm": int(
                    np.count_nonzero(lengths > 0.00001)
                ),
            }
            # Hash only data exported into the GLB.  Rounded float32 bytes make
            # the duplicate gate insensitive to irrelevant last-bit noise.
            digest.update(np.round(delta, decimals=8).tobytes(order="C"))

        maximum = max(
            component["maximumDeltaMillimeters"]
            for component in component_metrics.values()
        )
        if maximum < 0.01:
            raise ValueError(
                f"compact target {recipe.name} is inert ({maximum:.6f} mm max)"
            )
        if recipe.geometry_scope == "ocular":
            expected_components = (
                "eye_sclera",
                "eye_iris",
                "eye_pupil",
                "eye_interior",
            )
        elif recipe.anatomical_correction == "jaw_forward":
            expected_components = ("skin", "lower_teeth", "tongue")
        elif recipe.anatomical_correction in tongue_corrections:
            expected_components = ("tongue",)
        else:
            expected_components = ("skin",)
        inactive_expected = [
            component
            for component in expected_components
            if component_metrics[component]["maximumDeltaMillimeters"] < 0.01
        ]
        if inactive_expected:
            raise ValueError(
                f"compact target {recipe.name} is inert on intended components "
                f"{inactive_expected}"
            )

        fingerprint = digest.hexdigest()
        if fingerprint in fingerprints:
            raise ValueError(
                f"compact targets {fingerprints[fingerprint]} and {recipe.name} "
                "have duplicate runtime-visible deltas"
            )
        fingerprints[fingerprint] = recipe.name
        target_diagnostics[recipe.name] = {
            "maximumDeltaMillimeters": maximum,
            "expectedComponents": list(expected_components),
            "components": component_metrics,
            "runtimeDeltaSha256": fingerprint,
        }
    oral_contract_payload = "".join(
        f"{name}:{target_diagnostics[name]['runtimeDeltaSha256']}\n"
        for name in ORAL_MORPH_TARGET_NAMES
    ).encode("utf-8")
    oral_contract_sha256 = hashlib.sha256(oral_contract_payload).hexdigest()
    return {
        "nontrivialTargetCount": len(target_diagnostics),
        "duplicateTargetCount": 0,
        "thresholdMillimeters": 0.01,
        "oralRuntimeContractSha256": oral_contract_sha256,
        "oralRuntimeContractMatchesBaseline": (
            oral_contract_sha256 == BASELINE_ORAL_RUNTIME_CONTRACT_SHA256
        ),
        "targets": target_diagnostics,
    }


def runtime_topology_sha256(
    model: object, neutral_vertices: np.ndarray
) -> str:
    """Fingerprint the exact exported primitive topology and vertex remaps."""
    digest = hashlib.sha256()
    for spec in PRIMITIVES:
        triangle_indices = primitive_triangle_indices(
            model, spec, neutral_vertices
        )
        triangles = np.asarray(model.triangles)[triangle_indices]
        triangle_uvs = np.asarray(model.triangle_uvs)[triangle_indices].copy()
        triangle_uvs[..., 1] = 1.0 - triangle_uvs[..., 1]
        source_vertices, local_triangles, _ = remap_triangles_with_uvs(
            triangles, triangle_uvs
        )
        digest.update(spec.name.encode("utf-8"))
        digest.update(
            np.asarray(source_vertices, dtype=np.int32).tobytes(order="C")
        )
        digest.update(
            np.asarray(local_triangles, dtype=np.uint16).tobytes(order="C")
        )
    return digest.hexdigest()


def _group_union(model: object, names: Iterable[str]) -> np.ndarray:
    result = np.empty(0, dtype=np.int32)
    for name in names:
        result = np.union1d(result, model.vertex_group_indices(name))
    return result.astype(np.int32, copy=False)


def audit_expression_target_isolation(
    model: object,
    neutral_vertices: np.ndarray,
    morph_positions: np.ndarray,
) -> dict[str, object]:
    """Prove regional affect isolation and joint-derived gaze direction."""
    eyes = model.vertex_group_indices("eyes")
    skin = model.vertex_group_indices("skin")
    oral = _group_union(
        model,
        (
            "upper_lip_region",
            "lower_lip_region",
            "mouth_sock",
            "upper_teeth_and_gums",
            "lower_teeth_and_gums",
            "tongue",
        ),
    )
    internal_components = _group_union(
        model,
        (
            "eyes",
            "upper_teeth_and_gums",
            "lower_teeth_and_gums",
            "tongue",
        ),
    )
    upper_teeth = model.vertex_group_indices("upper_teeth_and_gums")
    lower_teeth = model.vertex_group_indices("lower_teeth_and_gums")
    tongue = model.vertex_group_indices("tongue")
    all_vertices = np.arange(model.num_vertices, dtype=np.int32)
    outside_eyes = np.setdiff1d(all_vertices, eyes)
    mirrors = np.asarray(model.mirror_indices, dtype=np.int32)
    skin_mask = np.zeros(model.num_vertices, dtype=bool)
    skin_mask[skin] = True
    symmetric_skin = skin[skin_mask[mirrors[skin]]]
    mirror_sign = np.array([-1.0, 1.0, 1.0], dtype=np.float32)
    target_index = {
        recipe.name: index for index, recipe in enumerate(MORPH_RECIPES)
    }

    upper_face: dict[str, object] = {}
    for name in UPPER_FACE_MORPH_TARGET_NAMES:
        delta = morph_positions[target_index[name]]
        oral_lengths = np.linalg.norm(delta[oral], axis=1)
        ocular_lengths = np.linalg.norm(delta[eyes], axis=1)
        skin_lengths = np.linalg.norm(delta[skin], axis=1)
        metrics: dict[str, object] = {
            "oralMaximumDeltaMillimeters": float(
                oral_lengths.max(initial=0.0) * 1000.0
            ),
            "ocularMaximumDeltaMillimeters": float(
                ocular_lengths.max(initial=0.0) * 1000.0
            ),
            "skinMaximumDeltaMillimeters": float(
                skin_lengths.max(initial=0.0) * 1000.0
            ),
        }
        recipe = MORPH_RECIPES[target_index[name]]
        if recipe.geometry_scope == "upperFaceBilateral":
            mirror_error = (
                delta[symmetric_skin]
                - delta[mirrors[symmetric_skin]] * mirror_sign
            )
            mirror_lengths = np.linalg.norm(mirror_error, axis=1)
            metrics["bilateralSymmetryMaximumErrorMillimeters"] = float(
                mirror_lengths.max(initial=0.0) * 1000.0
            )
            metrics["bilateralSymmetryRmsErrorMillimeters"] = float(
                np.sqrt(np.mean(np.square(mirror_lengths))) * 1000.0
            )
        metrics["passed"] = bool(
            metrics["oralMaximumDeltaMillimeters"] <= 0.001
            and metrics["ocularMaximumDeltaMillimeters"] <= 0.001
            and metrics["skinMaximumDeltaMillimeters"] >= 0.01
            and metrics.get(
                "bilateralSymmetryMaximumErrorMillimeters", 0.0
            )
            <= 0.001
        )
        upper_face[name] = metrics

    lower_face: dict[str, object] = {}
    for name in LOWER_FACE_EXPRESSION_TARGET_NAMES:
        delta = morph_positions[target_index[name]]
        skin_lengths = np.linalg.norm(delta[skin], axis=1)
        oral_lengths = np.linalg.norm(delta[oral], axis=1)
        internal_lengths = np.linalg.norm(delta[internal_components], axis=1)
        upper_teeth_lengths = np.linalg.norm(delta[upper_teeth], axis=1)
        lower_teeth_lengths = np.linalg.norm(delta[lower_teeth], axis=1)
        tongue_lengths = np.linalg.norm(delta[tongue], axis=1)
        ocular_lengths = np.linalg.norm(delta[eyes], axis=1)
        mirror_error = (
            delta[symmetric_skin]
            - delta[mirrors[symmetric_skin]] * mirror_sign
        )
        mirror_lengths = np.linalg.norm(mirror_error, axis=1)
        metrics = {
            "skinMaximumDeltaMillimeters": float(
                skin_lengths.max(initial=0.0) * 1000.0
            ),
            "oralMaximumDeltaMillimeters": float(
                oral_lengths.max(initial=0.0) * 1000.0
            ),
            "internalComponentMaximumDeltaMillimeters": float(
                internal_lengths.max(initial=0.0) * 1000.0
            ),
            "ocularMaximumDeltaMillimeters": float(
                ocular_lengths.max(initial=0.0) * 1000.0
            ),
            "upperDentalMaximumDeltaMillimeters": float(
                upper_teeth_lengths.max(initial=0.0) * 1000.0
            ),
            "lowerDentalMaximumDeltaMillimeters": float(
                lower_teeth_lengths.max(initial=0.0) * 1000.0
            ),
            "tongueMaximumDeltaMillimeters": float(
                tongue_lengths.max(initial=0.0) * 1000.0
            ),
            "bilateralSymmetryMaximumErrorMillimeters": float(
                mirror_lengths.max(initial=0.0) * 1000.0
            ),
        }
        metrics["passed"] = bool(
            metrics["skinMaximumDeltaMillimeters"] >= 0.01
            and metrics["oralMaximumDeltaMillimeters"] >= 0.01
            and metrics["internalComponentMaximumDeltaMillimeters"] <= 0.001
            and metrics["bilateralSymmetryMaximumErrorMillimeters"] <= 0.001
        )
        lower_face[name] = metrics

    gaze_expectations = {
        "gazeLeft": (0, 1.0),
        "gazeRight": (0, -1.0),
        "gazeUp": (1, 1.0),
        "gazeDown": (1, -1.0),
    }
    gaze: dict[str, object] = {}
    irises = model.vertex_group_indices("irises")
    left_eye = model.vertex_group_indices("left_eye")
    right_eye = model.vertex_group_indices("right_eye")
    for name, (axis, sign) in gaze_expectations.items():
        delta = morph_positions[target_index[name]]
        iris_delta = delta[irises].mean(axis=0) * 1000.0
        eye_lengths = np.linalg.norm(delta[eyes], axis=1)
        outside_lengths = np.linalg.norm(delta[outside_eyes], axis=1)
        left_lengths = np.linalg.norm(delta[left_eye], axis=1)
        right_lengths = np.linalg.norm(delta[right_eye], axis=1)
        intended = float(iris_delta[axis])
        cross_axis = float(abs(iris_delta[1 - axis]))
        left_rms = float(np.sqrt(np.mean(np.square(left_lengths))) * 1000.0)
        right_rms = float(np.sqrt(np.mean(np.square(right_lengths))) * 1000.0)
        metrics = {
            "ocularMaximumDeltaMillimeters": float(
                eye_lengths.max(initial=0.0) * 1000.0
            ),
            "outsideOcularMaximumDeltaMillimeters": float(
                outside_lengths.max(initial=0.0) * 1000.0
            ),
            "irisMeanDeltaMillimeters": iris_delta.astype(float).tolist(),
            "intendedAxis": "x" if axis == 0 else "y",
            "intendedAxisDeltaMillimeters": intended,
            "crossAxisDeltaMillimeters": cross_axis,
            "leftEyeRmsDeltaMillimeters": left_rms,
            "rightEyeRmsDeltaMillimeters": right_rms,
        }
        metrics["passed"] = bool(
            metrics["ocularMaximumDeltaMillimeters"] >= 0.01
            and metrics["outsideOcularMaximumDeltaMillimeters"] <= 0.001
            and intended * sign >= 0.5
            and cross_axis <= 0.02
            and abs(left_rms - right_rms) <= 0.02
        )
        gaze[name] = metrics

    passed = (
        all(item["passed"] for item in upper_face.values())
        and all(item["passed"] for item in lower_face.values())
        and all(item["passed"] for item in gaze.values())
    )
    return {
        "passed": bool(passed),
        "thresholdsMillimeters": {
            "oralAndOcularIsolationMaximum": 0.001,
            "minimumIntendedMovement": 0.01,
            "gazeMinimumIrisAxisMovement": 0.5,
            "gazeMaximumCrossAxisMovement": 0.02,
            "gazeMaximumLeftRightRmsMismatch": 0.02,
            "bilateralSymmetryMaximumError": 0.001,
            "lowerFaceInternalIsolationMaximum": 0.001,
        },
        "upperFaceTargets": upper_face,
        "lowerFaceExpressionTargets": lower_face,
        "gazeTargets": gaze,
    }


class BinaryBuilder:
    def __init__(self, gltf: GLTF2) -> None:
        self.gltf = gltf
        self.data = bytearray()

    def _align(self) -> None:
        while len(self.data) % 4:
            self.data.append(0)

    def add_array(
        self,
        array: np.ndarray,
        *,
        component_type: int,
        accessor_type: str,
        target: int | None = ARRAY_BUFFER,
        include_bounds: bool = False,
    ) -> int:
        self._align()
        contiguous = np.ascontiguousarray(array)
        offset = len(self.data)
        payload = contiguous.tobytes(order="C")
        self.data.extend(payload)
        view = BufferView(
            buffer=0,
            byteOffset=offset,
            byteLength=len(payload),
            target=target,
        )
        self.gltf.bufferViews.append(view)
        view_index = len(self.gltf.bufferViews) - 1
        count = int(contiguous.shape[0])
        kwargs: dict[str, object] = {}
        if include_bounds:
            flattened = contiguous.reshape(count, -1)
            kwargs["min"] = flattened.min(axis=0).astype(float).tolist()
            kwargs["max"] = flattened.max(axis=0).astype(float).tolist()
        accessor = Accessor(
            bufferView=view_index,
            byteOffset=0,
            componentType=component_type,
            count=count,
            type=accessor_type,
            **kwargs,
        )
        self.gltf.accessors.append(accessor)
        return len(self.gltf.accessors) - 1


def load_decoder_samples(path: Path, layer_names: Iterable[str], labels: tuple[str, ...]) -> dict[str, np.ndarray]:
    """Run the small bundled Keras decoder directly in NumPy.

    The H5 contains a stack of dense ReLU layers.  Reading it directly avoids a
    heavyweight TensorFlow dependency while evaluating Google's exact weights.
    """
    layer_names = tuple(layer_names)
    with h5py.File(path, "r") as model:
        first_kernel = model[f"model_weights/{layer_names[0]}/{layer_names[0]}/kernel:0"]
        input_size = int(first_kernel.shape[0])
        label_count = len(labels)
        latent_count = input_size - label_count
        result: dict[str, np.ndarray] = {}
        for label_index, label in enumerate(labels):
            value = np.zeros((1, input_size), dtype=np.float32)
            value[0, latent_count + label_index] = 1.0
            for layer_index, layer in enumerate(layer_names):
                kernel = model[f"model_weights/{layer}/{layer}/kernel:0"][()]
                bias = model[f"model_weights/{layer}/{layer}/bias:0"][()]
                value = value @ kernel + bias
                if layer_index < len(layer_names) - 1:
                    value = np.maximum(value, 0.0)
            result[label] = value[0].astype(np.float32)
    return result


def compose_expression_vector(
    recipe: MorphRecipe,
    semantic: dict[str, np.ndarray],
    expression_dim: int,
) -> np.ndarray:
    """Compose one compact target from the pinned full GNM expression space."""
    vector = np.zeros(expression_dim, dtype=np.float32)
    for source, weight in recipe.sources:
        vector += semantic[source] * weight
    if recipe.source_regions is not None:
        region_mask = np.zeros(expression_dim, dtype=bool)
        for region_name in recipe.source_regions:
            start, end = GNM_EXPRESSION_REGIONS[region_name]
            region_mask[start:end] = True
        vector[~region_mask] = 0.0
    # Stay inside the documented typical coefficient range.
    return np.clip(vector, -3.0, 3.0)


def compose_joint_rotations(recipe: MorphRecipe, model: object) -> np.ndarray:
    """Build the exact GNM axis-angle pose used to bake one compact target."""
    rotations = np.zeros((model.num_joints, 3), dtype=np.float32)
    joint_indices = {
        str(name): index for index, name in enumerate(model.joint_names)
    }
    for joint_name, axis_angle in recipe.joint_rotations:
        if joint_name not in joint_indices:
            raise ValueError(f"GNM joint {joint_name!r} is unavailable")
        rotations[joint_indices[joint_name]] = np.asarray(
            axis_angle, dtype=np.float32
        )
    return rotations


def material(name: str, color: tuple[float, float, float, float], roughness: float, metallic: float = 0.0) -> Material:
    return Material(
        name=name,
        pbrMetallicRoughness=PbrMetallicRoughness(
            baseColorFactor=list(color),
            metallicFactor=metallic,
            roughnessFactor=roughness,
        ),
        doubleSided=False,
    )


def remap_triangles_with_uvs(
    triangles: np.ndarray, triangle_uvs: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Split only vertices that cross a UV seam.

    GNM explicitly warns that its convenience ``vertex_uvs`` accessor loses UV
    seams.  glTF, however, requires one UV per rendered vertex.  The stable key
    below combines the source vertex with the exact per-corner UV bit pattern,
    preserving every seam without expanding the whole mesh to non-indexed
    triangle soup.
    """
    flat_vertices = triangles.reshape(-1).astype(np.int32)
    flat_uvs = np.ascontiguousarray(triangle_uvs.reshape(-1, 2), dtype=np.float32)
    uv_bits = flat_uvs.view(np.uint32).reshape(-1, 2)
    keys = np.column_stack([flat_vertices.astype(np.int64), uv_bits.astype(np.int64)])
    unique_keys, first_indices, inverse = np.unique(
        keys, axis=0, return_index=True, return_inverse=True
    )
    del unique_keys
    source_vertices = flat_vertices[first_indices]
    local_uvs = flat_uvs[first_indices]
    if len(source_vertices) > np.iinfo(np.uint16).max:
        raise ValueError("primitive exceeds uint16 index capacity after UV seam split")
    local_triangles = inverse.reshape(-1, 3).astype(np.uint16)
    return source_vertices, local_triangles, local_uvs


def _smoothstep01(value: np.ndarray) -> np.ndarray:
    value = np.clip(value, 0.0, 1.0)
    return value * value * (3.0 - 2.0 * value)


def _bounded_move(current: np.ndarray, desired: np.ndarray, maximum: float) -> np.ndarray:
    delta = desired - current
    lengths = np.linalg.norm(delta, axis=-1, keepdims=True)
    scale = np.minimum(1.0, maximum / np.maximum(lengths, 1e-12))
    return current + delta * scale


def _symmetric_pairs(
    neutral: np.ndarray, indices: np.ndarray, tolerance: float = 0.0035
) -> tuple[list[tuple[int, int]], np.ndarray]:
    """Match a component's vertices across the sagittal plane.

    Neutral-shape asymmetry is preserved. Only morph *deltas* on matched
    vertices are averaged later. The loose 3.5 mm search tolerance avoids
    pairing separate components.
    """
    local = neutral[indices]
    positive = indices[local[:, 0] > 0.0006]
    negative = indices[local[:, 0] < -0.0006]
    center = indices[np.abs(local[:, 0]) <= 0.0006]
    if not len(positive) or not len(negative):
        return [], center
    mirrored = neutral[positive].copy()
    mirrored[:, 0] *= -1.0
    distances, matches = cKDTree(neutral[negative]).query(mirrored)
    candidates = sorted(
        zip(distances.tolist(), positive.tolist(), negative[matches].tolist())
    )
    used_negative: set[int] = set()
    pairs: list[tuple[int, int]] = []
    for distance, pos_index, neg_index in candidates:
        if distance > tolerance or neg_index in used_negative:
            continue
        pairs.append((pos_index, neg_index))
        used_negative.add(neg_index)
    return pairs, center


def _symmetrize_delta(
    delta: np.ndarray,
    pairs: list[tuple[int, int]],
    center_indices: np.ndarray,
) -> None:
    mirror = np.array([-1.0, 1.0, 1.0], dtype=np.float32)
    for positive, negative in pairs:
        average = 0.5 * (delta[positive] + delta[negative] * mirror)
        delta[positive] = average
        delta[negative] = average * mirror
    delta[center_indices, 0] = 0.0


def _symmetrize_canonical_delta(
    model: object, delta: np.ndarray, indices: np.ndarray
) -> None:
    """Symmetrize a delta with GNM's canonical vertex mirror mapping."""
    mirrors = np.asarray(model.mirror_indices, dtype=np.int32)
    included = np.zeros(model.num_vertices, dtype=bool)
    included[indices] = True
    mirror_sign = np.array([-1.0, 1.0, 1.0], dtype=np.float32)
    for index in indices:
        mirror = int(mirrors[index])
        if not included[mirror] or index > mirror:
            continue
        if index == mirror:
            delta[index, 0] = 0.0
            continue
        average = 0.5 * (delta[index] + delta[mirror] * mirror_sign)
        delta[index] = average
        delta[mirror] = average * mirror_sign


def _project_rigid(reference: np.ndarray, deformed: np.ndarray) -> np.ndarray:
    """Best-fit rigid transform, used because teeth themselves cannot deform."""
    reference_center = reference.mean(axis=0)
    deformed_center = deformed.mean(axis=0)
    covariance = (reference - reference_center).T @ (deformed - deformed_center)
    left, _, right = np.linalg.svd(covariance)
    rotation = right.T @ left.T
    if np.linalg.det(rotation) < 0.0:
        right[-1] *= -1.0
        rotation = right.T @ left.T
    return (reference - reference_center) @ rotation.T + deformed_center


def _seal_bilabial(model: object, target: np.ndarray) -> None:
    upper_indices = model.vertex_group_indices("upper_lip")
    lower_indices = model.vertex_group_indices("lower_lip")
    upper = target[upper_indices]
    lower = target[lower_indices]
    upper_mask = (np.abs(upper[:, 0]) < 0.017) & (
        upper[:, 1] < np.quantile(upper[:, 1], 0.60)
    )
    lower_cut = np.quantile(lower[:, 1], 0.40)
    lower_top = np.quantile(lower[:, 1], 0.88)
    lower_mask = (np.abs(lower[:, 0]) < 0.017) & (lower[:, 1] > lower_cut)
    upper_candidates = upper_indices[upper_mask]
    lower_candidates = lower_indices[lower_mask]
    tree = cKDTree(target[upper_candidates])
    distances, matches = tree.query(target[lower_candidates])
    center_weight = _smoothstep01(
        (0.017 - np.abs(target[lower_candidates, 0])) / 0.007
    )
    rim_weight = _smoothstep01(
        (target[lower_candidates, 1] - lower_cut)
        / max(lower_top - lower_cut, 1e-6)
    )
    desired_distance = 0.00032
    active = (distances > desired_distance) & (distances < 0.0026)
    if not np.any(active):
        return
    current = target[lower_candidates[active]]
    nearest = target[upper_candidates[matches[active]]]
    direction = current - nearest
    direction /= np.maximum(np.linalg.norm(direction, axis=1, keepdims=True), 1e-12)
    desired = nearest + direction * desired_distance
    moved = _bounded_move(current, desired, 0.0015)
    weight = (center_weight * rim_weight)[active, None]
    target[lower_candidates[active]] = current + (moved - current) * weight

    # An identity refit can leave isolated rim samples almost coincident even
    # when aggregate closure is correct. Repel only those sub-0.16 mm samples
    # to a 0.24 mm clearance so the surfaces contact without interpenetrating
    # or z-fighting. The largest possible adjustment is below 0.2 mm.
    for _ in range(3):
        tree = cKDTree(target[upper_candidates])
        distances, matches = tree.query(target[lower_candidates])
        too_close = distances < 0.00016
        if not np.any(too_close):
            break
        current = target[lower_candidates[too_close]]
        nearest = target[upper_candidates[matches[too_close]]]
        direction = current - nearest
        direction /= np.maximum(
            np.linalg.norm(direction, axis=1, keepdims=True), 1e-12
        )
        target[lower_candidates[too_close]] = nearest + direction * 0.00024


def _make_labiodental_contact(model: object, target: np.ndarray) -> None:
    lower_indices = model.vertex_group_indices("lower_lip")
    tooth_indices = model.vertex_group_indices("upper_teeth_and_gums")
    lower = target[lower_indices]
    teeth = target[tooth_indices]
    tooth_mask = (
        (np.abs(teeth[:, 0]) < 0.020)
        & (teeth[:, 2] > np.quantile(teeth[:, 2], 0.78))
        & (teeth[:, 1] < np.quantile(teeth[:, 1], 0.55))
    )
    lower_cut = np.quantile(lower[:, 1], 0.43)
    lower_top = np.quantile(lower[:, 1], 0.90)
    lip_mask = (np.abs(lower[:, 0]) < 0.018) & (lower[:, 1] > lower_cut)
    lip_candidates = lower_indices[lip_mask]
    tooth_candidates = tooth_indices[tooth_mask]
    tree = cKDTree(target[tooth_candidates])
    distances, matches = tree.query(target[lip_candidates])
    current = target[lip_candidates]
    nearest = target[tooth_candidates[matches]]
    direction = current - nearest
    direction /= np.maximum(np.linalg.norm(direction, axis=1, keepdims=True), 1e-12)
    # Keep the lower-lip wet edge just clear of the incisors. A 0.35 mm target
    # reaches compliant contact without pulling an already-contacting sample
    # through the tooth surface.
    desired_distance = 0.00035
    desired = nearest + direction * desired_distance
    moved = _bounded_move(current, desired, 0.0045)
    center_weight = _smoothstep01(
        (0.018 - np.abs(current[:, 0])) / 0.008
    )
    rim_weight = _smoothstep01(
        (current[:, 1] - lower_cut) / max(lower_top - lower_cut, 1e-6)
    )
    # Do not pull already-contacting points through the incisors.
    active = distances > desired_distance
    weight = (center_weight * rim_weight * active)[..., None]
    target[lip_candidates] = current + (moved - current) * weight


def _alveolar_tip_delta(model: object, target: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    tongue_indices = model.vertex_group_indices("tongue")
    palate_indices = model.vertex_group_indices("upper_teeth_and_gums")
    tongue = target[tongue_indices]
    palate = target[palate_indices]
    palate_mask = (
        (np.abs(palate[:, 0]) < 0.008)
        & (palate[:, 1] > 0.241)
        & (palate[:, 1] < 0.249)
        & (palate[:, 2] > 0.117)
        & (palate[:, 2] < 0.1235)
    )
    palate_candidates = palate[palate_mask]
    anchor_mask = (np.abs(tongue[:, 0]) < 0.006) & (
        tongue[:, 2] > np.quantile(tongue[:, 2], 0.97)
    )
    anchor = tongue[anchor_mask].mean(axis=0)
    # Select the lingual/alveolar side behind the upper incisors, rather than
    # the more anterior mouth-sock/lip wall.  Axis normalization keeps this
    # stable across the neutral head's small asymmetry.
    ideal = np.array([0.0, 0.245, 0.120], dtype=np.float32)
    scale = np.array([0.006, 0.004, 0.004], dtype=np.float32)
    target_point = palate_candidates[
        np.argmin(np.linalg.norm((palate_candidates - ideal) / scale, axis=1))
    ].copy()
    # Stay just inferior and posterior to the gum surface: compliant contact,
    # not a deliberate interpenetration target.
    target_point += np.array([0.0, -0.0006, -0.0007], dtype=np.float32)
    return target_point - anchor, tongue_indices


def _raise_tongue_tip(
    model: object,
    target: np.ndarray,
    amount: float,
    groove_depth: float = 0.0,
) -> None:
    displacement, tongue_indices = _alveolar_tip_delta(model, target)
    tongue = target[tongue_indices].copy()
    lower = np.quantile(tongue[:, 2], 0.50)
    anterior_weight = _smoothstep01(
        (tongue[:, 2] - lower) / max(tongue[:, 2].max() - lower, 1e-6)
    )
    center_weight = _smoothstep01(
        (0.020 - np.abs(tongue[:, 0])) / 0.010
    )
    weight = anterior_weight * center_weight
    tongue += weight[:, None] * displacement[None, :] * amount
    if groove_depth:
        groove = np.exp(-np.square(tongue[:, 0] / 0.0035)) * weight
        tongue[:, 1] -= groove * groove_depth
    target[tongue_indices] = tongue


def _constrain_dental_protrusion(
    model: object, target: np.ndarray, maximum_advance: float = 0.0015
) -> None:
    tongue_indices = model.vertex_group_indices("tongue")
    upper_teeth = target[model.vertex_group_indices("upper_teeth_and_gums")]
    lips = target[
        np.union1d(
            model.vertex_group_indices("upper_lip"),
            model.vertex_group_indices("lower_lip"),
        )
    ]
    tongue = target[tongue_indices].copy()
    desired = min(upper_teeth[:, 2].max() + 0.0055, lips[:, 2].max() - 0.0008)
    advance = float(
        np.clip(
            desired - tongue[:, 2].max(),
            -maximum_advance,
            maximum_advance,
        )
    )
    lower = np.quantile(tongue[:, 2], 0.55)
    weight = _smoothstep01(
        (tongue[:, 2] - lower) / max(tongue[:, 2].max() - lower, 1e-6)
    )
    weight *= _smoothstep01((0.020 - np.abs(tongue[:, 0])) / 0.010)
    tongue[:, 2] += weight * advance
    target[tongue_indices] = tongue


def _raise_velar_dorsum(
    model: object, target: np.ndarray, amount: float = 1.0
) -> None:
    tongue_indices = model.vertex_group_indices("tongue")
    tongue = target[tongue_indices].copy()
    posterior_weight = _smoothstep01((tongue[:, 2] - 0.060) / 0.025)
    posterior_weight *= _smoothstep01((0.120 - tongue[:, 2]) / 0.025)
    top_weight = _smoothstep01(
        (tongue[:, 1] - np.quantile(tongue[:, 1], 0.35))
        / max(
            np.quantile(tongue[:, 1], 0.88)
            - np.quantile(tongue[:, 1], 0.35),
            1e-6,
        )
    )
    center_weight = _smoothstep01(
        (0.023 - np.abs(tongue[:, 0])) / 0.008
    )
    weight = posterior_weight * top_weight * center_weight
    mouth_sock = target[model.vertex_group_indices("mouth_sock")]
    velum = mouth_sock[
        (mouth_sock[:, 2] > 0.070)
        & (mouth_sock[:, 2] < 0.115)
        & (mouth_sock[:, 1] > 0.250)
    ]
    dorsum_mask = (
        (tongue[:, 2] > 0.070)
        & (tongue[:, 2] < 0.115)
        & (tongue[:, 1] > np.quantile(tongue[:, 1], 0.55))
    )
    # GNM identities have meaningfully different neutral palate clearances.
    # Search a bounded displacement that approaches, but does not cross, a
    # 1.25 mm contact clearance instead of applying one identity-specific
    # constant.  This remains deterministic and operates on GNM correspondence.
    target_clearance = 0.00125
    velum_tree = cKDTree(velum)
    candidate_amplitudes = np.linspace(0.0, 0.020, 81, dtype=np.float32)
    candidate_clearances: list[float] = []
    for amplitude in candidate_amplitudes:
        candidate = tongue[dorsum_mask].copy()
        candidate[:, 1] += weight[dorsum_mask] * amplitude
        candidate[:, 2] += weight[dorsum_mask] * amplitude * (0.0015 / 0.0145)
        candidate_clearances.append(float(velum_tree.query(candidate)[0].min()))
    safe_candidates = [
        index
        for index, clearance in enumerate(candidate_clearances)
        if clearance >= target_clearance
    ]
    if safe_candidates:
        selected = min(
            safe_candidates,
            key=lambda index: candidate_clearances[index] - target_clearance,
        )
    else:
        selected = int(np.argmax(candidate_clearances))
    calibrated_amplitude = float(candidate_amplitudes[selected])
    tongue[:, 1] += weight * calibrated_amplitude * amount
    tongue[:, 2] += (
        weight * calibrated_amplitude * (0.0015 / 0.0145) * amount
    )
    target[tongue_indices] = tongue


def _make_lateral_tongue_contact(
    model: object,
    target: np.ndarray,
    amount: float = 1.0,
    channel_depth: float = 0.0028,
) -> None:
    """Raise the tongue apex for /l/ while preserving lateral air channels."""
    _raise_tongue_tip(model, target, amount)
    tongue_indices = model.vertex_group_indices("tongue")
    tongue = target[tongue_indices].copy()
    anterior = _smoothstep01(
        (tongue[:, 2] - np.quantile(tongue[:, 2], 0.64))
        / max(
            np.quantile(tongue[:, 2], 0.98)
            - np.quantile(tongue[:, 2], 0.64),
            1e-6,
        )
    )
    lateral = _smoothstep01((np.abs(tongue[:, 0]) - 0.006) / 0.004)
    lateral *= _smoothstep01((0.022 - np.abs(tongue[:, 0])) / 0.005)
    tongue[:, 1] -= anterior * lateral * channel_depth
    target[tongue_indices] = tongue


def _raise_tongue_blade(model: object, target: np.ndarray) -> None:
    tongue_indices = model.vertex_group_indices("tongue")
    tongue = target[tongue_indices].copy()
    front = _smoothstep01((tongue[:, 2] - 0.082) / 0.018)
    front *= _smoothstep01((0.120 - tongue[:, 2]) / 0.010)
    width = _smoothstep01((0.022 - np.abs(tongue[:, 0])) / 0.007)
    top = _smoothstep01(
        (tongue[:, 1] - np.quantile(tongue[:, 1], 0.28))
        / max(
            np.quantile(tongue[:, 1], 0.90)
            - np.quantile(tongue[:, 1], 0.28),
            1e-6,
        )
    )
    tongue[:, 1] += front * width * top * 0.0040
    target[tongue_indices] = tongue


def _groove_tongue_blade(
    model: object,
    target: np.ndarray,
    amount: float = 0.56,
    groove_depth: float = 0.0026,
) -> None:
    # A raised anterior blade with a shallow midsagittal channel supports
    # sibilants without forcing the apex through the alveolar surface.
    _raise_tongue_tip(
        model, target, amount, groove_depth=groove_depth
    )


def _raise_tongue_body(model: object, target: np.ndarray) -> None:
    tongue_indices = model.vertex_group_indices("tongue")
    tongue = target[tongue_indices].copy()
    longitudinal = _smoothstep01((tongue[:, 2] - 0.064) / 0.018)
    longitudinal *= _smoothstep01((0.108 - tongue[:, 2]) / 0.016)
    center = _smoothstep01((0.023 - np.abs(tongue[:, 0])) / 0.007)
    top = _smoothstep01(
        (tongue[:, 1] - np.quantile(tongue[:, 1], 0.22))
        / max(
            np.quantile(tongue[:, 1], 0.88)
            - np.quantile(tongue[:, 1], 0.22),
            1e-6,
        )
    )
    tongue[:, 1] += longitudinal * center * top * 0.0050
    target[tongue_indices] = tongue


def _lower_tongue_body(model: object, target: np.ndarray) -> None:
    tongue_indices = model.vertex_group_indices("tongue")
    tongue = target[tongue_indices].copy()
    longitudinal = _smoothstep01((tongue[:, 2] - 0.058) / 0.018)
    longitudinal *= _smoothstep01((0.110 - tongue[:, 2]) / 0.018)
    center = _smoothstep01((0.023 - np.abs(tongue[:, 0])) / 0.007)
    top = _smoothstep01(
        (tongue[:, 1] - np.quantile(tongue[:, 1], 0.25))
        / max(
            np.quantile(tongue[:, 1], 0.88)
            - np.quantile(tongue[:, 1], 0.25),
            1e-6,
        )
    )
    tongue[:, 1] -= longitudinal * center * top * 0.0035
    target[tongue_indices] = tongue


def _translate_tongue(model: object, target: np.ndarray, distance: float) -> None:
    tongue_indices = model.vertex_group_indices("tongue")
    tongue = target[tongue_indices].copy()
    anterior = _smoothstep01(
        (tongue[:, 2] - np.quantile(tongue[:, 2], 0.15))
        / max(
            np.quantile(tongue[:, 2], 0.95)
            - np.quantile(tongue[:, 2], 0.15),
            1e-6,
        )
    )
    # The posterior/root attachment moves less than the free blade and tip.
    tongue[:, 2] += distance * (0.35 + 0.65 * anterior)
    target[tongue_indices] = tongue


def _deform_jaw_forward(model: object, target: np.ndarray) -> None:
    """Create a compact mandible-protrusion control from GNM component geometry."""
    lower_arch = model.vertex_group_indices("lower_teeth_and_gums")
    target[lower_arch, 2] += 0.0030

    tongue_indices = model.vertex_group_indices("tongue")
    target[tongue_indices, 2] += 0.0015

    mouth_sock_indices = model.vertex_group_indices("mouth_sock")
    mouth_sock = target[mouth_sock_indices]
    lower_sock = _smoothstep01((0.240 - mouth_sock[:, 1]) / 0.018)
    target[mouth_sock_indices, 2] += lower_sock * 0.0025

    # Move the anterior lower lip/chin envelope with the dental arch.  The
    # coordinate masks are evaluated on canonical GNM correspondence and fade
    # to zero before the neck, cheek, and upper-lip regions.
    skin_indices = np.setdiff1d(
        model.vertex_group_indices("skin"), mouth_sock_indices
    )
    skin = target[skin_indices]
    below_mouth = _smoothstep01((0.243 - skin[:, 1]) / 0.018)
    above_chin = _smoothstep01((skin[:, 1] - 0.165) / 0.035)
    anterior = _smoothstep01((skin[:, 2] - 0.070) / 0.035)
    medial = _smoothstep01((0.072 - np.abs(skin[:, 0])) / 0.022)
    target[skin_indices, 2] += (
        below_mouth * above_chin * anterior * medial * 0.0027
    )


def _lip_control(model: object, target: np.ndarray, control: str) -> None:
    upper = model.vertex_group_indices("upper_lip")
    lower = model.vertex_group_indices("lower_lip")
    upper_region = model.vertex_group_indices("upper_lip_region")
    lower_region = model.vertex_group_indices("lower_lip_region")
    oral_region = np.union1d(upper_region, lower_region)

    if control == "upper_raise":
        points = target[upper_region]
        weight = _smoothstep01((0.035 - np.abs(points[:, 0])) / 0.012)
        target[upper_region, 1] += weight * 0.0020
        target[upper_region, 2] += weight * 0.0004
        return
    if control == "lower_depress":
        points = target[lower_region]
        weight = _smoothstep01((0.035 - np.abs(points[:, 0])) / 0.012)
        target[lower_region, 1] -= weight * 0.0020
        target[lower_region, 2] += weight * 0.0003
        return
    if control == "compress":
        target[upper, 1] -= 0.00075
        target[lower, 1] += 0.00075
        target[np.union1d(upper, lower), 2] -= 0.00055
        return
    if control in ("roll_in", "roll_out"):
        direction = -1.0 if control == "roll_in" else 1.0
        rim = np.union1d(upper, lower)
        target[rim, 2] += direction * 0.0016
        target[oral_region, 2] += direction * 0.00045
        if control == "roll_in":
            target[upper, 1] -= 0.00035
            target[lower, 1] += 0.00035
        return

    points = target[oral_region]
    corner = _smoothstep01((np.abs(points[:, 0]) - 0.012) / 0.010)
    corner *= _smoothstep01((0.038 - np.abs(points[:, 0])) / 0.008)
    if control == "corners_up":
        target[oral_region, 1] += corner * 0.0020
        return
    if control == "corners_down":
        target[oral_region, 1] -= corner * 0.0020
        return
    if control == "stretch":
        target[oral_region, 0] += (
            np.sign(points[:, 0]) * corner * 0.0030
        )
        return
    raise ValueError(f"unknown lip control {control}")


def apply_anatomical_corrections(
    model: object, vertices: np.ndarray
) -> tuple[np.ndarray, dict[str, object]]:
    """Apply bounded contact/rigidity corrections to sampled GNM poses.

    GNM supplies topology, identity, and the broad learned deformation.  These
    deterministic correctives compensate only for the fact that GNM's
    semantic expression labels are not a speech articulator model.  They do
    do not constitute a biomechanical or millimetric anatomy model.
    """
    corrected = np.asarray(vertices, dtype=np.float32).copy()
    neutral = corrected[0].copy()
    eye_indices = model.vertex_group_indices("eyes")
    skin_indices = model.vertex_group_indices("skin")
    upper_face_oral_lock_indices = _group_union(
        model,
        (
            "upper_lip_region",
            "lower_lip_region",
            "mouth_sock",
        ),
    )
    upper_teeth_indices = model.vertex_group_indices("upper_teeth_and_gums")
    lower_arch_indices = model.vertex_group_indices("lower_teeth_and_gums")
    lower_tooth_indices = model.vertex_group_indices(
        "lower_teeth_and_gums", "&teeth"
    )
    tongue_indices = model.vertex_group_indices("tongue")
    symmetry_groups = (
        np.union1d(
            model.vertex_group_indices("upper_lip_region"),
            np.union1d(
                model.vertex_group_indices("lower_lip_region"),
                model.vertex_group_indices("mouth_sock"),
            ),
        ),
        tongue_indices,
    )
    symmetry_maps = [_symmetric_pairs(neutral, group) for group in symmetry_groups]
    diagnostics: dict[str, object] = {}

    for target_index, recipe in enumerate(MORPH_RECIPES, start=1):
        before = corrected[target_index].copy()
        target = corrected[target_index]
        match recipe.anatomical_correction:
            case "bilabial_seal":
                _seal_bilabial(model, target)
            case "labiodental_contact":
                _make_labiodental_contact(model, target)
            case "alveolar_stop_contact":
                _raise_tongue_tip(model, target, 1.0)
            case "lateral_contact":
                _make_lateral_tongue_contact(model, target)
            case "lateral_pose":
                _make_lateral_tongue_contact(
                    model, target, amount=0.64, channel_depth=0.0018
                )
            case "dental_protrusion":
                _constrain_dental_protrusion(model, target)
            case "dental_contact":
                _constrain_dental_protrusion(
                    model, target, maximum_advance=0.015
                )
            case "sibilant_groove":
                _raise_tongue_tip(model, target, 0.60, groove_depth=0.0021)
            case "postalveolar_groove":
                _raise_tongue_tip(model, target, 0.48, groove_depth=0.0018)
            case "velar_contact":
                _raise_velar_dorsum(model, target)
            case "rhotic_bunch":
                _raise_tongue_tip(model, target, 0.48)
            case "jaw_forward":
                _deform_jaw_forward(model, target)
            case "upper_lip_raise":
                _lip_control(model, target, "upper_raise")
            case "lower_lip_depress":
                _lip_control(model, target, "lower_depress")
            case "lip_compress":
                _lip_control(model, target, "compress")
            case "lip_roll_in":
                _lip_control(model, target, "roll_in")
            case "lip_roll_out":
                _lip_control(model, target, "roll_out")
            case "corners_up":
                _lip_control(model, target, "corners_up")
            case "corners_down":
                _lip_control(model, target, "corners_down")
            case "mouth_stretch":
                _lip_control(model, target, "stretch")
            case "tongue_blade_up":
                _raise_tongue_blade(model, target)
            case "tongue_blade_groove":
                _groove_tongue_blade(model, target)
            case "tongue_blade_groove_pose":
                _groove_tongue_blade(
                    model, target, amount=0.34, groove_depth=0.0015
                )
            case "tongue_body_high":
                _raise_tongue_body(model, target)
            case "tongue_body_back":
                _raise_velar_dorsum(model, target, 0.46)
            case "tongue_body_low":
                _lower_tongue_body(model, target)
            case "tongue_forward":
                _translate_tongue(model, target, 0.0030)
            case "tongue_retract":
                _translate_tongue(model, target, -0.0030)
            case None:
                pass
            case _:
                raise ValueError(
                    f"unknown anatomical correction {recipe.anatomical_correction}"
                )

        # Speech targets do not rotate eyeballs.  The upper dental arch is
        # skull-fixed, and the lower teeth are projected to one rigid motion.
        if recipe.oral:
            target[eye_indices] = neutral[eye_indices]
            target[upper_teeth_indices] = neutral[upper_teeth_indices]
            delta = target - neutral
            for pairs, center in symmetry_maps:
                _symmetrize_delta(delta, pairs, center)
            target[:] = neutral + delta
            if recipe.anatomical_correction in ISOLATED_LIP_CORRECTIONS:
                # GNM lower-face PCA modes are statistically coupled and can
                # move the tongue/dental arch even after a lower-face region
                # mask. Atomic lip controls must remain layerable, so preserve
                # the learned skin deformation but lock internal articulators.
                target[tongue_indices] = neutral[tongue_indices]
                target[lower_arch_indices] = neutral[lower_arch_indices]
            target[lower_tooth_indices] = _project_rigid(
                neutral[lower_tooth_indices], target[lower_tooth_indices]
            )
        elif (
            recipe.geometry_scope is not None
            and recipe.geometry_scope.startswith("upperFace")
        ):
            # GNM's left/right eye expression partitions drive the upper skin
            # but not the eyeball components. Preserve only that skin delta and
            # hard-lock the complete perioral envelope as a second guard
            # against future semantic-decoder changes.
            delta = target - neutral
            if recipe.geometry_scope == "upperFaceBilateral":
                _symmetrize_canonical_delta(model, delta, skin_indices)
            target[:] = neutral
            target[skin_indices] = neutral[skin_indices] + delta[skin_indices]
            target[upper_face_oral_lock_indices] = neutral[
                upper_face_oral_lock_indices
            ]
        elif recipe.name == "smile":
            # The learned lower-face smile is useful for the skin and lip
            # corners, but its statistical coupling must never drag the rigid
            # dental arches or tongue. Oral contacts suppress this target at
            # runtime, while these locks keep the remaining blend anatomical.
            target[eye_indices] = neutral[eye_indices]
            target[upper_teeth_indices] = neutral[upper_teeth_indices]
            target[lower_arch_indices] = neutral[lower_arch_indices]
            target[tongue_indices] = neutral[tongue_indices]
        elif recipe.geometry_scope == "lowerFaceExpression":
            # Preserve GNM's learned skin motion, including the lips and
            # perioral tissue, while hard-locking eyeballs, teeth and tongue.
            # This makes the target safe to mix slowly around the independent
            # speech rig without pulling internal anatomy along with it.
            delta = target - neutral
            _symmetrize_canonical_delta(model, delta, skin_indices)
            target[:] = neutral
            target[skin_indices] = neutral[skin_indices] + delta[skin_indices]
        elif recipe.geometry_scope == "ocular":
            # Joint posing is already isolated by GNM skinning. Hard masking
            # makes the exported contract explicit and future-proof: gaze may
            # rotate only the two complete ocular components, never eyelids.
            posed_eyes = target[eye_indices].copy()
            target[:] = neutral
            target[eye_indices] = posed_eyes

        correction = target - before
        diagnostics[recipe.name] = {
            "anatomicalCorrection": recipe.anatomical_correction,
            "maxCorrectionMillimeters": float(
                np.linalg.norm(correction, axis=1).max() * 1000.0
            ),
        }

    diagnostics["symmetry"] = {
        "matchedPairs": int(sum(len(pairs) for pairs, _ in symmetry_maps)),
        "centerVertices": int(sum(len(center) for _, center in symmetry_maps)),
        "note": "Only oral morph deltas are symmetrized; neutral-shape asymmetry is preserved.",
    }
    return corrected, diagnostics


def build_asset(args: argparse.Namespace) -> dict[str, object]:
    gnm_root = args.gnm_root.resolve()
    sys.path.insert(0, str(gnm_root))
    from gnm.shape import gnm_numpy  # pylint: disable=import-outside-toplevel

    model = gnm_numpy.GNM.from_local(
        version=gnm_numpy.GNMMajorVersion.V3,
        variant=gnm_numpy.GNMVariant.HEAD,
    )
    data_root = gnm_root / "gnm" / "shape" / "data" / "semantic_sampler"
    identity = np.zeros(model.identity_dim, dtype=np.float32)
    identity_method = "GNM v3 population-mean identity (zero coefficients)"
    if identity.shape != (model.identity_dim,):
        raise ValueError(f"identity must have {model.identity_dim} coefficients; got {identity.shape}")

    semantic = load_decoder_samples(
        data_root / "expression_decoder_model.h5",
        ("dense_13", "dense_14", "dense_15", "dense_16", "dense_17"),
        EXPRESSION_LABELS,
    )
    expression_vectors: list[np.ndarray] = []
    joint_rotations: list[np.ndarray] = []
    for recipe in MORPH_RECIPES:
        expression_vectors.append(
            compose_expression_vector(recipe, semantic, model.expression_dim)
        )
        joint_rotations.append(compose_joint_rotations(recipe, model))

    expression_batch = np.stack(
        [np.zeros(model.expression_dim, dtype=np.float32), *expression_vectors], axis=0
    )
    rotation_batch = np.stack(
        [np.zeros((model.num_joints, 3), dtype=np.float32), *joint_rotations],
        axis=0,
    )
    identity_batch = np.broadcast_to(identity, (len(expression_batch), model.identity_dim))
    vertices = np.asarray(
        model(
            identity=identity_batch,
            expression=expression_batch,
            rotations=rotation_batch,
        ),
        dtype=np.float32,
    )
    vertices, anatomical_diagnostics = apply_anatomical_corrections(model, vertices)
    normals = np.asarray(model.compute_vertex_normals(vertices), dtype=np.float32)
    neutral_vertices = vertices[0]
    neutral_normals = normals[0]
    morph_positions = vertices[1:] - neutral_vertices[None, ...]
    morph_normals = normals[1:] - neutral_normals[None, ...]
    compact_target_audit = audit_compact_morph_targets(
        model, neutral_vertices, morph_positions
    )
    if not compact_target_audit["oralRuntimeContractMatchesBaseline"]:
        raise ValueError(
            "oral runtime target contract changed: "
            f"{compact_target_audit['oralRuntimeContractSha256']} != "
            f"{BASELINE_ORAL_RUNTIME_CONTRACT_SHA256}"
        )
    expression_isolation_audit = audit_expression_target_isolation(
        model, neutral_vertices, morph_positions
    )
    if not expression_isolation_audit["passed"]:
        raise ValueError("expression/gaze target isolation audit failed")
    topology_sha256 = runtime_topology_sha256(model, neutral_vertices)
    if topology_sha256 != RUNTIME_TOPOLOGY_SHA256:
        raise ValueError(
            "runtime topology contract changed: "
            f"{topology_sha256} != {RUNTIME_TOPOLOGY_SHA256}"
        )
    gltf = GLTF2(
        asset=Asset(version="2.0", generator="gnm-voice-lab/tools/export_gnm_asset.py"),
        scenes=[Scene(nodes=[0])],
        scene=0,
        nodes=[
            Node(
                mesh=0,
                name="GNM_Population_Mean_Head",
            )
        ],
        meshes=[],
        materials=[
            material("skin", (0.53, 0.29, 0.21, 1.0), 0.68),
            material("sclera", (0.84, 0.82, 0.75, 1.0), 0.34),
            material("iris", (0.23, 0.28, 0.25, 1.0), 0.38),
            material("pupil", (0.012, 0.012, 0.01, 1.0), 0.25),
            material("eye_interior", (0.055, 0.018, 0.015, 1.0), 0.80),
            material("upper_teeth", (0.72, 0.67, 0.54, 1.0), 0.50),
            material("lower_teeth", (0.72, 0.67, 0.54, 1.0), 0.50),
            material("tongue", (0.39, 0.09, 0.075, 1.0), 0.76),
        ],
        bufferViews=[],
        accessors=[],
        buffers=[Buffer(byteLength=0)],
    )
    binary = BinaryBuilder(gltf)
    primitives: list[Primitive] = []
    primitive_diagnostics: dict[str, object] = {}

    for spec in PRIMITIVES:
        triangle_indices = primitive_triangle_indices(model, spec, neutral_vertices)
        triangles = np.asarray(model.triangles)[triangle_indices]
        triangle_uvs = np.asarray(model.triangle_uvs)[triangle_indices].copy()
        triangle_uvs[..., 1] = 1.0 - triangle_uvs[..., 1]
        source_vertices, local_triangles, base_uv = remap_triangles_with_uvs(
            triangles, triangle_uvs
        )
        base_position = neutral_vertices[source_vertices]
        base_normal = neutral_normals[source_vertices]
        position_accessor = binary.add_array(
            base_position, component_type=FLOAT, accessor_type="VEC3", include_bounds=True
        )
        normal_accessor = binary.add_array(
            base_normal, component_type=FLOAT, accessor_type="VEC3"
        )
        uv_accessor = binary.add_array(base_uv, component_type=FLOAT, accessor_type="VEC2")
        oral_semantics_accessor: int | None = None
        if spec.name == "skin":
            # Preserve canonical GNM oral topology labels in COLOR_0. The skin
            # material does not consume vertex colors; Three.js reads RGB as
            # the lips and mouth sock, plus A as the perioral blend region.
            oral_semantics = np.stack(
                (
                    model.vertex_group("upper_lip")[source_vertices],
                    model.vertex_group("lower_lip")[source_vertices],
                    model.vertex_group("mouth_sock")[source_vertices],
                    np.maximum(
                        model.vertex_group("upper_lip_region")[source_vertices],
                        model.vertex_group("lower_lip_region")[source_vertices],
                    ),
                ),
                axis=1,
            ).astype(np.float32)
            oral_semantics_accessor = binary.add_array(
                oral_semantics,
                component_type=FLOAT,
                accessor_type="VEC4",
            )
        index_accessor = binary.add_array(
            local_triangles.reshape(-1),
            component_type=UNSIGNED_SHORT,
            accessor_type="SCALAR",
            target=ELEMENT_ARRAY_BUFFER,
        )
        targets: list[Attributes] = []
        for morph_index in range(len(MORPH_RECIPES)):
            target_position = binary.add_array(
                morph_positions[morph_index, source_vertices],
                component_type=FLOAT,
                accessor_type="VEC3",
                include_bounds=True,
            )
            target = Attributes(POSITION=target_position)
            if spec.include_morph_normals:
                target.NORMAL = binary.add_array(
                    morph_normals[morph_index, source_vertices],
                    component_type=FLOAT,
                    accessor_type="VEC3",
                )
            targets.append(target)
        primitive_attributes = Attributes(
            POSITION=position_accessor,
            NORMAL=normal_accessor,
            TEXCOORD_0=uv_accessor,
        )
        if oral_semantics_accessor is not None:
            primitive_attributes.COLOR_0 = oral_semantics_accessor
        primitives.append(
            Primitive(
                attributes=primitive_attributes,
                indices=index_accessor,
                material=spec.material,
                mode=4,
                targets=targets,
                extras={"component": spec.name},
            )
        )
        primitive_diagnostics[spec.name] = {
            "vertices": int(len(source_vertices)),
            "triangles": int(len(local_triangles)),
            "morphNormals": spec.include_morph_normals,
            "oralSemanticChannels": (
                ["upper_lip", "lower_lip", "mouth_sock", "perioral_region"]
                if oral_semantics_accessor is not None
                else []
            ),
        }

    target_names = [recipe.name for recipe in MORPH_RECIPES]
    gltf.meshes.append(
        Mesh(
            name="GNM_Population_Mean_SpeechRig",
            primitives=primitives,
            weights=[0.0] * len(target_names),
            extras={"targetNames": target_names},
        )
    )
    gltf.buffers[0].byteLength = len(binary.data)
    gltf.set_binary_blob(bytes(binary.data))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    gltf.save_binary(str(args.output))

    metadata: dict[str, object] = {
        "source": {
            "repository": "https://github.com/google/GNM",
            "commit": args.gnm_commit,
            "license": "Apache-2.0",
            "model": "GNM Head v3.0",
        },
        "identity": {
            "method": identity_method,
            "coefficientCount": int(len(identity)),
            "coefficientNorm": float(np.linalg.norm(identity)),
        },
        "topology": {
            "sourceVertices": int(model.num_vertices),
            "sourceTriangles": int(len(model.triangles)),
            "primitiveCount": len(primitives),
            "runtimeTopologySha256": topology_sha256,
            "runtimeTopologyMatchesBaseline": True,
            "boundsMeters": {
                "min": neutral_vertices.min(axis=0).astype(float).tolist(),
                "max": neutral_vertices.max(axis=0).astype(float).tolist(),
            },
            "primitives": primitive_diagnostics,
        },
        "rig": {
            "morphTargetCount": len(target_names),
            "targetNames": target_names,
            "oralTargetCount": len(ORAL_MORPH_TARGET_NAMES),
            "oralTargetNames": list(ORAL_MORPH_TARGET_NAMES),
            "upperFaceTargetNames": list(UPPER_FACE_MORPH_TARGET_NAMES),
            "lowerFaceExpressionTargetNames": list(
                LOWER_FACE_EXPRESSION_TARGET_NAMES
            ),
            "gazeTargetNames": list(GAZE_MORPH_TARGET_NAMES),
            "recipes": {
                recipe.name: dict(recipe.sources) for recipe in MORPH_RECIPES
            },
            "targetRoles": {
                recipe.name: (
                    "oral"
                    if recipe.oral
                    else "gaze"
                    if recipe.geometry_scope == "ocular"
                    else "expression"
                )
                for recipe in MORPH_RECIPES
            },
            "geometryScopes": {
                recipe.name: recipe.geometry_scope for recipe in MORPH_RECIPES
            },
            "correctiveTypes": {
                recipe.name: recipe.anatomical_correction
                for recipe in MORPH_RECIPES
            },
            "sourceRegionFilters": {
                recipe.name: (
                    list(recipe.source_regions)
                    if recipe.source_regions is not None
                    else None
                )
                for recipe in MORPH_RECIPES
            },
            "sourceJointRotationsRadians": {
                recipe.name: {
                    joint_name: list(axis_angle)
                    for joint_name, axis_angle in recipe.joint_rotations
                }
                for recipe in MORPH_RECIPES
                if recipe.joint_rotations
            },
            "modelDimensions": {
                "identityCoefficients": int(model.identity_dim),
                "expressionCoefficients": int(model.expression_dim),
                "joints": int(model.num_joints),
                "vertices": int(model.num_vertices),
                "triangles": int(len(model.triangles)),
            },
            "jointNames": [str(name) for name in model.joint_names],
            "sourceExpressionSpace": {
                "coefficientCount": int(model.expression_dim),
                "regions": {
                    name: {
                        "startInclusive": limits[0],
                        "endExclusive": limits[1],
                        "coefficientCount": limits[1] - limits[0],
                    }
                    for name, limits in GNM_EXPRESSION_REGIONS.items()
                },
                "semanticDecoderLabels": list(EXPRESSION_LABELS),
                "policy": (
                    "Evaluate Google's semantic decoder into the complete 383-value "
                    "region-partitioned GNM v3 expression vector offline, isolate named "
                    "controls to documented coefficient regions, and bake paired native "
                    "eye-joint rotations as ocular-only gaze morphs. The result is a "
                    "compact speech/performance basis with bounded contact correctives."
                ),
                "rawPcaPolicy": (
                    "The 150 lower-face and 32 tongue PCA axes are intentionally not "
                    "exposed one-for-one: upstream names are ordinal, not anatomical, "
                    "so arbitrary direct activation is not a stable speech-control API. "
                    "Semantic decoder poses and deterministic topology-aware correctives "
                    "provide interpretable controls while retaining GNM correspondence."
                ),
            },
            "compactTargetAudit": compact_target_audit,
            "expressionIsolationAudit": expression_isolation_audit,
            "anatomicalCorrections": anatomical_diagnostics,
            "note": (
                "Named targets start in GNM's learned expression space, then receive "
                "bounded deterministic speech-contact, symmetry, ocular-stability, and "
                "dental-rigidity corrections. Upper-face targets are oral-locked; gaze "
                "is baked from paired native eye-joint poses and hard-masked to ocular "
                "geometry. They are anatomically informed, not forensic."
            ),
        },
        "artifact": {
            "path": os.fspath(args.output),
            "bytes": int(args.output.stat().st_size),
        },
    }
    args.metadata.parent.mkdir(parents=True, exist_ok=True)
    args.metadata.write_text(json.dumps(metadata, indent=2) + "\n")
    return metadata


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--gnm-root",
        type=Path,
        default=Path("research/GNM"),
        help="Cloned google/GNM repository root",
    )
    parser.add_argument(
        "--gnm-commit",
        default="e26528fbf34d3fefd1a8f160d1b68641df78a586",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("demo/public/assets/models/gnm-neutral.glb"),
    )
    parser.add_argument(
        "--metadata",
        type=Path,
        default=Path("demo/public/assets/models/gnm-neutral.metadata.json"),
    )
    return parser.parse_args()


if __name__ == "__main__":
    payload = build_asset(parse_args())
    print(json.dumps(payload, indent=2))
