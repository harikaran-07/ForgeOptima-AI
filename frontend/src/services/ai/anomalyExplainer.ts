/**
 * Anomaly Explainer powered by Qwen 2.5 0.5B Instruct.
 *
 * Implements Section 3 "Anomaly Detection":
 * Explains:
 * - Anomaly score and severity
 * - Which sensors deviated from normal
 * - Potential physical causes
 * - Recommended inspection steps
 */

import { Anomaly } from "../../lib/types";
import { runStructuredTask, StructuredAIResponse } from "./shakthiEngine";

export async function explainAnomalyRecord(
  anomaly: Anomaly,
  forceRefresh = false
): Promise<StructuredAIResponse> {
  const contextData = {
    anomaly_id: anomaly.id,
    heat_id: anomaly.heat_id,
    anomaly_type: anomaly.anomaly_type,
    severity: anomaly.severity,
    observed_value: anomaly.observed_value,
    expected_value: anomaly.expected_value,
    deviation_pct: anomaly.deviation_pct,
    score: anomaly.score,
    detected_at: anomaly.detected_at,
    suggested_action: anomaly.suggested_action,
  };

  const customPrompt = `Analyze this industrial furnace anomaly flagged by Isolation Forest and telemetry heuristics.
Explain the deviation severity (${anomaly.severity}, score ${anomaly.score.toFixed(3)}), the root sensor mismatch, probable physical and metallurgical causes (e.g., slag foaming, coil bridging, thermocouple drift, loose busbar), and prioritized physical inspection steps.`;

  return runStructuredTask(
    "anomaly_explanation",
    contextData,
    customPrompt,
    (data) => {
      const obs = Number(data.observed_value || 0);
      const exp = data.expected_value != null ? Number(data.expected_value) : null;
      const dev = data.deviation_pct != null ? Number(data.deviation_pct) : 0;
      const score = Number(data.score || -0.05);
      const type = String(data.anomaly_type || "Telemetry Deviation");
      const sev = String(data.severity || "MEDIUM");

      return {
        title: `Anomaly Analysis: ${type} (${sev})`,
        summary: `Isolation Forest flagged a ${sev} severity outlier on Heat ${data.heat_id || "N/A"} with score ${score.toFixed(3)}. Sensor reading was ${obs.toFixed(2)}${exp !== null ? ` vs nominal baseline ${exp.toFixed(2)} (${dev > 0 ? "+" : ""}${dev.toFixed(1)}% deviation)` : ""}.`,
        observations: [
          `Isolation Forest outlier threshold breached (score: ${score.toFixed(3)} vs normal boundary > -0.02).`,
          exp !== null
            ? `Observed parameter deviated by ${Math.abs(dev).toFixed(1)}% from grade expectation.`
            : `Unusual telemetry signature observed without static baseline match.`,
          `Deviation pattern aligns with transient coil impedance shifts or thermal boundary layer fluctuations.`,
        ],
        supporting_data: [
          { label: "Observed Value", value: obs.toFixed(2) },
          { label: "Expected Value", value: exp !== null ? exp.toFixed(2) : "N/A" },
          { label: "Deviation", value: `${dev > 0 ? "+" : ""}${dev.toFixed(1)}%` },
          { label: "Isolation Score", value: score.toFixed(3) },
        ],
        recommendations: [
          {
            action: data.suggested_action ? String(data.suggested_action) : "Perform physical inspection of coil water lines and lining profile",
            reason: "Prevents escalating refractory breach or unexpected inverter trip",
            priority: sev === "HIGH" ? "HIGH" : "MEDIUM",
            investigation_area: "Electrical / Refractory",
          },
          {
            action: "Inspect pyrometer lens cleanliness and secondary thermocouple calibration",
            reason: "Rules out optical obstruction or instrument drift before altering furnace power",
            priority: "MEDIUM",
            investigation_area: "Instrumentation",
          },
        ],
        limitations: [
          "Anomaly flags indicate mathematical outliers worth engineering inspection; they are not direct fault diagnoses.",
          "Ensure secondary physical inspection is logged before resetting alarm flags.",
        ],
        isModelGenerated: false,
        modelName: "ForgeOptima Grounded Engine",
        timestamp: new Date().toISOString(),
      };
    },
    forceRefresh
  );
}
