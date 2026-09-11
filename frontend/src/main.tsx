import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppProvider } from "@/state/AppContext";
import { AppShell } from "@/components/layout/AppShell";
import { AppRoutes } from "@/App";
import "@/styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <AppShell>
          <AppRoutes />
        </AppShell>
      </AppProvider>
    </BrowserRouter>
  </StrictMode>
);
