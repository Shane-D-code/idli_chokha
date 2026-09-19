import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { AppFooter } from "./AppFooter";
import { TopBar } from "./TopBar";
import { RailSidebar } from "./RailSidebar";
import { PipelineStatusStrip } from "./PipelineStatusStrip";

interface Props {
  children: ReactNode;
}

export function AppShell({ children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <RailSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <TopBar onOpenSidebar={() => setSidebarOpen(true)} />
      <main className="app-main">
        <PipelineStatusStrip className="mb-4" />
        {children}
        <AppFooter />
      </main>
    </div>
  );
}

export default AppShell;