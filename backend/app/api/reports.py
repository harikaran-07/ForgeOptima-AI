"""Report endpoints: CSV and PDF downloads."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..ml.registry import registry
from ..models import AnomalyRecord, HeatRecord, Prediction
from ..services import energy, reports

router = APIRouter(prefix="/reports", tags=["reports"])

PDF = "application/pdf"


def _filename(base: str, fmt: str) -> str:
    return f"{base}_{datetime.now(timezone.utc):%Y%m%d_%H%M}.{fmt}"


def _download(content: bytes, filename: str, media: str) -> Response:
    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/heat/{heat_id}", include_in_schema=False)
@router.get("/heat/{heat_id}")
def heat_report(heat_id: str, db: Session = Depends(get_db), format: Literal["pdf", "csv"] = "pdf"):
    heat = db.scalar(select(HeatRecord).where(HeatRecord.heat_id == heat_id))
    if not heat:
        raise HTTPException(status_code=404, detail=f"Heat {heat_id} not found.")

    if format == "csv":
        rows = [
            [
                heat.heat_id,
                heat.metal_grade,
                heat.charge_weight_kg,
                heat.initial_temp_c,
                heat.target_temp_c,
                heat.power_kw,
                heat.current_a,
                heat.voltage_v,
                heat.melting_time_min,
                heat.energy_kwh,
                round(energy.energy_per_kg(heat), 4),
                heat.heat_started_at.isoformat(),
                "synthetic" if heat.is_synthetic else heat.source,
            ]
        ]
        content = reports.to_csv(
            [
                "heat_id",
                "metal_grade",
                "charge_weight_kg",
                "initial_temp_c",
                "target_temp_c",
                "power_kw",
                "current_a",
                "voltage_v",
                "melting_time_min",
                "energy_kwh",
                "energy_per_kg",
                "heat_started_at",
                "data_source",
            ],
            rows,
        )
        return _download(content, _filename(f"heat_{heat.heat_id}", "csv"), "text/csv")

    stored = list(
        db.scalars(select(Prediction).where(Prediction.heat_id == heat.heat_id))
    )
    predictions = [
        {
            "model_name": p.model_name,
            "predicted_value": p.predicted_value,
            "actual_value": p.actual_value,
            "abs_error": p.abs_error,
            "unit": p.unit,
            "model_version": p.model_version,
        }
        for p in stored
    ]
    similar: list[dict] = []
    if registry.is_ready():
        try:
            similar = [
                s
                for s in registry.similar_heats(
                    {
                        "metal_grade": heat.metal_grade,
                        "charge_weight_kg": heat.charge_weight_kg,
                        "initial_temp_c": heat.initial_temp_c,
                        "target_temp_c": heat.target_temp_c,
                        "power_kw": heat.power_kw,
                        "energy_per_kg_nominal": energy.energy_per_kg(heat),
                    },
                    k=5,
                )
                if s["heat_id"] != heat.heat_id
            ]
        except Exception:
            similar = []
    ref = energy.grade_reference(db).get(heat.metal_grade)
    pdf = reports.heat_report_pdf(heat, predictions, similar, ref)
    return _download(pdf, _filename(f"heat_{heat.heat_id}", "pdf"), PDF)


@router.get("/energy")
def energy_report(
    db: Session = Depends(get_db),
    format: Literal["pdf", "csv"] = "pdf",
    days: int = Query(30, ge=1, le=365),
    granularity: str = Query("day", pattern="^(day|week|month)$"),
):
    summary = energy.summarize(db, days=days)
    series = energy.series(db, granularity=granularity, days=max(days, 45))
    waste = energy.waste_findings(db)
    carbon = energy.carbon_scenarios(db)

    if format == "csv":
        content = reports.to_csv(
            ["period", "energy_kwh", "charge_kg", "energy_per_kg", "co2_kg_estimated", "heat_count"],
            [
                [s["label"], s["energy_kwh"], s["charge_kg"], s["energy_per_kg"], s["co2_kg"], s["heat_count"]]
                for s in series
            ],
        )
        return _download(content, _filename("energy_report", "csv"), "text/csv")

    pdf = reports.generic_pdf(
        "Energy Consumption Report",
        f"Window: last {days} days · {summary['heat_count']} heats · synthetic dataset where labelled",
        sections=[
            (
                "Summary",
                f"Total energy {summary['total_energy_kwh']:,.1f} kWh across {summary['heat_count']} heats. "
                f"Average {summary['avg_energy_per_heat']:,.1f} kWh/heat, {summary['avg_energy_per_kg']:.3f} kWh/kg. "
                f"Average efficiency score {summary['avg_efficiency_score']:.1f}/100.",
            ),
            (
                "Estimated emissions",
                f"{carbon['current_co2_kg']:,.1f} kg CO2e using a configured factor of "
                f"{carbon['emission_factor_kg_per_kwh']} kg CO2/kWh. These are estimates, not verified measurements.",
            ),
            (
                "Methodology",
                summary["efficiency_method"] + ". Energy per kg is compared with the best decile of the same grade.",
            ),
        ],
        tables=[
            (
                "Consumption by period",
                [["Period", "Energy (kWh)", "Charge (kg)", "kWh/kg", "CO2 (kg)", "Heats"]]
                + [
                    [s["label"], f"{s['energy_kwh']:,.1f}", f"{s['charge_kg']:,.0f}", f"{s['energy_per_kg']:.3f}", f"{s['co2_kg']:,.1f}", s["heat_count"]]
                    for s in series[-24:]
                ],
            ),
            (
                "Highest-excess heats vs grade benchmark",
                [["Heat", "Grade", "Actual kWh", "Expected kWh", "Excess %"]]
                + [
                    [w["heat_id"], w["metal_grade"], f"{w['observed_energy_kwh']:,.0f}", f"{w['expected_energy_kwh']:,.0f}", f"{w['excess_pct']:.1f}%"]
                    for w in waste
                ],
            ),
        ],
    )
    return _download(pdf, _filename("energy_report", "pdf"), PDF)


@router.get("/performance")
def performance_report(db: Session = Depends(get_db), format: Literal["pdf", "csv"] = "pdf"):
    heats = list(
        db.scalars(
            select(HeatRecord)
            .where(HeatRecord.heat_status == "completed")
            .order_by(HeatRecord.heat_started_at.desc())
            .limit(120)
        )
    )
    rows = [["heat_id", "grade", "charge_kg", "actual_min", "predicted_min", "actual_kwh", "predicted_kwh"]]
    preds = list(db.scalars(select(Prediction).order_by(Prediction.created_at.desc()).limit(400)))
    by_heat: dict[str, dict] = {}
    for p in preds:
        by_heat.setdefault(p.heat_id or "", {})[p.model_name] = p.predicted_value

    for h in heats:
        r = by_heat.get(h.heat_id, {})
        rows.append(
            [
                h.heat_id,
                h.metal_grade,
                h.charge_weight_kg,
                round(h.melting_time_min, 1),
                round(r.get("melting_time", 0), 1) if "melting_time" in r else "",
                round(h.energy_kwh, 1),
                round(r.get("energy", 0), 1) if "energy" in r else "",
            ]
        )

    meta = registry.metadata or {}
    metrics_rows = [["Model", "Algorithm", "MAE", "RMSE", "R²", "Dataset size", "Version"]]
    for name, info in (meta.get("models") or {}).items():
        m = info.get("metrics") or {}
        metrics_rows.append(
            [
                name,
                info.get("algorithm", ""),
                m.get("mae", "n/a"),
                m.get("rmse", "n/a"),
                m.get("r2", "n/a"),
                meta.get("dataset_size", ""),
                meta.get("version", ""),
            ]
        )

    if format == "csv":
        return _download(
            reports.to_csv(rows[0], rows[1:]), _filename("prediction_performance", "csv"), "text/csv"
        )

    pdf = reports.generic_pdf(
        "Prediction Performance Report",
        "Model evaluation metrics are computed on a held-out 20% test split of the training data.",
        sections=[
            (
                "Evaluation",
                "Metrics below come from the last training run recorded in the model registry. "
                "They describe performance on synthetic data and should be re-established on plant data.",
            ),
        ],
        tables=[("Model metrics", metrics_rows)],
    )
    return _download(pdf, _filename("prediction_performance", "pdf"), PDF)


@router.get("/anomalies")
def anomaly_report(
    db: Session = Depends(get_db),
    format: Literal["pdf", "csv"] = "pdf",
    limit: int = Query(120, ge=1, le=500),
):
    rows = list(
        db.scalars(select(AnomalyRecord).order_by(AnomalyRecord.detected_at.desc()).limit(limit))
    )
    if format == "csv":
        return _download(
            reports.to_csv(
                ["heat_id", "type", "severity", "detected_at", "observed", "expected", "deviation_pct", "explanation", "action"],
                [
                    [
                        r.heat_id,
                        r.anomaly_type,
                        r.severity,
                        r.detected_at.isoformat(),
                        r.observed_value,
                        r.expected_value,
                        r.deviation_pct,
                        r.explanation,
                        r.suggested_action,
                    ]
                    for r in rows
                ],
            ),
            _filename("anomaly_report", "csv"),
            "text/csv",
        )

    pdf = reports.generic_pdf(
        "Anomaly Report",
        f"{len(rows)} stored anomaly findings · statistical screening, not fault diagnosis",
        sections=[
            (
                "Interpretation",
                "Anomalies are statistical indicators from IsolationForest plus sensor-quality rules. "
                "They highlight records worth inspecting and must be confirmed by a qualified engineer.",
            )
        ],
        tables=[
            (
                "Findings",
                [["Heat", "Type", "Severity", "Observed", "Deviation", "Suggested inspection"]]
                + [
                    [
                        r.heat_id or "-",
                        r.anomaly_type,
                        r.severity,
                        f"{r.observed_value:,.1f}",
                        f"{r.deviation_pct:+.1f}%" if r.deviation_pct is not None else "n/a",
                        (r.suggested_action[:90] + "…") if len(r.suggested_action) > 90 else r.suggested_action,
                    ]
                    for r in rows[:40]
                ],
            )
        ],
    )
    return _download(pdf, _filename("anomaly_report", "pdf"), PDF)


@router.get("/grades")
def grade_report(db: Session = Depends(get_db), format: Literal["pdf", "csv"] = "pdf"):
    grades = energy.grade_analytics(db)
    rows = [["metal_grade", "heat_count", "avg_melting_time_min", "avg_energy_kwh", "avg_energy_per_kg", "avg_efficiency_score"]]
    for g in grades:
        rows.append(
            [
                g["metal_grade"],
                g["heat_count"],
                g["avg_melting_time_min"],
                g["avg_energy_kwh"],
                g["avg_energy_per_kg"],
                g["avg_efficiency_score"],
            ]
        )
    if format == "csv":
        return _download(reports.to_csv(rows[0], rows[1:]), _filename("grade_analysis", "csv"), "text/csv")
    pdf = reports.generic_pdf(
        "Grade-wise Analysis",
        "Melting behaviour differs by alloy; comparisons are always within the same grade.",
        sections=[
            (
                "Reading guide",
                "Average energy per kg and efficiency scores are relative to each grade's own best decile, "
                "so grades are never compared on a single absolute benchmark.",
            )
        ],
        tables=[("Grades", [list(map(str, r)) for r in rows])],
    )
    return _download(pdf, _filename("grade_analysis", "pdf"), PDF)


@router.get("/carbon")
def carbon_report(db: Session = Depends(get_db), format: Literal["pdf", "csv"] = "pdf"):
    carbon = energy.carbon_scenarios(db)
    summary = energy.summarize(db, days=30)
    if format == "csv":
        return _download(
            reports.to_csv(
                ["metric", "value"],
                [
                    ["emission_factor_kg_per_kwh", carbon["emission_factor_kg_per_kwh"]],
                    ["total_energy_kwh_30d", summary["total_energy_kwh"]],
                    ["current_co2_kg", carbon["current_co2_kg"]],
                    ["scenario_improvement_pct", carbon["scenario_improvement_pct"]],
                    ["scenario_co2_kg", carbon["scenario_co2_kg"]],
                    ["avoided_co2_kg", carbon["avoided_co2_kg"]],
                ],
            ),
            _filename("carbon_report", "csv"),
            "text/csv",
        )
    pdf = reports.generic_pdf(
        "Carbon Emissions Report",
        "Estimated emissions from electricity consumption · not verified environmental measurements",
        sections=[
            (
                "Method",
                "CO2 (kg) = energy (kWh) × configured grid emission factor "
                f"({carbon['emission_factor_kg_per_kwh']} kg CO2/kWh). The factor is operator-configurable in Settings.",
            ),
            (
                "Current 30-day estimate",
                f"{carbon['current_co2_kg']:,.1f} kg CO2e from {summary['total_energy_kwh']:,.0f} kWh. "
                f"A {carbon['scenario_improvement_pct']:.0f}% reduction in specific energy would avoid approximately "
                f"{carbon['avoided_co2_kg']:,.1f} kg CO2e.",
            ),
        ],
        tables=[],
    )
    return _download(pdf, _filename("carbon_report", "pdf"), PDF)
