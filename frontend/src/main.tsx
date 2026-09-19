import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";
import { AppProvider } from "@/state/AppContext";
import { AppShell } from "@/components/layout/AppShell";
import { AppRoutes } from "@/App";
import { HomeMission } from "@/pages/HomeMission";
import "@fontsource-variable/inter";
import "@/styles/tailwind.css";
import "@/styles/global.css";
import "@/styles/mission.css";
import "@/styles/ops.css";
import "@/styles/story.css";
import "@/styles/command.css";

function RootLayout() {
  const location = useLocation();
  // The cinematic mission landing owns the full screen at "/".
  // Every deep route renders inside the Command Center shell.
  if (location.pathname === "/") return <HomeMission />;
  return (
    <AppShell>
      <AppRoutes />
    </AppShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <RootLayout />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>
);