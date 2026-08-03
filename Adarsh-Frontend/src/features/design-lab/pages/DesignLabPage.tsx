import React, { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Search, Trash2, FileUp, FileDown, Plus, Edit, Eye, RefreshCw, AlertTriangle, CheckCircle, ChevronDown, Check, Settings, X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { STATUSES, type StatusKey } from '@/constants/statuses'
import { AuthCard } from '@/components/layout/auth/AuthCard'
import { AuthHeader } from '@/components/layout/auth/AuthHeader'
import { AuthFooter } from '@/components/layout/auth/AuthFooter'
import { WizardStepIndicator } from '@/components/layout/auth/WizardStepIndicator'

// Mock Data
import {
  MOCK_STUDENTS,
  MOCK_STAFF,
  MOCK_REPRINTS,
  MOCK_WORKFLOWS
} from '../data/mockSchoolData'

// Dialogs & Drawers
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger
} from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'

// Loaders
import { TableLoader } from '@/components/feedback/TableLoader'

type LabSection =
  | 'Typography'
  | 'Colors'
  | 'Buttons'
  | 'Inputs'
  | 'Selects'
  | 'Dropdowns'
  | 'Badges'
  | 'Pagination'
  | 'Dialogs'
  | 'Drawers'
  | 'Tables'
  | 'Toolbars'
  | 'Loading States'
  | 'Layouts'
  | 'Spacing'
  | 'Status System'
  | 'Authentication'

