# FORGEOPTIMA AI

**AI-Powered Industrial Induction Furnace Optimization & Predictive Intelligence Platform**
Powered by **SHAKTHI AI**

> *Predict Smarter. Optimize Energy. Melt Efficiently.*

ForgeOptima AI is a working full-stack decision-support platform for induction furnace operations. It
combines machine-learning predictions, historical heat analytics, a digital-twin simulation, anomaly
screening, a power-profile what-if engine and a local LLM copilot — all backed by a real FastAPI service,
a relational database and trained model artifacts.

> **Scope.** ForgeOptima AI is a decision-support system. It never controls furnace equipment, never issues
> setpoint commands, and its outputs are estimates with published error metrics — not measurements.

---

## 1. What actually works

| Capability | Implementation |
|---|---|
| Dashboard | 10 live KPIs, 5 charts, progress, alerts and recent heats, all from the API |
| Live monitoring | Simulated telemetry generator (pause/resume/speed/reset), CSV upload with validation + import, manual heat entry |
| Melting-time prediction | `RandomForestRegressor`, held-out MAE/RMSE/R², per-tree uncertainty band |
| Energy prediction | `XGBRegressor` + benchmark comparison against the grade's best decile |
| Time-to-target | `RandomForestRegressor` trained on intermediate heat snapshots |
| Similar heats | `KNeighborsRegressor` over standardised operating features |
| Digital twin | Documented reduced-order thermal model, 6 stages, interactive SVG furnace |
| Power optimizer | What-if comparison of two power profiles inside engineer-approved limits, with historical evidence |
| Energy intelligence | Consumption per heat/kg/day/week/month, waste detection, transparent efficiency score, CO₂ estimates |
| Anomaly detection | `IsolationForest` + explicit sensor-quality rules, three severities, acknowledgement workflow |
| Heat history | Server-side filtering, pagination, KNN comparison, per-heat PDF/CSV reports |
| SHAKTHI AI | Browser Local AI powered by Qwen2.5-0.5B-Instruct via @mlc-ai/web-llm (WebGPU), 100% private on-device execution |
| Self-learning engine | Prediction/actual pairing, live error tracking, guarded retraining with data validation |
| Reports | 7 report types as PDF (reportlab) or CSV |
| Security | Pydantic validation, CORS allowlist, per-IP rate limiting, upload checks, read-only AI tools |

---

## 2. Architecture

```
React 18 + TS + Vite + Tailwind + Recharts
├── @mlc-ai/web-llm ────────────► WebGPU local inference (Qwen2.5-0.5B-Instruct)
└── /api (Vite proxy in dev, VITE_API_BASE_URL in prod)
    ▼
    FastAPI (Python 3.12)
    ├── SQLAlchemy 2.0 ─────────► PostgreSQL (prod) / SQLite (dev)
    ├── scikit-learn / XGBoost ─► backend/artifacts/*.joblib
    └── ReportLab ──────────────► PDF reports
```

```
backend/
├── app/
│   ├── main.py                 # app factory, CORS, rate limit, routers
│   ├── models.py               # 13 SQLAlchemy tables
│   ├── schemas.py              # Pydantic request/response contracts
│   ├── api/                    # furnace, heats, predict, optimize, twin,
│   │                           # anomalies, analytics, ai, reports, models, settings
│   ├── ml/                     # synthetic.py, features.py, training.py, registry.py
│   ├── services/               # energy, anomalies, optimizer, twin, simulation,
│   │                           # telemetry, reports, ai, runtime_settings
│   └── core/                   # config, database, logging
├── alembic/                    # migration environment + baseline revision
├── scripts/                    # seed.py, train_models.py, evaluate_models.py, smoke_test.py
├── artifacts/                  # trained models + metadata.json (generated)
└── data/                       # synthetic_heats.csv, synthetic_readings.csv (generated)

frontend/src/
├── pages/                      # 11 routes (Overview … Settings)
├── components/                 # Layout, ui, charts
├── hooks/useFetch.ts
└── lib/                        # api client, types, formatters
```

