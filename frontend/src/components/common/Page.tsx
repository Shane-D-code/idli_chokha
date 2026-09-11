import type { ReactNode } from "react";

interface Props {
  kicker: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function Page({ kicker, title, subtitle, actions, children }: Props) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-kicker">{kicker}</div>
          <h1 className="page-title">{title}</h1>
          {subtitle ? <div className="page-sub">{subtitle}</div> : null}
        </div>
        {actions ? <div className="row" style={{ marginTop: "var(--sp-3)" }}>{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