export const DesignLabPage: React.FC = () => {
  const { toast } = useToast()
  const [activeSection, setActiveSection] = useState<LabSection>('Typography')
  const [previewWidth, setPreviewWidth] = useState<'1000px' | '1280px' | '1440px' | '1920px' | 'Auto'>('Auto')
  
  // Dense states
  const [isAlternativeDensity, setIsAlternativeDensity] = useState(false)
  const [demoTableLoading, setDemoTableLoading] = useState(false)

  // Selection states for tables
  const [selectedStudents, setSelectedStudents] = useState<string[]>([])

  // Search/Filters mock state
  const [studentSearch, setStudentSearch] = useState('')
  const [studentClassFilter, setStudentClassFilter] = useState('ALL')
  const [studentSectionFilter, setStudentSectionFilter] = useState('ALL')
  const [studentStatusFilter, setStudentStatusFilter] = useState('ALL')

  // Authentication showcase state
  const [authDemoStep, setAuthDemoStep] = useState<'identity' | 'password' | 'otp' | 'success'>('identity')
  const [otpTimer, setOtpTimer] = useState(59)

  // OTP Timer effect
  React.useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined
    if (activeSection === 'Authentication' && authDemoStep === 'otp' && otpTimer > 0) {
      interval = setInterval(() => {
        setOtpTimer((prev) => (prev > 0 ? prev - 1 : 0))
      }, 1000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [activeSection, authDemoStep, otpTimer])

  const navItems: LabSection[] = [
    'Typography',
    'Colors',
    'Buttons',
    'Inputs',
    'Selects',
    'Dropdowns',
    'Badges',
    'Pagination',
    'Dialogs',
    'Drawers',
    'Tables',
    'Toolbars',
    'Loading States',
    'Layouts',
    'Spacing',
    'Status System',
    'Authentication'
  ]

  // Filtering mock data for tables
  const filteredStudents = useMemo(() => {
    return MOCK_STUDENTS.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(studentSearch.toLowerCase()) || item.rollNumber.includes(studentSearch)
      const matchesClass = studentClassFilter === 'ALL' || item.className === studentClassFilter
      const matchesSection = studentSectionFilter === 'ALL' || item.section === studentSectionFilter
      const matchesStatus = studentStatusFilter === 'ALL' || item.status === studentStatusFilter
      return matchesSearch && matchesClass && matchesSection && matchesStatus
    })
  }, [studentSearch, studentClassFilter, studentSectionFilter, studentStatusFilter])

  const toggleSelectStudent = (id: string) => {
    setSelectedStudents(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  const toggleSelectAllStudents = () => {
    if (selectedStudents.length === filteredStudents.length) {
      setSelectedStudents([])
    } else {
      setSelectedStudents(filteredStudents.map(s => s.id))
    }
  }

  // Width Class mapping
  const widthClassMap = {
    '1000px': 'max-w-[1000px]',
    '1280px': 'max-w-[1280px]',
    '1440px': 'max-w-[1440px]',
    '1920px': 'max-w-[1920px]',
    'Auto': 'w-full'
  }

  return (
    <div className="flex h-screen w-screen bg-background text-foreground overflow-hidden font-saira select-none">
      {/* Design Lab Sidebar */}
      <aside className="w-56 bg-sidebar border-r border-border flex flex-col h-full shrink-0">
        <div className="p-4 border-b border-border flex items-center justify-between bg-neutral-950/20">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <span className="font-bold text-subheading tracking-wider">DESIGN LAB</span>
          </div>
        </div>

        {/* Navigation items */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <div className="px-2 pb-1.5 text-[10px] font-bold text-muted uppercase tracking-widest border-b border-border/20 mb-2">
            Showcase Modules
          </div>
          {navItems.map((section) => (
            <button
              key={section}
              onClick={() => setActiveSection(section)}
              className={`w-full text-left px-3 py-1.5 rounded-sm transition-colors text-body flex items-center justify-between ${
                activeSection === section
                  ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                  : 'text-muted hover:text-foreground hover:bg-neutral-800/40'
              }`}
            >
              <span>{section}</span>
              {activeSection === section && <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
            </button>
          ))}
          <div className="pt-4 px-2 pb-1.5 text-[10px] font-bold text-muted uppercase tracking-widest border-b border-border/20 mb-2">
            System Auditing
          </div>
          <Link
            to="/design-lab/audit"
            className="w-full text-left px-3 py-1.5 rounded-sm text-body text-info hover:bg-info/10 transition-colors flex items-center gap-1.5"
          >
            <CheckCircle className="h-4 w-4" />
            <span>Design Audit Panel</span>
          </Link>
        </nav>

        {/* Small scale footer metadata */}
        <div className="p-3 border-t border-border bg-neutral-950/10 text-[10px] text-muted space-y-1">
          <div>LAB ENVIRONMENT: DEV-MOCK</div>
          <div>DENSITY STATUS: DENSE (4PX)</div>
        </div>
      </aside>

      {/* Main Sandbox Showcase */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
        
        {/* Topbar: Control Width Preview & Info */}
        <header className="h-14 bg-panel border-b border-border flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-subheading font-bold text-foreground">Evaluating: {activeSection}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 bg-neutral-900 border-border">
              Scenario Context Active
            </Badge>
          </div>

          {/* Width Resizers for evaluation */}
          <div className="flex items-center gap-1.5 bg-neutral-950/40 p-1 border border-border rounded-sm">
            <span className="text-[10px] font-bold text-muted-foreground uppercase px-2">Preview Width:</span>
            {(['1000px', '1280px', '1440px', '1920px', 'Auto'] as const).map((width) => (
              <Button
                key={width}
                variant={previewWidth === width ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setPreviewWidth(width)}
                className="h-7 px-2.5 text-caption font-semibold rounded-xs border-none"
              >
                {width}
              </Button>
            ))}
          </div>
        </header>

        {/* Central view frame */}
        <div className="flex-1 overflow-y-auto p-6 bg-background">
          <div className={`mx-auto bg-background transition-all duration-300 ${widthClassMap[previewWidth]} ${
            previewWidth !== 'Auto' ? 'border border-dashed border-primary/30 p-4 shadow-2xl relative' : ''
          }`}>
            {previewWidth !== 'Auto' && (
              <div className="absolute -top-3 left-4 bg-primary text-primary-foreground text-[9px] px-2 py-0.5 rounded font-bold uppercase select-none tracking-widest shadow">
                Simulated Canvas: {previewWidth}
              </div>
            )}
            
            {/* RENDER CURRENT LAB SECTION */}
            <div className="space-y-6">
              
              {/* TYPOGRAPHY */}
              {activeSection === 'Typography' && (
                <div className="space-y-6">
                  <div className="border border-border bg-panel p-4 rounded-card">
                    <h3 className="text-caption uppercase text-muted mb-3 tracking-widest border-b border-border pb-1">Real-world Typography Context: Student ID Roster Card</h3>
                    <div className="space-y-4">
                      {/* 20px - Subheading */}
                      <div className="text-subheading text-foreground font-bold border-b border-border pb-1">
                        SARA HIGHER SECONDARY SCHOOL - STUDENT DETAIL RECORD
                      </div>
                      
                      {/* Grid showing 14px (Table/Body), 12px (Label/Caption) */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3 bg-background border border-border">
                        <div>
                          <span className="text-caption block text-muted uppercase">Student Name:</span>
                          <span className="text-body font-semibold text-foreground">Aarav Sharma</span>
                        </div>
                        <div>
                          <span className="text-caption block text-muted uppercase">Roll Number:</span>
                          <span className="text-body font-semibold text-foreground">101-STD-X</span>
                        </div>
                        <div>
                          <span className="text-caption block text-muted uppercase">Enrollment Stage:</span>
                          <span className="text-table text-primary font-bold">VERIFICATION PENDING</span>
                        </div>
                        <div>
                          <span className="text-caption block text-muted uppercase">Registered Date:</span>
                          <span className="text-body text-foreground">2026-05-15</span>
                        </div>
                      </div>

                      {/* 10px / 12px captions */}
                      <div className="text-caption text-muted flex items-center justify-between border-t border-border pt-2">
                        <span>Database Node: cluster-02.india-south</span>
                        <span className="text-[10px] font-semibold text-warning uppercase">Warning: Profile has unverified blood group data (O+)</span>
                      </div>
                    </div>
                  </div>

                  <div className="border border-border bg-panel p-4 rounded-card">
                    <h3 className="text-caption uppercase text-muted mb-3 tracking-widest border-b border-border pb-1">Density & Alignment Verification</h3>
                    <div className="space-y-2">
                      <p className="text-heading text-foreground">24PX HEADER TEXT IN ADARSH ID ERP PANEL</p>
                      <p className="text-subheading text-foreground">18PX SUBHEADER DESIGN SYSTEM TOKEN SPECIFICATION</p>
                      <p className="text-body text-foreground">14px Body text. In standard operational mode, this contains density guides and instruction blocks. Grid borders surround these sections.</p>
                      <p className="text-table text-muted">13.5px Table text. Specifically designed to align with dense grids and spreadsheet outputs.</p>
                      <p className="text-caption text-info font-bold">12px Caption alert. Standard warning labels, meta variables, and sync stats.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* COLORS */}
              {activeSection === 'Colors' && (
                <div className="space-y-6">
                  <div className="border border-border bg-panel p-4 rounded-card space-y-4">
                    <h3 className="text-caption uppercase text-muted mb-2 tracking-widest border-b border-border pb-1">Color Palette in Semantic Scenarios</h3>
                    
                    {/* Primary/Alert message scenarios */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Success block */}
                      <div className="border border-success bg-success/5 p-4 rounded-sm space-y-2">
                        <div className="flex items-center gap-2 text-success">
                          <CheckCircle className="h-5 w-5" />
                          <span className="font-bold text-subheading">Sync Batch Passed</span>
                        </div>
                        <p className="text-body text-foreground">
                          Successfully verified and compiled 1,250 student smart card certificates for printing. Local files match server clusters.
                        </p>
                      </div>

                      {/* Danger Block */}
                      <div className="border border-destructive bg-destructive/5 p-4 rounded-sm space-y-2">
                        <div className="flex items-center gap-2 text-destructive">
                          <AlertTriangle className="h-5 w-5" />
                          <span className="font-bold text-subheading">Card Print Job Rejected</span>
                        </div>
                        <p className="text-body text-foreground">
                          Job cancelled due to 3 duplicate roll numbers in Class XII-A roster. Rectification required in CSV upload.
                        </p>
                      </div>
                    </div>

                    {/* Accent mapping visualization */}
                    <div className="grid grid-cols-5 gap-2 pt-2">
                      <div className="bg-primary p-3 rounded text-center text-primary-foreground font-bold text-caption">PRIMARY BLUE</div>
                      <div className="bg-success p-3 rounded text-center text-success-foreground font-bold text-caption">SUCCESS GREEN</div>
                      <div className="bg-warning p-3 rounded text-center text-warning-foreground font-bold text-caption">WARNING ORANGE</div>
                      <div className="bg-destructive p-3 rounded text-center text-destructive-foreground font-bold text-caption">DANGER RED</div>
                      <div className="bg-panel border border-border p-3 rounded text-center text-foreground font-bold text-caption">BORDER GREY</div>
                    </div>
                  </div>

                  {/* Surface background mapping */}
                  <div className="border border-border bg-panel p-4 rounded-card space-y-2">
                    <h3 className="text-caption uppercase text-muted mb-2 tracking-widest border-b border-border pb-1">Workspace Surface Contrast</h3>
                    <div className="p-4 bg-background border border-border rounded-sm">
                      <span className="text-caption text-muted">Canvas Surface (`#0A0A0A`)</span>
                      <div className="mt-2 p-4 bg-panel border border-border rounded-sm">
                        <span className="text-caption text-muted">Panel/Card Surface (`#171717`)</span>
                        <div className="mt-2 p-4 bg-sidebar border border-border rounded-sm text-center">
                          <span className="text-caption text-muted">Sidebar Surface (`#111111`)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* BUTTONS */}
              {activeSection === 'Buttons' && (
                <div className="space-y-6">
                  {/* Toolbar scenario */}
                  <div className="border border-border bg-panel p-4 rounded-card space-y-3">
                    <h3 className="text-caption uppercase text-muted mb-1 tracking-widest border-b border-border pb-1">Scenario A: Grid Action Toolbar</h3>
                    <div className="flex items-center justify-between bg-neutral-900/60 p-2 border border-border">
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="default">All Students</Button>
                        <Button size="sm" variant="outline">Flagged</Button>
                        <Button size="sm" variant="outline" disabled>Archived (0)</Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="default" className="bg-success hover:bg-success/90 text-white border-none">
                          <Check className="h-3.5 w-3.5 mr-1" /> Approve Batch
                        </Button>
                        <Button size="sm" variant="destructive" className="h-8">
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Terminate Roster
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Form Action scenario */}
                  <div className="border border-border bg-panel p-4 rounded-card space-y-3">
                    <h3 className="text-caption uppercase text-muted mb-1 tracking-widest border-b border-border pb-1">Scenario B: Roster Detail Editor Form Footer</h3>
                    <div className="flex justify-end gap-2 border-t border-border pt-4">
                      <Button variant="ghost" size="default">Discard Draft</Button>
                      <Button variant="outline" size="default">Verify Only</Button>
                      <Button variant="default" size="default" isLoading={btnLoading} onClick={() => { setBtnLoading(true); setTimeout(() => setBtnLoading(false), 2000) }}>
                        Save & Sync Database
                      </Button>
                    </div>
                  </div>

                  {/* Button matrix matrix inside business table headers */}
                  <div className="border border-border bg-panel p-4 rounded-card space-y-3">
                    <h3 className="text-caption uppercase text-muted mb-1 tracking-widest border-b border-border pb-1">Design System Buttons Grid Matrix</h3>
                    <div className="space-y-4">
                      <div className="grid grid-cols-5 gap-3">
                        <span className="text-caption font-bold uppercase self-center">Variant</span>
                        <span className="text-caption font-bold uppercase text-center">Small (28px)</span>
                        <span className="text-caption font-bold uppercase text-center">Medium (36px)</span>
                        <span className="text-caption font-bold uppercase text-center">Large (44px)</span>
                        <span className="text-caption font-bold uppercase text-center">State Indicators</span>
                      </div>
                      
                      {/* Primary Rows */}
                      <div className="grid grid-cols-5 gap-3 items-center">
                        <span className="text-body font-semibold">Primary</span>
                        <Button size="sm">Action</Button>
                        <Button size="default">Action</Button>
                        <Button size="lg">Action</Button>
                        <div className="flex gap-1.5 justify-center">
                          <Button size="sm" disabled>Disabled</Button>
                          <Button size="sm" isLoading={true}>Spin</Button>
                        </div>
                      </div>

                      {/* Success Rows */}
                      <div className="grid grid-cols-5 gap-3 items-center">
                        <span className="text-body font-semibold">Success</span>
                        <Button size="sm" className="bg-success hover:bg-success/90 text-white border-none">Success</Button>
                        <Button size="default" className="bg-success hover:bg-success/90 text-white border-none">Success</Button>
                        <Button size="lg" className="bg-success hover:bg-success/90 text-white border-none">Success</Button>
                        <span className="text-caption text-center text-success">Green Palette</span>
                      </div>

                      {/* Destructive Rows */}
                      <div className="grid grid-cols-5 gap-3 items-center">
                        <span className="text-body font-semibold">Destructive</span>
                        <Button size="sm" variant="destructive">Delete</Button>
                        <Button size="default" variant="destructive">Delete</Button>
                        <Button size="lg" variant="destructive">Delete</Button>
                        <span className="text-caption text-center text-destructive">Red Palette</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* INPUTS */}
              {activeSection === 'Inputs' && (
                <div className="space-y-6">
                  <div className="border border-border bg-panel p-4 rounded-card space-y-4">
                    <h3 className="text-caption uppercase text-muted mb-2 tracking-widest border-b border-border pb-1">Realistic Input Scenario: Student Enrollment Form</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Search Bar Input */}
                      <div className="space-y-1">
                        <Label htmlFor="search-input">Smart Card Global Search</Label>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                          <Input id="search-input" placeholder="Search by name, roll number, or smart card RFID tag..." className="pl-9" />
                        </div>
                        <span className="text-[10px] text-muted-foreground block">Searches indexed SQL tables.</span>
                      </div>

                      {/* Username input */}
                      <div className="space-y-1">
                        <Label htmlFor="username-input">Student Registration Username</Label>
                        <div className="flex items-stretch">
                          <span className="bg-neutral-900 border border-border border-r-0 px-3 flex items-center text-caption text-muted rounded-l-sm">adarsh.com/</span>
                          <Input id="username-input" placeholder="aarav.sharma" className="rounded-l-none" />
                        </div>
                      </div>

                      {/* Password input */}
                      <div className="space-y-1">
                        <Label htmlFor="pass-input">Smart Card Security Pin Code</Label>
                        <div className="relative">
                          <Input id="pass-input" type="password" placeholder="••••••" />
                          <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-caption text-muted hover:text-foreground">Show</button>
                        </div>
                      </div>

                      {/* Phone Input */}
                      <div className="space-y-1">
                        <Label htmlFor="phone-input">Parent Contact Phone</Label>
                        <div className="flex">
                          <span className="bg-neutral-900 border border-border border-r-0 px-3 flex items-center text-caption text-muted rounded-l-sm">+91</span>
                          <Input id="phone-input" type="tel" placeholder="98765 43210" className="rounded-l-none" />
                        </div>
                      </div>

                      {/* Email Input */}
                      <div className="space-y-1">
                        <Label htmlFor="email-input">Parent Registration Email</Label>
                        <Input id="email-input" type="email" placeholder="parent@domain.com" />
                        <span className="text-[10px] text-success block">✔ Email address is formatted correctly</span>
                      </div>

                      {/* Filter/Tags input */}
                      <div className="space-y-1">
                        <Label>Assigned Batch Tags</Label>
                        <div className="flex flex-wrap gap-1 p-1.5 border border-border bg-background min-h-9 rounded-sm">
                          <Badge variant="secondary" className="gap-1 rounded-sm text-[10px]">Class X <X className="h-3 w-3 hover:text-destructive cursor-pointer" /></Badge>
                          <Badge variant="secondary" className="gap-1 rounded-sm text-[10px]">Bus Route 4 <X className="h-3 w-3 hover:text-destructive cursor-pointer" /></Badge>
                          <input className="bg-transparent border-none outline-none text-caption flex-1 min-w-[60px]" placeholder="Add..." />
                        </div>
                      </div>

                      {/* Date Input */}
                      <div className="space-y-1">
                        <Label htmlFor="date-input">Card Issuing Date</Label>
                        <Input id="date-input" type="date" defaultValue="2026-06-10" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SELECTS */}
              {activeSection === 'Selects' && (
                <div className="space-y-6">
                  <div className="border border-border bg-panel p-4 rounded-card space-y-4">
                    <h3 className="text-caption uppercase text-muted mb-2 tracking-widest border-b border-border pb-1">Realistic Select Scenario: Smart Card Filter Widget</h3>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {/* Class selector */}
                      <div className="space-y-1">
                        <Label>School Class</Label>
                        <Select defaultValue="Class X">
                          <SelectTrigger className="w-full bg-background border-border">
                            <SelectValue placeholder="Select class" />
                          </SelectTrigger>
                          <SelectContent className="bg-panel border border-border">
                            <SelectItem value="Class IX">Class IX</SelectItem>
                            <SelectItem value="Class X">Class X</SelectItem>
                            <SelectItem value="Class XI">Class XI</SelectItem>
                            <SelectItem value="Class XII">Class XII</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Section Selector */}
                      <div className="space-y-1">
                        <Label>Class Section</Label>
                        <Select defaultValue="Sec A">
                          <SelectTrigger className="w-full bg-background border-border">
                            <SelectValue placeholder="Select section" />
                          </SelectTrigger>
                          <SelectContent className="bg-panel border border-border">
                            <SelectItem value="Sec A">Section A</SelectItem>
                            <SelectItem value="Sec B">Section B</SelectItem>
                            <SelectItem value="Sec C">Section C</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Status Selector */}
                      <div className="space-y-1">
                        <Label>Card Status</Label>
                        <Select defaultValue="APPROVED">
                          <SelectTrigger className="w-full bg-background border-border">
                            <SelectValue placeholder="Select Status" />
                          </SelectTrigger>
                          <SelectContent className="bg-panel border border-border">
                            <SelectItem value="PENDING">Pending Approval</SelectItem>
                            <SelectItem value="VERIFIED">Verified</SelectItem>
                            <SelectItem value="APPROVED">Approved</SelectItem>
                            <SelectItem value="REJECTED">Rejected</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* DROPDOWNS */}
              {activeSection === 'Dropdowns' && (
                <div className="space-y-6">
                  <div className="border border-border bg-panel p-4 rounded-card space-y-4">
                    <h3 className="text-caption uppercase text-muted mb-2 tracking-widest border-b border-border pb-1">Realistic Dropdown Contexts</h3>
                    
                    <div className="flex gap-4">
                      {/* Dropdown 1: Table row Actions */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline">Row Actions Dropdown <ChevronDown className="ml-2 h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="bg-panel border border-border w-48">
                          <DropdownMenuLabel>Student Card Actions</DropdownMenuLabel>
                          <DropdownMenuSeparator className="bg-border" />
                          <DropdownMenuItem className="focus:bg-neutral-800 cursor-pointer flex items-center gap-2">
                            <Eye className="h-4 w-4" />
                            <span>View Card Preview</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem className="focus:bg-neutral-800 cursor-pointer flex items-center gap-2">
                            <Edit className="h-4 w-4" />
                            <span>Edit Card Record</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem className="focus:bg-neutral-800 cursor-pointer flex items-center gap-2 text-warning">
                            <RefreshCw className="h-4 w-4" />
                            <span>Request Reprint</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-border" />
                          <DropdownMenuItem className="text-destructive focus:bg-destructive/15 cursor-pointer flex items-center gap-2">
                            <Trash2 className="h-4 w-4" />
                            <span>Delete Record</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      {/* Dropdown 2: Bulk Actions */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="secondary">Bulk Actions Selector <ChevronDown className="ml-2 h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="bg-panel border border-border w-56">
                          <DropdownMenuLabel>Apply to Selected (12)</DropdownMenuLabel>
                          <DropdownMenuSeparator className="bg-border" />
                          <DropdownMenuItem className="focus:bg-neutral-800 cursor-pointer">Verify Records</DropdownMenuItem>
                          <DropdownMenuItem className="focus:bg-neutral-800 cursor-pointer">Approve Smart Cards</DropdownMenuItem>
                          <DropdownMenuItem className="focus:bg-neutral-800 cursor-pointer">Move to Class XII-A</DropdownMenuItem>
                          <DropdownMenuItem className="focus:bg-neutral-800 cursor-pointer text-destructive">Bulk Delete Cards</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              )}

              {/* BADGES */}
              {activeSection === 'Badges' && (
                <div className="space-y-6">
                  {/* Badges in Table list/card context */}
                  <div className="border border-border bg-panel p-4 rounded-card space-y-4">
                    <h3 className="text-caption uppercase text-muted mb-2 tracking-widest border-b border-border pb-1">Realistic Badge Placements</h3>
                    
                    {/* Operations Card Context */}
                    <div className="bg-background border border-border p-4 rounded-sm space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-subheading font-bold text-foreground">Acme Student Roster</span>
                        <Badge variant="outline" className="text-success border-success bg-success/5 rounded-sm">Sync Active</Badge>
                      </div>
                      
                      {/* Mini list displaying badges */}
                      <div className="divide-y divide-border border border-border bg-panel">
                        {[
                          { name: 'Aarav Sharma', role: 'Student', status: 'APPROVED' as StatusKey },
                          { name: 'Dr. Ramesh Kumar', role: 'Staff Physics', status: 'VERIFIED' as StatusKey },
                          { name: 'Vihaan Gupta', role: 'Student', status: 'PENDING' as StatusKey },
                          { name: 'Sunita Deshmukh', role: 'Staff Math', status: 'REJECTED' as StatusKey },
                        ].map((user, idx) => {
                          const conf = STATUSES[user.status]
                          const Icon = conf.icon
                          return (
                            <div key={idx} className="p-3 flex items-center justify-between text-table">
                              <div className="flex items-center gap-3">
                                <span className="font-bold text-foreground">{user.name}</span>
                                <span className="text-muted text-caption">{user.role}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant={conf.badgeVariant} className="gap-1 py-0.5 rounded-sm">
                                  <Icon className="h-3 w-3" />
                                  <span>{conf.label}</span>
                                </Badge>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* PAGINATION */}
              {activeSection === 'Pagination' && (
                <div className="space-y-6">
                  {/* Small pagination */}
                  <div className="border border-border bg-panel p-4 rounded-card space-y-3">
                    <h3 className="text-caption uppercase text-muted mb-1 tracking-widest border-b border-border pb-1">A. Small Dataset Pagination (50 rows)</h3>
                    <div className="flex items-center justify-between px-4 py-2 border border-border bg-neutral-900/60 text-table">
                      <div className="flex items-center gap-2 text-muted">
                        <span>Showing</span>
                        <span className="font-semibold text-foreground">1-10</span>
                        <span>of</span>
                        <span className="font-semibold text-foreground">50</span>
                        <span>rows</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled>&lt;</Button>
                        <span className="text-caption font-semibold px-2">Page 1 of 5</span>
                        <Button size="sm" variant="outline" className="h-7 w-7 p-0">&gt;</Button>
                      </div>
                      <div className="text-muted flex items-center gap-1.5">
                        <span>Rows per page:</span>
                        <Badge variant="secondary" className="rounded-xs">10</Badge>
                      </div>
                    </div>
                  </div>

                  {/* Medium pagination */}
                  <div className="border border-border bg-panel p-4 rounded-card space-y-3">
                    <h3 className="text-caption uppercase text-muted mb-1 tracking-widest border-b border-border pb-1">B. Medium Dataset Pagination (500 rows)</h3>
                    <div className="flex items-center justify-between px-4 py-2 border border-border bg-neutral-900/60 text-table">
                      <div className="flex items-center gap-2 text-muted">
                        <span>Showing</span>
                        <span className="font-semibold text-foreground">1-10</span>
                        <span>of</span>
                        <span className="font-semibold text-foreground">500</span>
                        <span>rows</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled>&lt;</Button>
                        <span className="text-caption font-semibold px-2">Page 1 of 50</span>
                        <Button size="sm" variant="outline" className="h-7 w-7 p-0">&gt;</Button>
                      </div>
                      <div className="text-muted flex items-center gap-1.5">
                        <span>Rows per page:</span>
                        <Badge variant="secondary" className="rounded-xs">10</Badge>
                      </div>
                    </div>
                  </div>

                  {/* Large pagination */}
                  <div className="border border-border bg-panel p-4 rounded-card space-y-3">
                    <h3 className="text-caption uppercase text-muted mb-1 tracking-widest border-b border-border pb-1">C. Large Dataset Pagination (500,000 rows)</h3>
                    <div className="flex items-center justify-between px-4 py-2 border border-border bg-neutral-900/60 text-table">
                      <div className="flex items-center gap-2 text-muted">
                        <span>Showing</span>
                        <span className="font-semibold text-foreground">1-10</span>
                        <span>of</span>
                        <span className="font-semibold text-foreground">500,000</span>
                        <span>rows</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled>&lt;</Button>
                        <span className="text-caption font-semibold px-2">Page 1 of 50000</span>
                        <Button size="sm" variant="outline" className="h-7 w-7 p-0">&gt;</Button>
                      </div>
                      <div className="text-muted flex items-center gap-1.5">
                        <span>Rows per page:</span>
                        <Badge variant="secondary" className="rounded-xs">10</Badge>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* DIALOGS */}
              {activeSection === 'Dialogs' && (
                <div className="space-y-6">
                  <div className="border border-border bg-panel p-4 rounded-card space-y-4">
                    <h3 className="text-caption uppercase text-muted mb-2 tracking-widest border-b border-border pb-1">Interactive Dialog Scenarios</h3>
                    
                    <div className="flex flex-wrap gap-4">
                      {/* Dialog 1: Delete */}
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="destructive">Trigger Delete Dialog</Button>
                        </DialogTrigger>
                        <DialogContent className="bg-panel border border-border max-w-md rounded-dialog p-6">
                          <DialogHeader>
                            <DialogTitle className="text-subheading text-destructive flex items-center gap-2">
                              <AlertTriangle className="h-5 w-5" />
                              <span>Confirm Smart Card Deletion</span>
                            </DialogTitle>
                            <DialogDescription className="text-caption">
                              This will permanently remove the smart card record for student **Kabir Verma (Roll: 107)** from the cluster database.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="py-2 text-body">
                            Are you absolutely sure you want to proceed? This action is irreversibly logged in the security audits.
                          </div>
                          <DialogFooter className="gap-2 mt-4">
                            <DialogClose asChild>
                              <Button variant="ghost">Cancel</Button>
                            </DialogClose>
                            <Button variant="destructive" onClick={() => toast({ title: "Record Deleted", description: "Kabir Verma was removed from the database.", variant: "destructive" })}>
                              Proceed Deletion
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>

                      {/* Dialog 2: Export */}
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline">Trigger Export Dialog</Button>
                        </DialogTrigger>
                        <DialogContent className="bg-panel border border-border max-w-md rounded-dialog p-6">
                          <DialogHeader>
                            <DialogTitle className="text-subheading text-foreground">Export Cards Dataset</DialogTitle>
                            <DialogDescription className="text-caption">
                              Configure download formats and criteria for local storage files.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="py-4 space-y-4">
                            <div className="space-y-1">
                              <Label>Export Format</Label>
                              <Select defaultValue="csv">
                                <SelectTrigger className="w-full bg-background border-border">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-panel border border-border">
                                  <SelectItem value="csv">Comma-Separated Values (.csv)</SelectItem>
                                  <SelectItem value="json">JavaScript Object Notation (.json)</SelectItem>
                                  <SelectItem value="pdf">Print Ready Cards Document (.pdf)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center space-x-2">
                              <Checkbox id="include-deleted" />
                              <label htmlFor="include-deleted" className="text-body font-medium leading-none">Include deleted card references</label>
                            </div>
                          </div>
                          <DialogFooter className="gap-2">
                            <DialogClose asChild>
                              <Button variant="ghost">Close</Button>
                            </DialogClose>
                            <Button variant="default" onClick={() => toast({ title: "Export Scheduled", description: "Export process initialized." })}>
                              Export Dataset
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>

                      {/* Dialog 3: Import */}
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline">Trigger Import Dialog</Button>
                        </DialogTrigger>
                        <DialogContent className="bg-panel border border-border max-w-md rounded-dialog p-6">
                          <DialogHeader>
                            <DialogTitle className="text-subheading text-foreground">Import Student Roster</DialogTitle>
                            <DialogDescription className="text-caption">
                              Upload a structured CSV file to synchronize bulk student profiles.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="py-6 border border-dashed border-border text-center bg-background rounded-sm space-y-2 cursor-pointer hover:border-primary/50 transition-colors">
                            <FileUp className="h-8 w-8 mx-auto text-muted" />
                            <span className="text-caption block text-muted">Drag & Drop file here or Click to select</span>
                            <span className="text-[10px] text-muted-foreground">Supported file extension: .csv (Max 10MB)</span>
                          </div>
                          <DialogFooter className="gap-2 mt-4">
                            <DialogClose asChild>
                              <Button variant="ghost">Cancel</Button>
                            </DialogClose>
                            <Button variant="default" disabled>
                              Process File
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>

                      {/* Dialog 4: Notification */}
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline">Trigger Notification Dialog</Button>
                        </DialogTrigger>
                        <DialogContent className="bg-panel border border-border max-w-md rounded-dialog p-6">
                          <DialogHeader>
                            <DialogTitle className="text-subheading text-foreground">Cluster Synchronization Alert</DialogTitle>
                            <DialogDescription className="text-caption">
                              The system detected offline nodes in the local smart card pipeline.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="py-2 space-y-3">
                            <div className="p-3 bg-neutral-900 border border-border text-table text-warning font-mono whitespace-pre rounded-sm">
                              Node 3: TIMEOUT (last seen 4.5m ago) {"\n"}
                              Reconnecting pipeline queue... {"\n"}
                              Sync status: 92.5% Complete
                            </div>
                          </div>
                          <DialogFooter>
                            <DialogClose asChild>
                              <Button variant="default" className="w-full">Acknowledge</Button>
                            </DialogClose>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                </div>
              )}

              {/* DRAWERS */}
              {activeSection === 'Drawers' && (
                <div className="space-y-6">
                  <div className="border border-border bg-panel p-4 rounded-card space-y-4">
                    <h3 className="text-caption uppercase text-muted mb-2 tracking-widest border-b border-border pb-1">Interactive Drawers</h3>
                    
                    <div className="flex flex-wrap gap-4">
                      {/* Drawer 1: Create Card */}
                      <Drawer>
                        <DrawerTrigger asChild>
                          <Button variant="default">Create Card Drawer</Button>
                        </DrawerTrigger>
                        <DrawerContent className="bg-panel border border-border p-6 text-foreground max-w-2xl mx-auto rounded-t-dialog">
                          <DrawerHeader className="text-left border-b border-border pb-2 px-0">
                            <DrawerTitle className="text-subheading text-foreground">Register New Student Card</DrawerTitle>
                            <DrawerDescription className="text-caption text-muted">
                              Fill parent contact, name, and roll number details for smart card registration.
                            </DrawerDescription>
                          </DrawerHeader>
                          
                          <div className="py-6 space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <Label htmlFor="dw-name">Full Student Name</Label>
                                <Input id="dw-name" placeholder="e.g. Vihaan Gupta" />
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor="dw-roll">Roll Number</Label>
                                <Input id="dw-roll" placeholder="e.g. 103" />
                              </div>
                              <div className="space-y-1">
                                <Label>School Class</Label>
                                <Select>
                                  <SelectTrigger className="bg-background border-border">
                                    <SelectValue placeholder="Select class" />
                                  </SelectTrigger>
                                  <SelectContent className="bg-panel border border-border">
                                    <SelectItem value="IX">Class IX</SelectItem>
                                    <SelectItem value="X">Class X</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label>Blood Group</Label>
                                <Input placeholder="e.g. O+" />
                              </div>
                            </div>
                          </div>

                          <DrawerFooter className="flex flex-row justify-end gap-2 border-t border-border pt-4 px-0">
                            <DrawerClose asChild>
                              <Button variant="ghost">Cancel</Button>
                            </DrawerClose>
                            <Button onClick={() => toast({ title: "Student Registered", description: "Roster record created." })}>
                              Save Record
                            </Button>
                          </DrawerFooter>
                        </DrawerContent>
                      </Drawer>

                      {/* Drawer 2: Edit Card */}
                      <Drawer>
                        <DrawerTrigger asChild>
                          <Button variant="outline">Edit Card Drawer</Button>
                        </DrawerTrigger>
                        <DrawerContent className="bg-panel border border-border p-6 text-foreground max-w-2xl mx-auto rounded-t-dialog">
                          <DrawerHeader className="text-left border-b border-border pb-2 px-0">
                            <DrawerTitle className="text-subheading text-foreground">Edit Staff Profile: sunita.deshmukh</DrawerTitle>
                            <DrawerDescription className="text-caption text-muted">
                              Modify staff designations, departments, or card validity ranges.
                            </DrawerDescription>
                          </DrawerHeader>
                          
                          <div className="py-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <Label>Department</Label>
                                <Input defaultValue="Mathematics" />
                              </div>
                              <div className="space-y-1">
                                <Label>Designation</Label>
                                <Input defaultValue="Senior Teacher" />
                              </div>
                            </div>
                          </div>

                          <DrawerFooter className="flex flex-row justify-end gap-2 border-t border-border pt-4 px-0">
                            <DrawerClose asChild>
                              <Button variant="ghost">Cancel</Button>
                            </DrawerClose>
                            <Button onClick={() => toast({ title: "Profile Updated", description: "Staff credentials modified." })}>
                              Save Modifications
                            </Button>
                          </DrawerFooter>
                        </DrawerContent>
                      </Drawer>

                      {/* Drawer 3: Filter Drawer */}
                      <Drawer>
                        <DrawerTrigger asChild>
                          <Button variant="outline">Filter Drawer</Button>
                        </DrawerTrigger>
                        <DrawerContent className="bg-panel border border-border p-6 text-foreground max-w-md mx-auto rounded-t-dialog">
                          <DrawerHeader className="text-left border-b border-border pb-2 px-0">
                            <DrawerTitle className="text-subheading text-foreground">Advanced Query Filters</DrawerTitle>
                            <DrawerDescription className="text-caption text-muted">
                              Target specific batches and printing categories.
                            </DrawerDescription>
                          </DrawerHeader>
                          
                          <div className="py-6 space-y-4">
                            <div className="space-y-1">
                              <Label>Card Issuing Range</Label>
                              <div className="grid grid-cols-2 gap-2">
                                <Input type="date" placeholder="Start" />
                                <Input type="date" placeholder="End" />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <Label>Operator Authority</Label>
                              <Select>
                                <SelectTrigger className="bg-background border-border">
                                  <SelectValue placeholder="All Operators" />
                                </SelectTrigger>
                                <SelectContent className="bg-panel border-border">
                                  <SelectItem value="admin">System Administrator</SelectItem>
                                  <SelectItem value="op1">Operator 12</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <DrawerFooter className="flex flex-row justify-end gap-2 border-t border-border pt-4 px-0">
                            <DrawerClose asChild>
                              <Button variant="ghost">Clear Filters</Button>
                            </DrawerClose>
                            <Button variant="default" className="w-full">
                              Apply Filters
                            </Button>
                          </DrawerFooter>
                        </DrawerContent>
                      </Drawer>

                      {/* Drawer 4: Notification Drawer */}
                      <Drawer>
                        <DrawerTrigger asChild>
                          <Button variant="outline">Notification Drawer</Button>
                        </DrawerTrigger>
                        <DrawerContent className="bg-panel border border-border p-6 text-foreground max-w-md mx-auto rounded-t-dialog">
                          <DrawerHeader className="text-left border-b border-border pb-2 px-0">
                            <DrawerTitle className="text-subheading text-foreground">System Audit logs (Last 24h)</DrawerTitle>
                            <DrawerDescription className="text-caption text-muted">
                              Recent print requests, synchronization reports, and validation issues.
                            </DrawerDescription>
                          </DrawerHeader>
                          
                          <div className="py-4 space-y-3 divide-y divide-border max-h-[50vh] overflow-y-auto">
                            <div className="pt-2">
                              <span className="text-[10px] text-success font-bold uppercase block">Card sync passed - 11:20</span>
                              <p className="text-caption text-foreground font-semibold">Bulk CSV import sync finished for Class XII.</p>
                            </div>
                            <div className="pt-2">
                              <span className="text-[10px] text-warning font-bold uppercase block">Node timeout - 10:00</span>
                              <p className="text-caption text-foreground font-semibold">MinIO Storage Sync reported connection latency.</p>
                            </div>
                            <div className="pt-2">
                              <span className="text-[10px] text-destructive font-bold uppercase block">Roster sync failed - 09:15</span>
                              <p className="text-caption text-foreground font-semibold">Duplicated roll number (104) in reprint request roster.</p>
                            </div>
                          </div>

                          <DrawerFooter className="pt-4 border-t border-border px-0">
                            <DrawerClose asChild>
                              <Button variant="default" className="w-full">Dismiss Logs</Button>
                            </DrawerClose>
                          </DrawerFooter>
                        </DrawerContent>
                      </Drawer>
                    </div>
                  </div>
                </div>
              )}

              {/* TABLES */}
              {activeSection === 'Tables' && (
                <div className="space-y-6">
                  {/* Student Table */}
                  <div className="border border-border bg-panel p-4 rounded-card space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-subheading font-bold text-foreground">Student ID Registry Table</span>
                      <div className="text-caption text-muted">
                        Selected: {selectedStudents.length} / {MOCK_STUDENTS.length}
                      </div>
                    </div>
                    <div className="w-full overflow-x-auto border border-border">
                      <table className="w-full text-left border-collapse text-table">
                        <thead>
                          <tr className="border-b border-border bg-neutral-900/50">
                            <th className="p-2 w-10 border-r border-border text-center">
                              <Checkbox checked={selectedStudents.length === MOCK_STUDENTS.length} onCheckedChange={toggleSelectAllStudents} />
                            </th>
                            <th className="p-2 border-r border-border font-bold text-muted w-24">ID</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-24 text-right">Roll No.</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-44">Name</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-32">Class</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-32">Section</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-36 text-center">Status</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-36 text-center">Blood Gp</th>
                            <th className="p-2 font-bold text-muted text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {MOCK_STUDENTS.map((item) => {
                            const conf = STATUSES[item.status]
                            const Icon = conf.icon
                            return (
                              <tr key={item.id} className="border-b border-border hover:bg-neutral-800/40 transition-colors last:border-none">
                                <td className="p-2 border-r border-border text-center">
                                  <Checkbox checked={selectedStudents.includes(item.id)} onCheckedChange={() => toggleSelectStudent(item.id)} />
                                </td>
                                <td className="p-2 border-r border-border font-mono">{item.id}</td>
                                <td className="p-2 border-r border-border text-right font-mono">{item.rollNumber}</td>
                                <td className="p-2 border-r border-border font-bold text-foreground">{item.name}</td>
                                <td className="p-2 border-r border-border">{item.className}</td>
                                <td className="p-2 border-r border-border">{item.section}</td>
                                <td className="p-2 border-r border-border text-center">
                                  <Badge variant={conf.badgeVariant} className="gap-1 rounded-sm py-0.5 text-[11px] font-bold">
                                    <Icon className="h-3 w-3" />
                                    <span>{conf.label}</span>
                                  </Badge>
                                </td>
                                <td className="p-2 border-r border-border text-center font-bold">{item.bloodGroup}</td>
                                <td className="p-2 text-right">
                                  <div className="flex justify-end gap-1">
                                    <Button variant="ghost" size="icon" className="h-7 w-7"><Edit className="h-3.5 w-3.5" /></Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Staff Table */}
                  <div className="border border-border bg-panel p-4 rounded-card space-y-3">
                    <span className="text-subheading font-bold text-foreground block">Staff Profiles Roster</span>
                    <div className="w-full overflow-x-auto border border-border">
                      <table className="w-full text-left border-collapse text-table">
                        <thead>
                          <tr className="border-b border-border bg-neutral-900/50">
                            <th className="p-2 border-r border-border font-bold text-muted w-24">ID</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-32">Staff ID</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-44">Name</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-36">Department</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-36">Designation</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-32 text-center">Status</th>
                            <th className="p-2 font-bold text-muted w-36">Joining Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {MOCK_STAFF.map((item) => {
                            const conf = STATUSES[item.status]
                            const Icon = conf.icon
                            return (
                              <tr key={item.id} className="border-b border-border hover:bg-neutral-800/40 transition-colors last:border-none">
                                <td className="p-2 border-r border-border font-mono">{item.id}</td>
                                <td className="p-2 border-r border-border font-mono">{item.staffId}</td>
                                <td className="p-2 border-r border-border font-bold text-foreground">{item.name}</td>
                                <td className="p-2 border-r border-border">{item.department}</td>
                                <td className="p-2 border-r border-border">{item.designation}</td>
                                <td className="p-2 border-r border-border text-center">
                                  <Badge variant={conf.badgeVariant} className="gap-1 rounded-sm py-0.5">
                                    <Icon className="h-3 w-3" />
                                    <span>{conf.label}</span>
                                  </Badge>
                                </td>
                                <td className="p-2">{item.joiningDate}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Reprint Table */}
                  <div className="border border-border bg-panel p-4 rounded-card space-y-3">
                    <span className="text-subheading font-bold text-foreground block">Reprint Queue Database</span>
                    <div className="w-full overflow-x-auto border border-border">
                      <table className="w-full text-left border-collapse text-table">
                        <thead>
                          <tr className="border-b border-border bg-neutral-900/50">
                            <th className="p-2 border-r border-border font-bold text-muted w-24">ID</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-44">Student Name</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-28">Class/Sec</th>
                            <th className="p-2 border-r border-border font-bold text-muted">Reason for Reprint</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-32 text-center">Queue Status</th>
                            <th className="p-2 font-bold text-muted w-32">Req Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {MOCK_REPRINTS.map((item) => {
                            const conf = STATUSES[item.status]
                            const Icon = conf.icon
                            return (
                              <tr key={item.id} className="border-b border-border hover:bg-neutral-800/40 transition-colors last:border-none">
                                <td className="p-2 border-r border-border font-mono">{item.id}</td>
                                <td className="p-2 border-r border-border font-bold text-foreground">{item.studentName}</td>
                                <td className="p-2 border-r border-border">{item.className}-{item.section}</td>
                                <td className="p-2 border-r border-border italic text-muted-foreground">{item.reason}</td>
                                <td className="p-2 border-r border-border text-center">
                                  <Badge variant={conf.badgeVariant} className="gap-1 rounded-sm py-0.5">
                                    <Icon className="h-3 w-3" />
                                    <span>{conf.label}</span>
                                  </Badge>
                                </td>
                                <td className="p-2 font-mono">{item.requestDate}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Workflow Table */}
                  <div className="border border-border bg-panel p-4 rounded-card space-y-3">
                    <span className="text-subheading font-bold text-foreground block">System Integration Workflows</span>
                    <div className="w-full overflow-x-auto border border-border">
                      <table className="w-full text-left border-collapse text-table">
                        <thead>
                          <tr className="border-b border-border bg-neutral-900/50">
                            <th className="p-2 border-r border-border font-bold text-muted w-24">ID</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-56">Workflow Task</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-44">Operator ID</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-32 text-center">Priority</th>
                            <th className="p-2 border-r border-border font-bold text-muted w-32 text-center">Verification</th>
                            <th className="p-2 font-bold text-muted w-44">Last Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {MOCK_WORKFLOWS.map((item) => {
                            const conf = STATUSES[item.status]
                            const Icon = conf.icon
                            return (
                              <tr key={item.id} className="border-b border-border hover:bg-neutral-800/40 transition-colors last:border-none">
                                <td className="p-2 border-r border-border font-mono">{item.id}</td>
                                <td className="p-2 border-r border-border font-bold text-foreground">{item.taskName}</td>
                                <td className="p-2 border-r border-border">{item.operator}</td>
                                <td className="p-2 border-r border-border text-center">
                                  <Badge variant={item.priority === 'HIGH' ? 'destructive' : 'secondary'} className="rounded-sm text-[10px]">
                                    {item.priority}
                                  </Badge>
                                </td>
                                <td className="p-2 border-r border-border text-center">
                                  <Badge variant={conf.badgeVariant} className="gap-1 rounded-sm py-0.5">
                                    <Icon className="h-3 w-3" />
                                    <span>{conf.label}</span>
                                  </Badge>
                                </td>
                                <td className="p-2 font-mono">{item.updatedAt}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* TOOLBARS */}
              {activeSection === 'Toolbars' && (
                <div className="space-y-6">
                  <div className="border border-border bg-panel p-4 rounded-card space-y-4">
                    <h3 className="text-caption uppercase text-muted mb-2 tracking-widest border-b border-border pb-1">Operational Toolbar Compilation</h3>
                    
                    <div className="flex flex-col gap-3 p-4 bg-background border border-border rounded-sm">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        {/* Search & Filter Group */}
                        <div className="flex flex-wrap items-center gap-2 flex-1 max-w-2xl">
                          {/* Search */}
                          <div className="relative w-48">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
                            <Input 
                              placeholder="Search roster..." 
                              className="pl-8 bg-panel" 
                              value={studentSearch}
                              onChange={(e) => setStudentSearch(e.target.value)}
                            />
                          </div>

                          {/* Status Filter */}
                          <Select value={studentStatusFilter} onValueChange={setStudentStatusFilter}>
                            <SelectTrigger className="w-32 bg-panel border-border text-body">
                              <SelectValue placeholder="Card Status" />
                            </SelectTrigger>
                            <SelectContent className="bg-panel border border-border">
                              <SelectItem value="ALL">All Statuses</SelectItem>
                              <SelectItem value="APPROVED">Approved</SelectItem>
                              <SelectItem value="PENDING">Pending</SelectItem>
                            </SelectContent>
                          </Select>

                          {/* Class Filter */}
                          <Select value={studentClassFilter} onValueChange={setStudentClassFilter}>
                            <SelectTrigger className="w-28 bg-panel border-border text-body">
                              <SelectValue placeholder="Class" />
                            </SelectTrigger>
                            <SelectContent className="bg-panel border border-border">
                              <SelectItem value="ALL">All Classes</SelectItem>
                              <SelectItem value="Class X">Class X</SelectItem>
                              <SelectItem value="Class XII">Class XII</SelectItem>
                            </SelectContent>
                          </Select>

                          {/* Section Filter */}
                          <Select value={studentSectionFilter} onValueChange={setStudentSectionFilter}>
                            <SelectTrigger className="w-24 bg-panel border-border text-body">
                              <SelectValue placeholder="Section" />
                            </SelectTrigger>
                            <SelectContent className="bg-panel border border-border">
                              <SelectItem value="ALL">All Sections</SelectItem>
                              <SelectItem value="A">Section A</SelectItem>
                              <SelectItem value="B">Section B</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2">
                          <Button variant="outline" className="gap-1.5">
                            <FileDown className="h-3.5 w-3.5" />
                            <span>Export</span>
                          </Button>
                          <Button variant="outline" className="gap-1.5">
                            <FileUp className="h-3.5 w-3.5" />
                            <span>Import</span>
                          </Button>
                          <Button variant="default" className="gap-1.5">
                            <Plus className="h-3.5 w-3.5" />
                            <span>Add Card</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* LOADING STATES */}
              {activeSection === 'Loading States' && (
                <div className="space-y-6">
                  {/* Button skeleton triggers */}
                  <div className="border border-border bg-panel p-4 rounded-card space-y-4">
                    <h3 className="text-caption uppercase text-muted mb-2 tracking-widest border-b border-border pb-1">Table skeleton loading demonstration</h3>
                    
                    <div className="flex items-center gap-2 mb-4">
                      <Button variant="outline" onClick={() => { setDemoTableLoading(true); setTimeout(() => setDemoTableLoading(false), 2000); }} disabled={demoTableLoading}>
                        Trigger Table Skeletons (2s)
                      </Button>
                    </div>

                    <div className="border border-border bg-background p-2">
                      <TableLoader rows={5} cols={5} />
                    </div>
                  </div>

                  {/* Button spinners */}
                  <div className="border border-border bg-panel p-4 rounded-card space-y-2">
                    <h3 className="text-caption uppercase text-muted mb-2 tracking-widest border-b border-border pb-1">Button Loaders</h3>
                    <div className="flex flex-wrap gap-4 items-center">
                      <Button isLoading={true}>Loading Primary</Button>
                      <Button variant="outline" isLoading={true}>Loading Outline</Button>
                      <Button variant="destructive" isLoading={true}>Deleting...</Button>
                    </div>
                  </div>
                </div>
              )}

              {/* LAYOUTS */}
              {activeSection === 'Layouts' && (
                <div className="space-y-6">
                  <div className="border border-border bg-panel p-4 rounded-card space-y-4">
                    <h3 className="text-caption uppercase text-muted mb-2 tracking-widest border-b border-border pb-1">Realistic Multi-Panel Layout</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Left: Quick Stats */}
                      <div className="md:col-span-1 border border-border bg-background p-4 rounded-sm space-y-3">
                        <span className="text-caption text-muted uppercase font-bold block">Status Summary</span>
                        <div className="divide-y divide-border border border-border bg-panel">
                          <div className="p-2 flex justify-between text-caption">
                            <span>Verification Queue</span>
                            <span className="font-bold text-foreground">12 Cards</span>
                          </div>
                          <div className="p-2 flex justify-between text-caption">
                            <span>Pending Prints</span>
                            <span className="font-bold text-warning">8 Cards</span>
                          </div>
                          <div className="p-2 flex justify-between text-caption">
                            <span>Completed Today</span>
                            <span className="font-bold text-success">142 Cards</span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Operational Queue Details */}
                      <div className="md:col-span-2 border border-border bg-background p-4 rounded-sm space-y-3">
                        <span className="text-caption text-muted uppercase font-bold block">Active Node Synchronization Logs</span>
                        <div className="p-3 bg-panel border border-border font-mono text-table text-muted space-y-1">
                          <div>[10:00:15] Node-01 verified class X-A roster.</div>
                          <div>[10:02:40] MinIO Storage client fetched template index.</div>
                          <div className="text-success">[10:05:00] Batch #210 compilation successful: 25 cards printed.</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SPACING */}
              {activeSection === 'Spacing' && (
                <div className="space-y-6">
                  <div className="border border-border bg-panel p-4 rounded-card space-y-4">
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <h3 className="text-caption uppercase text-muted tracking-widest">Spacing Scale comparison</h3>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="density-toggle" className="text-caption">Use Alternative Density (Spaced)</Label>
                        <Switch id="density-toggle" checked={isAlternativeDensity} onCheckedChange={setIsAlternativeDensity} />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Panel representing density */}
                      <div className={`border border-border bg-background rounded-sm transition-all duration-300 ${
                        isAlternativeDensity ? 'p-6 gap-6' : 'p-2 gap-2'
                      } flex flex-col`}>
                        <div className="border border-border bg-panel text-center font-bold text-caption py-2">
                          HEADER COMPONENT
                        </div>
                        <div className="border border-border bg-panel p-3 text-body">
                          This element shows how items wrap and space. By changing the density, you can evaluate information visibility in the list view.
                        </div>
                        <div className="flex justify-end gap-2 border-t border-border pt-2">
                          <Button size="sm" variant="ghost">Cancel</Button>
                          <Button size="sm">Save Changes</Button>
                        </div>
                      </div>

                      {/* Legend explanation of spacing scale */}
                      <div className="space-y-3 text-caption">
                        <span className="font-bold text-foreground">Current ERP Spacing Guidelines:</span>
                        <p className="text-muted">
                          The current layout enforces strict spacing keys (`p-2`, `gap-2`, `py-1`) to maximize data visibility for staff processing thousands of cards. No margins exceed 16px.
                        </p>
                        <span className="font-bold text-foreground">Alternative Spacing Guidelines:</span>
                        <p className="text-muted">
                          Spaced mode (`p-6`, `gap-6`, `py-3`) adds excessive padding and whitespace, pushing details off-screen and reducing card processing efficiency.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STATUS SYSTEM */}
              {activeSection === 'Status System' && (
                <div className="space-y-6">
                  <div className="border border-border bg-panel p-4 rounded-card space-y-4">
                    <h3 className="text-caption uppercase text-muted mb-2 tracking-widest border-b border-border pb-1">
                      Status System Tokens (No Icons Showcase)
                    </h3>
                    
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {(Object.keys(STATUSES) as StatusKey[]).map((key) => {
                        const conf = STATUSES[key]
                        return (
                          <div 
                            key={key} 
                            className={`p-3 border ${conf.borderClass} ${conf.bgClass} flex flex-col justify-between rounded-sm h-20`}
                          >
                            <span className="text-[10px] font-bold text-muted-foreground uppercase">{key}</span>
                            {/* Render status label with NO icons as requested */}
                            <span className={`text-subheading font-bold ${conf.color}`}>
                              {conf.label}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div className="border border-border bg-panel p-4 rounded-card">
                    <h3 className="text-caption uppercase text-muted mb-2 tracking-widest border-b border-border pb-1">Status Colors Map</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-caption">
                      <div className="space-y-2">
                        <div className="flex justify-between border-b border-border pb-1">
                          <span>VERIFIED</span>
                          <span className="text-success font-bold">Success Green (Green-600)</span>
                        </div>
                        <div className="flex justify-between border-b border-border pb-1">
                          <span>APPROVED</span>
                          <span className="text-primary font-bold">Action Blue (Blue-600)</span>
                        </div>
                        <div className="flex justify-between border-b border-border pb-1">
                          <span>PENDING / REQUESTED</span>
                          <span className="text-warning font-bold">Warning Orange (Orange-600)</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between border-b border-border pb-1">
                          <span>REJECTED / DELETED</span>
                          <span className="text-destructive font-bold">Danger Red (Red-500)</span>
                        </div>
                        <div className="flex justify-between border-b border-border pb-1">
                          <span>PRINTED</span>
                          <span className="text-success font-bold">Success Green (Green-600)</span>
                        </div>
                        <div className="flex justify-between border-b border-border pb-1">
                          <span>DOWNLOADED</span>
                          <span className="text-info font-bold">Info Purple (Purple-600)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* AUTHENTICATION SHOWCASE */}
              {activeSection === 'Authentication' && (
                <div className="space-y-6">
                  {/* Step Selector for evaluators */}
                  <div className="border border-border bg-panel p-4 rounded-card">
                    <div className="flex items-center justify-between border-b border-border pb-2 mb-4">
                      <h3 className="text-caption uppercase text-muted tracking-widest">Authentication Preview Controls</h3>
                      <span className="text-[10px] text-info font-bold">SIMULATOR ACTIVE</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant={authDemoStep === 'identity' ? 'default' : 'outline'} 
                        size="sm" 
                        onClick={() => setAuthDemoStep('identity')}
                      >
                        Screen 1: Identity Step
                      </Button>
                      <Button 
                        variant={authDemoStep === 'password' ? 'default' : 'outline'} 
                        size="sm" 
                        onClick={() => setAuthDemoStep('password')}
                      >
                        Screen 2: Password Step
                      </Button>
                      <Button 
                        variant={authDemoStep === 'otp' ? 'default' : 'outline'} 
                        size="sm" 
                        onClick={() => { setAuthDemoStep('otp'); setOtpTimer(59); }}
                      >
                        Screen 3: OTP Step
                      </Button>
                      <Button 
                        variant={authDemoStep === 'success' ? 'default' : 'outline'} 
                        size="sm" 
                        onClick={() => setAuthDemoStep('success')}
                      >
                        Screen 4: Success Screen
                      </Button>
                    </div>
                  </div>

                  {/* Render the Auth Layout, Auth Card, Wizard indicators in canvas */}
                  <div className="border border-border bg-background p-8 flex justify-center items-center rounded-card relative overflow-hidden min-h-[480px]">
                    <div className="absolute top-0 right-0 bg-primary/20 text-primary text-[9px] px-2 py-0.5 rounded font-bold uppercase select-none tracking-widest z-20">
                      Viewport Centering Canvas (640px Card Fixed)
                    </div>
                    
                    <AuthCard>
                      <WizardStepIndicator currentStep={authDemoStep} />
                      
                      {authDemoStep === 'identity' && (
                        <>
                          <AuthHeader 
                            title="Operator Identity" 
                            subtitle="Verify your identity credentials to continue session handshake." 
                          />
                          <div className="p-6 space-y-4">
                            <div className="space-y-1">
                              <Label htmlFor="id-username" className="text-caption uppercase text-muted font-bold">Email / Username / Phone</Label>
                              <Input id="id-username" placeholder="operator@adarsh.com or 9876543210" className="bg-background text-body" />
                            </div>
                            <Button 
                              className="w-full text-button" 
                              onClick={() => setAuthDemoStep('password')}
                            >
                              CONTINUE
                            </Button>
                          </div>
                        </>
                      )}

                      {authDemoStep === 'password' && (
                        <>
                          <AuthHeader 
                            title="Security Verification" 
                            subtitle="Enter password credentials for user operator@adarsh.com." 
                          />
                          <div className="p-6 space-y-4">
                            <div className="space-y-1">
                              <div className="flex justify-between items-center">
                                <Label htmlFor="id-password" className="text-caption uppercase text-muted font-bold">Password</Label>
                                <a href="#forgot" className="text-caption text-primary font-bold hover:underline" onClick={(e) => { e.preventDefault(); toast({ title: "Forgot Password Clicked", description: "In production, this routes to password recovery." }); }}>
                                  FORGOT PASSWORD?
                                </a>
                              </div>
                              <Input id="id-password" type="password" placeholder="••••••••" className="bg-background text-body" />
                            </div>
                            <div className="flex gap-3">
                              <Button 
                                variant="outline" 
                                className="w-1/3 text-button" 
                                onClick={() => setAuthDemoStep('identity')}
                              >
                                BACK
                              </Button>
                              <Button 
                                className="w-2/3 text-button" 
                                onClick={() => { setAuthDemoStep('otp'); setOtpTimer(59); }}
                              >
                                SIGN IN
                              </Button>
                            </div>
                          </div>
                        </>
                      )}

                      {authDemoStep === 'otp' && (
                        <>
                          <AuthHeader 
                            title="Multi-Factor Auth" 
                            subtitle="A 6-digit OTP code has been dispatched to +91 ******3210." 
                          />
                          <div className="p-6 space-y-4">
                            <div className="space-y-1">
                              <Label htmlFor="id-otp" className="text-caption uppercase text-muted font-bold text-center block">Enter 6-Digit Code</Label>
                              <Input 
                                id="id-otp" 
                                maxLength={6} 
                                placeholder="000 000" 
                                className="bg-background text-[20px] text-center tracking-[1em] font-mono font-bold" 
                              />
                            </div>
                            
                            <div className="text-center text-caption">
                              {otpTimer > 0 ? (
                                <span className="text-muted-foreground">Resend code in <strong className="text-foreground">{otpTimer}s</strong></span>
                              ) : (
                                <button 
                                  className="text-primary font-bold hover:underline" 
                                  onClick={() => setOtpTimer(59)}
                                >
                                  RESEND OTP CODE
                                </button>
                              )}
                            </div>

                            <div className="flex gap-3">
                              <Button 
                                variant="outline" 
                                className="w-1/3 text-button" 
                                onClick={() => setAuthDemoStep('password')}
                              >
                                BACK
                              </Button>
                              <Button 
                                className="w-2/3 text-button" 
                                onClick={() => setAuthDemoStep('success')}
                              >
                                VERIFY OTP
                              </Button>
                            </div>
                          </div>
                        </>
                      )}

                      {authDemoStep === 'success' && (
                        <>
                          <AuthHeader 
                            title="Session Handshake Success" 
                            subtitle="Security credentials matched successfully." 
                          />
                          <div className="p-6 flex flex-col items-center justify-center space-y-4">
                            <div className="h-12 w-12 rounded-full bg-success/20 border border-success flex items-center justify-center text-success">
                              <Check className="h-6 w-6 stroke-[3]" />
                            </div>
                            <div className="text-center">
                              <span className="text-subheading font-bold text-success block">ACCESS GRANTED</span>
                              <span className="text-caption text-muted-foreground">Redirecting to operator console dashboard...</span>
                            </div>
                            <Button 
                              variant="outline"
                              className="w-full text-button" 
                              onClick={() => setAuthDemoStep('identity')}
                            >
                              RESTART PREVIEW
                            </Button>
                          </div>
                        </>
                      )}

                      <AuthFooter />
                    </AuthCard>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Simple state wrapper for button loader demos
let btnLoading = false
const setBtnLoading = (val: boolean) => {
  btnLoading = val
}

export default DesignLabPage
