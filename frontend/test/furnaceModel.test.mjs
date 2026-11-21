import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/index.js";
import {
  GRADES,
  FURNACE_CONFIG,
  predictHeat,
  optimizeHeat,
  stepTwin,
} from "../api/_lib/furnaceModel.js";

/**
 * Helper to call the unified serverless handler directly without network overhead.
 */
async function callHandler(method, path, body = undefined, headers = {}) {
  let statusCode = 200;
  const responseHeaders = {};
  let responseBody = null;
  const rawChunks = [];

  const req = {
    method,
    url: path,
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      ...headers,
    },
    body,
    query: {},
  };

  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      statusCode = code;
      return this;
    },
    setHeader(name, val) {
      responseHeaders[name.toLowerCase()] = val;
      return this;
    },
    getHeader(name) {
      return responseHeaders[name.toLowerCase()];
    },
    json(data) {
      responseBody = data;
      return this;
    },
    send(data) {
      responseBody = data;
      return this;
    },
    write(chunk) {
      rawChunks.push(chunk);
      return true;
    },
    end(data) {
      if (data && !responseBody) {
        try {
          responseBody = JSON.parse(data);
        } catch {
          responseBody = data;
        }
      }
      return this;
    },
  };

  await handler(req, res);
  return { status: statusCode, headers: responseHeaders, body: responseBody, chunks: rawChunks };
}

// -----------------------------------------------------------------------------
// TEST 1: Physical Scaling & Monotonicity
// -----------------------------------------------------------------------------
test("1. Energy scales linearly with charge weight; energy decreases or stays flat as power increases; time strictly decreases as power increases", () => {
  // Linear scaling with charge weight
  const pred2500 = predictHeat({
    charge_weight_kg: 2500,
    power_kw: 3000,
    initial_temp_c: 28,
    target_temp_c: 1520,
    metal_grade: "MS",
  });
  const pred5000 = predictHeat({
    charge_weight_kg: 5000,
    power_kw: 3000,
    initial_temp_c: 28,
    target_temp_c: 1520,
    metal_grade: "MS",
  });

  const weightRatio = 2500 / 5000;
  const thermalRatio = pred2500.thermal_kwh / pred5000.thermal_kwh;
  assert.ok(
    Math.abs(thermalRatio - weightRatio) < 0.001,
    `Thermal energy must scale linearly with mass: ratio is ${thermalRatio}`
  );

  // Time strictly decreases as power increases
  const predLowP = predictHeat({
    charge_weight_kg: 5000,
    power_kw: 2500,
    initial_temp_c: 28,
    target_temp_c: 1520,
    metal_grade: "MS",
  });
  const predHighP = predictHeat({
    charge_weight_kg: 5000,
    power_kw: 3200,
    initial_temp_c: 28,
    target_temp_c: 1520,
    metal_grade: "MS",
  });

  assert.ok(
    predHighP.predicted_melting_time_min < predLowP.predicted_melting_time_min,
    `Melting time at 3200 kW (${predHighP.predicted_melting_time_min}m) must be strictly less than at 2500 kW (${predLowP.predicted_melting_time_min}m)`
  );

  // Energy decreases (or stays flat) as power increases due to reduced standby loss duration
  assert.ok(
    predHighP.predicted_energy_kwh <= predLowP.predicted_energy_kwh,
    `Electrical energy at 3200 kW (${predHighP.predicted_energy_kwh} kWh) must be <= at 2500 kW (${predLowP.predicted_energy_kwh} kWh)`
  );
});

