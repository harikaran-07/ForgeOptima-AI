"""Heat record endpoints: listing, detail, CSV upload, manual entry."""
from __future__ import annotations

import hashlib
import io
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.database import get_db
from ..core.logging import get_logger
from ..models import Furnace, HeatRecord, SensorReading, User
from ..ml.synthetic import GRADE_SPECS, nominal_current, required_energy_kwh
from ..schemas import (
    CsvIssue,
    CsvPreviewResponse,
    HeatDetail,
    HeatManualCreate,
    HeatOut,
    PaginatedHeats,
    ReadingOut,
)
from ..services import energy

router = APIRouter(prefix="/heats", tags=["heats"])

# Role constants
ROLE_OPERATOR = "operator"
ROLE_ENGINEER = "engineer"
ROLE_ADMIN = "admin"

# Write-endpoint role requirements: minimum role needed to perform the action
WRITE_ROLE_REQUIREMENTS = {
    "manual_entry": ROLE_OPERATOR,      # operator can manual entry
    "csv_upload": ROLE_OPERATOR,        # operator can upload CSV
    "retrain_models": ROLE_ADMIN,        # admin can retrain models
    "update_settings": ROLE_ENGINEER,    # engineer can update settings
}


def check_write_role(action: str, db: Session) -> None:
    """Raise 403 if the current user does not have sufficient role for the action.

    The caller must have already fetched the user via `db.get(User, ...)` or equivalent;
    this helper reads the user's role from the DB and compares it against the requirement.
    """
    req = WRITE_ROLE_REQUIREMENTS.get(action)
    if req is None:
        return  # no role restriction configured
    user = db.scalar(select(User).limit(1))  # first user in the system
    if not user:
        raise HTTPException(status_code=403, detail="No user found — cannot verify role.")
    if user.role not in (ROLE_ADMIN, req):
        raise HTTPException(status_code=403, detail=f"Role '{user.role}' is not authorized for '{action}'. Required: {req}.")


def get_current_user(db: Session) -> User:
    """Return the first user record; in a production setup this would come from auth tokens/session."""
    return db.scalar(select(User).limit(1)) or User(role=ROLE_OPERATOR, email="operator@demo.local")


REQUIRED_COLUMNS = [
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
]
OPTIONAL_COLUMNS = ["ambient_temp_c", "heat_status", "heat_started_at", "power_factor", "notes"]
NUMERIC_COLUMNS = [
    "charge_weight_kg",
    "initial_temp_c",
    "target_temp_c",
    "power_kw",
    "current_a",
    "voltage_v",
    "melting_time_min",
    "energy_kwh",
    "ambient_temp_c",
]


def _heat_payload(heat: HeatRecord) -> dict[str, Any]:
    return {
        "id": heat.id,
        "heat_id": heat.heat_id,
        "metal_grade": heat.metal_grade,
        "charge_weight_kg": heat.charge_weight_kg,
        "initial_temp_c": heat.initial_temp_c,
        "target_temp_c": heat.target_temp_c,
        "power_kw": heat.power_kw,
        "current_a": heat.current_a,
        "voltage_v": heat.voltage_v,
        "melting_time_min": heat.melting_time_min,
        "energy_kwh": heat.energy_kwh,
        "ambient_temp_c": heat.ambient_temp_c,
        "heat_status": heat.heat_status,
        "source": heat.source,
        "is_synthetic": heat.is_synthetic,
        "heat_started_at": heat.heat_started_at,
        "heat_completed_at": heat.heat_completed_at,
    }


