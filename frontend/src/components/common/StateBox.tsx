import type { ModelOperationalStatus } from "@/types";

interface EmptyStateProps {
  big: string;
  message?: string;
  children?: React.ReactNode;
  footer?: string;
}

export function EmptyState({ big, message, children, footer }: EmptyStateProps) {
  return (
    <div className="state-box" role="status">
      <div className="big">{big}</div>
      {message ? <p>{message}</p> : null}
      {children}
      {footer ? <div className="statusline">{footer}</div> : null}
    </div>
  );
}

interface ModelEmptyProps {
  status: ModelOperationalStatus;
  title?: string;
  message?: string;
  footer?: string;
}

export function ModelUnavailableState({ status, title, message, footer }: ModelEmptyProps) {
  return (
    <EmptyState
      big={title ?? status.replace(/_/g, " ")}
      message={message}
      footer={footer ?? `Status: ${status.replace(/_/g, " ")}`}
    />
  );
}

export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" role="status">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 60 }} />
      ))}
    </div>
  );
}

export function ErrorState({ title = "DATA UNAVAILABLE", message }: { title?: string; message?: string }) {
  return <EmptyState big={title} message={message ?? "The TOOFAN backend could not be reached."} />;
}