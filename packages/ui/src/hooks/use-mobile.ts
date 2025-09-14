import * as React from "react";
import { MOBILE_BREAKPOINT } from "@/constants";

export function useIsMobile({
  breakpoint = MOBILE_BREAKPOINT,
  initialValue,
}: {
  breakpoint?: number;
  initialValue?: boolean;
} = {}) {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    initialValue
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < breakpoint);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < breakpoint);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpoint]);

  return !!isMobile;
}
