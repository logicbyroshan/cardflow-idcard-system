import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ShieldAlert, Palette, List, AlignLeft, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export const DesignAuditPage: React.FC = () => {
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground font-saira p-6 space-y-6">
      
      {/* Header section */}
      <header className="flex items-center justify-between border-b border-border pb-4 bg-panel/30 p-4 rounded-sm">
        <div className="flex items-center gap-3">
          <Palette className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-heading font-bold text-foreground">DESIGN AUDIT PANEL</h1>
            <p className="text-caption text-muted">Official Design Token Specification & Component Inventory</p>
          </div>
        </div>
        <Link to="/design-lab">
          <Button variant="outline" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Design Lab
          </Button>
        </Link>
      </header>

      {/* Unified Specifications Grid */}
      <div className="panel-sticked-group flex flex-col">
        
        {/* Row 1: Typography Scale & Color Tokens */}
        <div className="grid grid-cols-1 md:grid-cols-2 border-b border-border">
          {/* Token Box 1: Typography */}
          <section className="panel-section border-b border-border md:border-b-0 md:border-r border-border space-y-3">
            <h2 className="text-subheading text-primary font-bold border-b border-border pb-2 flex items-center gap-2">
              <Layers className="h-4 w-4" /> Typography Scale (Saira Condensed)
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-table">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="pb-2">Token / Class</th>
                    <th className="pb-2">Size</th>
                    <th className="pb-2">Weight / Tracking</th>
                    <th className="pb-2">Primary Intent</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/40">
                    <td className="py-2 font-mono text-foreground font-bold">.text-heading</td>
                    <td className="py-2">30px (1.875rem)</td>
                    <td className="py-2">Bold / Tracking-wider</td>
                    <td className="py-2">Page Titles, Major Blocks (Max size)</td>
                  </tr>
                  <tr className="border-b border-border/40">
                    <td className="py-2 font-mono text-foreground font-bold">.text-subheading</td>
                    <td className="py-2">22px (1.375rem)</td>
                    <td className="py-2">Semibold / Tracking-wide</td>
                    <td className="py-2">Section Headers, Panel Titles</td>
                  </tr>
                  <tr className="border-b border-border/40">
                    <td className="py-2 font-mono text-foreground font-bold">.text-body</td>
                    <td className="py-2">16px (1rem)</td>
                    <td className="py-2">Normal / Regular</td>
                    <td className="py-2">Standard UI copy, Description inputs</td>
                  </tr>
                  <tr className="border-b border-border/40">
                    <td className="py-2 font-mono text-foreground font-bold">.text-table</td>
                    <td className="py-2">15px (0.94rem)</td>
                    <td className="py-2">Medium</td>
                    <td className="py-2">Roster Tables, Grids, Row Action values</td>
                  </tr>
                  <tr className="border-b border-border/40">
                    <td className="py-2 font-mono text-foreground font-bold">.text-badge</td>
                    <td className="py-2">14px (0.875rem)</td>
                    <td className="py-2">Bold / Tracking-widest</td>
                    <td className="py-2">Badges, Small labels (Min size)</td>
                  </tr>
                  <tr>
                    <td className="py-2 font-mono text-foreground font-bold">.text-caption</td>
                    <td className="py-2">14px (0.875rem)</td>
                    <td className="py-2">Normal / Text-muted</td>
                    <td className="py-2">Subtext metadata, Database syncing states (Min size)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Token Box 2: Colors & Surfaces */}
          <section className="panel-section space-y-3">
            <h2 className="text-subheading text-primary font-bold border-b border-border pb-2 flex items-center gap-2">
              <Palette className="h-4 w-4" /> Color Tokens & Surfaces
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-table">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="pb-2">Token Name</th>
                    <th className="pb-2">HEX Value</th>
                    <th className="pb-2">Visual Mapping</th>
                    <th className="pb-2">Intent</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/40">
                    <td className="py-2 font-mono text-foreground font-bold">--background</td>
                    <td className="py-2">#0A0A0A</td>
                    <td className="py-2 flex items-center gap-1.5"><span className="h-3.5 w-3.5 bg-[#0A0A0A] border border-border rounded-xs" /> Black</td>
                    <td className="py-2">Global Canvas background</td>
                  </tr>
                  <tr className="border-b border-border/40">
                    <td className="py-2 font-mono text-foreground font-bold">--sidebar</td>
                    <td className="py-2">#111111</td>
                    <td className="py-2 flex items-center gap-1.5"><span className="h-3.5 w-3.5 bg-[#111111] border border-border rounded-xs" /> Sidebar Dark</td>
                    <td className="py-2">Navigation side column</td>
                  </tr>
                  <tr className="border-b border-border/40">
                    <td className="py-2 font-mono text-foreground font-bold">--panel</td>
                    <td className="py-2">#171717</td>
                    <td className="py-2 flex items-center gap-1.5"><span className="h-3.5 w-3.5 bg-[#171717] border border-border rounded-xs" /> Panel Grey</td>
                    <td className="py-2">Card boxes, Grid headers, Modals</td>
                  </tr>
                  <tr className="border-b border-border/40">
                    <td className="py-2 font-mono text-foreground font-bold">--border</td>
                    <td className="py-2">#262626</td>
                    <td className="py-2 flex items-center gap-1.5"><span className="h-3.5 w-3.5 bg-[#262626] border border-border rounded-xs" /> Border Grey</td>
                    <td className="py-2">Table cell grid, separators</td>
                  </tr>
                  <tr className="border-b border-border/40">
                    <td className="py-2 font-mono text-foreground font-bold">--primary</td>
                    <td className="py-2">#2563EB</td>
                    <td className="py-2 flex items-center gap-1.5"><span className="h-3.5 w-3.5 bg-[#2563EB] rounded-xs" /> Active Blue</td>
                    <td className="py-2">Action buttons, Selected status</td>
                  </tr>
                  <tr className="border-b border-border/40">
                    <td className="py-2 font-mono text-foreground font-bold">--success</td>
                    <td className="py-2">#16A34A</td>
                    <td className="py-2 flex items-center gap-1.5"><span className="h-3.5 w-3.5 bg-[#16A34A] rounded-xs" /> Green</td>
                    <td className="py-2">Verified, Approved, Printed states</td>
                  </tr>
                  <tr className="border-b border-border/40">
                    <td className="py-2 font-mono text-foreground font-bold">--warning</td>
                    <td className="py-2">#EA580C</td>
                    <td className="py-2 flex items-center gap-1.5"><span className="h-3.5 w-3.5 bg-[#EA580C] rounded-xs" /> Orange</td>
                    <td className="py-2">Pending reprint requests</td>
                  </tr>
                  <tr>
                    <td className="py-2 font-mono text-foreground font-bold">--destructive</td>
                    <td className="py-2">#EF4444</td>
                    <td className="py-2 flex items-center gap-1.5"><span className="h-3.5 w-3.5 bg-[#EF4444] rounded-xs" /> Red</td>
                    <td className="py-2">Rejected, Deleted states</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Row 2: Scales, UX Rules & Constraints */}
        <div className="grid grid-cols-1 md:grid-cols-3 border-b border-border">
          {/* Box 3: Spacing & Size scale */}
          <section className="panel-section border-b border-border md:border-b-0 md:border-r border-border space-y-3">
            <h2 className="text-subheading text-primary font-bold border-b border-border pb-2 flex items-center gap-2">
              <List className="h-4 w-4" /> Spacing & Radii Scales
            </h2>
            <div className="space-y-4 text-body">
              <div>
                <span className="font-bold text-foreground block mb-1">Strict Spacing Keys (Tailwind Custom):</span>
                <div className="flex gap-2 flex-wrap">
                  <Badge variant="secondary">0 = 0px</Badge>
                  <Badge variant="secondary">2 = 8px (dense padding)</Badge>
                  <Badge variant="secondary">4 = 16px (card padding)</Badge>
                  <Badge variant="secondary">8 = 32px (margins)</Badge>
                  <Badge variant="secondary">12 = 48px</Badge>
                  <Badge variant="secondary">16 = 64px</Badge>
                </div>
              </div>

              <div>
                <span className="font-bold text-foreground block mb-1">Height Limits:</span>
                <p className="text-caption text-muted">
                  Inputs: **36px** | Buttons: **36px** (Small: **28px**, Large: **44px**) | Headers: **56px** (14) | Sidebar: **100vh**.
                </p>
              </div>

              <div>
                <span className="font-bold text-foreground block mb-1">Border Radius mapping:</span>
                <div className="space-y-1 text-caption text-muted">
                  <div>- Tables & Cells: **0px (none)**</div>
                  <div>- Buttons & Input fields: **4px (md)**</div>
                  <div>- Dialog modals, cards, drawers: **8px (lg)**</div>
                </div>
              </div>
            </div>
          </section>

          {/* Box 4: Alignment & Pagination Rules */}
          <section className="panel-section border-b border-border md:border-b-0 md:border-r border-border space-y-3">
            <h2 className="text-subheading text-primary font-bold border-b border-border pb-2 flex items-center gap-2">
              <AlignLeft className="h-4 w-4" /> Table Alignment & Pagination Rules
            </h2>
            <ul className="space-y-2 text-caption text-muted list-disc pl-4">
              <li>
                <strong className="text-foreground">Checkbox Columns:</strong> Always placed on the leftmost side, centered, with `10px` cell width limit.
              </li>
              <li>
                <strong className="text-foreground">Numeric values / Roll Numbers:</strong> Right-aligned to support immediate scanning.
              </li>
              <li>
                <strong className="text-foreground">Text & Identifiers:</strong> Left-aligned with standard font-semibold formatting.
              </li>
              <li>
                <strong className="text-foreground">Status Badge Cells:</strong> Centered horizontally.
              </li>
              <li>
                <strong className="text-foreground">Pagination Alignment:</strong> Left side contains item counts (Showing 1-10 of 500); Center contains navigation links; Right contains rows-per-page selectors.
              </li>
            </ul>
          </section>

          {/* Box 5: Layout & Grid Rules */}
          <section className="panel-section space-y-3">
            <h2 className="text-subheading text-primary font-bold border-b border-border pb-2 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" /> Layout Rules & Constraints
            </h2>
            <ul className="space-y-2 text-caption text-muted list-disc pl-4">
              <li>
                <strong className="text-foreground">Dark Theme Only:</strong> White background, gradients, and transparency panels are strictly prohibited to prevent operator eye fatigue.
              </li>
              <li>
                <strong className="text-foreground">1px Grid borders:</strong> Explicit grid borders using `border-border` (`#262626`) are required around all elements.
              </li>
              <li>
                <strong className="text-foreground">No business workflows:</strong> Phase 0 does not implement any operational logic or authentication routing.
              </li>
            </ul>
          </section>
        </div>

        {/* Row 3: Component Inventory */}
        <section className="panel-section space-y-4">
          <h2 className="text-subheading text-primary font-bold border-b border-border pb-2 flex items-center gap-2">
            <List className="h-4 w-4" /> Interactive Component Inventory
          </h2>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4 text-center">
            <div className="p-3 bg-background border border-border rounded-sm">
              <span className="text-heading font-extrabold text-foreground">4</span>
              <span className="text-caption block text-muted mt-1">Mock Tables</span>
            </div>
            <div className="p-3 bg-background border border-border rounded-sm">
              <span className="text-heading font-extrabold text-foreground">5</span>
              <span className="text-caption block text-muted mt-1">Button Variants</span>
            </div>
            <div className="p-3 bg-background border border-border rounded-sm">
              <span className="text-heading font-extrabold text-foreground">7</span>
              <span className="text-caption block text-muted mt-1">Form Controls</span>
            </div>
            <div className="p-3 bg-background border border-border rounded-sm">
              <span className="text-heading font-extrabold text-foreground">4</span>
              <span className="text-caption block text-muted mt-1">Dialog Modals</span>
            </div>
            <div className="p-3 bg-background border border-border rounded-sm">
              <span className="text-heading font-extrabold text-foreground">4</span>
              <span className="text-caption block text-muted mt-1">Side Drawers</span>
            </div>
            <div className="p-3 bg-background border border-border rounded-sm">
              <span className="text-heading font-extrabold text-foreground">9</span>
              <span className="text-caption block text-muted mt-1">System Statuses</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

export default DesignAuditPage
