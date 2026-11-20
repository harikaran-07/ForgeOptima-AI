/**
 * Digital Twin Stage Explainer powered by Qwen 2.5 0.5B Instruct.
 *
 * Implements Section 3 "Digital Twin":
 * Explains:
 * - Current melting stage
 * - Heat transfer behavior
 * - Thermal efficiency
 * - Next expected milestone
 */

import { TwinState } from "../../lib/types";
import { runStructuredTask, StructuredAIResponse } from "./shakthiEngine";

export async function explainDigitalTwinStage(
  state: TwinState,
  forceRefresh = false
): Promise<StructuredAIResponse> {
  const contextData = {
    elapsed_min: state.elapsed_min,
    temperature_c: state.temperature_c,
    target_temp_c: state.target_temp_c,
    melt_progress: state.melt_progress,
    stage: state.stage,
    stage_index: state.stage_index,
    power_kw: state.power_kw,
    energy_kwh: state.energy_kwh,
    metal_grade: state.metal_grade,
    is_complete: state.is_complete,
  };

  const customPrompt = `Explain the thermodynamic and heat transfer physics of this digital twin simulation step.
Analyze the current stage (${state.stage}), phase transitions (sensible heat absorption, latent heat of fusion, liquid superheat), electromagnetic coil coupling, wall refractory conduction, and what metallurgical milestone to anticipate next.`;

  return runStructuredTask(
    `digital_twin_${state.stage}`,
    contextData,
    customPrompt,
    (data) => {
      const temp = Number(data.temperature_c || 1350);
      const target = Number(data.target_temp_c || 1550);
      const stage = String(data.stage || "Intermediate Melting");
      const prog = Number(data.melt_progress || 48.0);
      const eff = Number(data.efficiency || 0.72) * 100;

      return {
        title: `Digital Twin Physics: ${stage}`,
        summary: `The furnace simulation is in '${stage}' at ${temp.toFixed(0)}°C (${prog.toFixed(1)}% molten). Thermal efficiency is simulated at ${eff.toFixed(0)}% with enthalpy transferring through both sensible and latent heat regimes.`,
        observations: [
          `In the current ${stage} phase, magnetic flux penetration depth (skin depth δ) couples into solid and semi-molten charge clusters.`,
          `Sensible heat absorption is transitioning into the liquidus isothermal plateau as steel reaches ~1,450–1,500°C.`,
          `Refractory crucible heat loss is modeled using Fourier transient conduction with outer air convection.`,
          `Next milestone: ${temp < 1450 ? "Solidus-to-liquidus complete pool formation at ~1,480°C" : "Reaching final tapping target temperature (" + target + "°C)"}.`,
        ],
        supporting_data: [
          { label: "Current Temp", value: temp.toFixed(0), unit: "°C" },
          { label: "Target Temp", value: target.toFixed(0), unit: "°C" },
          { label: "Melt Progression", value: prog.toFixed(1), unit: "%" },
          { label: "Simulated Efficiency", value: eff.toFixed(1), unit: "%" },
        ],
        recommendations: [
          {
            action: "Maintain steady power ramp to minimize refractory thermal shocking",
            reason: "Excessive heating rate during latent phase creates high thermal stresses across crucible walls",
            priority: "MEDIUM",
            investigation_area: "Lining Integrity",
          },
          {
            action: "Verify cover insulation to reduce top-surface radiative emissivity losses",
            reason: "Stefan-Boltzmann radiation losses (T⁴) increase nonlinearly above 1,300°C",
            priority: "HIGH",
            investigation_area: "Thermal Enclosure",
          },
        ],
        limitations: [
          "Digital twin simulates 1D lumped thermodynamic heat transfer with ideal electromagnetic field assumptions.",
          "Real-world scrap geometry, oxidation crust, and slag fluidity may introduce minor deviation from ideal curves.",
        ],
        isModelGenerated: false,
        modelName: "ForgeOptima Grounded Engine",
        timestamp: new Date().toISOString(),
      };
    },
    forceRefresh
  );
}
