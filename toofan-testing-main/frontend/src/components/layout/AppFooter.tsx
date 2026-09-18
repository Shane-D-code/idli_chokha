import { useApp } from "@/state/AppContext";

export function AppFooter() {
  const { system } = useApp();
  return (
    <footer className="app-footer">
      <div className="footer-brand">
        TOOFAN
        <small>Multi-Hazard Cyclone Intelligence</small>
      </div>
      <div className="footer-links">
        <a href="/dashboard">Command</a>
        <a href="/models">Models</a>
        <a href="/data">Data</a>
        <a href="/historical">Archive</a>
        <a href="/settings">System</a>
      </div>
      <div className="footer-meta">
        <span>LAST UPDATE {system?.lastUpdated ?? "—"}</span>
        <span>VERSION 2.0.0</span>
      </div>
    </footer>
  );
}
