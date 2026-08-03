import React from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

function App() {
  return (
    <div className="min-h-screen bg-background text-foreground p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-12">
        <header>
          <h1 className="text-4xl font-bold mb-2 text-heading">UI Components Showcase</h1>
          <p className="text-muted-foreground text-lg">
            A comprehensive look at our base UI components and their variants.
          </p>
        </header>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold border-b border-border pb-2 text-subheading">Buttons</h2>
          <div className="flex flex-wrap gap-4">
            <Button variant="default">Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap gap-4 items-center mt-4">
             <Button size="sm">Small Size</Button>
             <Button size="default">Default Size</Button>
             <Button size="lg">Large Size</Button>
             <Button isLoading>Loading</Button>
             <Button disabled>Disabled</Button>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold border-b border-border pb-2 text-subheading">Badges</h2>
          <div className="flex flex-wrap gap-4">
            <Badge variant="default">Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="destructive">Destructive</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="info">Info</Badge>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold border-b border-border pb-2 text-subheading">Form Controls</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Input</Label>
                <Input id="email" type="email" placeholder="m@example.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="disabled">Disabled Input</Label>
                <Input id="disabled" disabled placeholder="Disabled field" />
              </div>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center space-x-4">
                <div><Switch id="airplane-mode" /></div>
                <Label htmlFor="airplane-mode">Airplane Mode</Label>
              </div>
              
              <div className="flex items-center space-x-4">
                <div><Checkbox id="terms" /></div>
                <Label htmlFor="terms">Accept terms and conditions</Label>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold border-b border-border pb-2 text-subheading">Tabs</h2>
          <Tabs defaultValue="account">
            <TabsList>
              <TabsTrigger value="account">Account</TabsTrigger>
              <TabsTrigger value="password">Password</TabsTrigger>
            </TabsList>
            <TabsContent value="account">
              <p className="text-sm">Make changes to your account here.</p>
            </TabsContent>
            <TabsContent value="password">
              <p className="text-sm">Change your password here.</p>
            </TabsContent>
          </Tabs>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold border-b border-border pb-2 text-subheading">Complete Form Preview</h2>
          <div className="max-w-2xl ring-1 ring-input rounded-sm p-6 bg-card space-y-6 shadow-sm">
            <div>
              <h3 className="text-lg font-semibold text-heading uppercase">Create New Account</h3>
              <p className="text-sm text-muted-foreground uppercase">Fill in the details below to register.</p>
            </div>
            
            <div className="flex space-x-8">
              <div className="w-1/2 space-y-2">
                <Label htmlFor="first-name">First Name</Label>
                <Input id="first-name" placeholder="John" />
              </div>
              <div className="w-1/2 space-y-2">
                <Label htmlFor="last-name">Last Name</Label>
                <Input id="last-name" placeholder="Doe" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-full">Email Address</Label>
              <Input id="email-full" type="email" placeholder="john.doe@example.com" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Account Role</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrator</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea id="bio" placeholder="Tell us a little bit about yourself..." />
            </div>

            <div className="flex items-center justify-between border-t border-border pt-6">
              <div className="flex items-center space-x-4">
                <div><Switch id="marketing" /></div>
                <Label htmlFor="marketing">Receive marketing emails</Label>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <div><Checkbox id="terms-full" /></div>
              <Label htmlFor="terms-full">I agree to the Terms of Service and Privacy Policy.</Label>
            </div>

            <div className="flex justify-end gap-4 pt-6 border-t border-border">
              <Button variant="outline">Cancel</Button>
              <Button>Create Account</Button>
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}

export default App

