interface Props {
  label: string;
  strong?: boolean;
}

export function SectionLabel({ label, strong }: Props) {
  return (
    <div className={`section-label ${strong ? "strong" : ""}`}>{label}</div>
  );
}
