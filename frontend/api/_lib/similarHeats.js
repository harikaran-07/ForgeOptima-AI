// Nearest-neighbor historical heat ranking from synthetic_heats dataset
import syntheticHeats from "./syntheticHeats.js";

/**
 * Finds top k nearest neighbor heats by charge weight, power, and target temperature.
 */
export function findSimilarHeats(params, k = 3) {
  const {
    charge_weight_kg = 5000,
    power_kw = 3000,
    target_temp_c = 1520,
    metal_grade = "MS",
  } = params;

  let candidates = syntheticHeats.filter((h) => h.metal_grade === metal_grade);
  if (candidates.length < k) {
    candidates = syntheticHeats;
  }

  const scored = candidates.map((h) => {
    const dw = (charge_weight_kg - h.charge_weight_kg) / 5000;
    const dp = (power_kw - h.power_kw) / 3200;
    const dt = (target_temp_c - h.target_temp_c) / 1800;
    const distance = Math.sqrt(dw * dw + dp * dp + dt * dt);
    const similarity = Number(Math.max(0.70, (1 - distance)).toFixed(3));

    return {
      heat_id: h.heat_id,
      metal_grade: h.metal_grade,
      charge_weight_kg: h.charge_weight_kg,
      power_kw: h.power_kw,
      melting_time_min: h.melting_time_min,
      energy_kwh: h.energy_kwh,
      energy_per_kg: h.energy_per_kg,
      efficiency: h.efficiency,
      distance: Number(distance.toFixed(4)),
      similarity,
    };
  });

  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, k);
}