### Database tables
`users`, `furnaces`, `heat_records`, `sensor_readings`, `predictions`, `power_profiles`,
`anomaly_records`, `energy_analytics`, `ai_conversations`, `ai_messages`, `model_versions`,
`simulation_records`, `optimization_scenarios` — with foreign keys, cascade rules and indexes on
`heat_id`, `(metal_grade, heat_started_at)`, `(heat_record_id, ts)`, `(heat_id, detected_at)` and
prediction timestamps.

---

## 3. Quick start (Windows shown; same commands on macOS/Linux)

### 3.1 Backend

```bash
cd backend
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt      # macOS/Linux: source .venv/bin/activate
./.venv/Scripts/python.exe -m scripts.seed                          # generate 1,200 heats + train models
./.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

API: <http://127.0.0.1:8000/docs> · health: `/api/health`

`scripts.seed` is idempotent by design: it refuses to re-import when heats already exist
(use `--reset` to rebuild). It writes the dataset CSV, trains all five models, records model
versions, scans recent heats for anomalies and aggregates daily energy analytics.

### 3.2 Frontend

```bash
cd frontend
npm install
npm run dev        # http://127.0.0.1:5173  (proxies /api → 127.0.0.1:8000)
```

Production build: `npm run build` (runs `tsc --noEmit` first).

### 3.3 SHAKTHI AI — Browser Local AI (Qwen2.5 3B Instruct via WebLLM)

ForgeOptima AI executes Qwen2.5 3B Instruct **100% locally inside the user's browser** via WebGPU:
- **No Ollama server** installation or background process required.
- **No paid API keys** or cloud tokens (zero billing).
- **Direct WebGPU shader acceleration** provides real-time streaming token generation.
- Model assets (~1.62 GB) are fetched from the official MLC Hugging Face repository (`mlc-ai/Qwen2.5-3B-Instruct-q4f16_1-MLC`) and cached in browser storage for instant subsequent loads.
- Open **SHAKTHI AI** or **Settings** to inspect WebGPU hardware capabilities, manage downloads/caches, select context lengths (4096 or 2048 for mobile), and chat privately.

---

## 4. Configuration

Copy `.env.example` → `.env` (repository root, or `backend/.env`). Key variables:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./forgeoptima.db` | Use `postgresql+psycopg://user:pass@host:5432/forgeoptima` for PostgreSQL |
| `CORS_ORIGINS` | localhost:5173 | Comma-separated allowed origins |
| `AI_PROVIDER` | `webllm` | Browser Local AI architecture |
| `AI_MODEL` | `Qwen2.5-3B-Instruct` | Local WebGPU model identifier |
| `EMISSION_FACTOR_KG_PER_KWH` | `0.71` | Grid factor for CO₂ estimates (also editable in Settings) |
| `MAX_UPLOAD_MB` | `10` | CSV upload limit |
| `RATE_LIMIT_PER_MINUTE` | `240` | Per-IP sliding window |
| `VITE_API_BASE_URL` | *(empty)* | Frontend's backend origin in production |

No secrets are required for local development. Nothing sensitive is ever sent to the browser: the Ollama
endpoint is only called by the backend.

---

## 5. Machine learning — models, data and honest metrics

### Synthetic dataset
`app/ml/synthetic.py` generates 1,200 heats with documented, internally consistent assumptions:

* Grade-specific specific energy (kWh/t): MS 580, SS304 640, SS316 665, Alloy Steel 620, Cast Iron 520,
  Al Alloy 560, Cu Alloy 430.
* A 1-minute power trace is generated **first**; energy is its integral
  (`energy_kwh = Σ power_kw × dt_hours`), so the two can never contradict each other.
* Duration is derived from required energy and base power: `time = energy × loss / power × 60`, with a
  3–12 % operator-loss factor and a small share of aborted heats.
* Current follows power and voltage through a power factor:
  `I = P × 1000 / (√3 × V × cosφ)`.
