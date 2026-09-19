import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Scrolls to an in-page anchor whenever the URL hash points at it
 * (e.g. `/forecast#intensity`). Used by the pipeline flow nodes so a
 * click lands the operator on the exact section, not just the page.
 */
export function useScrollToHash() {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [hash]);
}

export default useScrollToHash;