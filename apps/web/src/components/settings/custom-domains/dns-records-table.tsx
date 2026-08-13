import { RiErrorWarningFill } from "@remixicon/react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@repo/ui/components/reui/alert";
import { Badge } from "@repo/ui/components/reui/badge";
import {
  DataGrid,
  DataGridContainer,
} from "@repo/ui/components/reui/data-grid/data-grid";
import { DataGridScrollArea } from "@repo/ui/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@repo/ui/components/reui/data-grid/data-grid-table";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { dnsRecordWarningCopy } from "./dns-record-warnings";
import { columns } from "./dns-records-columns";
import type { DNSRecord } from "./types";

export function DNSRecordsTable({
  fqdn,
  records,
  title,
  optional = false,
  hasPriority = false,
}: {
  fqdn: string;
  records: DNSRecord[];
  title: string;
  optional?: boolean;
  hasPriority?: boolean;
}) {
  const warnings = records.flatMap((record) => record.warnings ?? []);

  const table = useReactTable({
    columns,
    data: records,
    initialState: {
      columnVisibility: {
        priority: hasPriority,
      },
    },
    enableHiding: hasPriority,
    getRowId: (row) =>
      `${row.purpose}-${row.name}${row.priority ? `-${row.priority}` : ""}`,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      fqdn,
      hasPriority,
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <span className="font-semibold text-xl">{title}</span>
        <Badge size="lg" variant={optional ? "outline" : "secondary"}>
          {optional ? "Optional" : "Required"}
        </Badge>
      </div>
      {warnings.map((warning) => {
        const copy = dnsRecordWarningCopy(warning);
        return (
          <Alert
            key={`${warning.code}-${warning.recordCount}`}
            variant="warning"
          >
            <RiErrorWarningFill />
            <AlertTitle>{copy.title}</AlertTitle>
            <AlertDescription>{copy.description}</AlertDescription>
          </Alert>
        );
      })}
      <DataGrid
        data={records}
        recordCount={records.length}
        table={table}
        tableClassNames={{
          headerRow:
            "*:first:rounded-l-md *:last:rounded-r-md *:border-y *:first:border-l *:last:border-r",
          bodyRow: "*:border-b",
        }}
        tableLayout={{ headerBackground: true, headerBorder: false }}
      >
        <div className="w-full space-y-2.5">
          <DataGridContainer>
            <DataGridScrollArea>
              <DataGridTable />
            </DataGridScrollArea>
          </DataGridContainer>
        </div>
      </DataGrid>
    </div>
  );
}