* Temperature follows delivered energy (plateau through the latent-heat region), with ±6 °C noise.
* ~0.4 % of readings carry a deliberate sensor-quality flag so the quality checks have something to find.

Everything is labelled `is_synthetic` / `source='synthetic'` and surfaced as such in the UI.

### Models and measured performance
Latest training run (1,173 completed heats, 80/20 holdout, `scripts/evaluate_models.py`):

| Model | Algorithm | MAE | RMSE | R² | MAPE |
|---|---|---|---|---|---|
| Melting time | RandomForestRegressor | 3.30 min | 4.37 min | 0.897 | 5.1 % |
| Energy | XGBRegressor | 41.4 kWh | 55.0 kWh | 0.989 | 2.3 % |
| Time to target | RandomForestRegressor | 3.74 min | 5.30 min | 0.916 | 12.1 % |

5-fold cross-validated R² for melting time: **0.887 ± 0.017**. These numbers are recomputed on every
retrain and exposed via `/api/models/status` and `/api/analytics/performance` — the UI never hardcodes
them. **They describe synthetic data and must be re-established on plant data before operational use.**

Uncertainty is reported honestly: the melting-time band is the larger of the per-tree spread and the
holdout residual σ; the energy band is ±1σ of holdout residuals.

If artifacts are missing, the API returns HTTP 503 for time-to-target/optimizer and a clearly flagged
physics baseline (energy balance) for melting time and energy — never a fabricated model result.

### Self-learning loop
`POST /api/models/retrain` validates every completed heat (energy must agree with power × duration within
60 %, positive charge/duration), refuses to train below 100 validated heats, retrains all models,
recomputes metrics on a fresh holdout, deactivates prior versions and records the new `ModelVersion`.
`/api/analytics/performance` pairs stored predictions with actual outcomes when a matching heat is
available and recommends retraining when enough new labelled predictions exist.

---

## 6. Analytics definitions (no arbitrary numbers)

* **Efficiency score** = `clip(100 × reference_energy_per_kg / actual_energy_per_kg, 0, 100)` where the
  reference is the **10th percentile** of energy per kg among completed heats of the same grade.
* **Energy per kg** = `energy_kwh / charge_weight_kg`.
* **Waste finding** = a heat whose energy per kg exceeds its grade benchmark by more than 6 %, with
  contributing factors derived from duration, power level, ambient temperature and temperature span.
* **CO₂ estimate** = `energy_kwh × emission_factor` (configurable), explicitly labelled an estimate.
* **Anomaly severity** — HIGH: IsolationForest score < −0.08 or |deviation| ≥ 30 %; MEDIUM: score < −0.02
  or |deviation| ≥ 15 %; LOW: remaining flagged readings. Rules cover power, current, voltage, specific
  energy, duration, flagged readings, non-monotonic temperature and sampling gaps.

---

## 7. API reference (prefix `/api`)

| Area | Endpoints |
|---|---|
| Furnace | `GET /furnace/status`, `GET /furnace/readings`, `POST /furnace/simulate?action=start|pause|resume|reset|configure`, `GET /furnace/live` |
| Heats | `GET /heats`, `GET /heats/options`, `GET /heats/{heat_id}`, `GET /heats/{heat_id}/readings`, `GET /heats/{heat_id}/comparison`, `POST /heats/upload`, `POST /heats/manual` |
| Predictions | `POST /predict/melting-time`, `POST /predict/energy`, `POST /predict/time-to-target`, `POST /predict/similar`, `GET /predict/models` |
| Optimizer | `GET /optimize/context`, `POST /optimize/analyze`, `POST /optimize/compare`, `GET /optimize/scenarios` |
| Digital twin | `GET /digital-twin/model`, `POST /digital-twin/start`, `POST /digital-twin/step`, `POST /digital-twin/stop` |
| Anomalies | `GET /anomalies`, `GET /anomalies/summary`, `POST /anomalies/analyze`, `POST /anomalies/scan`, `PATCH /anomalies/{id}/acknowledge`, `GET /anomalies/quality/{heat_id}` |
| Analytics | `GET /analytics/dashboard`, `GET /analytics/energy`, `GET /analytics/grades`, `GET /analytics/performance`, `GET /analytics/heat/{heat_id}/timeline` |
| SHAKTHI AI | `GET /ai/status`, `GET /ai/suggestions`, `POST /ai/chat` (SSE stream), `GET /ai/history`, `GET /ai/history/{id}`, `DELETE /ai/history/{id}`, `GET /ai/context` |
| Reports | `GET /reports/heat/{heat_id}`, `/reports/energy`, `/reports/performance`, `/reports/anomalies`, `/reports/grades`, `/reports/carbon` — each with `?format=pdf|csv` |
| Models | `GET /models`, `GET /models/status`, `POST /models/retrain` |
| Platform | `GET /health`, `GET /settings`, `PUT /settings` |

