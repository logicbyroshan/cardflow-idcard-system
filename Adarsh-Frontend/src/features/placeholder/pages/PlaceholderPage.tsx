import React, { useState } from 'react'
import PageHeader from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import StandardLayout from '@/components/layout/variants/StandardLayout'
import TableLayout from '@/components/layout/variants/TableLayout'
import SettingsLayout from '@/components/layout/variants/SettingsLayout'
import DashboardLayout from '@/components/layout/variants/DashboardLayout'
import ManagementLayout from '@/components/layout/variants/ManagementLayout'
import { 
  RefreshCw, 
  Plus, 
  Search, 
  Filter, 
  AlertTriangle, 
  Layers,
  Activity,
  History
} from 'lucide-react'

interface PlaceholderPageProps {
  pageId: string
  title: string
  group: string
}

export const PlaceholderPage: React.FC<PlaceholderPageProps> = ({ pageId, title, group }) => {
  const [activeTab, setActiveTab] = useState('general')
  const [selectedItem, setSelectedItem] = useState(1)

  const breadcrumbs = ['Platform', group, title]

  // Render Dashboard Layout Variant
  if (pageId === 'dashboard') {
    return (
      <div className="space-y-4">
        <PageHeader
          title={title}
          description="Real-time operational dashboard for monitoring ID Card sync and reprint states"
          breadcrumbs={breadcrumbs}
          statusTags={[{ label: 'SYNC_STABLE', variant: 'default' }]}
          actionSlot={
            <Button size="sm" className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Force Refresh
            </Button>
          }
        />
        <DashboardLayout>
          {[
            { label: 'Active Sync Jobs', val: '14 Active', sub: 'Last sync 2 mins ago', color: 'text-primary' },
            { label: 'Reprint Requests', val: '82 Pending', sub: 'Requires Operator approval', color: 'text-warning' },
            { label: 'Total Cards Printed', val: '502,301', sub: '99.8% Success Rate', color: 'text-success' },
            { label: 'Operator Sessions', val: '4 Online', sub: 'Active in terminal clusters', color: 'text-foreground' }
          ].map((item, idx) => (
            <div key={idx} className="bg-panel border border-border p-4 rounded-sm flex flex-col justify-between h-28">
              <div className="flex justify-between items-start">
                <span className="text-caption text-muted uppercase tracking-wider">{item.label}</span>
                <Badge variant="outline">Live</Badge>
              </div>
              <div>
                <span className={`text-heading font-extrabold ${item.color}`}>{item.val}</span>
                <span className="text-caption block text-muted mt-0.5">{item.sub}</span>
              </div>
            </div>
          ))}
        </DashboardLayout>
      </div>
    )
  }

  // Render Tables Layout Variant (e.g. Data Tables)
  if (pageId === 'tables') {
    return (
      <div className="space-y-4 h-full flex flex-col">
        <PageHeader
          title={title}
          description="Unified registry database showing printed cards and rosters"
          breadcrumbs={breadcrumbs}
          statusTags={[{ label: 'ACTIVE_QUERY', variant: 'default' }]}
          actionSlot={
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add Roster Record
            </Button>
          }
        />

        <TableLayout
          toolbarSlot={
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <Input placeholder="Search roster name or badge ID..." className="h-9" />
                <Button size="icon" variant="outline" className="h-9 w-9 shrink-0">
                  <Search className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1 h-9">
                  <Filter className="h-3.5 w-3.5" /> Filters
                </Button>
                <Button variant="outline" size="sm" className="gap-1 h-9">
                  Export CSV
                </Button>
              </div>
            </div>
          }
          paginationSlot={
            <div className="flex items-center justify-between text-caption text-muted">
              <span>Showing 1-10 of 500 records</span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-7 px-2" disabled>Prev</Button>
                <Button variant="outline" size="sm" className="h-7 px-2">Next</Button>
              </div>
            </div>
          }
        >
          <table className="w-full text-left border-collapse text-table">
            <thead>
              <tr className="border-b border-border bg-neutral-950/20 text-muted uppercase text-[11px] tracking-wider">
                <th className="p-3">Roster Name</th>
                <th className="p-3">Badge ID</th>
                <th className="p-3">Class/Group</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Adarsh Sharma', id: 'BADGE-9021', group: 'Section A', status: 'PRINTED', variant: 'default' },
                { name: 'Rohan Gupta', id: 'BADGE-1240', group: 'Section B', status: 'PENDING', variant: 'outline' },
                { name: 'Pooja Patel', id: 'BADGE-8012', group: 'Section A', status: 'PRINTED', variant: 'default' },
                { name: 'Vikram Singh', id: 'BADGE-4421', group: 'Section C', status: 'REJECTED', variant: 'destructive' }
              ].map((row, idx) => (
                <tr key={idx} className="border-b border-border/40 hover:bg-neutral-800/20">
                  <td className="p-3 font-semibold text-foreground">{row.name}</td>
                  <td className="p-3 font-mono text-muted">{row.id}</td>
                  <td className="p-3 text-muted">{row.group}</td>
                  <td className="p-3 text-center">
                    <Badge variant={row.variant as any}>{row.status}</Badge>
                  </td>
                  <td className="p-3 text-right">
                    <Button variant="outline" size="sm" className="h-7">Inspect</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableLayout>
      </div>
    )
  }

  // Render Management Layout Variant
  if (pageId === 'management') {
    const mockOperators = [
      { id: 1, name: 'Operator Chief A', email: 'chief@adarsh.com', status: 'Active' },
      { id: 2, name: 'Terminal Handler B', email: 'handler@adarsh.com', status: 'Active' },
      { id: 3, name: 'Roster Reviewer C', email: 'reviewer@adarsh.com', status: 'Suspended' }
    ]
    const selectedOp = mockOperators.find(o => o.id === selectedItem) || mockOperators[0]

    return (
      <div className="space-y-4 h-full flex flex-col">
        <PageHeader
          title={title}
          description="Configure roster variables and system operators"
          breadcrumbs={breadcrumbs}
          actionSlot={
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add Staff Operator
            </Button>
          }
        />
        <ManagementLayout
          listPanel={
            <div className="flex flex-col h-full">
              <div className="p-3 border-b border-border bg-neutral-900/20 flex gap-2">
                <Input placeholder="Filter list..." className="h-9 flex-1" />
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-border/40">
                {mockOperators.map((op) => (
                  <button
                    key={op.id}
                    onClick={() => setSelectedItem(op.id)}
                    className={`w-full text-left p-3 flex flex-col gap-1 transition-colors ${
                      selectedItem === op.id ? 'bg-primary/10 border-l-2 border-primary' : 'hover:bg-neutral-800/20'
                    }`}
                  >
                    <span className="text-body font-bold text-foreground">{op.name}</span>
                    <span className="text-caption text-muted">{op.email}</span>
                  </button>
                ))}
              </div>
            </div>
          }
          detailPanel={
            <div className="p-4 space-y-4">
              <div className="flex justify-between items-start border-b border-border pb-3">
                <div>
                  <h3 className="text-subheading font-bold text-foreground">{selectedOp.name}</h3>
                  <p className="text-caption text-muted">ID Profile Node: OP-{selectedOp.id}</p>
                </div>
                <Badge variant={selectedOp.status === 'Active' ? 'default' : 'destructive'}>
                  {selectedOp.status}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-neutral-900/40 border border-border/40 rounded-sm">
                  <span className="text-[10px] text-muted block uppercase tracking-wider">Default Email</span>
                  <span className="text-body text-foreground">{selectedOp.email}</span>
                </div>
                <div className="p-3 bg-neutral-900/40 border border-border/40 rounded-sm">
                  <span className="text-[10px] text-muted block uppercase tracking-wider">Access Scope</span>
                  <span className="text-body text-foreground">Global Cluster</span>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-caption text-foreground font-bold uppercase tracking-wider">Operator Actions</h4>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm">Modify Credentials</Button>
                  <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10">
                    Suspend Operator
                  </Button>
                </div>
              </div>
            </div>
          }
        />
      </div>
    )
  }

  // Render Settings Layout Variant
  if (pageId === 'settings') {
    const tabs = [
      { id: 'general', label: 'General System Config', active: activeTab === 'general', onClick: () => setActiveTab('general') },
      { id: 'security', label: 'Security & Access Keys', active: activeTab === 'security', onClick: () => setActiveTab('security') }
    ]

    return (
      <div className="space-y-4 h-full flex flex-col">
        <PageHeader
          title={title}
          description="Adjust system settings and credentials configuration parameters"
          breadcrumbs={breadcrumbs}
        />
        <SettingsLayout tabs={tabs}>
          {activeTab === 'general' ? (
            <>
              <div>
                <h3 className="text-subheading font-semibold text-foreground mb-1">General Configurations</h3>
                <p className="text-caption text-muted">Configure the global syncing nodes parameters</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
                <div className="space-y-1.5">
                  <label className="text-caption text-foreground block font-bold">Sync Interval (seconds)</label>
                  <Input type="number" defaultValue="120" className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-caption text-foreground block font-bold">Default Device Cluster ID</label>
                  <Input defaultValue="CLUSTER-EAST-01" className="h-9" />
                </div>
              </div>
              <Button size="sm">Save Configuration</Button>
            </>
          ) : (
            <>
              <div>
                <h3 className="text-subheading font-semibold text-foreground mb-1">Security & Access Keys</h3>
                <p className="text-caption text-muted">Manage database key rotations and certificates</p>
              </div>
              <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-caption rounded-sm max-w-xl flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Modifying these keys will immediately force reprint queues to log out and re-authenticate.</span>
              </div>
              <div className="space-y-1.5 max-w-xl">
                <label className="text-caption text-foreground block font-bold">Primary Encryption Key Hash</label>
                <Input type="password" value="••••••••••••••••••••••••••••••••••••" className="h-9" disabled />
              </div>
              <Button variant="outline" size="sm" className="text-destructive">Rotate Keys</Button>
            </>
          )}
        </SettingsLayout>
      </div>
    )
  }

  // Render Standard/Informational Layout Variant
  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={`Interactive mockup placeholder for the ${title} workflow`}
        breadcrumbs={breadcrumbs}
        statusTags={[{ label: 'PLACEHOLDER_SHELL', variant: 'outline' }]}
      />
      <StandardLayout>
        <div className="bg-panel border border-border p-6 rounded-sm text-center space-y-4 max-w-2xl mx-auto mt-6">
          <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto text-primary">
            <Layers className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h3 className="text-subheading font-bold text-foreground">{title} Console</h3>
            <p className="text-body text-muted">
              This is a foundation shell routing page. It validates the menu navigation, topbar context, and layout responsiveness. Business logic will be integrated in Phase 2.
            </p>
          </div>
          <div className="flex justify-center gap-3">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Diagnostics
            </Button>
            <Button size="sm" className="gap-1.5">
              <History className="h-3.5 w-3.5" /> Audit Trail
            </Button>
          </div>
        </div>
      </StandardLayout>
    </div>
  )
}

export default PlaceholderPage