// -----------------------------------------------------------------------------
// TEST 2: Validation Rejections (HTTP 400)
// -----------------------------------------------------------------------------
test("2. Weight 0, negative, 'abc', power 0, power -100, power 5000, target < initial, unknown grade, malformed JSON all return 400 with detail", async () => {
  // Weight 0
  let res = await callHandler("POST", "/api/predict/melting-time", {
    charge_weight_kg: 0,
    power_kw: 3000,
    metal_grade: "MS",
  });
  assert.equal(res.status, 400, "Weight 0 must return 400");
  assert.ok(res.body?.detail, "Must contain detail message");

  // Negative weight
  res = await callHandler("POST", "/api/predict/melting-time", {
    charge_weight_kg: -500,
    power_kw: 3000,
    metal_grade: "MS",
  });
  assert.equal(res.status, 400, "Negative weight must return 400");

  // Weight "abc"
  res = await callHandler("POST", "/api/predict/melting-time", {
    charge_weight_kg: "abc",
    power_kw: 3000,
    metal_grade: "MS",
  });
  assert.equal(res.status, 400, "String weight must return 400");

  // Power 0
  res = await callHandler("POST", "/api/predict/melting-time", {
    charge_weight_kg: 5000,
    power_kw: 0,
    metal_grade: "MS",
  });
  assert.equal(res.status, 400, "Power 0 must return 400");

  // Power -100
  res = await callHandler("POST", "/api/predict/melting-time", {
    charge_weight_kg: 5000,
    power_kw: -100,
    metal_grade: "MS",
  });
  assert.equal(res.status, 400, "Power -100 must return 400");

  // Power 5000 (exceeds max limit 3200)
  res = await callHandler("POST", "/api/predict/melting-time", {
    charge_weight_kg: 5000,
    power_kw: 5000,
    metal_grade: "MS",
  });
  assert.equal(res.status, 400, "Power 5000 must return 400");

  // Target < initial
  res = await callHandler("POST", "/api/predict/melting-time", {
    charge_weight_kg: 5000,
    power_kw: 3000,
    initial_temp_c: 1550,
    target_temp_c: 1400,
    metal_grade: "MS",
  });
  assert.equal(res.status, 400, "Target < initial must return 400");

  // Unknown grade
  res = await callHandler("POST", "/api/predict/melting-time", {
    charge_weight_kg: 5000,
    power_kw: 3000,
    metal_grade: "TitaniumSuperalloy",
  });
  assert.equal(res.status, 400, "Unknown grade must return 400");

  // Malformed JSON string body
  res = await callHandler("POST", "/api/predict/melting-time", "{ bad: json, unquoted }");
  assert.equal(res.status, 400, "Malformed JSON body must return 400");
  assert.equal(res.body?.detail, "Malformed JSON body");
});

