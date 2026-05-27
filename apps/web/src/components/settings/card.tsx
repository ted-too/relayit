import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/ui/shad/card";
import { cn } from "@repo/ui/lib/utils";

export function SettingsCard({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Card>, "size">) {
  return (
    <Card
      className={cn("w-full data-[size=lg]:gap-3", className)}
      size="lg"
      {...props}
    />
  );
}

export function SettingsCardHeader({
  className,
  ...props
}: Omit<React.ComponentProps<typeof CardHeader>, "size">) {
  return <CardHeader className={cn(className)} {...props} />;
}

export function SettingsCardTitle({
  className,
  ...props
}: Omit<React.ComponentProps<typeof CardTitle>, "size">) {
  return (
    <CardTitle
      className={cn("font-semibold text-xl leading-relaxed", className)}
      {...props}
    />
  );
}

export function SettingsCardDescription({
  className,
  ...props
}: Omit<React.ComponentProps<typeof CardDescription>, "size">) {
  return <CardDescription className={cn("mt-3 mb-1", className)} {...props} />;
}

export function SettingsCardContent({
  className,
  ...props
}: Omit<React.ComponentProps<typeof CardContent>, "size">) {
  return <CardContent className={cn(className)} {...props} />;
}

export function SettingsCardFooter({
  className,
  ...props
}: Omit<React.ComponentProps<typeof CardFooter>, "size">) {
  return (
    <CardFooter
      className={cn(
        "mt-3 justify-between group-data-[size=lg]/card:px-6 group-data-[size=lg]/card:py-3",
        className
      )}
      {...props}
    />
  );
}
