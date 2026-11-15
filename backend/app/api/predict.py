"""Prediction endpoints backed by the trained models."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..ml.features import FEATURE_LABELS
from ..ml.registry import ModelNotTrained, baseline_estimate, registry
from ..models import HeatRecord, Prediction
from ..schemas import PredictionRequest, PredictionResponse, SimilarHeatOut
from ..services import energy

router = APIRouter(prefix="/predict", tags=["predictions"])

CAVEATS = [
    "Prediction from a model trained on synthetic, physically-plausible data — not plant measurements.",
    "Values are estimates with the stated uncertainty band; validate against actual heats before acting.",
]


def _feature_list(payload: dict, importance: list[dict]) -> list[dict]:
    out = []
    for item in importance:
        key = item["feature"]
        value = payload.get(key)
        out.append(
            {
                "feature": key,
                "label": item.get("label") or FEATURE_LABELS.get(key, key),
                "importance": item["importance"],
                "value": float(value) if isinstance(value, (int, float)) else 0.0,
            }
        )
    return out


def _store(db: Session, response: dict, payload: dict):
    heat = None
    if payload.get("heat_id"):
        heat = db.query(HeatRecord).filter(HeatRecord.heat_id == payload["heat_id"]).first()
    record = Prediction(
        heat_record_id=heat.id if heat else None,
        heat_id=payload.get("heat_id"),
        model_name=response["model_name"],
        model_version=response["model_version"],
        predicted_value=response["predicted_value"],
        unit=response["unit"],
        lower_bound=response.get("lower_bound"),
        upper_bound=response.get("upper_bound"),
        inputs=payload,
        feature_importance=response.get("features", []),
    )
    db.add(record)
    db.commit()


@router.post("/melting-time", response_model=PredictionResponse)
def predict_melting_time(payload: PredictionRequest, db: Session = Depends(get_db)):
    data = payload.model_dump()
    if not registry.is_ready():
        base = baseline_estimate(
            payload.metal_grade, payload.charge_weight_kg, payload.initial_temp_c, payload.target_temp_c, payload.power_kw
        )
        response = {
            "model_name": "melting_time",
            "model_version": "baseline-physics",
            "algorithm": "Documented energy balance baseline",
            "predicted_value": base["melting_time_min"],
            "unit": "minutes",
            "lower_bound": None,
            "upper_bound": None,
            "confidence_note": "ML models are not trained. Showing the documented physics baseline.",
            "metrics": {},
            "features": [],
            "caveats": CAVEATS + ["Baseline estimate, not a trained model prediction."],
            "baseline_used": True,
            "baseline_reason": "No trained model artifacts found.",
            "extra": {"remaining_min": round(max(base["melting_time_min"] - payload.elapsed_min, 0), 1)},
        }
        return response

    try:
        result = registry.predict_melting_time(data)
    except ModelNotTrained as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    response = {
        "model_name": "melting_time",
        "model_version": registry.version,
        "algorithm": result["algorithm"],
        "predicted_value": result["predicted_value"],
        "unit": "minutes",
        "lower_bound": result["lower_bound"],
        "upper_bound": result["upper_bound"],
        "confidence_note": (
            f"Uncertainty band = max(per-tree spread ({result['tree_spread']} min), holdout residual σ "
            f"({result['metrics'].get('residual_std', 'n/a')} min))."
        ),
        "metrics": result["metrics"],
        "features": _feature_list(payload.model_dump(), result["importance"]),
        "caveats": CAVEATS,
        "extra": {
            "remaining_min": result["remaining_min"],
            "predicted_total_min": result["predicted_value"],
            "elapsed_min": payload.elapsed_min,
        },
    }
    _store(db, response, data)
    return response


@router.post("/energy", response_model=PredictionResponse)
def predict_energy(payload: PredictionRequest, db: Session = Depends(get_db)):
    data = payload.model_dump()
    if not registry.is_ready():
        base = baseline_estimate(
            payload.metal_grade, payload.charge_weight_kg, payload.initial_temp_c, payload.target_temp_c, payload.power_kw
        )
        return {
            "model_name": "energy",
            "model_version": "baseline-physics",
            "algorithm": "Documented energy balance baseline",
            "predicted_value": base["energy_kwh"],
            "unit": "kWh",
            "lower_bound": None,
            "upper_bound": None,
            "confidence_note": "ML models are not trained. Showing the documented physics baseline.",
            "metrics": {},
            "features": [],
            "caveats": CAVEATS,
            "baseline_used": True,
            "baseline_reason": "No trained model artifacts found.",
            "extra": {},
        }

    try:
        result = registry.predict_energy(data)
    except ModelNotTrained as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    refs = energy.grade_reference(db)
    ref_epk = refs.get(payload.metal_grade)
    per_kg = result["energy_per_kg"]
    reference = ref_epk * payload.charge_weight_kg if ref_epk else None

    response = {
        "model_name": "energy",
        "model_version": registry.version,
        "algorithm": result["algorithm"],
        "predicted_value": result["predicted_value"],
        "unit": "kWh",
        "lower_bound": result["lower_bound"],
        "upper_bound": result["upper_bound"],
        "confidence_note": (
            f"±1σ band from holdout residual standard deviation ({result['metrics'].get('residual_std', 'n/a')} kWh)."
        ),
        "metrics": result["metrics"],
        "features": _feature_list({**data, "energy_per_kg_nominal": per_kg}, result["importance"]),
        "caveats": CAVEATS,
        "extra": {
            "energy_per_kg": per_kg,
            "comparable_benchmark_kwh": round(reference, 1) if reference else None,
            "difference_from_benchmark_kwh": round(result["predicted_value"] - reference, 1) if reference else None,
            "benchmark_note": (
                "Benchmark = 10th-percentile energy per kg of the same grade × charge weight."
                if reference
                else "No comparable historical heats for this grade."
            ),
        },
    }
    _store(db, response, data)
    return response


@router.post("/time-to-target", response_model=PredictionResponse)
def predict_time_to_target(payload: PredictionRequest, db: Session = Depends(get_db)):
    data = payload.model_dump()
    if not registry.is_ready():
        raise HTTPException(status_code=503, detail="Models are not trained. Run the seed/retrain step.")
    try:
        result = registry.predict_time_to_target(data)
    except ModelNotTrained as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    total = None
    if registry.is_ready():
        try:
            total = registry.predict_melting_time(data)["predicted_value"]
        except Exception:
            total = None

    response = {
        "model_name": "time_to_target",
        "model_version": registry.version,
        "algorithm": result["algorithm"],
        "predicted_value": result["predicted_value"],
        "unit": "minutes",
        "lower_bound": result["lower_bound"],
        "upper_bound": result["upper_bound"],
        "confidence_note": "First-order estimate for time remaining to reach target temperature from current state.",
        "metrics": result["metrics"],
        "features": _feature_list({**data, "elapsed_min": payload.elapsed_min}, result["importance"]),
        "caveats": CAVEATS,
        "extra": {
            "current_temperature_c": result["features"].get("current_temperature_c"),
            "elapsed_min": payload.elapsed_min,
            "predicted_total_min": total,
        },
    }
    _store(db, response, data)
    return response


@router.post("/similar", response_model=list[SimilarHeatOut])
def similar(payload: PredictionRequest):
    if not registry.is_ready():
        raise HTTPException(status_code=503, detail="Similar-heat model is not trained.")
    try:
        return registry.similar_heats(payload.model_dump(), k=6)
    except ModelNotTrained as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/models")
def model_catalog():
    meta = registry.metadata
    return {
        "ready": registry.is_ready(),
        "version": registry.version,
        "metadata": meta,
        "stored_predictions": None,
    }
