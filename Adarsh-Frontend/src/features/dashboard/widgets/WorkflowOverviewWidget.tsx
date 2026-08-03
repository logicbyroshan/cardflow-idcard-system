import React from 'react'
import { WidgetWrapper } from '../components/WidgetWrapper'
import { WorkflowStrip } from '../components/WorkflowStrip'
import { type WidgetLifecycleState } from '../types'

interface WorkflowOverviewWidgetProps {
  state?: WidgetLifecycleState
  onRefresh?: () => void
}

export const WorkflowOverviewWidget: React.FC<WorkflowOverviewWidgetProps> = ({ state, onRefresh }) => {
  return (
    <WidgetWrapper
      title="Workflow Roster Overview"
      subtitle="Current lifecycle distribution metrics across the database"
      initialState={state}
      onRefresh={onRefresh}
    >
      <WorkflowStrip />
    </WidgetWrapper>
  )
}
export default WorkflowOverviewWidget
