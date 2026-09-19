import type { ReactNode } from "react";

interface Props {
  index: string;
  kicker: string;
  title: string;
  sub?: string;
  meta?: ReactNode;
}

/** Page header used uniformly across Genesis / Forecast / Impact. */
export function PageHead({ index, kicker, title, sub, meta }: Props) {
  return (
    <div className="cm-pagehead">
      <div className="cm-pagehead__meta">
        <span className="cm-pagehead__index">{index}</span>
        <span className="cm-kicker">{kicker}</span>
      </div>
      <h1 className="cm-pagehead__title">{title}</h1>
      {sub ? <p className="cm-pagehead__sub">{sub}</p> : null}
      {meta ? <div className="cm-pagehead__meta">{meta}</div> : null}
    </div>
  );
}

export default PageHead;