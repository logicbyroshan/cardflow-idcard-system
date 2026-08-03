import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import AppLayout from '@/components/layout/AppLayout'
import AuthGuard from '@/app/guards/AuthGuard'
import { DesignLabPage } from '@/features/design-lab/pages/DesignLabPage'
import { DesignAuditPage } from '@/features/design-lab/pages/DesignAuditPage'
import PlaceholderPage from '@/features/placeholder/pages/PlaceholderPage'
import { AuthLayout } from '@/components/layout/auth/AuthLayout'
import LoginPage from '@/features/auth/pages/LoginPage'
import OtpPage from '@/features/auth/pages/OtpPage'
import ForgotPasswordPage from '@/features/auth/pages/ForgotPasswordPage'
import ResetPasswordPage from '@/features/auth/pages/ResetPasswordPage'
import DashboardResolver from '@/features/dashboard/pages/DashboardResolver'
import AdminDashboard from '@/features/dashboard/pages/AdminDashboard'
import ClientDashboard from '@/features/dashboard/pages/ClientDashboard'

const AuthRouteWrapper: React.FC = () => (
  <AuthLayout>
    <Outlet />
  </AuthLayout>
)

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <AuthGuard>
        <AppLayout />
      </AuthGuard>
    ),
    children: [
      {
        path: '',
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'dashboard',
        element: <DashboardResolver />,
      },
      {
        path: 'dashboard/admin',
        element: <AdminDashboard />,
      },
      {
        path: 'dashboard/client',
        element: <ClientDashboard />,
      },
      {
        path: 'management',
        element: <PlaceholderPage pageId="management" title="Management Console" group="Core Operations" />,
      },
      {
        path: 'management/roster',
        element: <PlaceholderPage pageId="management" title="Roster Management" group="Core Operations" />,
      },
      {
        path: 'management/staff',
        element: <PlaceholderPage pageId="management" title="Staff Operators" group="Core Operations" />,
      },
      {
        path: 'tables',
        element: <PlaceholderPage pageId="tables" title="Data Tables" group="Core Operations" />,
      },
      {
        path: 'tables/cards',
        element: <PlaceholderPage pageId="tables" title="Cards Registry" group="Core Operations" />,
      },
      {
        path: 'tables/batches',
        element: <PlaceholderPage pageId="tables" title="Batch Archives" group="Core Operations" />,
      },
      {
        path: 'workflow',
        element: <PlaceholderPage pageId="workflow" title="Workflow Designer" group="Core Operations" />,
      },
      {
        path: 'imports',
        element: <PlaceholderPage pageId="imports" title="Imports Engine" group="Data Exchange" />,
      },
      {
        path: 'exports',
        element: <PlaceholderPage pageId="exports" title="Exports Engine" group="Data Exchange" />,
      },
      {
        path: 'notifications',
        element: <PlaceholderPage pageId="notifications" title="System Notifications" group="Queue & Comms" />,
      },
      {
        path: 'reprints',
        element: <PlaceholderPage pageId="reprints" title="Reprints Queue" group="Queue & Comms" />,
      },
      {
        path: 'sandbox',
        element: <PlaceholderPage pageId="sandbox" title="Sandbox Suite" group="Advanced Tools" />,
      },
      {
        path: 'operations',
        element: <PlaceholderPage pageId="operations" title="Operations Engine" group="Advanced Tools" />,
      },
      {
        path: 'pro',
        element: <PlaceholderPage pageId="pro" title="Pro Platform" group="Advanced Tools" />,
      },
      {
        path: 'settings',
        element: <PlaceholderPage pageId="settings" title="System Settings" group="Settings & Setup" />,
      },
      {
        path: 'settings/system',
        element: <PlaceholderPage pageId="settings" title="System Config" group="Settings & Setup" />,
      },
      {
        path: 'settings/security',
        element: <PlaceholderPage pageId="settings" title="Security & Keys" group="Settings & Setup" />,
      },
      {
        path: 'design-lab',
        element: <DesignLabPage />,
      },
      {
        path: 'design-lab/audit',
        element: <DesignAuditPage />,
      },
    ],
  },
  {
    path: '/auth',
    element: <AuthRouteWrapper />,
    children: [
      {
        path: '',
        element: <Navigate to="/auth/login" replace />,
      },
      {
        path: 'login',
        element: <LoginPage />,
      },
      {
        path: 'otp',
        element: <OtpPage />,
      },
      {
        path: 'forgot-password',
        element: <ForgotPasswordPage />,
      },
      {
        path: 'reset-password',
        element: <ResetPasswordPage />,
      },
    ],
  },
])

export default router
