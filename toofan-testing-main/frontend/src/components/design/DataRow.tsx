interface Props {
  label: string;
  value: React.ReactNode;
}

export function DataRow({ label, value }: Props) {
  return (
    <div className="data-row">
      <span className="k">{label}</span>
      <span className="v">{value ?? "—"}</span>
    </div>
  );
}
