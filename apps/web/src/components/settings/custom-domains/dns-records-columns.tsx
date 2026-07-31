import { RiFileCopyLine } from "@remixicon/react";
import { Badge, type BadgeVariant } from "@repo/ui/components/reui/badge";
import { Button } from "@repo/ui/components/ui/coss/button";
import { useCopyToClipboard } from "@repo/ui/hooks/use-copy-to-clipboard";
import type { ColumnDef } from "@tanstack/react-table";
import type { DNSRecord } from "./types";

function CopyableText({ text }: { text: string }) {
  const copy = useCopyToClipboard(text);

  return (
    <Button
      className="h-auto! w-full min-w-0 max-w-full justify-start overflow-hidden p-0! font-normal"
      onClick={copy}
      title={text}
      type="button"
      variant="link"
    >
      <span className="block min-w-0 truncate">{text}</span>
      <RiFileCopyLine />
    </Button>
  );
}

function toRelativeHost(name: string, fqdn: string): string {
  if (name === fqdn) {
    return "@";
  }

  const suffix = `.${fqdn}`;
  if (name.endsWith(suffix)) {
    return name.slice(0, -suffix.length);
  }

  return name;
}

export const columns: ColumnDef<DNSRecord>[] = [
  {
    accessorKey: "recordType",
    id: "recordType",
    header: "Type",
    cell: (cellApi) => cellApi.getValue() as string,
    size: 128,
  },
  {
    accessorKey: "name",
    id: "name",
    header: "Name",
    cell: (cellApi) => (
      <CopyableText
        text={toRelativeHost(
          cellApi.getValue() as string,
          (cellApi.table.options.meta as { fqdn: string })?.fqdn
        )}
      />
    ),
    meta: {
      cellClassName: "max-w-0",
    },
    size: 400,
  },
  {
    accessorKey: "value",
    id: "value",
    header: "Content",
    cell: (cellApi) => <CopyableText text={cellApi.getValue() as string} />,
    meta: {
      autoSize: true,
      cellClassName: "max-w-0",
    },
  },
  {
    accessorKey: "priority",
    id: "priority",
    header: "Priority",
    cell: (cellApi) => cellApi.getValue() as number | undefined,
    size: 96,
  },
  {
    accessorKey: "ttl",
    id: "ttl",
    header: "TTL",
    cell: (cellApi) => {
      const ttl = cellApi.getValue() as number | undefined;
      return ttl ? ttl : "Auto";
    },
    size: 96,
  },
  {
    accessorKey: "status",
    id: "status",
    header: "Status",
    cell: (cellApi) => {
      const status = cellApi.getValue() as DNSRecord["status"];
      let variant: BadgeVariant = "secondary";
      switch (status) {
        case "active":
          variant = "success-light";
          break;
        case "missing":
          variant = "destructive-light";
          break;
        case "pending":
          variant = "warning-light";
          break;
        default:
      }

      return (
        <Badge className="capitalize" size="lg" variant={variant}>
          {status}
        </Badge>
      );
    },
    size: 128,
  },
];
