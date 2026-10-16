import { Navigate } from 'react-router'

// Phase 3: the operator-level root is a sign-in page only. The public
// per-builder landings live at /b/:slug.
export function OperatorLanding() {
  return <Navigate to="/auth/login" replace />
}
