"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { type ComponentProps, type HTMLAttributes, useState } from "react";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsPanels,
  TabsTab,
} from "@/components/animate-ui/components/base/tabs";
import { Button } from "@/components/base/button";
import { cn } from "@/lib/utils";

export type SnippetProps = ComponentProps<typeof Tabs>;

export const Snippet = ({ className, ...props }: SnippetProps) => (
  <Tabs
    className={cn(
      "group w-full gap-0 overflow-hidden rounded-md border",
      className
    )}
    {...props}
  />
);

export type SnippetHeaderProps = HTMLAttributes<HTMLDivElement>;

export const SnippetHeader = ({ className, ...props }: SnippetHeaderProps) => (
  <div
    className={cn(
      "flex flex-row items-center justify-between border-b bg-secondary p-1",
      className
    )}
    {...props}
  />
);

export type SnippetCopyButtonProps = ComponentProps<typeof Button> & {
  value: string;
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export const SnippetCopyButton = ({
  value,
  onCopy,
  onError,
  timeout = 2000,
  children,
  ...props
}: SnippetCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = () => {
    if (
      typeof window === "undefined" ||
      !navigator.clipboard.writeText ||
      !value
    ) {
      return;
    }

    navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      onCopy?.();

      setTimeout(() => setIsCopied(false), timeout);
    }, onError);
  };

  const icon = isCopied ? <CheckIcon size={14} /> : <CopyIcon size={14} />;

  return (
    <Button
      className="opacity-0 transition-opacity group-hover:opacity-100"
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
      {...props}
    >
      {children ?? icon}
    </Button>
  );
};

export type SnippetTabsListProps = ComponentProps<typeof TabsList>;

export const SnippetTabsList = TabsList;

export type SnippetTabsTriggerProps = ComponentProps<typeof TabsTab>;

export const SnippetTabsTrigger = ({
  className,
  ...props
}: SnippetTabsTriggerProps) => (
  <TabsTab className={cn("gap-1.5", className)} {...props} />
);

export type SnippetTabsPanelsProps = ComponentProps<typeof TabsPanels>;

export const SnippetTabsPanels = TabsPanels;

export type SnippetTabsContentProps = ComponentProps<typeof TabsPanel>;

export const SnippetTabsContent = ({
  className,
  children,
  ...props
}: SnippetTabsContentProps) => (
  <TabsPanel
    className={cn("mt-0 bg-background p-4 text-sm", className)}
    {...props}
  >
    <pre className="truncate">{children}</pre>
  </TabsPanel>
);
