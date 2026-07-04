import type { ReactNode } from 'react'
import type { Table } from '@tanstack/react-table'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface TableToolbarProps<TData> {
  table: Table<TData>
  searchKey?: string
  placeholder?: string
  actionSlot?: ReactNode
}

export function TableToolbar<TData>({
  table,
  searchKey,
  placeholder = "Search...",
  actionSlot,
}: TableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0

  return (
    <div className="flex items-center justify-between p-2 bg-panel border border-border border-b-0 rounded-none gap-4">
      <div className="flex flex-1 items-center gap-2 max-w-sm relative">
        {searchKey && (
          <>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
            <Input
              placeholder={placeholder}
              value={(table.getColumn(searchKey)?.getFilterValue() as string) ?? ""}
              onChange={(event) =>
                table.getColumn(searchKey)?.setFilterValue(event.target.value)
              }
              className="w-full bg-background border-border pl-8 rounded-sm text-body"
            />
            {isFiltered && (
              <Button
                variant="ghost"
                onClick={() => table.resetColumnFilters()}
                className="px-2 lg:px-3 text-caption text-destructive hover:bg-destructive/10 uppercase"
              >
                CLEAR
              </Button>
            )}
          </>
        )}
      </div>
      
      {/* Right actions */}
      <div className="flex items-center gap-2">
        {actionSlot}
      </div>
    </div>
  )
}

export default TableToolbar
