interface Props {
  title: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  heavy?: boolean;
  flat?: boolean;
  className?: string;
}

export function EditorialCard({
  title,
  meta,
  children,
  heavy,
  flat,
  className = "",
}: Props) {
  return (
    <div
      className={`panel ${heavy ? "heavy" : ""} ${flat ? "flat" : ""} ${className}`}
    >
      {title ? (
        <div className="panel-head">
          <span className="panel-title">{title}</span>
          {meta ? <span>{meta}</span> : null}
        </div>
      ) : null}
      <div className="panel-body">{children}</div>
    </div>
  );
}
