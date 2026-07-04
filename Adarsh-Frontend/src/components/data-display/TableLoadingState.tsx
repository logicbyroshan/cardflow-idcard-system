import React from 'react'
import { TableLoader } from '@/components/feedback/TableLoader'

interface TableLoadingStateProps {
  rows?: number
  cols?: number
}

export const TableLoadingState: React.FC<TableLoadingStateProps> = ({
  rows = 5,
  cols = 5,
}) => {
  return (
    <div className="w-full">
      <TableLoader rows={rows} cols={cols} />
    </div>
  )
}

export default TableLoadingState
