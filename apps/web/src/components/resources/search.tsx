import { RiCloseLine, RiSearchLine } from "@remixicon/react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@repo/ui/components/ui/shad/input-group";
import { Kbd } from "@repo/ui/components/ui/shad/kbd";
import { useIsMobile } from "@repo/ui/hooks/use-mobile";
import { cn } from "@repo/ui/lib/utils";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useRouteContext } from "@tanstack/react-router";
import { useDebounce } from "@uidotdev/usehooks";
import { useEffect, useState } from "react";

export function Search({
  value,
  onChange,
  placeholder = "Search...",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { isMobile: isMobileRoute } = useRouteContext({ from: "__root__" });
  const isMobile = useIsMobile(isMobileRoute);
  const [search, setSearch] = useState(value);
  const debouncedSearch = useDebounce(search, 500);

  useEffect(() => {
    onChange(debouncedSearch);
  }, [debouncedSearch, onChange]);

  useHotkey("Escape", () => {
    if (search.length === 0 || isMobile) {
      return;
    }

    setSearch("");
  });

  return (
    <InputGroup className={cn("h-10", className)}>
      <InputGroupInput
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder}
        value={search}
      />
      <InputGroupAddon className="pl-3">
        <RiSearchLine aria-hidden="true" className="size-4" />
      </InputGroupAddon>
      <InputGroupAddon
        align="inline-end"
        className={cn(
          "pr-3 transition-opacity duration-200",
          search.length > 0 ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      >
        <InputGroupButton
          className={cn(!isMobile && "h-max! w-auto")}
          onClick={() => setSearch("")}
          size="icon-xs"
          variant={isMobile ? "ghost" : "outline"}
        >
          {isMobile ? (
            <RiCloseLine className="size-4" />
          ) : (
            <Kbd className="bg-transparent!">Esc</Kbd>
          )}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
