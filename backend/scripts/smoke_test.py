"""Smoke-test every ForgeOptima AI API surface against a running backend.

Usage (from backend/, with the server running):
    python -m scripts.smoke_test [--base http://127.0.0.1:8000]
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import time

import httpx

SUFFIX = str(int(time.time()))[-6:]

FAILED: list[str] = []
PASSED = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if condition:
        PASSED += 1
        print(f"  PASS  {name}")
    else:
        FAILED.append(f"{name} {detail}")
        print(f"  FAIL  {name} {detail}")


def main() -> int:
    try:  # Windows consoles may default to cp1252
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    base = args.base.rstrip("/")
    api = f"{base}/api"
    client = httpx.Client(base_url=api, timeout=60.0)

    print("\n== Core ==")
    r = client.get("/health")
    check("health", r.status_code == 200 and r.json()["models_ready"], r.text[:160])

    r = client.get("/furnace/status")
    st = r.json()
    check("furnace status", r.status_code == 200 and st["active_heat_id"] is not None, r.text[:200])
    check("furnace labels data mode", st.get("data_mode") in {"historical", "simulated", "offline"})
    check("furnace status labelled", "SIMULATED" in st["data_source_note"].upper() or "historical" in st["data_source_note"].lower())

    r = client.get("/analytics/dashboard")
    d = r.json()
    kpis = d.get("kpis", {})
    expected = [
        "active_furnace",
        "current_temperature_c",
        "current_power_kw",
        "current_current_a",
        "voltage_v",
        "charge_weight_kg",
        "predicted_melting_time_min",
        "predicted_energy_kwh",
        "efficiency_score",
        "active_heat_id",
    ]
    check("dashboard 10 KPIs", all(k in kpis for k in expected), str(list(kpis))[:200])
    check("dashboard charts", len(d["temperature_series"]) > 2 and len(d["energy_by_heat"]) > 3)
    check("dashboard grade performance", len(d["grade_performance"]) >= 3)
    check(
        "melting performance has predictions",
        any(p["predicted_min"] for p in d["melting_performance"]),
    )

    print("\n== Heats ==")
    r = client.get("/heats", params={"page_size": 5, "metal_grade": "MS"})
    page = r.json()
    check("heat list paged", r.status_code == 200 and len(page["items"]) == 5 and page["total"] > 100)
    heat_id = page["items"][0]["heat_id"]
    r = client.get(f"/heats/{heat_id}")
    check("heat detail", r.status_code == 200 and r.json()["heat_id"] == heat_id)
    check("heat detail energy_per_kg", r.json()["energy_per_kg"] > 0)
    r = client.get(f"/heats/{heat_id}/readings")
    check("heat readings", r.status_code == 200 and len(r.json()) > 10)
    r = client.get(f"/heats/{heat_id}/comparison")
    comp = r.json()
    check("heat comparison + KNN evidence", r.status_code == 200 and len(comp["similar"]) >= 3)
    check("comparison benchmark", comp["benchmark_energy_per_kg"] is not None)
    r = client.get("/heats/options")
    check("heat filter options", r.status_code == 200 and len(r.json()["grades"]) >= 5)

    # manual entry
    manual = {
        "metal_grade": "MS",
        "charge_weight_kg": 2500,
        "initial_temp_c": 40,
        "target_temp_c": 1560,
        "power_kw": 1600,
        "melting_time_min": 72,
        "energy_kwh": 1920,
        "heat_status": "completed",
        "heat_started_at": "2026-11-15T06:00:00Z",
        "heat_id": f"MAN-TEST-{SUFFIX}",
        "notes": "smoke test",
    }
    r = client.post("/heats/manual", json=manual)
    check("manual heat entry", r.status_code in (201, 409), f"{r.status_code} {r.text[:200]}")
    if r.status_code == 409:
        manual["heat_id"] = f"MAN-TEST-{SUFFIX}-b"
        r = client.post("/heats/manual", json=manual)
    check("manual heat persisted", r.status_code == 201 and r.json()["source"] == "manual", f"{r.status_code} {r.text[:200]}")

    # CSV upload: preview then commit
    csv_body = (
        "heat_id,metal_grade,charge_weight_kg,initial_temp_c,target_temp_c,power_kw,current_a,voltage_v,melting_time_min,energy_kwh,ambient_temp_c,heat_status\n"
        f"CSV-{SUFFIX}-1,MS,2200,30,1550,1500,1240,760,68,1700,30.5,completed\n"
        f"CSV-{SUFFIX}-2,SS304,3100,25,1520,1900,1570,745,84,2650,32.0,completed\n"
        f"CSV-{SUFFIX}-3,MS,0,30,1550,1500,1240,760,68,1700,30.5,completed\n"
    )
    files = {"file": ("heats.csv", io.BytesIO(csv_body.encode()), "text/csv")}
    r = client.post("/heats/upload", files=files, params={"commit": "false"})
    prev = r.json()
    check("csv preview validates columns", r.status_code == 200 and prev["missing_columns"] == [], r.text[:200])
    check("csv preview catches invalid row", any(i.get("row") for i in prev["issues"]), json.dumps(prev["issues"])[:200])
    files = {"file": ("heats.csv", io.BytesIO(csv_body.encode()), "text/csv")}
    r = client.post("/heats/upload", files=files, params={"commit": "true"})
    imp = r.json()
    check("csv import commits valid rows", r.status_code == 200 and imp["imported"] >= 1, json.dumps(imp)[:300])
    r = client.post(
        "/heats/upload",
        files={"file": ("bad.csv", io.BytesIO(b"foo,bar\n1,2\n"), "text/csv")},
        params={"commit": "false"},
    )
    check("csv rejects wrong schema", r.status_code == 200 and r.json()["missing_columns"])

    print("\n== Predictions ==")
    payload = {
        "metal_grade": "MS",
        "charge_weight_kg": 3000,
        "initial_temp_c": 35,
        "target_temp_c": 1550,
        "power_kw": 1900,
        "elapsed_min": 20,
    }
    r = client.post("/predict/melting-time", json=payload)
    mt = r.json()
    check("melting time prediction", r.status_code == 200 and 20 < mt["predicted_value"] < 250, r.text[:200])
    check("melting time has uncertainty", mt.get("lower_bound") is not None and mt["upper_bound"] > mt["predicted_value"])
    check("melting time real metrics", mt["metrics"].get("r2", 0) > 0.5, str(mt["metrics"]))
    check("melting time feature importance", len(mt["features"]) >= 4)
    check("remaining time computed", mt["extra"]["remaining_min"] == round(max(mt["predicted_value"] - 20, 0), 1))

    r = client.post("/predict/energy", json=payload)
    en = r.json()
    per_kg = en["predicted_value"] / 3000
    check("energy prediction", r.status_code == 200 and 0.2 < per_kg < 1.1, f"{en.get('predicted_value')} kWh/kg={per_kg:.3f}")
    check("energy benchmark comparison", en["extra"].get("comparable_benchmark_kwh") is not None)

    r = client.post("/predict/time-to-target", json={**payload, "temperature_now_c": 900})
    check("time-to-target prediction", r.status_code == 200 and r.json()["predicted_value"] > 0, r.text[:200])

    r = client.post("/predict/similar", json=payload)
    sims = r.json()
    check("similar heats (KNN)", r.status_code == 200 and len(sims) == 6)
    check("similar heats same-ish grade", any(s["metal_grade"] == "MS" for s in sims))

    r = client.post("/predict/melting-time", json={**payload, "target_temp_c": 10})
    check("invalid target rejected (422)", r.status_code == 422)

    print("\n== Optimizer ==")
    r = client.get("/optimize/context")
    ctx = r.json()
    check("optimizer context", r.status_code == 200 and ctx["limits"]["max_power_kw"] > 0)
    r = client.post(
        "/optimize/analyze",
        json={
            "metal_grade": "MS",
            "charge_weight_kg": 3000,
            "initial_temp_c": 35,
            "target_temp_c": 1550,
            "current_power_kw": 1500,
            "alternative_power_kw": 2000,
        },
    )
    opt = r.json()
    check("what-if analysis", r.status_code == 200 and opt["alternative"]["melting_time_min"] > 0, r.text[:200])
    check("what-if energy delta reported", "delta_energy_kwh" in opt)
    check("optimizer safety notes", len(opt["safety_notes"]) >= 3)
    check("optimizer historical evidence", len(opt["evidence"]) >= 3)
    check("optimizer temperature curve", len(opt["current"]["temperature_curve"]) > 5)
    r = client.post(
        "/optimize/analyze",
        json={
            "metal_grade": "MS",
            "charge_weight_kg": 3000,
            "initial_temp_c": 35,
            "target_temp_c": 1550,
            "current_power_kw": 1500,
            "alternative_power_kw": 3200,
        },
    )
    check("alternative clipped to limits", r.json()["alternative"]["power_kw"] <= opt["limits"]["max_power_kw"])
    r = client.get("/optimize/scenarios")
    check("scenarios stored", r.status_code == 200 and len(r.json()) >= 1)

    print("\n== Digital twin ==")
    r = client.get("/digital-twin/model")
    check("twin model documented", r.status_code == 200 and len(r.json()["stages"]) == 6)
    r = client.post(
        "/digital-twin/start",
        json={
            "metal_grade": "MS",
            "charge_weight_kg": 3000,
            "initial_temp_c": 35,
            "target_temp_c": 1550,
            "power_kw": 1900,
            "efficiency": 0.72,
            "time_step_min": 1.0,
        },
    )
    twin = r.json()
    check("twin start", r.status_code == 200 and twin["session_id"], r.text[:200])
    sid = twin["session_id"]
    prev_temp = twin["temperature_c"]
    monotonic = True
    for _ in range(4):
        r = client.post("/digital-twin/step", json={"session_id": sid, "steps": 10})
        st = r.json()
        if st["temperature_c"] < prev_temp - 0.5:
            monotonic = False
        prev_temp = st["temperature_c"]
    check("twin temperature rises", monotonic and st["temperature_c"] > 35)
    check("twin energy accumulates", st["energy_kwh"] > 0)
    check("twin stage reported", st["stage"] in [
        "Charging",
        "Initial Heating",
        "Intermediate Melting",
        "Complete Melting",
        "Temperature Adjustment",
        "Target Temperature Reached",
    ])
    r = client.post("/digital-twin/stop", json={"session_id": sid, "steps": 1})
    check("twin stop", r.status_code == 200)

    print("\n== Anomalies ==")
    r = client.get("/anomalies")
    check("anomaly list", r.status_code == 200 and len(r.json()) > 0)
    r = client.get("/anomalies/summary")
    check("anomaly summary", r.status_code == 200 and r.json()["total"] > 0)
    r = client.post("/anomalies/analyze", json={"heat_id": heat_id, "persist": False})
    an = r.json()
    check("anomaly analysis", r.status_code == 200 and "records" in an, r.text[:200])
    check("sensor quality checks", len(an["sensor_quality"]) >= 4)
    r = client.post("/anomalies/scan", params={"limit": 3})
    check("anomaly scan", r.status_code == 200)
    r = client.get(f"/anomalies/quality/{heat_id}")
    check("quality endpoint", r.status_code == 200 and len(r.json()) >= 4)

    print("\n== Energy & grades ==")
    r = client.get("/analytics/energy", params={"days": 30})
    en = r.json()
    check("energy summary", r.status_code == 200 and en["summary"]["heat_count"] > 0)
    check("energy series", len(en["series"]) > 5)
    check("waste detection", isinstance(en["waste_findings"], list))
    check("carbon calculated", en["carbon"]["current_co2_kg"] > 0)
    check("efficiency method documented", "10th-percentile" in en["methodology"]["efficiency_score"])
    r = client.get("/analytics/grades")
    check("grade analytics", r.status_code == 200 and len(r.json()["grades"]) >= 5)
    r = client.get("/analytics/performance")
    perf = r.json()
    check("model performance", r.status_code == 200 and len(perf["versions"]) > 0)
    check("retraining policy present", "validation" in perf["retraining"]["policy"])

    print("\n== Reports ==")
    for name, path in [
        ("energy pdf", f"/reports/energy?format=pdf"),
        ("energy csv", f"/reports/energy?format=csv&days=60"),
        ("heat pdf", f"/reports/heat/{heat_id}"),
        ("heat csv", f"/reports/heat/{heat_id}?format=csv"),
        ("performance pdf", "/reports/performance"),
        ("anomaly pdf", "/reports/anomalies"),
        ("grades pdf", "/reports/grades"),
        ("carbon pdf", "/reports/carbon"),
    ]:
        r = client.get(path)
        minimum = 500 if "pdf" in name else 80
        ok = r.status_code == 200 and len(r.content) > minimum
        check(name, ok, f"{r.status_code} {len(r.content)}b")
        if "pdf" in name:
            check(f"{name} magic bytes", r.content[:4] == b"%PDF", str(r.content[:4]))

    print("\n== AI ==")
    r = client.get("/ai/status")
    status = r.json()
    check("ai status reports state", r.status_code == 200 and "online" in status)
    print(f"        SHAKTHI AI online={status['online']} :: {status['detail']}")
    r = client.get("/ai/suggestions")
    check("ai suggestions", len(r.json()["suggestions"]) >= 9)
    r = client.get("/ai/context")
    check("ai context read-only preview", r.status_code == 200 and "latest_heat" in r.json()["context"])
    r = client.get("/ai/history")
    check("ai history", r.status_code == 200)

    print("\n== Live simulation ==")
    r = client.post(
        "/furnace/simulate",
        params={"action": "start"},
        json={
            "metal_grade": "MS",
            "charge_weight_kg": 2500,
            "target_temp_c": 1550,
            "initial_temp_c": 40,
            "power_kw": 1700,
            "interval_seconds": 1,
            "speed_multiplier": 30,
        },
    )
    sim = r.json()
    check("simulation start", r.status_code == 200 and sim["simulation"]["running"], r.text[:200])
    check("simulation labelled synthetic", sim["simulation"]["is_synthetic"] is True)
    r = client.get("/furnace/readings")
    check("simulation readings", r.status_code == 200 and r.json()["mode"] == "simulated")
    r = client.post("/furnace/simulate", params={"action": "pause"})
    check("simulation pause", r.json()["simulation"]["paused"] is True)
    r = client.post("/furnace/simulate", params={"action": "resume"})
    check("simulation resume", r.json()["simulation"]["paused"] is False)
    r = client.post("/furnace/simulate", params={"action": "configure"}, json={"speed_multiplier": 40})
    check("simulation speed", r.json()["simulation"]["speed_multiplier"] == 40)
    r = client.get("/furnace/status")
    check("status switches to simulated mode", r.json()["data_mode"] == "simulated")
    r = client.post("/furnace/simulate", params={"action": "reset"})
    check("simulation reset", r.json()["simulation"]["running"] is False)

    print("\n== Model registry & settings ==")
    r = client.get("/models/status")
    ms = r.json()
    check("model status", r.status_code == 200 and ms["ready"])
    check("model metrics stored", ms["models"]["melting_time"]["metrics"].get("mae") is not None)
    r = client.get("/models")
    check("model versions listed", r.status_code == 200 and len(r.json()) >= 3)
    r = client.post("/models/retrain")
    check("retrain guarded + works", r.status_code == 200 and len(r.json()["trained"]) >= 3, r.text[:200])
    r = client.get("/settings")
    check("settings read", r.status_code == 200 and "emission_factor_kg_per_kwh" in r.json()["runtime"])
    r = client.put("/settings", json={"emission_factor_kg_per_kwh": 0.68})
    check("settings update", r.status_code == 200 and r.json()["runtime"]["emission_factor_kg_per_kwh"] == 0.68)
    client.put("/settings", json={"emission_factor_kg_per_kwh": 0.71})

    print("\n== Security / reliability ==")
    r = client.post("/heats/manual", json={"metal_grade": "MS", "charge_weight_kg": -50})
    check("negative charge rejected", r.status_code == 422)
    r = client.post("/anomalies/analyze", json={"heat_id": "NOPE-123"})
    check("unknown heat 404", r.status_code == 404)
    r = client.get("/digital-twin/step")
    check("wrong method rejected", r.status_code == 405)
    r = httpx.get(f"{base}/", timeout=10)
    check("root endpoint", r.status_code == 200)

    print("\n" + "=" * 60)
    print(f"{PASSED} checks passed, {len(FAILED)} failed")
    for f in FAILED:
        print("  -", f)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
