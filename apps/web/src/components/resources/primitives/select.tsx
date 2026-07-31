import {
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Select as ShadSelect,
} from "@repo/ui/components/ui/shad/select";
import { cn } from "@repo/ui/lib/utils";

interface BaseSelectItem {
  label: string;
  value: string;
}

interface BaseSelectProps<T extends BaseSelectItem> {
  className?: string;
  items: T[];
  leftAddon?: React.ReactNode;
  notFoundContent?: string;
  placeholder?: string;
  renderItem?: (item: T) => React.ReactNode;
}

type SelectProps<T extends BaseSelectItem> = BaseSelectProps<T> &
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

export function Select<T extends BaseSelectItem>({
  items,
  value,
  onChange,
  multiple,
  placeholder = "Select an item",
  leftAddon,
  className,
}: SelectProps<T>) {
  return (
    <ShadSelect
      isItemEqualToValue={(item, value) => item.value === value.value}
      items={items}
      itemToStringLabel={(item) => item.label}
      itemToStringValue={(item) => item.value}
      multiple={multiple}
      onValueChange={(value) => onChange(value as T & T[])}
      value={value}
    >
      <SelectTrigger className={cn("data-[size=default]:h-10", className)}>
        {leftAddon}
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </ShadSelect>
  );
}
