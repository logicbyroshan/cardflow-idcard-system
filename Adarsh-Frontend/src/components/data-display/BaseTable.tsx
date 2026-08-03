import React from 'react'
import { flexRender, type Table as TableInstance } from '@tanstack/react-table'
import { TableLoadingState } from './TableLoadingState'
import { TableEmptyState } from './TableEmptyState'
import { cn } from '@/utils/cn'
import { getColumnAlignment } from '@/utils/tableAlignment'

interface BaseTableProps<TData> {
  table: TableInstance<TData>
  isLoading?: boolean
  emptyState?: React.ReactNode
  onRowClick?: (row: TData) => void
  containerClassName?: string
  
  // Virtualization parameters
  virtualizer?: {
    getVirtualItems: () => any[]
    getTotalSize: () => number
    measureElement: (element: any) => void
  }
}

export function BaseTable<TData>({
  table,
  isLoading = false,
  emptyState,
  onRowClick,
  containerClassName,
  virtualizer,
}: BaseTableProps<TData>) {
  const { rows } = table.getRowModel()
  const headerGroups = table.getHeaderGroups()

  if (isLoading) {
    // Show table structure with skeleton loading rows
    return (
      <TableLoadingState 
        rows={table.getState().pagination.pageSize || 5} 
        cols={table.getVisibleFlatColumns().length || 4} 
      />
    )
  }

  const hasNoData = rows.length === 0

  return (
    <div className={cn("w-full border border-border bg-panel overflow-hidden", containerClassName)}>
      {/* Table Container */}
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left border-collapse text-table">
          {/* Table Headers */}
          <thead>
            {headerGroups.map((headerGroup) => (
              <tr 
                key={headerGroup.id} 
                className="border-b border-border bg-neutral-900/50"
              >
                {headerGroup.headers.map((header) => {
                  const headerText = typeof header.column.columnDef.header === 'string' ? header.column.columnDef.header : undefined;
                  const align = (header.column.columnDef.meta as { align?: 'center' | 'left' })?.align || getColumnAlignment(header.column.id, headerText);
                  
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        "py-1.5 px-2 text-badge font-bold text-muted border-r border-border last:border-r-0 select-none relative group",
                        align === 'center' ? 'text-center' : 'text-left'
                      )}
                      style={{ width: header.getSize() }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className={cn(
                            "absolute right-0 top-0 h-full w-1 bg-border/20 cursor-col-resize select-none touch-none hover:bg-primary/80 transition-colors opacity-0 group-hover:opacity-100",
                            header.column.getIsResizing() && "bg-primary opacity-100 w-1"
                          )}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          {/* Table Body (Standard or Virtualized) */}
          <tbody>
            {hasNoData ? (
              <tr>
                <td 
                  colSpan={table.getVisibleFlatColumns().length} 
                  className="p-0 border-none"
                >
                  {emptyState || <TableEmptyState />}
                </td>
              </tr>
            ) : virtualizer ? (
              // Virtualized rendering layout
              <>
                <tr style={{ height: `${virtualizer.getVirtualItems()[0]?.start ?? 0}px` }} />
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const row = rows[virtualRow.index]
                  return (
                    <tr
                      key={row.id}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      className={cn(
                        "border-b border-border hover:bg-neutral-800/40 transition-colors last:border-b-0",
                        onRowClick && "cursor-pointer"
                      )}
                      onClick={() => onRowClick && onRowClick(row.original)}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const headerText = typeof cell.column.columnDef.header === 'string' ? cell.column.columnDef.header : undefined;
                        const align = (cell.column.columnDef.meta as { align?: 'center' | 'left' })?.align || getColumnAlignment(cell.column.id, headerText);

                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              "py-1.5 px-2 border-r border-border last:border-r-0 font-medium text-foreground text-table",
                              align === 'center' ? 'text-center' : 'text-left'
                            )}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  )
                })}
                <tr
                  style={{
                    height: `${
                      virtualizer.getTotalSize() -
                      (virtualizer.getVirtualItems()[virtualizer.getVirtualItems().length - 1]?.end ?? 0)
                    }px`,
                  }}
                />
              </>
            ) : (
              // Standard rendering layout
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-border hover:bg-neutral-800/40 transition-colors last:border-b-0",
                    onRowClick && "cursor-pointer"
                  )}
                  onClick={() => onRowClick && onRowClick(row.original)}
                >
                  {row.getVisibleCells().map((cell) => {
                    const headerText = typeof cell.column.columnDef.header === 'string' ? cell.column.columnDef.header : undefined;
                    const align = (cell.column.columnDef.meta as { align?: 'center' | 'left' })?.align || getColumnAlignment(cell.column.id, headerText);

                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          "py-1.5 px-2 border-r border-border last:border-r-0 font-medium text-foreground text-table",
                          align === 'center' ? 'text-center' : 'text-left'
                        )}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default BaseTable
