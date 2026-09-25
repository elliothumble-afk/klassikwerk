import { createBrowserRouter, RouterProvider } from 'react-router'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { RoleGuard } from '@/components/auth/RoleGuard'
import { HomePage } from '@/pages/public/HomePage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { CallbackPage } from '@/pages/auth/CallbackPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { PortalShell } from '@/pages/portal/PortalShell'
import { OpsShell } from '@/pages/ops/OpsShell'
import { CatalogPage } from '@/pages/ops/catalog/CatalogPage'

const router = createBrowserRouter([
  {
    path: '/',
    element: <HomePage />,
  },
  {
    path: '/auth/login',
    element: <LoginPage />,
  },
  {
    path: '/auth/callback',
    element: <CallbackPage />,
  },
  {
    path: '/auth/forgot-password',
    element: <ForgotPasswordPage />,
  },
  {
    element: <AuthGuard />,
    children: [
      {
        path: '/portal',
        element: <RoleGuard role="customer" />,
        children: [
          {
            index: true,
            element: <PortalShell />,
          },
        ],
      },
      {
        path: '/ops',
        element: <RoleGuard role="ops" />,
        children: [
          {
            element: <OpsShell />,
            children: [
              {
                path: 'catalog',
                element: <CatalogPage />,
              },
            ],
          },
        ],
      },
    ],
  },
])

export function App() {
  return <RouterProvider router={router} />
}
