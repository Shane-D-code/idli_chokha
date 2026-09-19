import { useInView } from "@/hooks/usePrefersReducedMotion";

export function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const [ref, inView] = useInView(0.08);
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      className={`m-reveal ${inView ? "in" : ""}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}