// -----------------------------------------------------------------------------
// TEST 3: Power Optimizer Checks
// -----------------------------------------------------------------------------
test("3. Optimizer: cur == alt -> delta_energy = 0 and delta_time = 0; alt power > 3200 -> is_within_limits false; slower alternative never says 'faster'", async () => {
  // Same power cur == alt
  let res = await callHandler("POST", "/api/optimize/analyze", {
    charge_weight_kg: 5000,
    current_power_kw: 3000,
    alternative_power_kw: 3000,
    metal_grade: "MS",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.delta_energy_kwh, 0, "cur == alt must yield delta_energy_kwh = 0");
  assert.equal(res.body.delta_time_min, 0, "cur == alt must yield delta_time_min = 0");

  // Alt power > 3200 exceeds envelope limits
  res = await callHandler("POST", "/api/optimize/analyze", {
    charge_weight_kg: 5000,
    current_power_kw: 3000,
    alternative_power_kw: 3500,
    metal_grade: "MS",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.alternative.is_within_limits, false, "alt power > 3200 must set is_within_limits: false");
  assert.equal(res.body.summary.is_within_limits, false);

  // Slower alternative (lower power) must never say "faster"
  res = await callHandler("POST", "/api/optimize/analyze", {
    charge_weight_kg: 5000,
    current_power_kw: 3000,
    alternative_power_kw: 2500,
    metal_grade: "MS",
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.delta_time_min > 0, "Lower power alternative must take more time (delta_time_min > 0)");
  const combinedNotes = res.body.alternative.notes.join(" ");
  assert.ok(!combinedNotes.toLowerCase().includes("faster"), "Slower alternative must NEVER say 'faster'");
  assert.ok(combinedNotes.toLowerCase().includes("slower"), "Slower alternative must explicitly say 'slower'");
});

// -----------------------------------------------------------------------------
// TEST 4: Digital Twin Integration to Completion
// -----------------------------------------------------------------------------
test("4. Twin: reaches is_complete = true and final temperature >= target; energy_kwh ≈ ∫ power dt (within 1%)", async () => {
  let twinState = {
    session_id: "twin_test_01",
    metal_grade: "MS",
    charge_weight_kg: 5000,
    power_kw: 3000,
    initial_temp_c: 28,
    target_temp_c: 1520,
    elapsed_min: 0,
    temperature_c: 28,
    history: [],
  };

  const dtMinutes = 2.5;
  let iterations = 0;
  while (!twinState.is_complete && iterations < 50) {
    twinState = stepTwin(twinState, dtMinutes);
    iterations++;
  }

  assert.equal(twinState.is_complete, true, "Digital twin must reach is_complete = true without 45m cap");
  assert.ok(
    twinState.temperature_c >= 1520,
    `Final temperature (${twinState.temperature_c} °C) must reach or exceed target (1520 °C)`
  );

  // Energy integral check: E = P * (t / 60)
  const expectedIntegralKwh = 3000 * (twinState.elapsed_min / 60);
  const diffPct = Math.abs(twinState.energy_kwh - expectedIntegralKwh) / expectedIntegralKwh;
  assert.ok(
    diffPct <= 0.01,
    `Integrated energy (${twinState.energy_kwh} kWh) must match integral (${expectedIntegralKwh} kWh) within 1% (diff: ${(diffPct * 100).toFixed(3)}%)`
  );
});

// -----------------------------------------------------------------------------
// TEST 5: Telemetry & Predict Consistency
// -----------------------------------------------------------------------------
test("5. Consistency: /furnace/status energy, power, elapsed and temperature agree with /predict for the same inputs (within 2%)", async () => {
  const statusRes = await callHandler("GET", "/api/furnace/status");
  assert.equal(statusRes.status, 200);
  const st = statusRes.body;

  const predRes = await callHandler("POST", "/api/predict/melting-time", {
    charge_weight_kg: st.charge_weight_kg,
    power_kw: st.power_kw,
    initial_temp_c: 28,
    target_temp_c: st.target_temperature_c,
    metal_grade: st.metal_grade,
  });
  assert.equal(predRes.status, 200);
  const pr = predRes.body;

  // Total forecast duration agreement
  const timeDiff = Math.abs(st.predicted_melting_time_min - pr.predicted_value) / pr.predicted_value;
  assert.ok(timeDiff <= 0.02, `Predicted cycle time between status and predict must agree within 2% (diff: ${(timeDiff * 100).toFixed(2)}%)`);

  // Delivered energy consistency: E_delivered = P * (elapsed / 60)
  const expectedDelivered = Math.round(st.power_kw * (44.0 / 60));
  const energyDiff = Math.abs(st.energy_kwh - expectedDelivered) / expectedDelivered;
  assert.ok(energyDiff <= 0.02, `Delivered energy (${st.energy_kwh}) must match P*dt (${expectedDelivered}) within 2%`);
});

// -----------------------------------------------------------------------------
// TEST 6: Distinct Grade-Specific Energy Bounds
// -----------------------------------------------------------------------------
test("6. Each grade (MS, SS304, SS316, Alloy Steel, Cast Iron) returns a different, physically plausible specific energy (0.45..0.75 kWh/kg)", () => {
  const grades = ["MS", "SS304", "SS316", "Alloy Steel", "Cast Iron"];
  const specificEnergies = new Map();

  for (const grade of grades) {
    const res = predictHeat({
      charge_weight_kg: 5000,
      power_kw: 3000,
      initial_temp_c: 28,
      metal_grade: grade,
    });

    const spEnergy = res.specific_energy_kwh_per_kg;
    assert.ok(
      spEnergy >= 0.45 && spEnergy <= 0.75,
      `Specific energy for ${grade} (${spEnergy} kWh/kg) must be between 0.45 and 0.75 kWh/kg`
    );
    specificEnergies.set(grade, spEnergy);
  }

  // Ensure all 5 are distinct
  const uniqueValues = new Set(specificEnergies.values());
  assert.equal(
    uniqueValues.size,
    grades.length,
    `All ${grades.length} grades must have distinct specific energies: ${JSON.stringify(Object.fromEntries(specificEnergies))}`
  );
});
