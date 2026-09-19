import { Navigate, Route, Routes } from "react-router-dom";
import DashboardPage from "@/pages/DashboardPage";
import GenesisPage from "@/pages/GenesisPage";
import ForecastPage from "@/pages/ForecastPage";
import ImpactPage from "@/pages/ImpactPage";
import LiveMonitorPage from "@/pages/LiveMonitorPage";
import TrackPage from "@/pages/TrackPage";
import IntensityPage from "@/pages/IntensityPage";
import HazardsPage from "@/pages/HazardsPage";
import RainfallPage from "@/pages/RainfallPage";
import WindPage from "@/pages/WindPage";
import FloodPage from "@/pages/FloodPage";
import LandslidePage from "@/pages/LandslidePage";
import RecurvaturePage from "@/pages/RecurvaturePage";
import RiskPage from "@/pages/RiskPage";
import ModelsPage from "@/pages/ModelsPage";
import PerformancePage from "@/pages/PerformancePage";
import HistoricalPage from "@/pages/HistoricalPage";
import DataSourcesPage from "@/pages/DataSourcesPage";
import ReportsPage from "@/pages/ReportsPage";
import SettingsPage from "@/pages/SettingsPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/genesis" element={<GenesisPage />} />
      <Route path="/forecast" element={<ForecastPage />} />
      <Route path="/impact" element={<ImpactPage />} />
      <Route path="/live" element={<LiveMonitorPage />} />
      <Route path="/track" element={<TrackPage />} />
      <Route path="/intensity" element={<IntensityPage />} />
      <Route path="/hazards" element={<HazardsPage />} />
      <Route path="/rainfall" element={<RainfallPage />} />
      <Route path="/wind" element={<WindPage />} />
      <Route path="/flood" element={<FloodPage />} />
      <Route path="/landslide" element={<LandslidePage />} />
      <Route path="/recurvature" element={<RecurvaturePage />} />
      <Route path="/risk" element={<RiskPage />} />
      <Route path="/models" element={<ModelsPage />} />
      <Route path="/performance" element={<PerformancePage />} />
      <Route path="/historical" element={<HistoricalPage />} />
      <Route path="/data" element={<DataSourcesPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function NotFoundPage() {
  return (
    <div className="page" style={{ display: "grid", placeItems: "center", minHeight: "70vh" }}>
      <div className="state-box">
        <div className="big">ROUTE NOT FOUND</div>
        <p className="muted">The requested path does not exist in the TOOFAN system.</p>
        <a className="btn mt-16" href="/dashboard">Return to Command Center</a>
      </div>
    </div>
  );
}