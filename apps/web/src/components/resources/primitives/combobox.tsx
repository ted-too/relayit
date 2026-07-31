import { RiSearchLine } from "@remixicon/react";
import {
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  Combobox as ShadCombobox,
} from "@repo/ui/components/ui/shad/combobox";
import { useRef } from "react";

interface BaseComboboxItem {
  label: string;
  value: string;
}

interface BaseComboboxProps<T extends BaseComboboxItem> {
  items: T[];
  notFoundContent?: string;
  placeholder?: string;
  renderItem?: (item: T) => React.ReactNode;
}

type ComboboxProps<T extends BaseComboboxItem> = BaseComboboxProps<T> &
  (
    | {
        multiple: false;
        onChange: (value: T | null) => void;
        value: T | null;
      }
    | {
        multiple: true;
        onChange: (value: T[]) => void;
        value: T[];
      }
  );

export function Combobox<T extends BaseComboboxItem>({
  items,
  value,
  onChange,
  placeholder = "Select an item",
  notFoundContent = "No items found.",
  renderItem,
  multiple,
}: ComboboxProps<T>) {
  const anchorRef = useRef<HTMLFieldSetElement>(null);
  return (
    <ShadCombobox
      items={items}
      itemToStringValue={(item: T) => item.label}
      multiple={multiple}
      onValueChange={(value) => onChange(value as T & T[])}
      value={value}
    >
      <ComboboxInput
        className="h-10"
        leftAddon={<RiSearchLine />}
        placeholder={placeholder}
        ref={anchorRef}
      />
      <ComboboxContent anchor={anchorRef}>
        <ComboboxEmpty>{notFoundContent}</ComboboxEmpty>
        <ComboboxList>
          {(item: T) => (
            <ComboboxItem key={item.value} value={item}>
              {renderItem?.(item) ?? item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </ShadCombobox>
  );
}
