import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'
import { App } from './App'
import './styles/tokens.css'

// After a deploy, lazy-loaded chunks from the previous build vanish and
// dynamic imports start throwing "Failed to fetch dynamically imported
// module". Vite emits a `vite:preloadError` event on window for exactly
// this; the fix is to reload the page once so the client picks up the
// current index.html + new asset hashes. We gate on sessionStorage so a
// persistently failing chunk doesn't infinite-loop reload — the sentinel
// clears a few seconds after a successful load, so later deploys in the
// same tab can still trigger one more reload.
const RELOAD_KEY = 'vite-preload-error-reloaded'

window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem(RELOAD_KEY)) return
  sessionStorage.setItem(RELOAD_KEY, '1')
  event.preventDefault()
  window.location.reload()
})

window.addEventListener('load', () => {
  setTimeout(() => sessionStorage.removeItem(RELOAD_KEY), 10_000)
})

const root = document.getElementById('root')
if (!root) throw new Error('No #root element')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
