import { X } from "lucide-react";
import { useApp } from "@/state/AppContext";
import { AlertCard } from "@/components/alerts/AlertCard";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NotificationsDrawer({ open, onClose }: Props) {
  const { alerts } = useApp();
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="drawer" role="dialog" aria-modal="true" aria-label="System announcements">
        <div className="drawer-head">
          <div>
            <div className="page-kicker">Alert Center</div>
            <div className="drawer-title">System Announcements</div>
          </div>
          <button className="header-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="drawer-body">
          {alerts.length === 0 ? (
            <div className="small muted">No current announcements.</div>
          ) : (
            <div className="stack">
              {alerts.map((a) => (
                <AlertCard key={a.id} alert={a} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
