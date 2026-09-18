interface Props {
  mode: "demo" | "live";
  onToggle: () => void;
}

export function ModeTag({ mode, onToggle }: Props) {
  return (
    <button
      type="button"
      className={`mode-tag ${mode}`}
      onClick={onToggle}
      title={
        mode === "demo"
          ? "DEMO MODE — SIMULATED DATA. Click for live backend."
          : "Live backend mode. Click to switch to demo."
      }
    >
      <span className="dot" aria-hidden="true" />
      {mode === "demo" ? "DEMO" : "LIVE"}
    </button>
  );
}