@router.get("/options")
def options(db: Session = Depends(get_db)):
    grades = list(db.scalars(select(HeatRecord.metal_grade).distinct()))
    sources = list(db.scalars(select(HeatRecord.source).distinct()))
    furnaces = list(db.scalars(select(Furnace)))
    bounds = db.execute(
        select(
            func.min(HeatRecord.charge_weight_kg),
            func.max(HeatRecord.charge_weight_kg),
            func.min(HeatRecord.melting_time_min),
            func.max(HeatRecord.melting_time_min),
            func.min(HeatRecord.energy_kwh),
            func.max(HeatRecord.energy_kwh),
            func.min(HeatRecord.heat_started_at),
            func.max(HeatRecord.heat_started_at),
        )
    ).first()
    return {
        "grades": sorted(g for g in grades if g),
        "grade_catalog": {
            g: {"target_temp_c": s["target_temp_c"], "specific_energy_kwh_per_t": s["specific_energy_kwh_per_t"]}
            for g, s in GRADE_SPECS.items()
        },
        "sources": sorted(s for s in sources if s),
        "furnaces": [
            {"id": f.id, "name": f.name, "capacity_kg": f.capacity_kg, "min_power_kw": f.min_power_kw, "max_power_kw": f.max_power_kw}
            for f in furnaces
        ],
        "bounds": {
            "charge_kg": [bounds[0] or 0, bounds[1] or 0],
            "melting_time_min": [bounds[2] or 0, bounds[3] or 0],
            "energy_kwh": [bounds[4] or 0, bounds[5] or 0],
            "started_at": [bounds[6], bounds[7]],
        },
        "total_heats": db.scalar(select(func.count(HeatRecord.id))) or 0,
    }


