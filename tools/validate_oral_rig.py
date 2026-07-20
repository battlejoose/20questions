#!/usr/bin/env python3
"""Deterministically validate the GNM-derived speech/performance rig and GLBs.

The checks are geometry/anatomy regression tests, not a claim of forensic or
patient-specific accuracy.  Google GNM's oral component surfaces are open and
already intersect in neutral, so triangle-intersection counts are reported as
a baseline-relative penetration proxy instead of a signed-volume assertion.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
from typing import Any

# Keep the pinned upstream checkout reproducibly clean when its modules are
# imported for validation.
sys.dont_write_bytecode = True

import numpy as np
from pygltflib import FLOAT, GLTF2
from scipy.spatial import cKDTree
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_gnm_asset as exporter  # pylint: disable=wrong-import-position


def millimeters(value: float) -> float:
    return float(value * 1000.0)


def load_evaluated_rig(args: argparse.Namespace) -> tuple[Any, np.ndarray, dict[str, Any]]:
    gnm_root = args.gnm_root.resolve()
    sys.path.insert(0, str(gnm_root))
    from gnm.shape import gnm_landmarks, gnm_numpy  # pylint: disable=import-outside-toplevel

    model = gnm_numpy.GNM.from_local(
        version=gnm_numpy.GNMMajorVersion.V3,
        variant=gnm_numpy.GNMVariant.HEAD,
    )
    data_root = gnm_root / "gnm" / "shape" / "data" / "semantic_sampler"
    identity = np.zeros(model.identity_dim, dtype=np.float32)
    identity_method = "GNM v3 population-mean identity (zero coefficients)"
    semantic = exporter.load_decoder_samples(
        data_root / "expression_decoder_model.h5",
        ("dense_13", "dense_14", "dense_15", "dense_16", "dense_17"),
        exporter.EXPRESSION_LABELS,
    )
    expressions: list[np.ndarray] = [
        np.zeros(model.expression_dim, dtype=np.float32)
    ]
    rotations: list[np.ndarray] = [
        np.zeros((model.num_joints, 3), dtype=np.float32)
    ]
    for recipe in exporter.MORPH_RECIPES:
        expressions.append(
            exporter.compose_expression_vector(
                recipe, semantic, model.expression_dim
            )
        )
        rotations.append(exporter.compose_joint_rotations(recipe, model))
    expression_batch = np.stack(expressions)
    rotation_batch = np.stack(rotations)
    vertices = np.asarray(
        model(
            identity=np.broadcast_to(
                identity, (len(expression_batch), model.identity_dim)
            ),
            expression=expression_batch,
            rotations=rotation_batch,
        ),
        dtype=np.float32,
    )
    vertices, correction_diagnostics = exporter.apply_anatomical_corrections(
        model, vertices
    )
    configuration = gnm_landmarks.load_landmarks(
        gnm_landmarks.GNMLandmarksType.HEAD_SPARSE_68
    )
    landmarks = np.sum(
        vertices[:, configuration.indices, :]
        * configuration.weights[None, :, :, None],
        axis=2,
    )
    context = {
        "identityMethod": identity_method,
        "identityCoefficientNorm": float(np.linalg.norm(identity)),
        "correctionDiagnostics": correction_diagnostics,
        "landmarks": landmarks,
    }
    return model, vertices, context


def _contact_subset(model: Any, vertices: np.ndarray) -> dict[str, np.ndarray]:
    upper_lip = vertices[model.vertex_group_indices("upper_lip")]
    lower_lip = vertices[model.vertex_group_indices("lower_lip")]
    upper_rim = upper_lip[
        (np.abs(upper_lip[:, 0]) < 0.016)
        & (upper_lip[:, 1] < np.quantile(upper_lip[:, 1], 0.58))
    ]
    lower_rim = lower_lip[
        (np.abs(lower_lip[:, 0]) < 0.016)
        & (lower_lip[:, 1] > np.quantile(lower_lip[:, 1], 0.42))
    ]
    upper_teeth = vertices[model.vertex_group_indices("upper_teeth_and_gums")]
    incisor_patch = upper_teeth[
        (np.abs(upper_teeth[:, 0]) < 0.020)
        & (upper_teeth[:, 2] > np.quantile(upper_teeth[:, 2], 0.78))
        & (upper_teeth[:, 1] < np.quantile(upper_teeth[:, 1], 0.55))
    ]
    lower_contact = lower_lip[
        (np.abs(lower_lip[:, 0]) < 0.018)
        & (lower_lip[:, 1] > np.quantile(lower_lip[:, 1], 0.43))
    ]
    alveolar_patch = upper_teeth[
        (np.abs(upper_teeth[:, 0]) < 0.012)
        & (upper_teeth[:, 1] > 0.241)
        & (upper_teeth[:, 1] < 0.249)
        & (upper_teeth[:, 2] > 0.117)
        & (upper_teeth[:, 2] < 0.124)
    ]
    return {
        "upperLipRim": upper_rim,
        "lowerLipRim": lower_rim,
        "incisorPatch": incisor_patch,
        "lowerLipContact": lower_contact,
        "alveolarPatch": alveolar_patch,
    }


def _nearest_distances(first: np.ndarray, second: np.ndarray) -> np.ndarray:
    return cKDTree(second).query(first)[0]


def pose_metrics(
    model: Any, vertices: np.ndarray, landmarks: np.ndarray, neutral: np.ndarray
) -> dict[str, float]:
    contact = _contact_subset(model, vertices)
    lip_forward = _nearest_distances(
        contact["upperLipRim"], contact["lowerLipRim"]
    )
    lip_reverse = _nearest_distances(
        contact["lowerLipRim"], contact["upperLipRim"]
    )
    labiodental = _nearest_distances(
        contact["lowerLipContact"], contact["incisorPatch"]
    )
    tongue = vertices[model.vertex_group_indices("tongue")]
    tongue_front = tongue[tongue[:, 2] > np.quantile(tongue[:, 2], 0.85)]
    alveolar = _nearest_distances(tongue_front, contact["alveolarPatch"])
    upper_teeth = vertices[model.vertex_group_indices("upper_teeth_and_gums")]
    lips = vertices[
        np.union1d(
            model.vertex_group_indices("upper_lip"),
            model.vertex_group_indices("lower_lip"),
        )
    ]
    tongue_anterior = tongue[tongue[:, 2] > np.quantile(tongue[:, 2], 0.80)]
    groove_center = tongue_anterior[np.abs(tongue_anterior[:, 0]) < 0.002]
    groove_lateral = tongue_anterior[
        (np.abs(tongue_anterior[:, 0]) > 0.004)
        & (np.abs(tongue_anterior[:, 0]) < 0.009)
    ]
    mouth_sock = vertices[model.vertex_group_indices("mouth_sock")]
    dorsum = tongue[
        (tongue[:, 2] > 0.070)
        & (tongue[:, 2] < 0.115)
        & (tongue[:, 1] > np.quantile(tongue[:, 1], 0.55))
    ]
    velum = mouth_sock[
        (mouth_sock[:, 2] > 0.070)
        & (mouth_sock[:, 2] < 0.115)
        & (mouth_sock[:, 1] > 0.250)
    ]
    neutral_landmarks = neutral["landmarks"]
    neutral_vertices = neutral["vertices"]
    width = np.linalg.norm(landmarks[48, :2] - landmarks[54, :2])
    neutral_width = np.linalg.norm(
        neutral_landmarks[48, :2] - neutral_landmarks[54, :2]
    )
    protrusion = float(
        landmarks[[48, 51, 54, 57], 2].mean()
        - neutral_landmarks[[48, 51, 54, 57], 2].mean()
    )
    upper_lip_indices = model.vertex_group_indices("upper_lip")
    lower_lip_indices = model.vertex_group_indices("lower_lip")
    oral_lip_indices = np.union1d(upper_lip_indices, lower_lip_indices)
    neutral_lips = neutral_vertices[oral_lip_indices]
    corner_mask = np.abs(neutral_lips[:, 0]) > np.quantile(
        np.abs(neutral_lips[:, 0]), 0.72
    )
    lower_arch_indices = model.vertex_group_indices("lower_teeth_and_gums")
    neutral_tongue = neutral_vertices[model.vertex_group_indices("tongue")]
    tip_mask = neutral_tongue[:, 2] > np.quantile(neutral_tongue[:, 2], 0.82)
    blade_mask = (
        (neutral_tongue[:, 2] > 0.082)
        & (neutral_tongue[:, 2] < 0.116)
        & (neutral_tongue[:, 1] > np.quantile(neutral_tongue[:, 1], 0.45))
    )
    body_mask = (
        (neutral_tongue[:, 2] > 0.062)
        & (neutral_tongue[:, 2] < 0.106)
        & (neutral_tongue[:, 1] > np.quantile(neutral_tongue[:, 1], 0.45))
    )
    posterior_mask = (
        (neutral_tongue[:, 2] > 0.055)
        & (neutral_tongue[:, 2] < 0.095)
        & (neutral_tongue[:, 1] > np.quantile(neutral_tongue[:, 1], 0.45))
    )
    return {
        "innerLipApertureMm": millimeters(landmarks[62, 1] - landmarks[66, 1]),
        "outerLipApertureMm": millimeters(landmarks[51, 1] - landmarks[57, 1]),
        "mouthWidthMm": millimeters(width),
        "mouthWidthRatioToNeutral": float(width / neutral_width),
        "lipProtrusionFromNeutralMm": millimeters(protrusion),
        "lipRimMinimumMm": millimeters(min(lip_forward.min(), lip_reverse.min())),
        "lipRimCoverageWithin1_5mm": float(
            0.5
            * ((lip_forward < 0.0015).mean() + (lip_reverse < 0.0015).mean())
        ),
        "lowerLipToUpperIncisorMinimumMm": millimeters(labiodental.min()),
        "lowerLipIncisorCoverageWithin2mm": float((labiodental < 0.002).mean()),
        "tongueToAlveolarMinimumMm": millimeters(alveolar.min()),
        "tongueBeyondUpperIncisorMm": millimeters(
            tongue[:, 2].max() - upper_teeth[:, 2].max()
        ),
        "tongueBehindLipFrontMm": millimeters(lips[:, 2].max() - tongue[:, 2].max()),
        "anteriorTongueGrooveMm": millimeters(
            np.percentile(groove_lateral[:, 1], 90)
            - np.percentile(groove_center[:, 1], 90)
        ),
        "anteriorTongueLateralChannelMm": millimeters(
            np.percentile(groove_center[:, 1], 90)
            - np.percentile(groove_lateral[:, 1], 90)
        ),
        "posteriorDorsumToVelumMm": millimeters(
            _nearest_distances(dorsum, velum).min()
        ),
        "upperLipVerticalDeltaMm": millimeters(
            vertices[upper_lip_indices, 1].mean()
            - neutral_vertices[upper_lip_indices, 1].mean()
        ),
        "lowerLipVerticalDeltaMm": millimeters(
            vertices[lower_lip_indices, 1].mean()
            - neutral_vertices[lower_lip_indices, 1].mean()
        ),
        "mouthCornerVerticalDeltaMm": millimeters(
            vertices[oral_lip_indices[corner_mask], 1].mean()
            - neutral_lips[corner_mask, 1].mean()
        ),
        "mouthCornerLateralDeltaMm": millimeters(
            np.abs(vertices[oral_lip_indices[corner_mask], 0]).mean()
            - np.abs(neutral_lips[corner_mask, 0]).mean()
        ),
        "lowerDentalForwardDeltaMm": millimeters(
            vertices[lower_arch_indices, 2].mean()
            - neutral_vertices[lower_arch_indices, 2].mean()
        ),
        "tongueTipVerticalDeltaMm": millimeters(
            tongue[tip_mask, 1].mean() - neutral_tongue[tip_mask, 1].mean()
        ),
        "tongueBladeVerticalDeltaMm": millimeters(
            tongue[blade_mask, 1].mean()
            - neutral_tongue[blade_mask, 1].mean()
        ),
        "tongueBodyVerticalDeltaMm": millimeters(
            tongue[body_mask, 1].mean()
            - neutral_tongue[body_mask, 1].mean()
        ),
        "tonguePosteriorVerticalDeltaMm": millimeters(
            tongue[posterior_mask, 1].mean()
            - neutral_tongue[posterior_mask, 1].mean()
        ),
        "tongueMeanForwardDeltaMm": millimeters(
            tongue[:, 2].mean() - neutral_tongue[:, 2].mean()
        ),
    }


def expression_semantic_metrics(
    model: Any,
    vertices: np.ndarray,
    landmarks: np.ndarray,
    names: list[str],
) -> dict[str, dict[str, float]]:
    """Measure named upper-face controls in canonical GNM coordinates."""

    def eye_aperture(points: np.ndarray) -> float:
        return 0.5 * (
            points[[37, 38], 1].mean()
            - points[[40, 41], 1].mean()
            + points[[43, 44], 1].mean()
            - points[[46, 47], 1].mean()
        )

    def inner_brow_gap(points: np.ndarray) -> float:
        return float(abs(points[21, 0] - points[22, 0]))

    neutral_landmarks = landmarks[0]
    neutral_aperture = eye_aperture(neutral_landmarks)
    neutral_gap = inner_brow_gap(neutral_landmarks)
    cheek_indices = model.vertex_group_indices(
        "left_zygomatic_region", "right_zygomatic_region"
    )
    result: dict[str, dict[str, float]] = {}
    for name in (
        "browLift",
        "browFurrow",
        "eyeWiden",
        "eyeSquint",
        "cheekRaise",
    ):
        index = names.index(name)
        points = landmarks[index]
        result[name] = {
            "eyeApertureDeltaMillimeters": millimeters(
                eye_aperture(points) - neutral_aperture
            ),
            "meanBrowVerticalDeltaMillimeters": millimeters(
                points[17:27, 1].mean()
                - neutral_landmarks[17:27, 1].mean()
            ),
            "innerBrowGapDeltaMillimeters": millimeters(
                inner_brow_gap(points) - neutral_gap
            ),
            "meanZygomaticVerticalDeltaMillimeters": millimeters(
                (
                    vertices[index, cheek_indices, 1]
                    - vertices[0, cheek_indices, 1]
                ).mean()
            ),
        }
    return result


def performance_profile_metrics(
    model: Any,
    vertices: np.ndarray,
    landmarks: np.ndarray,
    names: list[str],
) -> dict[str, dict[str, float]]:
    """Validate perceptible signed motion for the production affect blends."""

    profiles = {
        "warm": {
            "browLift": 0.18 * 0.96,
            "eyeWiden": 0.025 * 0.96,
            "eyeSquint": 0.24 * 0.96,
            "cheekRaise": 0.82 * 0.96,
            "smileMouth": 0.72 * 0.96,
        },
        "surprise": {
            "browLift": 0.88 * 0.96,
            "eyeWiden": 0.92 * 0.96,
            "cheekRaise": 0.08 * 0.96,
            "surpriseMouth": 0.62 * 0.96,
        },
        "question": {
            "browLift": 0.62 * 0.96,
            "eyeWiden": 0.36 * 0.96,
            "cheekRaise": 0.07 * 0.96,
            "curiosityMouth": 0.38 * 0.96,
        },
        "concerned": {
            "browConcern": 0.68 * 0.96,
            "browLift": 0.16 * 0.96,
            "browFurrow": 0.55 * 0.96,
            "eyeSquint": 0.23 * 0.96,
            "cheekRaise": 0.05 * 0.96,
            "concernMouth": 0.58 * 0.96,
        },
        "emphatic": {
            "browConcern": 0.15 * 0.96,
            "browFurrow": 0.72 * 0.96,
            "eyeSquint": 0.22 * 0.96,
            "cheekRaise": 0.05 * 0.96,
            "emphasisMouth": 0.46 * 0.96,
        },
    }
    neutral_vertices = vertices[0]
    neutral_landmarks = landmarks[0]
    skin_indices = model.vertex_group_indices("skin")
    eye_indices = model.vertex_group_indices("eyes")
    upper_teeth = model.vertex_group_indices("upper_teeth_and_gums")
    lower_teeth = model.vertex_group_indices("lower_teeth_and_gums")
    tongue = model.vertex_group_indices("tongue")

    def eye_aperture(points: np.ndarray) -> float:
        return 0.5 * (
            points[[37, 38], 1].mean()
            - points[[40, 41], 1].mean()
            + points[[43, 44], 1].mean()
            - points[[46, 47], 1].mean()
        )

    result: dict[str, dict[str, float]] = {}
    for profile_name, weights in profiles.items():
        profile_vertices = neutral_vertices.copy()
        profile_landmarks = neutral_landmarks.copy()
        for target_name, weight in weights.items():
            index = names.index(target_name)
            profile_vertices += (vertices[index] - neutral_vertices) * weight
            profile_landmarks += (landmarks[index] - neutral_landmarks) * weight
        protected_maximum = max(
            np.linalg.norm(
                profile_vertices[group] - neutral_vertices[group], axis=1
            ).max(initial=0.0)
            for group in (eye_indices, upper_teeth, lower_teeth, tongue)
        )
        oral_landmark_maximum = np.linalg.norm(
            profile_landmarks[48:68] - neutral_landmarks[48:68], axis=1
        ).max(initial=0.0)
        result[profile_name] = {
            "skinMaximumDeltaMillimeters": millimeters(
                np.linalg.norm(
                    profile_vertices[skin_indices] - neutral_vertices[skin_indices],
                    axis=1,
                ).max(initial=0.0)
            ),
            "protectedComponentMaximumDeltaMillimeters": millimeters(
                protected_maximum
            ),
            "oralLandmarkMaximumDeltaMillimeters": millimeters(
                oral_landmark_maximum
            ),
            "mouthCornerVerticalDeltaMillimeters": millimeters(
                profile_landmarks[[48, 54], 1].mean()
                - neutral_landmarks[[48, 54], 1].mean()
            ),
            "innerLipApertureDeltaMillimeters": millimeters(
                (profile_landmarks[62, 1] - profile_landmarks[66, 1])
                - (neutral_landmarks[62, 1] - neutral_landmarks[66, 1])
            ),
            "mouthWidthDeltaMillimeters": millimeters(
                np.linalg.norm(profile_landmarks[48, :2] - profile_landmarks[54, :2])
                - np.linalg.norm(neutral_landmarks[48, :2] - neutral_landmarks[54, :2])
            ),
            "lipForwardDeltaMillimeters": millimeters(
                profile_landmarks[48:68, 2].mean()
                - neutral_landmarks[48:68, 2].mean()
            ),
            "meanBrowVerticalDeltaMillimeters": millimeters(
                profile_landmarks[17:27, 1].mean()
                - neutral_landmarks[17:27, 1].mean()
            ),
            "eyeApertureDeltaMillimeters": millimeters(
                eye_aperture(profile_landmarks)
                - eye_aperture(neutral_landmarks)
            ),
            "innerBrowGapDeltaMillimeters": millimeters(
                abs(profile_landmarks[21, 0] - profile_landmarks[22, 0])
                - abs(neutral_landmarks[21, 0] - neutral_landmarks[22, 0])
            ),
        }
    return result


def speech_expression_compatibility_metrics(
    model: Any,
    vertices: np.ndarray,
    landmarks: np.ndarray,
    names: list[str],
) -> dict[str, dict[str, Any]]:
    """Measure the exact lower-face retention policy used during hard contacts.

    Speech and affect targets are additive in Three.js.  Reconstructing those
    blends here catches the two failure modes that visual affect tuning can
    otherwise hide: an expression erasing a consonant contact, or contact
    suppression erasing the expression entirely.
    """

    blends = {
        "warmBilabial": ("contactBilabial", "smileMouth", 0.72 * 0.96 * 0.12),
        "warmLabiodental": (
            "contactLabiodental",
            "smileMouth",
            0.72 * 0.96 * 0.12,
        ),
        "surpriseBilabial": (
            "contactBilabial",
            "surpriseMouth",
            0.62 * 0.96 * 0.04,
        ),
        "concernBilabial": (
            "contactBilabial",
            "concernMouth",
            0.58 * 0.96 * 0.62,
        ),
        "questionBilabial": (
            "contactBilabial",
            "curiosityMouth",
            0.38 * 0.96 * 0.24,
        ),
        "emphaticBilabial": (
            "contactBilabial",
            "emphasisMouth",
            0.46 * 0.96 * 0.40,
        ),
    }
    neutral_vertices = vertices[0]
    neutral_landmarks = landmarks[0]
    neutral_context = {
        "vertices": neutral_vertices,
        "landmarks": neutral_landmarks,
    }
    result: dict[str, dict[str, Any]] = {}
    for blend_name, (contact_name, expression_name, expression_weight) in blends.items():
        contact_index = names.index(contact_name)
        expression_index = names.index(expression_name)
        contact_vertices = vertices[contact_index]
        contact_landmarks = landmarks[contact_index]
        combined_vertices = contact_vertices + (
            vertices[expression_index] - neutral_vertices
        ) * expression_weight
        combined_landmarks = contact_landmarks + (
            landmarks[expression_index] - neutral_landmarks
        ) * expression_weight
        combined_metrics = pose_metrics(
            model, combined_vertices, combined_landmarks, neutral_context
        )
        contact_metrics = pose_metrics(
            model, contact_vertices, contact_landmarks, neutral_context
        )
        result[blend_name] = {
            "contactTarget": contact_name,
            "expressionTarget": expression_name,
            "effectiveExpressionWeight": expression_weight,
            "lipRimMinimumMillimeters": combined_metrics["lipRimMinimumMm"],
            "lipRimCoverageWithin1_5Millimeters": combined_metrics[
                "lipRimCoverageWithin1_5mm"
            ],
            "lowerLipToUpperIncisorMinimumMillimeters": combined_metrics[
                "lowerLipToUpperIncisorMinimumMm"
            ],
            "lowerLipIncisorCoverageWithin2Millimeters": combined_metrics[
                "lowerLipIncisorCoverageWithin2mm"
            ],
            "innerLipApertureMillimeters": combined_metrics[
                "innerLipApertureMm"
            ],
            "expressionOralLandmarkMaximumDeltaMillimeters": millimeters(
                np.linalg.norm(
                    combined_landmarks[48:68] - contact_landmarks[48:68], axis=1
                ).max(initial=0.0)
            ),
            "expressionMouthCornerVerticalDeltaMillimeters": millimeters(
                combined_landmarks[[48, 54], 1].mean()
                - contact_landmarks[[48, 54], 1].mean()
            ),
            "expressionMouthWidthDeltaMillimeters": millimeters(
                np.linalg.norm(
                    combined_landmarks[48, :2] - combined_landmarks[54, :2]
                )
                - np.linalg.norm(
                    contact_landmarks[48, :2] - contact_landmarks[54, :2]
                )
            ),
            "contactLipRimMinimumMillimeters": contact_metrics[
                "lipRimMinimumMm"
            ],
            "contactLipRimCoverageWithin1_5Millimeters": contact_metrics[
                "lipRimCoverageWithin1_5mm"
            ],
            "contactLowerLipToUpperIncisorMinimumMillimeters": contact_metrics[
                "lowerLipToUpperIncisorMinimumMm"
            ],
            "contactLowerLipIncisorCoverageWithin2Millimeters": contact_metrics[
                "lowerLipIncisorCoverageWithin2mm"
            ],
        }
    return result


def best_rigid_residual(reference: np.ndarray, target: np.ndarray) -> tuple[float, float]:
    projected = exporter._project_rigid(reference, target)  # pylint: disable=protected-access
    errors = np.linalg.norm(projected - target, axis=1)
    return millimeters(np.sqrt(np.mean(np.square(errors)))), millimeters(errors.max())


def symmetry_error(model: Any, neutral: np.ndarray, target: np.ndarray) -> tuple[float, float]:
    groups = (
        np.union1d(
            model.vertex_group_indices("upper_lip_region"),
            np.union1d(
                model.vertex_group_indices("lower_lip_region"),
                model.vertex_group_indices("mouth_sock"),
            ),
        ),
        model.vertex_group_indices("tongue"),
    )
    mirror = np.array([-1.0, 1.0, 1.0], dtype=np.float32)
    errors: list[float] = []
    delta = target - neutral
    for group in groups:
        pairs, _ = exporter._symmetric_pairs(  # pylint: disable=protected-access
            neutral, group
        )
        for positive, negative in pairs:
            errors.append(float(np.linalg.norm(delta[positive] - delta[negative] * mirror)))
    array = np.asarray(errors)
    return millimeters(np.sqrt(np.mean(np.square(array)))), millimeters(array.max())


def component_mesh(model: Any, vertices: np.ndarray, group: str) -> trimesh.Trimesh:
    faces = np.asarray(model.triangles)[model.triangle_indices_for_group(group)]
    source_indices, inverse = np.unique(faces, return_inverse=True)
    return trimesh.Trimesh(
        vertices=vertices[source_indices],
        faces=inverse.reshape(-1, 3),
        process=False,
    )


def edge_surface_intersections(first: trimesh.Trimesh, second: trimesh.Trimesh) -> int:
    edges = first.edges_unique
    origins = first.vertices[edges[:, 0]]
    ends = first.vertices[edges[:, 1]]
    vectors = ends - origins
    lengths = np.linalg.norm(vectors, axis=1)
    locations, ray_indices, _ = second.ray.intersects_location(
        origins, vectors / lengths[:, None], multiple_hits=True
    )
    if not len(locations):
        return 0
    hit_distances = np.linalg.norm(locations - origins[ray_indices], axis=1)
    return int(
        np.sum(
            (hit_distances > 1e-7)
            & (hit_distances < lengths[ray_indices] - 1e-7)
        )
    )


def intersection_proxy(model: Any, vertices: np.ndarray) -> dict[str, int]:
    tongue = component_mesh(model, vertices, "tongue")
    result: dict[str, int] = {}
    for group in (
        "upper_teeth_and_gums",
        "lower_teeth_and_gums",
        "mouth_sock",
    ):
        component = component_mesh(model, vertices, group)
        result[group] = edge_surface_intersections(
            tongue, component
        ) + edge_surface_intersections(component, tongue)
    return result


def read_accessor(gltf: GLTF2, accessor_index: int) -> np.ndarray:
    accessor = gltf.accessors[accessor_index]
    if accessor.componentType != FLOAT:
        raise ValueError(f"expected FLOAT accessor, got {accessor.componentType}")
    components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[accessor.type]
    view = gltf.bufferViews[accessor.bufferView]
    offset = int((view.byteOffset or 0) + (accessor.byteOffset or 0))
    expected_stride = components * np.dtype(np.float32).itemsize
    if view.byteStride not in (None, expected_stride):
        raise ValueError(f"unsupported interleaved accessor stride {view.byteStride}")
    count = int(accessor.count) * components
    return np.frombuffer(
        gltf.binary_blob(), dtype=np.float32, count=count, offset=offset
    ).copy().reshape(int(accessor.count), components)


def validate_glb_parity(
    model: Any, vertices: np.ndarray, glb_path: Path
) -> dict[str, Any]:
    gltf = GLTF2().load_binary(str(glb_path))
    expected_names = [recipe.name for recipe in exporter.MORPH_RECIPES]
    actual_names = list(gltf.meshes[0].extras["targetNames"])
    max_position_error = 0.0
    max_morph_error = 0.0
    primitive_results: dict[str, Any] = {}
    neutral = vertices[0]
    deltas = vertices[1:] - neutral[None, ...]
    for spec, primitive in zip(exporter.PRIMITIVES, gltf.meshes[0].primitives):
        triangle_indices = exporter.primitive_triangle_indices(model, spec, neutral)
        triangles = np.asarray(model.triangles)[triangle_indices]
        triangle_uvs = np.asarray(model.triangle_uvs)[triangle_indices].copy()
        triangle_uvs[..., 1] = 1.0 - triangle_uvs[..., 1]
        source_vertices, _, _ = exporter.remap_triangles_with_uvs(
            triangles, triangle_uvs
        )
        base = read_accessor(gltf, primitive.attributes.POSITION)
        position_error = float(np.max(np.abs(base - neutral[source_vertices])))
        primitive_morph_error = 0.0
        for target_index, attributes in enumerate(primitive.targets):
            position_accessor = (
                attributes["POSITION"]
                if isinstance(attributes, dict)
                else attributes.POSITION
            )
            actual = read_accessor(gltf, position_accessor)
            expected = deltas[target_index, source_vertices]
            primitive_morph_error = max(
                primitive_morph_error, float(np.max(np.abs(actual - expected)))
            )
        max_position_error = max(max_position_error, position_error)
        max_morph_error = max(max_morph_error, primitive_morph_error)
        primitive_results[spec.name] = {
            "positionMaxAbsErrorMeters": position_error,
            "morphMaxAbsErrorMeters": primitive_morph_error,
            "vertexCount": int(len(source_vertices)),
        }
    return {
        "targetNamesMatch": actual_names == expected_names,
        "primitiveCount": len(gltf.meshes[0].primitives),
        "maxPositionAbsErrorMeters": max_position_error,
        "maxMorphAbsErrorMeters": max_morph_error,
        "primitives": primitive_results,
        "sha256": hashlib.sha256(glb_path.read_bytes()).hexdigest(),
        "bytes": glb_path.stat().st_size,
    }


def validate_metadata(
    path: Path,
    model: Any,
    compact_target_audit: dict[str, Any],
    expression_isolation_audit: dict[str, Any],
    topology_sha256: str,
    glb: dict[str, Any],
) -> dict[str, Any]:
    payload = json.loads(path.read_text())
    rig = payload.get("rig", {})
    topology = payload.get("topology", {})
    expected_names = [recipe.name for recipe in exporter.MORPH_RECIPES]
    expected_dimensions = {
        "identityCoefficients": int(model.identity_dim),
        "expressionCoefficients": int(model.expression_dim),
        "joints": int(model.num_joints),
        "vertices": int(model.num_vertices),
        "triangles": int(len(model.triangles)),
    }
    checks = {
        "targetNamesMatch": rig.get("targetNames") == expected_names,
        "oralTargetNamesMatch": rig.get("oralTargetNames")
        == list(exporter.ORAL_MORPH_TARGET_NAMES),
        "upperFaceTargetNamesMatch": rig.get("upperFaceTargetNames")
        == list(exporter.UPPER_FACE_MORPH_TARGET_NAMES),
        "lowerFaceExpressionTargetNamesMatch": rig.get(
            "lowerFaceExpressionTargetNames"
        )
        == list(exporter.LOWER_FACE_EXPRESSION_TARGET_NAMES),
        "gazeTargetNamesMatch": rig.get("gazeTargetNames")
        == list(exporter.GAZE_MORPH_TARGET_NAMES),
        "modelDimensionsMatch": rig.get("modelDimensions")
        == expected_dimensions,
        "jointNamesMatch": rig.get("jointNames")
        == [str(name) for name in model.joint_names],
        "topologySha256Matches": topology.get("runtimeTopologySha256")
        == topology_sha256,
        "oralContractSha256Matches": rig.get("compactTargetAudit", {}).get(
            "oralRuntimeContractSha256"
        )
        == compact_target_audit["oralRuntimeContractSha256"],
        "expressionIsolationAuditMatches": rig.get(
            "expressionIsolationAudit"
        )
        == expression_isolation_audit,
        "artifactByteCountMatches": payload.get("artifact", {}).get("bytes")
        == glb["bytes"],
    }
    return {
        "path": str(path),
        "checks": checks,
        "passed": all(checks.values()),
    }


def validate_runtime_manifest(path: Path) -> dict[str, Any]:
    """Validate compressed-asset contracts that do not require decompression."""
    gltf = GLTF2().load_binary(str(path))
    expected_names = [recipe.name for recipe in exporter.MORPH_RECIPES]
    names = list(gltf.meshes[0].extras["targetNames"])
    primitives = gltf.meshes[0].primitives
    target_slots = sum(len(primitive.targets) for primitive in primitives)
    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "targetNamesMatch": names == expected_names,
        "namedMorphTargets": len(names),
        "primitiveCount": len(primitives),
        "primitiveMorphSlots": target_slots,
        "passed": bool(
            names == expected_names
            and len(primitives) == len(exporter.PRIMITIVES)
            and target_slots
            == len(exporter.PRIMITIVES) * len(exporter.MORPH_RECIPES)
            and path.stat().st_size <= 2 * 1024 * 1024
        ),
    }


def add_check(
    checks: list[dict[str, Any]],
    name: str,
    target: str,
    value: float | bool,
    expectation: str,
    passed: bool,
    unit: str = "",
) -> None:
    checks.append(
        {
            "name": name,
            "target": target,
            "value": value,
            "unit": unit,
            "expectation": expectation,
            "passed": bool(passed),
        }
    )


def build_report(args: argparse.Namespace) -> dict[str, Any]:
    model, vertices, context = load_evaluated_rig(args)
    landmarks = context.pop("landmarks")
    names = ["neutral", *[recipe.name for recipe in exporter.MORPH_RECIPES]]
    neutral_context = {"landmarks": landmarks[0], "vertices": vertices[0]}
    metrics = {
        name: pose_metrics(model, vertices[index], landmarks[index], neutral_context)
        for index, name in enumerate(names)
    }
    neutral = vertices[0]
    eye_indices = model.vertex_group_indices("eyes")
    upper_teeth_indices = model.vertex_group_indices("upper_teeth_and_gums")
    lower_tooth_indices = model.vertex_group_indices(
        "lower_teeth_and_gums", "&teeth"
    )
    global_metrics: dict[str, Any] = {
        "allFinite": bool(np.isfinite(vertices).all()),
        "maximumMorphDisplacementMm": millimeters(
            np.linalg.norm(vertices[1:] - neutral[None, ...], axis=2).max()
        ),
        "maximumOralEyeDriftMm": 0.0,
        "maximumOralUpperTeethDriftMm": 0.0,
        "maximumLowerTeethRigidRmsMm": 0.0,
        "maximumLowerTeethRigidMaxMm": 0.0,
        "maximumOralSymmetryRmsMm": 0.0,
        "maximumOralSymmetryMaxMm": 0.0,
    }
    oral_pose_indices = [
        index
        for index, recipe in enumerate(exporter.MORPH_RECIPES, start=1)
        if recipe.oral
    ]
    for index in oral_pose_indices:
        global_metrics["maximumOralEyeDriftMm"] = max(
            global_metrics["maximumOralEyeDriftMm"],
            millimeters(
                np.linalg.norm(vertices[index, eye_indices] - neutral[eye_indices], axis=1).max()
            ),
        )
        global_metrics["maximumOralUpperTeethDriftMm"] = max(
            global_metrics["maximumOralUpperTeethDriftMm"],
            millimeters(
                np.linalg.norm(
                    vertices[index, upper_teeth_indices] - neutral[upper_teeth_indices],
                    axis=1,
                ).max()
            ),
        )
        rigid_rms, rigid_max = best_rigid_residual(
            neutral[lower_tooth_indices], vertices[index, lower_tooth_indices]
        )
        symmetry_rms, symmetry_max = symmetry_error(
            model, neutral, vertices[index]
        )
        global_metrics["maximumLowerTeethRigidRmsMm"] = max(
            global_metrics["maximumLowerTeethRigidRmsMm"], rigid_rms
        )
        global_metrics["maximumLowerTeethRigidMaxMm"] = max(
            global_metrics["maximumLowerTeethRigidMaxMm"], rigid_max
        )
        global_metrics["maximumOralSymmetryRmsMm"] = max(
            global_metrics["maximumOralSymmetryRmsMm"], symmetry_rms
        )
        global_metrics["maximumOralSymmetryMaxMm"] = max(
            global_metrics["maximumOralSymmetryMaxMm"], symmetry_max
        )

    proxy_targets = (
        "neutral",
        "viseme_L",
        "viseme_TH",
        "viseme_TDN",
        "viseme_SZ",
        "viseme_CHSH",
        "viseme_KG",
        "viseme_R",
        "tongueTipLateral",
        "tongueBladeGroove",
        "contactDental",
        "contactAlveolar",
        "contactLateral",
        "correctiveSibilantGroove",
        "contactVelar",
    )
    intersection_proxies = {
        name: intersection_proxy(model, vertices[names.index(name)])
        for name in proxy_targets
    }
    baseline = intersection_proxies["neutral"]
    intersection_ratios: dict[str, dict[str, float]] = {}
    for name, values in intersection_proxies.items():
        if name == "neutral":
            continue
        intersection_ratios[name] = {
            group: float(values[group] / max(baseline[group], 1))
            for group in values
        }

    glb = validate_glb_parity(model, vertices, args.glb)
    compact_target_audit = exporter.audit_compact_morph_targets(
        model, neutral, vertices[1:] - neutral[None, ...]
    )
    expression_isolation_audit = exporter.audit_expression_target_isolation(
        model, neutral, vertices[1:] - neutral[None, ...]
    )
    topology_sha256 = exporter.runtime_topology_sha256(model, neutral)
    upper_face_landmark_diagnostics: dict[str, float] = {}
    for name in exporter.UPPER_FACE_MORPH_TARGET_NAMES:
        index = names.index(name)
        maximum = np.linalg.norm(
            landmarks[index, 48:68] - landmarks[0, 48:68], axis=1
        ).max(initial=0.0)
        upper_face_landmark_diagnostics[name] = millimeters(maximum)
    expression_semantics = expression_semantic_metrics(
        model, vertices, landmarks, names
    )
    performance_profiles = performance_profile_metrics(
        model, vertices, landmarks, names
    )
    speech_expression_compatibility = speech_expression_compatibility_metrics(
        model, vertices, landmarks, names
    )
    metadata = validate_metadata(
        args.metadata,
        model,
        compact_target_audit,
        expression_isolation_audit,
        topology_sha256,
        glb,
    )
    runtime_glb = validate_runtime_manifest(args.runtime_glb)
    checks: list[dict[str, Any]] = []
    add_check(checks, "finite geometry", "all", global_metrics["allFinite"], "true", global_metrics["allFinite"])
    add_check(checks, "bounded displacement", "all", global_metrics["maximumMorphDisplacementMm"], "<= 25", global_metrics["maximumMorphDisplacementMm"] <= 25.0, "mm")
    add_check(checks, "speech-target eyeball stability", "oral targets", global_metrics["maximumOralEyeDriftMm"], "<= 0.02", global_metrics["maximumOralEyeDriftMm"] <= 0.02, "mm")
    add_check(checks, "upper dental arch stability", "oral targets", global_metrics["maximumOralUpperTeethDriftMm"], "<= 0.02", global_metrics["maximumOralUpperTeethDriftMm"] <= 0.02, "mm")
    add_check(checks, "lower teeth rigid RMS", "oral targets", global_metrics["maximumLowerTeethRigidRmsMm"], "<= 0.02", global_metrics["maximumLowerTeethRigidRmsMm"] <= 0.02, "mm")
    add_check(checks, "oral delta symmetry RMS", "oral targets", global_metrics["maximumOralSymmetryRmsMm"], "<= 0.02", global_metrics["maximumOralSymmetryRmsMm"] <= 0.02, "mm")
    add_check(checks, "GLB target names", "artifact", glb["targetNamesMatch"], "true", glb["targetNamesMatch"])
    add_check(checks, "GLB source-position parity", "artifact", glb["maxPositionAbsErrorMeters"], "<= 1e-7", glb["maxPositionAbsErrorMeters"] <= 1e-7, "m")
    add_check(checks, "GLB morph-delta parity", "artifact", glb["maxMorphAbsErrorMeters"], "<= 1e-7", glb["maxMorphAbsErrorMeters"] <= 1e-7, "m")
    add_check(
        checks,
        "source GLB size",
        "artifact",
        glb["bytes"],
        "<= 24 MiB",
        glb["bytes"] <= 24 * 1024 * 1024,
        "bytes",
    )
    add_check(
        checks,
        "runtime topology fingerprint",
        "artifact",
        topology_sha256 == exporter.RUNTIME_TOPOLOGY_SHA256,
        "exact baseline SHA-256",
        topology_sha256 == exporter.RUNTIME_TOPOLOGY_SHA256,
    )
    add_check(
        checks,
        "oral runtime contract fingerprint",
        "oral targets",
        compact_target_audit["oralRuntimeContractMatchesBaseline"],
        "exact 46-target baseline SHA-256",
        compact_target_audit["oralRuntimeContractMatchesBaseline"],
    )
    add_check(
        checks,
        "GNM model dimensions",
        "source",
        bool(
            model.identity_dim == 253
            and model.expression_dim == 383
            and model.num_joints == 4
            and model.num_vertices == 17821
            and len(model.triangles) == 35324
        ),
        "253 identity / 383 expression / 4 joints / 17,821 vertices / 35,324 triangles",
        bool(
            model.identity_dim == 253
            and model.expression_dim == 383
            and model.num_joints == 4
            and model.num_vertices == 17821
            and len(model.triangles) == 35324
        ),
    )
    add_check(
        checks,
        "metadata parity",
        "artifact",
        metadata["passed"],
        "all generated metadata contracts match",
        metadata["passed"],
    )
    add_check(
        checks,
        "compressed runtime manifest",
        "runtime artifact",
        runtime_glb["passed"],
        (
            f"{len(exporter.MORPH_RECIPES)} names / {len(exporter.PRIMITIVES)} "
            f"primitives / {len(exporter.MORPH_RECIPES) * len(exporter.PRIMITIVES)} "
            "morph slots / <= 2 MiB"
        ),
        runtime_glb["passed"],
    )
    add_check(
        checks,
        "nontrivial compact targets",
        "artifact",
        compact_target_audit["nontrivialTargetCount"],
        f"== {len(exporter.MORPH_RECIPES)}",
        compact_target_audit["nontrivialTargetCount"]
        == len(exporter.MORPH_RECIPES),
        "count",
    )

    for name, metrics_for_target in expression_isolation_audit[
        "upperFaceTargets"
    ].items():
        add_check(
            checks,
            "upper-face region isolation",
            name,
            metrics_for_target["passed"],
            "skin moves; oral/ocular <= 0.001 mm; bilateral symmetry <= 0.001 mm",
            metrics_for_target["passed"],
        )
        landmark_maximum = upper_face_landmark_diagnostics[name]
        add_check(
            checks,
            "oral landmark stability",
            name,
            landmark_maximum,
            "<= 0.001",
            landmark_maximum <= 0.001,
            "mm",
        )
    for name, metrics_for_target in expression_isolation_audit[
        "lowerFaceExpressionTargets"
    ].items():
        add_check(
            checks,
            "lower-face affect isolation",
            name,
            metrics_for_target["passed"],
            "skin and oral envelope move; eyes/teeth/tongue <= 0.001 mm; bilateral symmetry <= 0.001 mm",
            metrics_for_target["passed"],
        )
    semantic_expectations = (
        (
            "browLift",
            "meanBrowVerticalDeltaMillimeters",
            ">= 0.30",
            expression_semantics["browLift"][
                "meanBrowVerticalDeltaMillimeters"
            ]
            >= 0.30,
        ),
        (
            "browFurrow",
            "innerBrowGapDeltaMillimeters",
            "<= -0.10",
            expression_semantics["browFurrow"][
                "innerBrowGapDeltaMillimeters"
            ]
            <= -0.10,
        ),
        (
            "eyeWiden",
            "eyeApertureDeltaMillimeters",
            ">= 0.50",
            expression_semantics["eyeWiden"][
                "eyeApertureDeltaMillimeters"
            ]
            >= 0.50,
        ),
        (
            "eyeSquint",
            "eyeApertureDeltaMillimeters",
            "<= -0.50",
            expression_semantics["eyeSquint"][
                "eyeApertureDeltaMillimeters"
            ]
            <= -0.50,
        ),
        (
            "cheekRaise",
            "meanZygomaticVerticalDeltaMillimeters",
            ">= 0.10",
            expression_semantics["cheekRaise"][
                "meanZygomaticVerticalDeltaMillimeters"
            ]
            >= 0.10,
        ),
    )
    for name, metric_name, expectation, passed in semantic_expectations:
        add_check(
            checks,
            "named expression direction",
            name,
            expression_semantics[name][metric_name],
            expectation,
            passed,
            "mm",
        )
    for name, profile in performance_profiles.items():
        add_check(
            checks,
            "perceptible production affect",
            name,
            profile["skinMaximumDeltaMillimeters"],
            ">= 0.50",
            profile["skinMaximumDeltaMillimeters"] >= 0.50,
            "mm",
        )
        add_check(
            checks,
            "affect protected-component isolation",
            name,
            profile["protectedComponentMaximumDeltaMillimeters"],
            "<= 0.001",
            profile["protectedComponentMaximumDeltaMillimeters"] <= 0.001,
            "mm",
        )
        add_check(
            checks,
            "whole-face affect signal",
            name,
            profile["oralLandmarkMaximumDeltaMillimeters"],
            ">= 0.10",
            profile["oralLandmarkMaximumDeltaMillimeters"] >= 0.10,
            "mm",
        )
    signed_profile_expectations = (
        (
            "warm",
            "mouthCornerVerticalDeltaMillimeters",
            ">= 1.0",
            performance_profiles["warm"]["mouthCornerVerticalDeltaMillimeters"]
            >= 1.0,
        ),
        (
            "surprise",
            "meanBrowVerticalDeltaMillimeters",
            ">= 1.0",
            performance_profiles["surprise"]["meanBrowVerticalDeltaMillimeters"]
            >= 1.0,
        ),
        (
            "surprise",
            "eyeApertureDeltaMillimeters",
            ">= 1.0",
            performance_profiles["surprise"]["eyeApertureDeltaMillimeters"]
            >= 1.0,
        ),
        (
            "question",
            "meanBrowVerticalDeltaMillimeters",
            ">= 0.50",
            performance_profiles["question"]["meanBrowVerticalDeltaMillimeters"]
            >= 0.50,
        ),
        (
            "question",
            "eyeApertureDeltaMillimeters",
            ">= 0.50",
            performance_profiles["question"]["eyeApertureDeltaMillimeters"]
            >= 0.50,
        ),
        (
            "concerned",
            "meanBrowVerticalDeltaMillimeters",
            "<= -0.50",
            performance_profiles["concerned"]["meanBrowVerticalDeltaMillimeters"]
            <= -0.50,
        ),
        (
            "concerned",
            "innerBrowGapDeltaMillimeters",
            "<= -0.20",
            performance_profiles["concerned"]["innerBrowGapDeltaMillimeters"]
            <= -0.20,
        ),
        (
            "emphatic",
            "eyeApertureDeltaMillimeters",
            "<= -0.25",
            performance_profiles["emphatic"]["eyeApertureDeltaMillimeters"]
            <= -0.25,
        ),
    )
    for name, metric_name, expectation, passed in signed_profile_expectations:
        add_check(
            checks,
            "signed production affect direction",
            name,
            performance_profiles[name][metric_name],
            expectation,
            passed,
            "mm",
        )
    for name, compatibility in speech_expression_compatibility.items():
        expression_signal = compatibility[
            "expressionOralLandmarkMaximumDeltaMillimeters"
        ]
        if compatibility["contactTarget"] == "contactLabiodental":
            labiodental_distance = compatibility[
                "lowerLipToUpperIncisorMinimumMillimeters"
            ]
            labiodental_coverage = compatibility[
                "lowerLipIncisorCoverageWithin2Millimeters"
            ]
            add_check(
                checks,
                "affect-compatible labiodental distance",
                name,
                labiodental_distance,
                "0.20–1.20",
                0.20 <= labiodental_distance <= 1.20,
                "mm",
            )
            add_check(
                checks,
                "affect-compatible labiodental coverage",
                name,
                labiodental_coverage,
                ">= 0.50",
                labiodental_coverage >= 0.50,
            )
            minimum_signal = 0.50
        else:
            lip_distance = compatibility["lipRimMinimumMillimeters"]
            lip_coverage = compatibility["lipRimCoverageWithin1_5Millimeters"]
            add_check(
                checks,
                "affect-compatible bilabial distance",
                name,
                lip_distance,
                "0.05–0.80",
                0.05 <= lip_distance <= 0.80,
                "mm",
            )
            add_check(
                checks,
                "affect-compatible bilabial coverage",
                name,
                lip_coverage,
                ">= 0.85",
                lip_coverage >= 0.85,
            )
            minimum_signal = 0.15
        add_check(
            checks,
            "affect remains visible through contact",
            name,
            expression_signal,
            f">= {minimum_signal:.2f}",
            expression_signal >= minimum_signal,
            "mm",
        )
    for name, metrics_for_target in expression_isolation_audit[
        "gazeTargets"
    ].items():
        add_check(
            checks,
            "joint-derived ocular gaze isolation and direction",
            name,
            metrics_for_target["passed"],
            "intended iris axis >= 0.5 mm; outside ocular <= 0.001 mm",
            metrics_for_target["passed"],
        )
    add_check(
        checks,
        "duplicate compact targets",
        "artifact",
        compact_target_audit["duplicateTargetCount"],
        "== 0",
        compact_target_audit["duplicateTargetCount"] == 0,
        "count",
    )

    mbp = metrics["viseme_MBP"]
    add_check(checks, "bilabial rim distance", "viseme_MBP", mbp["lipRimMinimumMm"], "0.10–0.80", 0.10 <= mbp["lipRimMinimumMm"] <= 0.80, "mm")
    add_check(checks, "bilabial contact coverage", "viseme_MBP", mbp["lipRimCoverageWithin1_5mm"], ">= 0.70", mbp["lipRimCoverageWithin1_5mm"] >= 0.70)
    add_check(checks, "bilabial aperture", "viseme_MBP", mbp["innerLipApertureMm"], "<= 5.5", mbp["innerLipApertureMm"] <= 5.5, "mm")
    fv = metrics["viseme_FV"]
    add_check(checks, "labiodental contact", "viseme_FV", fv["lowerLipToUpperIncisorMinimumMm"], "0.20–1.20", 0.20 <= fv["lowerLipToUpperIncisorMinimumMm"] <= 1.20, "mm")
    add_check(checks, "labiodental aperture", "viseme_FV", fv["innerLipApertureMm"], "4.5–8.5", 4.5 <= fv["innerLipApertureMm"] <= 8.5, "mm")

    for target_name in ("viseme_L", "viseme_TDN", "tongueTipUp"):
        value = metrics[target_name]["tongueToAlveolarMinimumMm"]
        add_check(checks, "alveolar tongue contact", target_name, value, "0.10–1.50", 0.10 <= value <= 1.50, "mm")
    th = metrics["viseme_TH"]
    add_check(checks, "dental tongue protrusion", "viseme_TH", th["tongueBeyondUpperIncisorMm"], "3.0–8.0", 3.0 <= th["tongueBeyondUpperIncisorMm"] <= 8.0, "mm")
    add_check(checks, "tongue remains behind lip front", "viseme_TH", th["tongueBehindLipFrontMm"], ">= 0.5", th["tongueBehindLipFrontMm"] >= 0.5, "mm")
    for target_name, aperture_range in (("viseme_SZ", (4.0, 7.0)), ("viseme_CHSH", (6.0, 11.0))):
        target_metrics = metrics[target_name]
        add_check(checks, "sibilant aperture", target_name, target_metrics["innerLipApertureMm"], f"{aperture_range[0]}–{aperture_range[1]}", aperture_range[0] <= target_metrics["innerLipApertureMm"] <= aperture_range[1], "mm")
        add_check(checks, "anterior tongue groove", target_name, target_metrics["anteriorTongueGrooveMm"], ">= 0.20", target_metrics["anteriorTongueGrooveMm"] >= 0.20, "mm")
    kg = metrics["viseme_KG"]
    add_check(checks, "posterior tongue/velum approach", "viseme_KG", kg["posteriorDorsumToVelumMm"], "0.5–3.0", 0.5 <= kg["posteriorDorsumToVelumMm"] <= 3.0, "mm")
    wq = metrics["viseme_WQ"]
    add_check(checks, "rounded W/Q width", "viseme_WQ", wq["mouthWidthRatioToNeutral"], "<= 0.94", wq["mouthWidthRatioToNeutral"] <= 0.94)
    add_check(checks, "rounded W/Q protrusion", "viseme_WQ", wq["lipProtrusionFromNeutralMm"], ">= 3.0", wq["lipProtrusionFromNeutralMm"] >= 3.0, "mm")

    aperture_ranges = {
        "vowel_AA": (10.0, 16.0),
        "vowel_AE": (9.0, 14.0),
        "vowel_AH": (9.0, 14.0),
        "vowel_EH": (7.0, 11.0),
        "vowel_IH": (5.5, 9.5),
        "vowel_EE": (6.0, 10.0),
        "vowel_OH": (8.5, 13.0),
        "vowel_OO": (6.0, 10.0),
    }
    for target_name, limits in aperture_ranges.items():
        value = metrics[target_name]["innerLipApertureMm"]
        add_check(checks, "vowel aperture", target_name, value, f"{limits[0]}–{limits[1]}", limits[0] <= value <= limits[1], "mm")
    add_check(checks, "spread /i/ width", "vowel_EE", metrics["vowel_EE"]["mouthWidthRatioToNeutral"], ">= 1.06", metrics["vowel_EE"]["mouthWidthRatioToNeutral"] >= 1.06)
    for target_name in ("vowel_OH", "vowel_OO"):
        add_check(checks, "rounded vowel width", target_name, metrics[target_name]["mouthWidthRatioToNeutral"], "<= 0.96", metrics[target_name]["mouthWidthRatioToNeutral"] <= 0.96)

    jaw_index = names.index("jawOpen")
    lower_teeth_all = model.vertex_group_indices("lower_teeth_and_gums")
    jaw_drop = millimeters(
        vertices[jaw_index, lower_teeth_all, 1].mean()
        - neutral[lower_teeth_all, 1].mean()
    )
    add_check(checks, "jaw-open aperture", "jawOpen", metrics["jawOpen"]["innerLipApertureMm"], ">= 10", metrics["jawOpen"]["innerLipApertureMm"] >= 10.0, "mm")
    add_check(checks, "lower dental arch descends", "jawOpen", jaw_drop, "<= -3.0", jaw_drop <= -3.0, "mm")

    jaw_forward = metrics["jawForward"]
    add_check(
        checks,
        "mandible protrusion",
        "jawForward",
        jaw_forward["lowerDentalForwardDeltaMm"],
        "2.5–3.5",
        2.5 <= jaw_forward["lowerDentalForwardDeltaMm"] <= 3.5,
        "mm",
    )
    add_check(
        checks,
        "jaw-forward aperture isolation",
        "jawForward",
        abs(
            jaw_forward["innerLipApertureMm"]
            - metrics["neutral"]["innerLipApertureMm"]
        ),
        "<= 0.25",
        abs(
            jaw_forward["innerLipApertureMm"]
            - metrics["neutral"]["innerLipApertureMm"]
        )
        <= 0.25,
        "mm",
    )
    add_check(
        checks,
        "isolated upper-lip raise",
        "upperLipRaise",
        metrics["upperLipRaise"]["upperLipVerticalDeltaMm"],
        ">= 1.2",
        metrics["upperLipRaise"]["upperLipVerticalDeltaMm"] >= 1.2,
        "mm",
    )
    add_check(
        checks,
        "isolated lower-lip depress",
        "lowerLipDepress",
        metrics["lowerLipDepress"]["lowerLipVerticalDeltaMm"],
        "<= -1.2",
        metrics["lowerLipDepress"]["lowerLipVerticalDeltaMm"] <= -1.2,
        "mm",
    )
    compression = (
        metrics["neutral"]["innerLipApertureMm"]
        - metrics["lipCompress"]["innerLipApertureMm"]
    )
    add_check(
        checks,
        "lip compression aperture reduction",
        "lipCompress",
        compression,
        ">= 0.8",
        compression >= 0.8,
        "mm",
    )
    add_check(
        checks,
        "lip roll inward",
        "lipRollIn",
        metrics["lipRollIn"]["lipProtrusionFromNeutralMm"],
        "<= -1.5",
        metrics["lipRollIn"]["lipProtrusionFromNeutralMm"] <= -1.5,
        "mm",
    )
    add_check(
        checks,
        "lip roll outward",
        "lipRollOut",
        metrics["lipRollOut"]["lipProtrusionFromNeutralMm"],
        ">= 1.0",
        metrics["lipRollOut"]["lipProtrusionFromNeutralMm"] >= 1.0,
        "mm",
    )
    for target_name, minimum, maximum in (
        ("mouthCornersUp", 1.0, float("inf")),
        ("mouthCornersDown", -float("inf"), -1.0),
    ):
        value = metrics[target_name]["mouthCornerVerticalDeltaMm"]
        add_check(
            checks,
            "mouth-corner vertical control",
            target_name,
            value,
            f"{minimum:g}–{maximum:g}",
            minimum <= value <= maximum,
            "mm",
        )
    add_check(
        checks,
        "mouth stretch lateral control",
        "mouthStretch",
        metrics["mouthStretch"]["mouthCornerLateralDeltaMm"],
        ">= 2.0",
        metrics["mouthStretch"]["mouthCornerLateralDeltaMm"] >= 2.0,
        "mm",
    )

    add_check(
        checks,
        "lateral tongue channel",
        "tongueTipLateral",
        metrics["tongueTipLateral"]["anteriorTongueLateralChannelMm"],
        ">= 0.5",
        metrics["tongueTipLateral"]["anteriorTongueLateralChannelMm"] >= 0.5,
        "mm",
    )
    add_check(
        checks,
        "tongue blade raise",
        "tongueBladeUp",
        metrics["tongueBladeUp"]["tongueBladeVerticalDeltaMm"],
        ">= 1.0",
        metrics["tongueBladeUp"]["tongueBladeVerticalDeltaMm"] >= 1.0,
        "mm",
    )
    add_check(
        checks,
        "tongue blade groove",
        "tongueBladeGroove",
        metrics["tongueBladeGroove"]["anteriorTongueGrooveMm"],
        ">= 0.25",
        metrics["tongueBladeGroove"]["anteriorTongueGrooveMm"] >= 0.25,
        "mm",
    )
    for target_name, metric_name, expectation, passed in (
        (
            "tongueBodyHigh",
            "tongueBodyVerticalDeltaMm",
            ">= 1.5",
            metrics["tongueBodyHigh"]["tongueBodyVerticalDeltaMm"] >= 1.5,
        ),
        (
            "tongueBodyBack",
            "tonguePosteriorVerticalDeltaMm",
            ">= 1.5",
            metrics["tongueBodyBack"]["tonguePosteriorVerticalDeltaMm"] >= 1.5,
        ),
        (
            "tongueBodyLow",
            "tongueBodyVerticalDeltaMm",
            "<= -1.0",
            metrics["tongueBodyLow"]["tongueBodyVerticalDeltaMm"] <= -1.0,
        ),
        (
            "tongueForward",
            "tongueMeanForwardDeltaMm",
            ">= 1.5",
            metrics["tongueForward"]["tongueMeanForwardDeltaMm"] >= 1.5,
        ),
        (
            "tongueRetract",
            "tongueMeanForwardDeltaMm",
            "<= -1.5",
            metrics["tongueRetract"]["tongueMeanForwardDeltaMm"] <= -1.5,
        ),
    ):
        add_check(
            checks,
            "atomic tongue control",
            target_name,
            metrics[target_name][metric_name],
            expectation,
            passed,
            "mm",
        )

    contact_bilabial = metrics["contactBilabial"]
    add_check(
        checks,
        "layerable bilabial contact",
        "contactBilabial",
        contact_bilabial["lipRimMinimumMm"],
        "0.10–0.80",
        0.10 <= contact_bilabial["lipRimMinimumMm"] <= 0.80,
        "mm",
    )
    contact_fv = metrics["contactLabiodental"]
    add_check(
        checks,
        "layerable labiodental contact",
        "contactLabiodental",
        contact_fv["lowerLipToUpperIncisorMinimumMm"],
        "0.20–1.20",
        0.20 <= contact_fv["lowerLipToUpperIncisorMinimumMm"] <= 1.20,
        "mm",
    )
    contact_dental = metrics["contactDental"]
    add_check(
        checks,
        "layerable dental protrusion",
        "contactDental",
        contact_dental["tongueBeyondUpperIncisorMm"],
        "3.0–8.0",
        3.0 <= contact_dental["tongueBeyondUpperIncisorMm"] <= 8.0,
        "mm",
    )
    for target_name in ("contactAlveolar", "contactLateral"):
        value = metrics[target_name]["tongueToAlveolarMinimumMm"]
        add_check(
            checks,
            "layerable alveolar contact",
            target_name,
            value,
            "0.10–1.50",
            0.10 <= value <= 1.50,
            "mm",
        )
    add_check(
        checks,
        "layerable lateral channel",
        "contactLateral",
        metrics["contactLateral"]["anteriorTongueLateralChannelMm"],
        ">= 0.8",
        metrics["contactLateral"]["anteriorTongueLateralChannelMm"] >= 0.8,
        "mm",
    )
    add_check(
        checks,
        "layerable sibilant groove",
        "correctiveSibilantGroove",
        metrics["correctiveSibilantGroove"]["anteriorTongueGrooveMm"],
        ">= 0.30",
        metrics["correctiveSibilantGroove"]["anteriorTongueGrooveMm"] >= 0.30,
        "mm",
    )
    add_check(
        checks,
        "layerable velar contact",
        "contactVelar",
        metrics["contactVelar"]["posteriorDorsumToVelumMm"],
        "0.5–3.0",
        0.5 <= metrics["contactVelar"]["posteriorDorsumToVelumMm"] <= 3.0,
        "mm",
    )

    # A zero neutral upper-teeth count makes division-based ratios meaningless:
    # an intentional tongue contact would turn one event into an apparent
    # 200x regression.  Bound that surface by an absolute edge-hit count and
    # use baseline-relative ratios only for components with established
    # neutral intersections.
    maximum_upper_contact_count = max(
        values["upper_teeth_and_gums"]
        for name, values in intersection_proxies.items()
        if name != "neutral"
    )
    established_baseline_ratios = [
        values[group] / baseline[group]
        for name, values in intersection_proxies.items()
        if name != "neutral"
        for group in (
            "upper_teeth_and_gums",
            "lower_teeth_and_gums",
            "mouth_sock",
        )
        if baseline[group] >= 10
    ]
    worst_established_baseline_ratio = max(established_baseline_ratios)
    if baseline["upper_teeth_and_gums"] >= 10:
        upper_contact_value = (
            maximum_upper_contact_count / baseline["upper_teeth_and_gums"]
        )
        add_check(
            checks,
            "upper-contact intersection proxy",
            "contact targets",
            upper_contact_value,
            "<= 5.0× neutral",
            upper_contact_value <= 5.0,
            "ratio",
        )
    else:
        add_check(
            checks,
            "upper-contact intersection proxy",
            "contact targets",
            maximum_upper_contact_count,
            "<= 300 edge hits (zero neutral baseline)",
            maximum_upper_contact_count <= 300,
            "count",
        )
    add_check(
        checks,
        "baseline-relative intersection proxy",
        "contact targets",
        worst_established_baseline_ratio,
        "<= 5.0× neutral for nonzero baselines",
        worst_established_baseline_ratio <= 5.0,
        "ratio",
    )

    passed_count = sum(check["passed"] for check in checks)
    report: dict[str, Any] = {
        "schemaVersion": 2,
        "result": {
            "passed": passed_count == len(checks),
            "passedChecks": passed_count,
            "totalChecks": len(checks),
        },
        "scope": (
            "GNM-derived oral speech geometry plus region-isolated upper-face and "
            "joint-derived gaze regression; anatomically informed, not forensic, "
            "medical, patient-specific, or millimetrically validated."
        ),
        "source": {
            "repository": "https://github.com/google/GNM",
            "commit": args.gnm_commit,
            "license": "Apache-2.0",
            "model": "GNM Head v3.0",
            "identity": context["identityMethod"],
        },
        "globalMetrics": global_metrics,
        "poseMetrics": metrics,
        "intersectionProxy": {
            "counts": intersection_proxies,
            "ratiosToNeutral": intersection_ratios,
            "caveat": (
                "GNM oral components are open/non-watertight and intersect in neutral. "
                "Counts are edge/triangle intersection regression proxies; intended "
                "contacts also increase them, so they are not signed penetration depths."
            ),
        },
        "glb": glb,
        "runtimeGlb": runtime_glb,
        "metadata": metadata,
        "compactTargetAudit": compact_target_audit,
        "expressionIsolationAudit": expression_isolation_audit,
        "expressionSemanticMetrics": expression_semantics,
        "performanceProfileMetrics": performance_profiles,
        "speechExpressionCompatibilityMetrics": speech_expression_compatibility,
        "upperFaceOralLandmarkMaximumDeltaMillimeters": (
            upper_face_landmark_diagnostics
        ),
        "runtimeTopologySha256": topology_sha256,
        "checks": checks,
        "anatomicalCorrections": context["correctionDiagnostics"],
    }
    return report


def write_markdown(report: dict[str, Any], path: Path) -> None:
    result = report["result"]
    lines = [
        "# GNM speech and expression rig geometry validation",
        "",
        f"**Result:** {'PASS' if result['passed'] else 'FAIL'} "
        f"({result['passedChecks']}/{result['totalChecks']} checks)",
        "",
        report["scope"],
        "",
        "## Method",
        "",
        "The validator re-evaluates the pinned GNM v3 population-mean identity, applies the same deterministic correctives as the exporter, measures GNM's barycentric 68-point mouth landmarks and component geometry, checks rigid teeth, upper-face/oral separation, bilateral expression symmetry, and eye-joint gaze isolation, and byte-decodes every source GLB morph accessor to prove source/export parity. The compressed runtime manifest is checked here and decoded source/runtime parity is checked separately with `demo/scripts/compare-gnm-runtime.mjs`.",
        "",
        "## Checks",
        "",
        "| Status | Target | Check | Value | Expected |",
        "|---|---|---|---:|---|",
    ]
    for check in report["checks"]:
        value = check["value"]
        rendered = f"{value:.6g}" if isinstance(value, float) else str(value)
        if check["unit"]:
            rendered += f" {check['unit']}"
        lines.append(
            f"| {'PASS' if check['passed'] else 'FAIL'} | {check['target']} | "
            f"{check['name']} | {rendered} | {check['expectation']} |"
        )
    lines.extend(
        [
            "",
            "## Core target metrics",
            "",
            "| Target | Aperture mm | Width / neutral | Protrusion mm | Lip rim min mm | Incisor contact mm | Alveolar contact mm | Groove mm | Velar clearance mm |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for name, values in report["poseMetrics"].items():
        if name not in exporter.ORAL_MORPH_TARGET_NAMES:
            continue
        lines.append(
            f"| {name} | {values['innerLipApertureMm']:.2f} | "
            f"{values['mouthWidthRatioToNeutral']:.3f} | "
            f"{values['lipProtrusionFromNeutralMm']:.2f} | "
            f"{values['lipRimMinimumMm']:.2f} | "
            f"{values['lowerLipToUpperIncisorMinimumMm']:.2f} | "
            f"{values['tongueToAlveolarMinimumMm']:.2f} | "
            f"{values['anteriorTongueGrooveMm']:.2f} | "
            f"{values['posteriorDorsumToVelumMm']:.2f} |"
        )
    proxy = report["intersectionProxy"]
    lines.extend(
        [
            "",
            "## Intersection regression proxy",
            "",
            proxy["caveat"],
            "",
            "| Target | Upper teeth | Lower teeth | Mouth sock |",
            "|---|---:|---:|---:|",
        ]
    )
    for name, values in proxy["counts"].items():
        lines.append(
            f"| {name} | {values['upper_teeth_and_gums']} | "
            f"{values['lower_teeth_and_gums']} | {values['mouth_sock']} |"
        )
    isolation = report["expressionIsolationAudit"]
    lines.extend(
        [
            "",
            "## Upper-face isolation",
            "",
            "| Target | Skin max mm | Oral max mm | Ocular max mm | Oral landmark max mm | Symmetry max error mm |",
            "|---|---:|---:|---:|---:|---:|",
        ]
    )
    for name, values in isolation["upperFaceTargets"].items():
        lines.append(
            f"| {name} | {values['skinMaximumDeltaMillimeters']:.4f} | "
            f"{values['oralMaximumDeltaMillimeters']:.6f} | "
            f"{values['ocularMaximumDeltaMillimeters']:.6f} | "
            f"{report['upperFaceOralLandmarkMaximumDeltaMillimeters'][name]:.6f} | "
            f"{values.get('bilateralSymmetryMaximumErrorMillimeters', 0.0):.6f} |"
        )
    lines.extend(
        [
            "",
            "## Lower-face affect isolation",
            "",
            "| Target | Skin max mm | Oral max mm | Eyes max mm | Teeth max mm | Tongue max mm | Symmetry max error mm |",
            "|---|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for name, values in isolation["lowerFaceExpressionTargets"].items():
        lines.append(
            f"| {name} | {values['skinMaximumDeltaMillimeters']:.4f} | "
            f"{values['oralMaximumDeltaMillimeters']:.4f} | "
            f"{values['ocularMaximumDeltaMillimeters']:.6f} | "
            f"{max(values['upperDentalMaximumDeltaMillimeters'], values['lowerDentalMaximumDeltaMillimeters']):.6f} | "
            f"{values['tongueMaximumDeltaMillimeters']:.6f} | "
            f"{values['bilateralSymmetryMaximumErrorMillimeters']:.6f} |"
        )
    lines.extend(
        [
            "",
            "## Production affect profiles",
            "",
            "The values below apply the same calibrated target weights used by the browser controller at 0.9 intent intensity. Every profile combines region-isolated GNM upper-face and lower-face signals while leaving the eyes, teeth, and tongue protected.",
            "",
            "| Affect | Skin max mm | Protected component max mm | Oral landmark max mm | Brow Y mm | Eye aperture mm | Mouth-corner Y mm | Mouth width mm | Lip forward mm |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for name, values in report["performanceProfileMetrics"].items():
        lines.append(
            f"| {name} | {values['skinMaximumDeltaMillimeters']:.4f} | "
            f"{values['protectedComponentMaximumDeltaMillimeters']:.6f} | "
            f"{values['oralLandmarkMaximumDeltaMillimeters']:.6f} | "
            f"{values['meanBrowVerticalDeltaMillimeters']:.4f} | "
            f"{values['eyeApertureDeltaMillimeters']:.4f} | "
            f"{values['mouthCornerVerticalDeltaMillimeters']:.4f} | "
            f"{values['mouthWidthDeltaMillimeters']:.4f} | "
            f"{values['lipForwardDeltaMillimeters']:.4f} |"
        )
    lines.extend(
        [
            "",
            "## Speech and affect composition",
            "",
            "These blends reproduce the runtime contact-priority policy. A strong GNM affect signal must remain visible without erasing bilabial or labiodental articulation.",
            "",
            "| Blend | Contact | Affect | Affect weight | Lip rim min mm | Lip coverage | Incisor min mm | Incisor coverage | Affect signal mm | Corner Y mm |",
            "|---|---|---|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for name, values in report["speechExpressionCompatibilityMetrics"].items():
        lines.append(
            f"| {name} | {values['contactTarget']} | {values['expressionTarget']} | "
            f"{values['effectiveExpressionWeight']:.4f} | "
            f"{values['lipRimMinimumMillimeters']:.3f} | "
            f"{values['lipRimCoverageWithin1_5Millimeters']:.3f} | "
            f"{values['lowerLipToUpperIncisorMinimumMillimeters']:.3f} | "
            f"{values['lowerLipIncisorCoverageWithin2Millimeters']:.3f} | "
            f"{values['expressionOralLandmarkMaximumDeltaMillimeters']:.3f} | "
            f"{values['expressionMouthCornerVerticalDeltaMillimeters']:.3f} |"
        )
    lines.extend(
        [
            "",
            "## Joint-derived gaze isolation",
            "",
            "| Target | Ocular max mm | Outside ocular max mm | Iris mean delta mm | Left/right RMS mismatch mm |",
            "|---|---:|---:|---|---:|",
        ]
    )
    for name, values in isolation["gazeTargets"].items():
        iris = ", ".join(f"{value:.4f}" for value in values["irisMeanDeltaMillimeters"])
        mismatch = abs(
            values["leftEyeRmsDeltaMillimeters"]
            - values["rightEyeRmsDeltaMillimeters"]
        )
        lines.append(
            f"| {name} | {values['ocularMaximumDeltaMillimeters']:.4f} | "
            f"{values['outsideOcularMaximumDeltaMillimeters']:.6f} | "
            f"[{iris}] | {mismatch:.6f} |"
        )
    lines.extend(
        [
            "",
            "## Artifact integrity",
            "",
            f"- GLB SHA-256: `{report['glb']['sha256']}`",
            f"- GLB bytes: {report['glb']['bytes']}",
            f"- Runtime GLB SHA-256: `{report['runtimeGlb']['sha256']}`",
            f"- Runtime GLB bytes: {report['runtimeGlb']['bytes']}",
            f"- Maximum source-position accessor error: {report['glb']['maxPositionAbsErrorMeters']:.3g} m",
            f"- Maximum morph-delta accessor error: {report['glb']['maxMorphAbsErrorMeters']:.3g} m",
            f"- Nontrivial compact targets: {report['compactTargetAudit']['nontrivialTargetCount']}",
            f"- Duplicate compact targets: {report['compactTargetAudit']['duplicateTargetCount']}",
            f"- Oral runtime contract SHA-256: `{report['compactTargetAudit']['oralRuntimeContractSha256']}`",
            f"- Runtime topology SHA-256: `{report['runtimeTopologySha256']}`",
            f"- Expression/gaze isolation audit: {'PASS' if report['expressionIsolationAudit']['passed'] else 'FAIL'}",
            "- Target names: "
            + ", ".join(report["compactTargetAudit"]["targets"].keys()),
            "",
            "## Interpretation boundary",
            "",
            "These tests establish deterministic contact intent, coherent component motion, bounded deformation, and exact GLB export parity. They do not establish collision-free volumetric anatomy because the supplied GNM mouth parts are open and overlap at neutral, and they are not a claim of millimetric biomechanical accuracy.",
            "",
        ]
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gnm-root", type=Path, default=Path("research/GNM"))
    parser.add_argument(
        "--gnm-commit", default="e26528fbf34d3fefd1a8f160d1b68641df78a586"
    )
    parser.add_argument(
        "--glb", type=Path, default=Path("demo/public/assets/models/gnm-neutral.glb")
    )
    parser.add_argument(
        "--runtime-glb",
        type=Path,
        default=Path("demo/public/assets/models/gnm-neutral.runtime.glb"),
    )
    parser.add_argument(
        "--metadata",
        type=Path,
        default=Path("demo/public/assets/models/gnm-neutral.metadata.json"),
    )
    parser.add_argument(
        "--json", type=Path, default=Path("research/generic-oral-rig-validation.json")
    )
    parser.add_argument(
        "--markdown", type=Path, default=Path("research/generic-oral-rig-validation.md")
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = build_report(args)
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(report, indent=2) + "\n")
    write_markdown(report, args.markdown)
    print(
        json.dumps(
            {
                "result": report["result"],
                "json": str(args.json),
                "markdown": str(args.markdown),
                "glbSha256": report["glb"]["sha256"],
            },
            indent=2,
        )
    )
    if not report["result"]["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
