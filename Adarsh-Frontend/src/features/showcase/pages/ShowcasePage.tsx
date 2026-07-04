import React from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { 
  useReactTable, 
  getCoreRowModel, 
  getFilteredRowModel, 
  getPaginationRowModel,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState
} from '@tanstack/react-table'

// Primitives
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/layout/PageHeader'
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'

// Form Wrappers
import { FormInput } from '@/components/forms/FormInput'
import { FormSelect } from '@/components/forms/FormSelect'
import { FormTextarea } from '@/components/forms/FormTextarea'
import { FormCheckbox } from '@/components/forms/FormCheckbox'
import { FormSwitch } from '@/components/forms/FormSwitch'

// Table Components
import { BaseTable } from '@/components/data-display/BaseTable'
import { TableToolbar } from '@/components/data-display/TableToolbar'
import { TablePagination } from '@/components/data-display/TablePagination'

// Status Map
import { STATUSES, type StatusKey } from '@/constants/statuses'

// Loaders
import { PageLoader } from '@/components/feedback/PageLoader'

// Icons
import { Layers, CheckCircle2, AlertTriangle, Info, Eye } from 'lucide-react'

// Define validation schema for the form showcase
const showcaseSchema = z.object({
  clientName: z.string().min(2, "Client name must be at least 2 characters"),
  environment: z.string().min(1, "Please select an environment"),
  notes: z.string().optional(),
  agreedToTerms: z.boolean().refine(v => v === true, "You must accept the terms"),
  sandboxMode: z.boolean(),
})

// Table data definition
interface MockClient {
  id: string
  clientName: string
  cardsCount: number
  status: StatusKey
  createdAt: string
}

// Generate 100 items of mock data to test paginated TanStack Table
const generateMockData = (): MockClient[] => {
  const statuses: StatusKey[] = ["PENDING", "VERIFIED", "APPROVED", "DOWNLOADED", "DELETED", "REQUESTED", "CONFIRMED", "REJECTED", "PRINTED"]
  return Array.from({ length: 100 }).map((_, index) => {
    const id = `cli-${(2000 + index).toString()}`
    const clientName = `Acme Operations ${index + 1}`
    const cardsCount = Math.floor(Math.random() * 12000) + 150
    const status = statuses[index % statuses.length]
    const createdAt = new Date(2026, 4, 1 + (index % 28)).toISOString().slice(0, 10)
    return { id, clientName, cardsCount, status, createdAt }
  })
}

const mockData = generateMockData()

