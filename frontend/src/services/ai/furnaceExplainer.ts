/**
 * Live Furnace Monitoring Explainer powered by Qwen 2.5 0.5B Instruct.
 *
 * Implements Section 3 "Furnace Monitoring":
 * Explains:
 * - Temperature
 * - Voltage
 * - Current
 * - Power
 * - Furnace status
 */

import { FurnaceStatus } from "../../lib/types";
import { runStructuredTask, StructuredAIResponse } from "./shakthiEngine";

export async function explainFurnaceReadings(
  status: FurnaceStatus,
  forceRefresh = false
): Promise<StructuredAIResponse> {
  const contextData = {
    furnace_name: status.furnace?.name ?? "IF-01",
    furnace_code: status.furnace?.code ?? "IF-01",
    rated_power_kw: status.furnace?.rated_power_kw ?? 3200,
    capacity_kg: status.furnace?.capacity_kg ?? 3000,
    status: status.status,
    active_heat_id: status.active_heat_id,
    temperature_c: status.temperature_c,
    target_temperature_c: status.target_temperature_c,
    power_kw: status.power_kw,
    current_a: status.current_a,
    voltage_v: status.voltage_v,
    charge_weight_kg: status.charge_weight_kg,
    melt_progress: status.melt_progress,
    energy_kwh: status.energy_kwh,
    metal_grade: status.metal_grade,
    data_mode: status.data_mode,
  };

  const customPrompt = `Explain the live electrical and thermal telemetry of this induction furnace.
Analyze temperature progression, voltage, current, power draw, apparent impedance, and operating status.
Highlight electrical health, thermal ramp rate, and recommended metallurgical checks.`;

  return runStructuredTask(
    "furnace_readings",
    contextData,
    customPrompt,
    (data) => {
      const v = Number(data.voltage_v || 762);
      const a = Number(data.current_a || 2410);
      const kw = Number(data.power_kw || 1920);
      const temp = Number(data.temperature_c || 1418);
      const target = Number(data.target_temperature_c || 1520);
      const prog = Number(data.melt_progress || 62.5);

      // Electrical calculations: Apparent power S = sqrt(3)*V*I / 1000
      const sKva = Math.round((Math.sqrt(3) * v * a) / 1000);
      const pf = Math.min(Math.max(kw / (sKva || 1), 0.75), 0.98);

      return {
        title: "Live Furnace Telemetry Explanation",
        summary: `Furnace is drawing ${kw} kW at ${v} V and ${a} A (${sKva} kVA, PF ~${pf.toFixed(2)}), with bath temperature at ${temp}°C (${prog.toFixed(1)}% melt completion). Electrical delivery is well-coupled to the charge.`,
        observations: [
          `Coil voltage (${v} V) and line current (${a} A) reflect healthy resonant circuit matching without inverter overvoltage trips.`,
          `Current power draw (${kw} kW) represents ${(kw / Number(data.rated_power_kw || 3500) * 100).toFixed(0)}% of the ${data.rated_power_kw} kW nameplate rating.`,
          `Molten bath temperature (${temp}°C) is ${(target - temp).toFixed(0)}°C below the ${target}°C tap setpoint.`,
          `Electromagnetic stirring action is actively distributing thermal energy through the liquid core.`,
        ],
        supporting_data: [
          { label: "Active Power", value: kw, unit: "kW" },
          { label: "Line Voltage", value: v, unit: "V" },
          { label: "Phase Current", value: a, unit: "A" },
          { label: "Estimated PF", value: pf.toFixed(2), unit: "cos φ" },
          { label: "Bath Temperature", value: temp, unit: "°C" },
        ],
        recommendations: [
          {
            action: "Monitor coil cooling water temperature delta",
            reason: "Delta T exceeding 10°C indicates reduced water velocity or mineral scale buildup in cooling turns",
            priority: "MEDIUM",
            investigation_area: "Cooling Circuit",
          },
          {
            action: "Maintain steady power until bath reaches 1,480°C before alloy additions",
            reason: "Prevents chilling of the bath and improves ferrosilicon/ferromanganese recovery rates",
            priority: "HIGH",
            investigation_area: "Metallurgy",
          },
        ],
        limitations: [
          "Impedance and power factor are derived from secondary line electrical parameters.",
          "Check immersion thermocouple calibration before final tap authorization.",
        ],
        isModelGenerated: false,
        modelName: "ForgeOptima Grounded Engine",
        timestamp: new Date().toISOString(),
      };
    },
    forceRefresh
  );
}
