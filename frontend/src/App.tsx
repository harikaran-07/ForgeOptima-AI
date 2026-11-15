import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Overview from "./pages/Overview";
import LiveMonitoring from "./pages/LiveMonitoring";
import Predictions from "./pages/Predictions";
import DigitalTwin from "./pages/DigitalTwin";
import PowerOptimizer from "./pages/PowerOptimizer";
import EnergyIntelligence from "./pages/EnergyIntelligence";
import Anomalies from "./pages/Anomalies";
import HeatHistory from "./pages/HeatHistory";
import ShakthiAI from "./pages/ShakthiAI";
import LocalAISetup from "./pages/LocalAISetup";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="/live" element={<LiveMonitoring />} />
        <Route path="/predictions" element={<Predictions />} />
        <Route path="/digital-twin" element={<DigitalTwin />} />
        <Route path="/optimizer" element={<PowerOptimizer />} />
        <Route path="/energy" element={<EnergyIntelligence />} />
        <Route path="/anomalies" element={<Anomalies />} />
        <Route path="/history" element={<HeatHistory />} />
        <Route path="/history/:heatId" element={<HeatHistory />} />
        <Route path="/shakthi-ai" element={<ShakthiAI />} />
        <Route path="/local-ai" element={<LocalAISetup />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
