import { useNavigate } from "react-router-dom";

interface Props {
  children: React.ReactNode;
  onClick?: () => void;
  to?: string;
  variant?: "solid" | "outline" | "ghost";
  size?: "md" | "sm";
  className?: string;
}

export function EditorialButton({
  children,
  onClick,
  to,
  variant = "outline",
  size = "md",
  className = "",
}: Props) {
  const navigate = useNavigate();
  const cls = `btn ${variant === "solid" ? "solid" : variant === "ghost" ? "" : ""} ${size === "sm" ? "sm" : ""} ${className}`;
  if (to) {
    return (
      <button
        type="button"
        className={cls}
        onClick={() => (onClick ? onClick() : navigate(to))}
      >
        {children}
      </button>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick}>
      {children}
    </button>
  );
}
