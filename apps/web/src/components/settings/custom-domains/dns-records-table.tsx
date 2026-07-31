import { Badge } from "@repo/ui/components/reui/badge";
import {
  DataGrid,
  DataGridContainer,
} from "@repo/ui/components/reui/data-grid/data-grid";
import { DataGridScrollArea } from "@repo/ui/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@repo/ui/components/reui/data-grid/data-grid-table";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
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
      <DataGrid
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
