import React, { useMemo, useState } from 'react'
import { useReactTable, getCoreRowModel, type ColumnDef } from '@tanstack/react-table'
import { BaseTable } from '@/components/data-display/BaseTable'
import { WidgetWrapper } from '../components/WidgetWrapper'
import { type WidgetLifecycleState } from '../types'

interface ClientRow {
  clientName: string
  pending: number
  verified: number
  approved: number
  downloaded: number
  reprint: number
  total: number
  lastActivity: string
}

interface ClientOverviewWidgetProps {
  state?: WidgetLifecycleState
  onRefresh?: () => void
}

const mockClients: ClientRow[] = [
  { clientName: 'Delhi Public School (Dwarka)', pending: 12, verified: 45, approved: 120, downloaded: 98, reprint: 4, total: 279, lastActivity: '2m ago' },
  { clientName: "St. Xavier's Academy (Kolkata)", pending: 0, verified: 8, approved: 230, downloaded: 220, reprint: 12, total: 470, lastActivity: '5m ago' },
  { clientName: 'Orchid International (Mumbai)', pending: 85, verified: 12, approved: 45, downloaded: 10, reprint: 1, total: 153, lastActivity: '12m ago' },
  { clientName: 'Kendriya Vidyalaya (Noida)', pending: 3, verified: 90, approved: 350, downloaded: 340, reprint: 8, total: 791, lastActivity: '22m ago' },
  { clientName: 'GD Goenka School (Gurugram)', pending: 42, verified: 0, approved: 15, downloaded: 0, reprint: 0, total: 57, lastActivity: '1h ago' },
  { clientName: 'Ryan International (Bengaluru)', pending: 150, verified: 340, approved: 1020, downloaded: 980, reprint: 45, total: 2535, lastActivity: '3h ago' },
  { clientName: 'The Heritage School (Ranchi)', pending: 0, verified: 0, approved: 82, downloaded: 82, reprint: 2, total: 166, lastActivity: '5h ago' },
  { clientName: 'DAV Public School (Patna)', pending: 22, verified: 55, approved: 190, downloaded: 180, reprint: 6, total: 453, lastActivity: '1d ago' }
]

export const ClientOverviewWidget: React.FC<ClientOverviewWidgetProps> = ({ state, onRefresh }) => {
  const [data] = useState<ClientRow[]>(mockClients)

  const columns = useMemo<ColumnDef<ClientRow>[]>(
    () => [
      {
        accessorKey: 'clientName',
        header: 'Client Name',
        size: 220,
      },
      {
        accessorKey: 'pending',
        header: 'Pending',
        size: 70,
        meta: { align: 'center' },
        cell: ({ getValue }) => <span className="font-mono text-amber-500">{getValue() as number}</span>
      },
      {
        accessorKey: 'verified',
        header: 'Verified',
        size: 70,
        meta: { align: 'center' },
        cell: ({ getValue }) => <span className="font-mono text-blue-400">{getValue() as number}</span>
      },
      {
        accessorKey: 'approved',
        header: 'Approved',
        size: 70,
        meta: { align: 'center' },
        cell: ({ getValue }) => <span className="font-mono text-emerald-400">{getValue() as number}</span>
      },
      {
        accessorKey: 'downloaded',
        header: 'Downloaded',
        size: 80,
        meta: { align: 'center' },
        cell: ({ getValue }) => <span className="font-mono text-purple-400">{getValue() as number}</span>
      },
      {
        accessorKey: 'reprint',
        header: 'Reprint',
        size: 70,
        meta: { align: 'center' },
        cell: ({ getValue }) => <span className="font-mono text-rose-400">{getValue() as number}</span>
      },
      {
        accessorKey: 'total',
        header: 'Total',
        size: 70,
        meta: { align: 'center' },
        cell: ({ getValue }) => <span className="font-mono font-bold text-foreground">{getValue() as number}</span>
      },
      {
        accessorKey: 'lastActivity',
        header: 'Last Activity',
        size: 100,
        cell: ({ getValue }) => <span className="text-[10px] text-muted-foreground font-mono">{getValue() as string}</span>
      }
    ],
    []
  )

  const table = useReactTable({
    data,
    columns,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <WidgetWrapper
      title="Client Workspace Overview"
      subtitle="Total cards and status aggregates by client school"
      initialState={state}
      onRefresh={onRefresh}
    >
      <div className="w-full overflow-hidden max-h-[280px]">
        <BaseTable 
          table={table} 
          containerClassName="max-h-[250px] overflow-y-auto"
        />
      </div>
    </WidgetWrapper>
  )
}

export default ClientOverviewWidget
