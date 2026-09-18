import { useState } from "react";
import { Layers } from "lucide-react";

export interface LayerOption {
  key: string;
  label: string;
  available: boolean;
}

export interface LayerGroup {
  group: string;
  options: LayerOption[];
}

interface Props {
  groups: LayerGroup[];
  visible: Record<string, boolean>;
  onToggle: (key: string) => void;
}

export function LayerControl({ groups, visible, onToggle }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="layer-toggler">
      <button
        className="btn sm map-layer-btn"
        aria-label="Toggle layers"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Layers size={13} />
        Layers
      </button>
      {open ? (
        <div className="layer-panel">
          {groups.map((g) => (
            <div className="layer-group" key={g.group}>
              <h4>{g.group}</h4>
              {g.options.map((o) => (
                <label
                  key={o.key}
                  className={`layer-item ${o.available ? "" : "disabled"}`}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                    <input
                      type="checkbox"
                      checked={!!visible[o.key]}
                      onChange={() => o.available && onToggle(o.key)}
                      disabled={!o.available}
                    />
                    <span>{o.label}</span>
                  </span>
                  {!o.available ? <span className="xsmall muted-3">UNAVAILABLE</span> : null}
                </label>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}