import React from 'react'
import { WidgetWrapper } from '../components/WidgetWrapper'
import { QuickActionList, type QuickActionItem } from '../components/QuickActionList'
import { type WidgetLifecycleState } from '../types'
import { Plus, UserPlus, Send, Bell, Sliders, List } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface QuickActionsWidgetProps {
  state?: WidgetLifecycleState
  onRefresh?: () => void
}

export const QuickActionsWidget: React.FC<QuickActionsWidgetProps> = ({ state, onRefresh }) => {
  const { toast } = useToast()

  const handleActionClick = (label: string) => {
    toast({
      title: 'Action Triggered',
      description: `Dashboard Quick Action: "${label}" has been initiated.`
    })
  }

  const actions: QuickActionItem[] = [
    {
      icon: Plus,
      label: 'Add Client',
      onClick: () => handleActionClick('Add Client'),
      variant: 'primary'
    },
    {
      icon: UserPlus,
      label: 'Add Operator',
      onClick: () => handleActionClick('Add Operator')
    },
    {
      icon: Send,
      label: 'Send Message',
      onClick: () => handleActionClick('Send Message')
    },
    {
      icon: Bell,
      label: 'Notifications',
      counter: 8,
      onClick: () => handleActionClick('Notifications')
    },
    {
      icon: Sliders,
      label: 'Platform Settings',
      onClick: () => handleActionClick('Platform Settings')
    },
    {
      icon: List,
      label: 'Audit Logs',
      onClick: () => handleActionClick('Audit Logs')
    }
  ]

  return (
    <WidgetWrapper
      title="Quick Actions"
      subtitle="Direct commands and shortcuts"
      initialState={state}
      onRefresh={onRefresh}
    >
      <QuickActionList actions={actions} />
    </WidgetWrapper>
  )
}

export default QuickActionsWidget