@router.get("", response_model=PaginatedHeats)
def list_heats(
    db: Session = Depends(get_db),
    metal_grade: Optional[str] = None,
    search: Optional[str] = None,
    min_charge: Optional[float] = None,
    max_charge: Optional[float] = None,
    min_duration: Optional[float] = None,
    max_duration: Optional[float] = None,
    min_energy: Optional[float] = None,
    max_energy: Optional[float] = None,
    status: Optional[str] = None,
    source: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=5, le=200),
):
    stmt = select(HeatRecord)
    if metal_grade:
        stmt = stmt.where(HeatRecord.metal_grade == metal_grade)
    if search:
        stmt = stmt.where(HeatRecord.heat_id.ilike(f"%{search}%"))
    if min_charge is not None:
        stmt = stmt.where(HeatRecord.charge_weight_kg >= min_charge)
    if max_charge is not None:
        stmt = stmt.where(HeatRecord.charge_weight_kg <= max_charge)
    if min_duration is not None:
        stmt = stmt.where(HeatRecord.melting_time_min >= min_duration)
    if max_duration is not None:
        stmt = stmt.where(HeatRecord.melting_time_min <= max_duration)
    if min_energy is not None:
        stmt = stmt.where(HeatRecord.energy_kwh >= min_energy)
    if max_energy is not None:
        stmt = stmt.where(HeatRecord.energy_kwh <= max_energy)
    if status:
        stmt = stmt.where(HeatRecord.heat_status == status)
    if source:
        stmt = stmt.where(HeatRecord.source == source)
    if date_from:
        stmt = stmt.where(HeatRecord.heat_started_at >= date_from)
    if date_to:
        stmt = stmt.where(HeatRecord.heat_started_at <= date_to)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(
        db.scalars(
            stmt.order_by(HeatRecord.heat_started_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return {
        "items": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(math.ceil(total / page_size), 1),
    }


@router.post("/manual", response_model=HeatDetail, status_code=201)
def create_manual(payload: HeatManualCreate, db: Session = Depends(get_db)):
    # Check write role for manual entry
    check_write_role("manual_entry", db)
    
    started = payload.heat_started_at or datetime.now(timezone.utc)
    heat_id = payload.heat_id or f"MAN-{started:%Y%m%d-%H%M%S}"
    if db.scalar(select(HeatRecord).where(HeatRecord.heat_id == heat_id)):
        raise HTTPException(status_code=409, detail=f"Heat {heat_id} already exists.")

    voltage = payload.voltage_v or 760.0
    current = payload.current_a or nominal_current(payload.power_kw, voltage)
    derived_energy = payload.energy_kwh or round(payload.power_kw * payload.melting_time_min / 60.0, 2)
    furnace = db.scalar(select(Furnace).order_by(Furnace.id).limit(1))

    heat = HeatRecord(
        heat_id=heat_id,
        furnace_id=furnace.id if furnace else None,
        metal_grade=payload.metal_grade,
        charge_weight_kg=payload.charge_weight_kg,
        initial_temp_c=payload.initial_temp_c,
        target_temp_c=payload.target_temp_c,
        power_kw=payload.power_kw,
        current_a=current,
        voltage_v=voltage,
        melting_time_min=payload.melting_time_min,
        energy_kwh=derived_energy,
        ambient_temp_c=payload.ambient_temp_c,
        heat_status=payload.heat_status,
        source="manual",
        is_synthetic=False,
        notes=payload.notes,
        heat_started_at=started,
        heat_completed_at=started + timedelta(minutes=payload.melting_time_min),
    )

    # consistency check: energy vs integral of power over duration
    expected = payload.power_kw * payload.melting_time_min / 60.0
    if expected > 0 and abs(derived_energy - expected) / expected > 0.35:
        heat.notes = (heat.notes or "") + (
            f"\nData-quality note: reported energy differs from power x duration by "
            f"{abs(derived_energy - expected) / expected * 100:.0f}%."
        )

    db.add(heat)
    db.flush()

    # build a consistent single-point trace so history charts still work
    design_energy = required_energy_kwh(
        payload.metal_grade, payload.charge_weight_kg, payload.initial_temp_c, payload.target_temp_c
    )
    for i in range(0, 11):
        frac = i / 10
        db.add(
            SensorReading(
                heat_record_id=heat.id,
                ts=started + timedelta(minutes=payload.melting_time_min * frac),
                elapsed_min=round(payload.melting_time_min * frac, 1),
                power_kw=round(payload.power_kw * (0.6 + 0.4 * min(frac / 0.1, 1.0)), 1),
                current_a=round(current * (0.6 + 0.4 * min(frac / 0.1, 1.0)), 1),
                voltage_v=voltage,
                temperature_c=round(
                    payload.initial_temp_c + (payload.target_temp_c - payload.initial_temp_c) * frac, 1
                ),
                energy_kwh=round(derived_energy * frac, 2),
                melt_progress=round(min(frac * 100, 100), 1),
                charge_weight_kg=payload.charge_weight_kg,
                is_synthetic=False,
                quality_flag="derived" if design_energy else "ok",
            )
        )
    db.commit()
    db.refresh(heat)
    return {**_heat_payload(heat), "energy_per_kg": round(energy.energy_per_kg(heat), 4), "reading_count": 11, "notes": heat.notes}


@router.post("/upload", response_model=CsvPreviewResponse)
async def upload_csv(
    file: UploadFile = File(...),
    commit: bool = Query(False, description="Import validated rows into the database"),
    db: Session = Depends(get_db),
):
    # Check write role for CSV upload
    check_write_role("csv_upload", db)
    
    raw = await file.read()
    if len(raw) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_mb} MB limit.")
    if not (file.filename or "").lower().endswith((".csv", ".txt")):
        raise HTTPException(status_code=415, detail="Only .csv files are accepted.")

    try:
        frame = pd.read_csv(io.BytesIO(raw))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {exc}") from exc

    frame.columns = [str(c).strip().lower() for c in frame.columns]
    issues: list[CsvIssue] = []
    missing = [c for c in REQUIRED_COLUMNS if c not in frame.columns]
    extra = [c for c in frame.columns if c not in REQUIRED_COLUMNS + OPTIONAL_COLUMNS]
    valid = [c for c in frame.columns if c in REQUIRED_COLUMNS + OPTIONAL_COLUMNS]

    missing_values = {c: int(frame[c].isna().sum()) for c in frame.columns}

    if missing:
        for col in missing:
            issues.append(CsvIssue(column=col, message=f"Required column '{col}' is missing.", severity="error"))
        return {
            "filename": file.filename or "upload.csv",
            "row_count": len(frame),
            "valid_columns": valid,
            "missing_columns": missing,
            "extra_columns": extra,
            "missing_values": missing_values,
            "issues": issues,
            "sample_rows": frame.head(8).to_dict("records"),
            "ready_to_import": False,
        }

    cleaned = frame.copy()
    for col in NUMERIC_COLUMNS:
        if col in cleaned.columns:
            cleaned[col] = pd.to_numeric(cleaned[col], errors="coerce")

    for col in NUMERIC_COLUMNS:
        if col in cleaned.columns and cleaned[col].isna().any():
            bad = int(cleaned[col].isna().sum())
            issues.append(
                CsvIssue(column=col, message=f"{bad} non-numeric or empty value(s) in '{col}'.", severity="error")
            )

    if "metal_grade" in cleaned.columns:
        unknown = set(cleaned["metal_grade"].astype(str).str.strip()) - set(GRADE_SPECS.keys())
        if unknown:
            issues.append(
                CsvIssue(
                    column="metal_grade",
                    message=f"Unrecognised grades will be kept as-is: {', '.join(sorted(unknown))}.",
                    severity="warning",
                )
            )

    # physics plausibility and duplicate checks per row
    seen: set[str] = set()
    importable: list[dict[str, Any]] = []
    for idx, row in cleaned.iterrows():
        row_no = int(idx) + 2
        row_errors = []
        heat_id = str(row.get("heat_id", "")).strip()
        if not heat_id or heat_id.lower() == "nan":
            row_errors.append("missing heat_id")
        elif heat_id in seen:
            row_errors.append("duplicate heat_id within file")
        seen.add(heat_id)

        charge = row.get("charge_weight_kg")
        duration = row.get("melting_time_min")
        power = row.get("power_kw")
        e_kwh = row.get("energy_kwh")
        if pd.notna(charge) and (charge <= 0 or charge > 15000):
            row_errors.append("charge_weight_kg outside 0-15000")
        if pd.notna(duration) and (duration <= 0 or duration > 600):
            row_errors.append("melting_time_min outside 0-600")
        if pd.notna(power) and (power <= 0 or power > 6000):
            row_errors.append("power_kw outside 0-6000")
        if pd.notna(e_kwh) and e_kwh <= 0:
            row_errors.append("energy_kwh must be positive")

        if pd.notna(power) and pd.notna(duration) and pd.notna(e_kwh) and e_kwh > 0:
            implied = power * duration / 60.0
            if abs(e_kwh - implied) / max(implied, 1e-6) > 0.5:
                issues.append(
                    CsvIssue(
                        row=row_no,
                        column="energy_kwh",
                        message="Energy differs from power x duration by more than 50% — row kept with a quality flag.",
                        severity="warning",
                    )
                )

        if row_errors:
            issues.append(CsvIssue(row=row_no, message="; ".join(row_errors)))
        else:
            importable.append(row.to_dict())

    duplicate_ids = set(
        str(x) for x in db.scalars(select(HeatRecord.heat_id).where(HeatRecord.heat_id.in_([r["heat_id"] for r in importable])))
    ) if importable else set()
    if duplicate_ids:
        issues.append(
            CsvIssue(
                message=f"{len(duplicate_ids)} heat ID(s) already exist in the database and will be skipped.",
                severity="warning",
            )
        )

    ready = not any(i.severity == "error" for i in issues if i.row is None) and bool(importable)
    imported = 0
    skipped = 0

    if commit and ready:
        furnace = db.scalar(select(Furnace).order_by(Furnace.id).limit(1))
        for row in importable:
            heat_id = str(row["heat_id"]).strip()
            if heat_id in duplicate_ids:
                skipped += 1
                continue
            started_raw = row.get("heat_started_at")
            try:
                started = pd.to_datetime(started_raw).to_pydatetime() if pd.notna(started_raw) else datetime.now(timezone.utc)
            except Exception:
                started = datetime.now(timezone.utc)
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            duration = float(row["melting_time_min"])
            status_val = str(row.get("heat_status") or "completed").strip().lower()
            if status_val not in {"completed", "aborted", "running"}:
                status_val = "completed"
            heat = HeatRecord(
                heat_id=heat_id,
                furnace_id=furnace.id if furnace else None,
                metal_grade=str(row["metal_grade"]).strip(),
                charge_weight_kg=float(row["charge_weight_kg"]),
                initial_temp_c=float(row["initial_temp_c"]),
                target_temp_c=float(row["target_temp_c"]),
                power_kw=float(row["power_kw"]),
                current_a=float(row["current_a"]),
                voltage_v=float(row["voltage_v"]),
                melting_time_min=duration,
                energy_kwh=float(row["energy_kwh"]),
                ambient_temp_c=float(row["ambient_temp_c"]) if pd.notna(row.get("ambient_temp_c")) else 32.0,
                heat_status=status_val,
                source="csv_upload",
                is_synthetic=False,
                heat_started_at=started,
                heat_completed_at=started + timedelta(minutes=duration),
            )
            db.add(heat)
            db.flush()
            # derive a smooth trace consistent with the row (energy integral preserved)
            power = float(row["power_kw"])
            energy_total = float(row["energy_kwh"])
            for i in range(0, 21):
                frac = i / 20
                db.add(
                    SensorReading(
                        heat_record_id=heat.id,
                        ts=started + timedelta(minutes=duration * frac),
                        elapsed_min=round(duration * frac, 1),
                        power_kw=round(power * (0.62 + 0.38 * min(frac / 0.1, 1.0)), 1),
                        current_a=round(float(row["current_a"]) * (0.62 + 0.38 * min(frac / 0.1, 1.0)), 1),
                        voltage_v=float(row["voltage_v"]),
                        temperature_c=round(
                            float(row["initial_temp_c"])
                            + (float(row["target_temp_c"]) - float(row["initial_temp_c"])) * frac,
                            1,
                        ),
                        energy_kwh=round(energy_total * frac, 2),
                        melt_progress=round(min(frac * 100, 100), 1),
                        charge_weight_kg=float(row["charge_weight_kg"]),
                        is_synthetic=False,
                        quality_flag="derived",
                    )
                )
            imported += 1
        db.commit()
        log.info("CSV import: %s imported, %s skipped", imported, skipped)

    return {
        "filename": file.filename or "upload.csv",
        "row_count": int(len(cleaned)),
        "valid_columns": valid,
        "missing_columns": [],
        "extra_columns": extra,
        "missing_values": missing_values,
        "issues": issues[:60],
        "sample_rows": cleaned.head(8).fillna("").to_dict("records"),
        "ready_to_import": ready,
        "imported": imported,
        "skipped": skipped,
    }


@router.get("/{heat_id}", response_model=HeatDetail)
def get_heat(heat_id: str, db: Session = Depends(get_db)):
    heat = db.scalar(select(HeatRecord).where(HeatRecord.heat_id == heat_id))
    if not heat:
        raise HTTPException(status_code=404, detail=f"Heat {heat_id} not found.")
    count = db.scalar(
        select(func.count(SensorReading.id)).where(SensorReading.heat_record_id == heat.id)
    ) or 0
    return {
        **_heat_payload(heat),
        "energy_per_kg": round(energy.energy_per_kg(heat), 4),
        "reading_count": count,
        "notes": heat.notes,
    }


@router.get("/{heat_id}/readings", response_model=list[ReadingOut])
def get_readings(heat_id: str, db: Session = Depends(get_db), limit: int = Query(400, ge=10, le=3000)):
    heat = db.scalar(select(HeatRecord).where(HeatRecord.heat_id == heat_id))
    if not heat:
        raise HTTPException(status_code=404, detail=f"Heat {heat_id} not found.")
    rows = list(
        db.scalars(
            select(SensorReading)
            .where(SensorReading.heat_record_id == heat.id)
            .order_by(SensorReading.elapsed_min)
        )
    )
    step = max(len(rows) // limit, 1)
    return rows[::step]


@router.get("/{heat_id}/comparison")
def comparison(heat_id: str, db: Session = Depends(get_db), limit: int = Query(6, ge=3, le=20)):
    from ..ml.registry import registry

    heat = db.scalar(select(HeatRecord).where(HeatRecord.heat_id == heat_id))
    if not heat:
        raise HTTPException(status_code=404, detail=f"Heat {heat_id} not found.")
    payload = {
        "metal_grade": heat.metal_grade,
        "charge_weight_kg": heat.charge_weight_kg,
        "initial_temp_c": heat.initial_temp_c,
        "target_temp_c": heat.target_temp_c,
        "power_kw": heat.power_kw,
        "energy_per_kg_nominal": energy.energy_per_kg(heat),
    }
    try:
        similar = [s for s in registry.similar_heats(payload, k=limit + 1) if s["heat_id"] != heat.heat_id][:limit]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    refs = energy.grade_reference(db)
    ref = refs.get(heat.metal_grade)
    return {
        "heat": _heat_payload(heat),
        "energy_per_kg": round(energy.energy_per_kg(heat), 4),
        "benchmark_energy_per_kg": round(ref, 4) if ref else None,
        "efficiency_score": energy.efficiency_score(energy.energy_per_kg(heat), ref) if ref else None,
        "similar": similar,
    }