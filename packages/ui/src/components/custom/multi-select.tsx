import { useCallback, useRef, useState } from "react";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "@/components/base/combobox";
import { Label } from "@/components/base/label";
import { cn } from "@/lib/utils";

export interface Item<T> {
  value: T;
  label: React.ReactNode;
}

export interface MultiSelectProps<T> {
  items: Item<T>[];
  defaultValue?: T | T[] | null;
  value?: T | T[] | null;
  setValue?: (value: T | T[] | null) => void;
  label?: string;
  id?: string;
  placeholder?: string;
  emptyIndicator?: React.ReactNode;
  multiple?: boolean;
  disabled?: boolean;
  required?: boolean;
  className?: {
    root?: string;
    label?: string;
    input?: string;
  };
}

export function MultiSelect<T>({
  items,
  className,
  label,
  id = "multi-select",
  placeholder,
  emptyIndicator = "No item found.",
  multiple = true,
  disabled = false,
  required = false,
  defaultValue,
  value: _value,
  setValue: _setValue,
}: MultiSelectProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [inputValue, setInputValue] = useState("");
  const [internalValue, setInternalValue] = useState<T[] | T | null>(() => {
    if (defaultValue !== undefined) return defaultValue;
    return multiple ? [] : null;
  });

  const value = _value !== undefined ? _value : internalValue;
  const setValue = _setValue || setInternalValue;

  const getLabel = useCallback(
    (item: T) =>
      typeof item === "string"
        ? (items?.find((i) => i.value === item)?.label ?? item)
        : (item as string),
    [items]
  );

  return (
    <Combobox
      // @ts-expect-error - FIXME: find a better way to handle this
      value={value ? (Array.isArray(value) ? value : [value]) : null}
      inputValue={inputValue}
      onInputValueChange={(v, e) => {
        if (["item-press", "chip-remove-press", "none"].includes(e.reason)) {
          setInputValue("");
          e.cancel();
          return;
        }
        setInputValue(v);
      }}
      onValueChange={(v) => {
        if (v === undefined || v === null) {
          setValue(multiple ? [] : null);
          setInputValue("");
          return;
        }

        if (multiple) {
          setValue(Array.isArray(v) ? v : [v]);
        } else {
          setValue(Array.isArray(v) ? (v[0] ?? null) : v);
        }
        setInputValue("");
      }}
      items={items}
      multiple={multiple}
    >
      <div className={cn("flex flex-col gap-2", className?.root)}>
        <Label className={className?.label} htmlFor={id}>
          {label}
        </Label>
        <ComboboxChips ref={containerRef}>
          <ComboboxValue>
            {(value: T[] | T) => {
              const selectedValues =
                value === null || value === undefined
                  ? []
                  : Array.isArray(value)
                    ? value
                    : [value];
              return (
                <>
                  {selectedValues
                    .filter((item) => item !== null)
                    .map((item, i) => {
                      const label = getLabel(item);
                      return (
                        <ComboboxChip
                          key={`multi-select-${i}-${item}`}
                          disabled={disabled}
                          aria-label={label?.toString()}
                        >
                          {label}
                        </ComboboxChip>
                      );
                    })}
                  <ComboboxInput
                    ref={inputRef}
                    id={id}
                    className={cn("shadow-none", className?.input)}
                    disabled={disabled}
                    required={required}
                    placeholder={selectedValues?.length > 0 ? "" : placeholder}
                  />
                </>
              );
            }}
          </ComboboxValue>
        </ComboboxChips>
      </div>
      <ComboboxContent anchor={containerRef} sideOffset={6}>
        <ComboboxEmpty>{emptyIndicator}</ComboboxEmpty>
        <ComboboxList>
          {(item: Item<T>, i) => {
            // console.log(item);
            return item?.value ? (
              <ComboboxItem
                key={`multi-select-${i}-${item.value}`}
                value={item.value}
              >
                {item.label}
              </ComboboxItem>
            ) : null;
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