export const ShowcasePage: React.FC = () => {
  const { toast } = useToast()
  const [btnLoading, setBtnLoading] = React.useState(false)
  const [tableLoading, setTableLoading] = React.useState(false)
  const [pageLoadingDemo, setPageLoadingDemo] = React.useState(false)

  // 1. Form Setup
  const methods = useForm<z.infer<typeof showcaseSchema>>({
    resolver: zodResolver(showcaseSchema),
    defaultValues: {
      clientName: '',
      environment: '',
      notes: '',
      agreedToTerms: false,
      sandboxMode: true,
    }
  })

  const onSubmit = (values: z.infer<typeof showcaseSchema>) => {
    toast({
      title: "Showcase Form Submitted",
      description: JSON.stringify(values, null, 2),
    })
  }

  // 2. Table Setup
  const [data] = React.useState<MockClient[]>(mockData)
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })

  // Table Columns Definition
  const columns = React.useMemo<ColumnDef<MockClient>[]>(
    () => [
      {
        accessorKey: "id",
        header: "Client ID",
        size: 100,
      },
      {
        accessorKey: "clientName",
        header: "Client Workspace",
        size: 250,
      },
      {
        accessorKey: "cardsCount",
        header: "Cards Managed",
        size: 150,
        cell: ({ getValue }) => {
          const val = getValue() as number
          return <span>{val.toLocaleString()}</span>
        }
      },
      {
        accessorKey: "status",
        header: "Status Token",
        size: 180,
        cell: ({ getValue }) => {
          const key = getValue() as StatusKey
          const conf = STATUSES[key]
          return (
            <Badge variant={conf.badgeVariant} className="py-0.5 rounded-sm uppercase">
              {conf.label}
            </Badge>
          )
        }
      },
      {
        accessorKey: "createdAt",
        header: "Created Date",
        size: 150,
      },
    ],
    []
  )

  const table = useReactTable({
    data,
    columns,
    state: {
      columnFilters,
      pagination,
    },
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  // Loading page demo trigger
  const handlePageLoaderDemo = () => {
    setPageLoadingDemo(true)
    setTimeout(() => setPageLoadingDemo(false), 2000)
  }

  if (pageLoadingDemo) {
    return <PageLoader />
  }

  return (
    <div className="flex flex-col">
      <PageHeader 
        title="Design System Showcase" 
        description="Verify theme tokens, typography, input wrappers, dialogs, and table pagination under dark-only ERP guidelines."
        actionSlot={
          <Button variant="outline" size="sm" onClick={handlePageLoaderDemo}>
            PAGE-LOADER DEMO
          </Button>
        }
      />

      {/* Stacked Divider Layout of Design Elements */}
      <div className="border border-border bg-panel divide-y divide-border mt-4">
        
        {/* Box 1: Typography */}
        <section className="p-4 space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <Layers className="h-4 w-4 text-primary" />
            <h2 className="text-subheading text-foreground">Typography Tokens (Saira Condensed)</h2>
          </div>
          <div className="space-y-3">
            <div>
              <span className="text-caption block mb-1">Heading (.text-heading)</span>
              <p className="text-heading text-foreground">500,000+ CARDS COMPLETED</p>
            </div>
            <div>
              <span className="text-caption block mb-1">SubHeading (.text-subheading)</span>
              <p className="text-subheading text-foreground">OPERATIONS WORKSPACE AREA</p>
            </div>
            <div>
              <span className="text-caption block mb-1">Body (.text-body)</span>
              <p className="text-body text-foreground">The system contains dense panels and 1px border grids for rapid operations workflow.</p>
            </div>
            <div>
              <span className="text-caption block mb-1">Table Content (.text-table)</span>
              <p className="text-table text-foreground">Acme Operations Corp - 5,203 cards</p>
            </div>
            <div className="flex gap-4">
              <div>
                <span className="text-caption block mb-1">Badge (.text-badge)</span>
                <span className="text-badge bg-secondary px-2 py-0.5 rounded-sm">VERIFIED STATE</span>
              </div>
              <div>
                <span className="text-caption block mb-1">Button (.text-button)</span>
                <span className="text-button bg-primary px-3 py-1 rounded-sm text-primary-foreground">SUBMIT REQ</span>
              </div>
            </div>
            <div>
              <span className="text-caption block mb-1">Caption (.text-caption)</span>
              <p className="text-caption">System syncing complete: Local database matches 3 active nodes.</p>
            </div>
          </div>
        </section>

        {/* Box 2: Buttons & Actions */}
        <section className="p-4 space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <h2 className="text-subheading text-foreground">Button Primitive Showcase</h2>
          </div>
          
          <div className="space-y-4">
            {/* Variants */}
            <div>
              <span className="text-caption block mb-2">Variants (With standard radius: 4px)</span>
              <div className="flex flex-wrap gap-2">
                <Button variant="default">PRIMARY</Button>
                <Button variant="secondary">SECONDARY</Button>
                <Button variant="outline">OUTLINE</Button>
                <Button variant="destructive">DESTRUCTIVE</Button>
                <Button variant="ghost">GHOST</Button>
                <Button variant="link">LINK</Button>
              </div>
            </div>

            {/* Sizes */}
            <div>
              <span className="text-caption block mb-2">Sizes</span>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="lg">LARGE SIZE</Button>
                <Button size="default">DEFAULT SIZE</Button>
                <Button size="sm">SMALL SIZE</Button>
                <Button size="icon" variant="outline"><Eye className="h-3.5 w-3.5" /></Button>
              </div>
            </div>

            {/* Loading / Disable */}
            <div>
              <span className="text-caption block mb-2">Loading and Disabled States</span>
              <div className="flex flex-wrap gap-2">
                <Button 
                  isLoading={btnLoading} 
                  onClick={() => {
                    setBtnLoading(true)
                    setTimeout(() => setBtnLoading(false), 2000)
                  }}
                >
                  CLICK TO LOAD (2S)
                </Button>
                <Button isLoading={true}>ALWAYS LOADING</Button>
                <Button disabled>DISABLED BUTTON</Button>
              </div>
            </div>
          </div>
        </section>

        {/* Box 3: Badge Status System */}
        <section className="p-4 space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <Info className="h-4 w-4 text-primary" />
            <h2 className="text-subheading text-foreground">Badge & Status Tokens</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <span className="text-caption block mb-2">Standard UI Badges (Radius: 2px)</span>
              <div className="flex flex-wrap gap-2">
                <Badge variant="default">DEFAULT</Badge>
                <Badge variant="secondary">SECONDARY</Badge>
                <Badge variant="outline">OUTLINE</Badge>
                <Badge variant="destructive">DESTRUCTIVE</Badge>
              </div>
            </div>

            <div>
              <span className="text-caption block mb-2">Semantic Status Badges (Configured from statuses.ts - No Icons)</span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(Object.keys(STATUSES) as StatusKey[]).map((key) => {
                  const conf = STATUSES[key]
                  return (
                    <div 
                      key={key} 
                      className={`flex items-center justify-center p-2 border ${conf.borderClass} ${conf.bgClass} rounded-sm`}
                    >
                      <span className="text-badge font-bold text-foreground uppercase">{conf.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Box 4: Dialogs & Toast Modals */}
        <section className="p-4 space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <AlertTriangle className="h-4 w-4 text-primary" />
            <h2 className="text-subheading text-foreground">Modals & Feedback</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <span className="text-caption block mb-2">Dialog Modal Component (Radius: 8px)</span>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline">OPEN SETTINGS DIALOG</Button>
                </DialogTrigger>
                <DialogContent className="bg-panel border border-border max-w-md rounded-dialog">
                  <DialogHeader>
                    <DialogTitle className="text-subheading text-foreground">System Configurations</DialogTitle>
                    <DialogDescription className="text-caption">
                      Verify your connection string settings before sync initialization.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4 space-y-3">
                    <p className="text-body">
                      This is a structured dialog element configured with a 1px border.
                    </p>
                  </div>
                  <DialogFooter className="gap-2">
                    <DialogTrigger asChild>
                      <Button variant="ghost">CLOSE</Button>
                    </DialogTrigger>
                    <Button variant="default" onClick={() => toast({ title: "CONFIGURATION APPLIED", description: "All database nodes verified." })}>
                      SAVE SETTINGS
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <div>
              <span className="text-caption block mb-2">Toaster Notifications</span>
              <div className="flex flex-wrap gap-2">
                <Button 
                  variant="secondary"
                  onClick={() => toast({
                    title: "SUCCESS ACTION",
                    description: "Batch export of 5,000 cards has completed.",
                  })}
                >
                  TRIGGER INFO TOAST
                </Button>
                <Button 
                  variant="destructive"
                  onClick={() => toast({
                    variant: "destructive",
                    title: "CONNECTION TIMED OUT",
                    description: "Sync cluster response delayed beyond 3000ms.",
                  })}
                >
                  TRIGGER DESTRUCTIVE TOAST
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Reusable Form wrappers sandbox */}
        <section className="p-4 space-y-4">
          <div className="border-b border-border pb-2">
            <h2 className="text-subheading text-foreground">Reusable Form Wrappers Sandbox</h2>
          </div>

          <FormProvider {...methods}>
            <form onSubmit={methods.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormInput 
                  name="clientName" 
                  label="Client Workspace Name" 
                  placeholder="e.g. Acme Cards Division" 
                  description="Unique identifier for the card deployment."
                />
                <FormSelect 
                  name="environment" 
                  label="Execution Environment" 
                  placeholder="Choose network"
                  options={[
                    { label: "Production Cluster", value: "prod" },
                    { label: "Staging Sandbox", value: "staging" },
                    { label: "Local Cluster Dev", value: "local" },
                  ]}
                  description="Cluster routing for cards processing."
                />
              </div>

              <FormTextarea 
                name="notes" 
                label="Sync Operator Notes" 
                placeholder="Provide comments regarding batch initialization..."
                rows={3}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormSwitch 
                  name="sandboxMode" 
                  label="Enable Sandbox Cluster Mode" 
                  description="Redirect traffic from production card queues."
                />
                <FormCheckbox 
                  name="agreedToTerms" 
                  label="Confirm local deployment policy" 
                  description="By checking, you confirm the client card records comply with privacy audits."
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button type="button" variant="outline" onClick={() => methods.reset()}>
                  RESET FORM
                </Button>
                <Button type="submit" variant="default">
                  VERIFY SCHEMA
                </Button>
              </div>
            </form>
          </FormProvider>
        </section>

        {/* TanStack Table showcase */}
        <section className="p-4 space-y-3">
          <div className="flex items-center justify-between pb-1">
            <h2 className="text-subheading text-foreground font-semibold">TanStack Table Integration (100 Mock Rows Paginated)</h2>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => {
                setTableLoading(true)
                setTimeout(() => setTableLoading(false), 1500)
              }}
            >
              TRIGGER TABLELOADER
            </Button>
          </div>

          <TableToolbar 
            table={table} 
            searchKey="clientName" 
            placeholder="Filter workspaces..."
            actionSlot={
              <div className="text-caption text-muted uppercase">
                Active Filters: {columnFilters.length}
              </div>
            }
          />
          
          <BaseTable 
            table={table} 
            isLoading={tableLoading} 
          />
          
          <TablePagination table={table} />
        </section>
      </div>
    </div>
  )
}

export default ShowcasePage
