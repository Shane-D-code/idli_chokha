import { useApp } from "@/state/AppContext";

export function DemoBanner() {
  const { mode } = useApp();
  if (mode !== "demo") return null;
  return (
    <span
      className="mode-tag demo"
      role="status"
      title="DEMO MODE — SIMULATED DATA. Not real model output."
    >
      <span className="dot" aria-hidden="true" />
      DEMO MODE
    </span>
  );
}
