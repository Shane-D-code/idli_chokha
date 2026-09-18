interface Props {
  solid?: boolean;
  faint?: boolean;
}

export function ThinDivider({ solid, faint }: Props) {
  return <div className={`thin-divider ${solid ? "solid" : ""} ${faint ? "faint" : ""}`} aria-hidden="true" />;
}