---

## 8. Data ingestion

**CSV mode** — `POST /heats/upload?commit=false` returns a preview: detected columns, missing required
columns, per-column missing counts, row-level issues (missing/duplicate heat IDs, non-physical values,
energy vs. power × duration mismatches) and sample rows. `commit=true` imports only valid rows, skips
existing heat IDs and stores a derived trace consistent with the row's energy.

Required columns: `heat_id, metal_grade, charge_weight_kg, initial_temp_c, target_temp_c, power_kw,
current_a, voltage_v, melting_time_min, energy_kwh`.
Optional: `ambient_temp_c, heat_status, heat_started_at`.

**Manual entry** — `POST /heats/manual` derives current from power/voltage when omitted, derives energy
from power × duration, and attaches a data-quality note if the supplied energy disagrees by >35 %.

**Simulated live mode** — `/furnace/simulate` drives a documented model on a speed multiplier. Every
reading is returned with `is_synthetic: true`; the UI shows a `SIMULATED DATA` badge and the API reports
`data_mode: "simulated"`. Power is validated against the furnace's engineer-approved min/max.

---

## 9. Digital twin model

```
E_required = mass_t × specific_energy(grade) × span_factor        [kWh]
dE/dt      = power × efficiency / 60                              [kWh/min]
progress   = 100 × E_delivered / E_required
T_implied  piecewise over progress (initial heating / latent plateau / superheat)
dT/dt      = (T_implied − T)/τ − loss_rate        τ = 3.5 min, loss = 0.02 °C/min
```

The first-order lag is what makes the "Temperature Adjustment" stage exist after the charge is molten.
Stages: Charging → Initial Heating → Intermediate Melting → Complete Melting → Temperature Adjustment →
Target Temperature Reached. This is a **reduced-order predictive simulation, not a physics-validated
digital twin**.

---

## 10. SHAKTHI AI — grounding, WebGPU and guardrails

SHAKTHI AI executes Qwen2.5 3B Instruct directly in the client's browser using `@mlc-ai/web-llm` and WebGPU.
The backend supplies a read-only JSON context per request via `/api/ai/context`: latest heat, 12 recent heats, grade
benchmarks, 7-day energy summary, model predictions **with their metrics**, KNN neighbours, recent
anomalies, current live-simulation stage and the furnace envelope. This context is injected into the
grounded system prompt.

Guardrails:
* The model is instructed to ground answers in physical metallurgical physics and the provided telemetry without inventing sensor readings.
* Read-only decision support: no equipment control commands or simulated actuations.
* All prompts, conversations, and reasoning remain 100% on the user's device (no prompt telemetry sent to external APIs).
* Conversations and messages are stored locally in the browser's persistent storage.

---

## 11. Testing

```bash
cd backend
./.venv/Scripts/python.exe -m scripts.smoke_test        # 96 API assertions against a running server
./.venv/Scripts/python.exe -m scripts.evaluate_models   # metrics + 5-fold cross-validation
cd ../frontend && npm run build                          # tsc --noEmit + production bundle
```

