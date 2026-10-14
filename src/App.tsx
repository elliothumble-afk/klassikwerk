import { useMemo } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { RoleGuard } from '@/components/auth/RoleGuard'
import { Spinner } from '@/components/ui/Spinner'
import { LoginPage } from '@/pages/auth/LoginPage'
import { CallbackPage } from '@/pages/auth/CallbackPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'
import { PortalShell } from '@/pages/portal/PortalShell'
import { OpsShell } from '@/pages/ops/OpsShell'
import { CatalogPage } from '@/pages/ops/catalog/CatalogPage'
import { BuildersList } from '@/pages/ops/builders/BuildersList'
import { BuilderWizard } from '@/pages/ops/builders/BuilderWizard'
import { BrandEdit } from '@/pages/ops/builders/BrandEdit'
import { TermsEdit } from '@/pages/ops/builders/TermsEdit'
import { ContractEdit } from '@/pages/ops/builders/ContractEdit'
import { BuildsList } from '@/pages/ops/builds/BuildsList'
import { BuildDetail } from '@/pages/ops/builds/BuildDetail'
import { OperatorLanding } from '@/pages/public/OperatorLanding'
import { BuilderShell } from '@/pages/public/BuilderShell'
import { BuilderHome } from '@/pages/public/BuilderHome'
import { ProcessPage } from '@/pages/public/ProcessPage'
import { PlatformsPage } from '@/pages/public/PlatformsPage'
import { ConfigurePage } from '@/pages/public/ConfigurePage'
import { ReserveSuccess } from '@/pages/public/ReserveSuccess'

function useCustomDomainSlug(): { slug: string | null; loading: boolean } {
  const hostname = typeof window === 'undefined' ? '' : window.location.hostname
  const q = useQuery({
    queryKey: ['custom-domain', hostname],
    queryFn: async () => {
      if (!hostname) return null
      const { data } = await supabase
        .from('builder_brand')
        .select('custom_domain, builders!inner(slug)')
        .eq('custom_domain', hostname)
        .maybeSingle()
      const slug = (data as unknown as { builders: { slug: string } } | null)?.builders?.slug ?? null
      return slug
    },
    staleTime: 1000 * 60 * 5,
  })
  return { slug: q.data ?? null, loading: q.isLoading }
}

export function App() {
  const { slug: customDomainSlug, loading } = useCustomDomainSlug()

  const router = useMemo(() => {
    const builderChildren = [
      { index: true, element: <BuilderHome /> },
      { path: 'platforms', element: <PlatformsPage /> },
      { path: 'process', element: <ProcessPage /> },
      { path: 'configure', element: <ConfigurePage /> },
      { path: 'reserve/success', element: <ReserveSuccess /> },
    ]

    const rootRoute = customDomainSlug
      ? { path: '/', element: <BuilderShell slugOverride={customDomainSlug} />, children: builderChildren }
      : { path: '/', element: <OperatorLanding /> }

    return createBrowserRouter([
      rootRoute,
      { path: '/b/:builderSlug', element: <BuilderShell />, children: builderChildren },
      { path: '/auth/login', element: <LoginPage /> },
      { path: '/auth/callback', element: <CallbackPage /> },
      { path: '/auth/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/auth/reset-password', element: <ResetPasswordPage /> },
      {
        element: <AuthGuard />,
        children: [
          {
            path: '/portal',
            element: <RoleGuard role="customer" />,
            children: [{ index: true, element: <PortalShell /> }],
          },
          {
            path: '/ops',
            element: <RoleGuard roles={['ops', 'operator']} />,
            children: [
              {
                element: <OpsShell />,
                children: [
                  { index: true, element: <CatalogPage /> },
                  { path: 'catalog', element: <CatalogPage /> },
                  { path: 'builds', element: <BuildsList /> },
                  { path: 'builds/:id', element: <BuildDetail /> },
                  {
                    path: 'builders',
                    element: <RoleGuard role="operator" />,
                    children: [
                      { index: true, element: <BuildersList /> },
                      { path: 'new', element: <BuilderWizard /> },
                    ],
                  },
                  { path: 'builders/:id/brand', element: <BrandEdit /> },
                  { path: 'builders/:id/terms', element: <TermsEdit /> },
                  { path: 'builders/:id/contract', element: <ContractEdit /> },
                ],
              },
            ],
          },
        ],
      },
    ])
  }, [customDomainSlug])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size={20} className="text-[var(--color-muted)]" />
      </div>
    )
  }

  return <RouterProvider router={router} />
}
