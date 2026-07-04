import type { Table } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface TablePaginationProps<TData> {
  table: Table<TData>
  pageSizeOptions?: number[]
}

export function TablePagination<TData>({
  table,
  pageSizeOptions = [10, 25, 50, 100],
}: TablePaginationProps<TData>) {
  const { pageIndex, pageSize } = table.getState().pagination
  const totalRows = table.getFilteredRowModel().rows.length
  const pageCount = table.getPageCount()

  const startRowIndex = pageIndex * pageSize + 1
  const endRowIndex = Math.min((pageIndex + 1) * pageSize, totalRows)

  // Generate list of page numbers to show (up to 5 pages)
  const getPageNumbers = () => {
    const pages = []
    const maxVisiblePages = 5
    let startPage = Math.max(0, pageIndex - 2)
    const endPage = Math.min(pageCount - 1, startPage + maxVisiblePages - 1)
    
    if (endPage - startPage < maxVisiblePages - 1) {
      startPage = Math.max(0, endPage - maxVisiblePages + 1)
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i)
    }
    return pages
  }

  return (
    <div className="flex items-center justify-between px-3 py-1.5 border border-border border-t-0 bg-panel text-table select-none">
      {/* LEFT: Showing range */}
      <div className="text-muted">
        Showing <span className="font-semibold text-foreground">{totalRows === 0 ? 0 : `${startRowIndex}–${endRowIndex}`}</span> of <span className="font-semibold text-foreground">{totalRows}</span>
      </div>

      {/* CENTER: Pagination controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="px-2.5 rounded-sm border-border uppercase"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          PREVIOUS
        </Button>
        
        {getPageNumbers().map((i) => (
          <Button
            key={i}
            variant={pageIndex === i ? 'default' : 'outline'}
            size="sm"
            className="w-7 p-0 rounded-sm border-border"
            onClick={() => table.setPageIndex(i)}
          >
            {i + 1}
          </Button>
        ))}

        <Button
          variant="outline"
          size="sm"
          className="px-2.5 rounded-sm border-border uppercase"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          NEXT
        </Button>
      </div>

      {/* RIGHT: Rows Per Page */}
      <div className="flex items-center gap-2">
        <span className="text-muted">Rows per page:</span>
        <Select
          value={`${pageSize}`}
          onValueChange={(value) => {
            table.setPageSize(Number(value))
          }}
        >
          <SelectTrigger className="h-7 w-[70px] bg-background border-border rounded-sm">
            <SelectValue placeholder={pageSize} />
          </SelectTrigger>
          <SelectContent className="bg-panel border border-border">
            {pageSizeOptions.map((size) => (
              <SelectItem key={size} value={`${size}`}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export default TablePagination