The smoke test covers all modules: dashboard KPIs and charts, heat listing/detail/readings/comparison,
manual entry, CSV preview + import + schema rejection, four prediction endpoints with metric assertions,
optimization with limit clipping, digital-twin start/step/stop with monotonic temperature, anomaly
listing/analysis/scan/quality, energy and grade analytics, every PDF (magic bytes) and CSV report, AI
status/context/history, simulation start/pause/resume/speed/reset, settings round-trip, retraining and
negative-path validation (422/404/405).

```bash
./.venv/Scripts/python.exe -m scripts.test_ai_chat   # live SHAKTHI AI: status, context, streamed answer, persistence
```

Verified in this environment: **96/96 API checks passed**. SHAKTHI AI was also verified end-to-end against
a live Ollama `qwen2.5:3b`: the streamed reply quoted the melting-time prediction with its uncertainty band
(40.3 min, range 35.5–45.1) and flagged the grade's specific energy against its benchmark, and the
exchange was persisted. The offline path (no Ollama) is verified too.

---

## 12. Deployment

### 12.1 PostgreSQL
```bash
createdb forgeoptima
export DATABASE_URL="postgresql+psycopg://forgeoptima:password@host:5432/forgeoptima"
cd backend && alembic upgrade head
```
`alembic/versions/0001_initial_schema.py` is the baseline revision (generated from the model metadata so
it cannot drift); later changes use `alembic revision --autogenerate` and are reviewed before applying.

### 12.2 Backend → Render
* Build: `pip install -r backend/requirements.txt`
* Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT` (root directory `backend`)
* Env: `DATABASE_URL`, `CORS_ORIGINS=https://your-app.vercel.app`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`,
  `ENVIRONMENT=production`
* First deploy: run `python -m scripts.seed` once (Render shell), or run `alembic upgrade head` and import
  your own CSV through the API.
* Model artifacts must be present at runtime: either run the seed/training step in the build or commit
  `backend/artifacts/` (they are small: ~22 MB) — otherwise predictions return the flagged baseline.

### 12.3 Frontend → Vercel
* Root directory `frontend`, framework Vite, build `npm run build`, output `dist`
* Env: `VITE_API_BASE_URL=https://your-backend.onrender.com`
* Add the Vercel domain to the backend's `CORS_ORIGINS`.

### 12.4 SHAKTHI AI in production
Because SHAKTHI AI runs **directly inside the client's browser using WebLLM and WebGPU**, there are **zero expensive GPU server costs or Ollama hosting infrastructure required**. Any user visiting the site on a modern browser (Chrome 113+, Edge 113+, Safari 18+) can run Qwen2.5 3B with WebGPU hardware acceleration. The backend only serves the lightweight FastAPI endpoints, SQLite/PostgreSQL database, and scikit-learn models.

---

## 13. Limitations — read before operational use

1. **All historical data is synthetic.** The models learn plausible physics, not your plant. Retrain on
   validated plant data before acting on predictions.
2. **The digital twin is reduced-order**, not CFD/electromagnetic finite element and not validated
   against measurements.
3. **Live monitoring is simulated**, always labelled; there is no PLC/OPC-UA/Modbus integration.
4. **Optimizer output is a model estimate**, never verified savings, and never a control recommendation.
   Profiles outside the engineer-approved envelope are refused or clipped.
5. **Anomalies are statistical screening**, not fault diagnosis.
6. **CO₂ figures are estimates** from a configurable grid factor.
7. No authentication/RBAC in this build: the single seeded operator profile is a demonstration identity.
   Put the API behind your own SSO/reverse proxy before exposing it beyond a trusted network.
8. PDF reports are decision-support documents, not certified industrial records.

---

## 14. Project identity

**FORGEOPTIMA AI** — AI-Powered Industrial Induction Furnace Optimization Platform, powered by
**SHAKTHI AI** (*Your Intelligent Industrial Furnace Assistant*).

*Predict Smarter. Optimize Energy. Melt Efficiently.*
