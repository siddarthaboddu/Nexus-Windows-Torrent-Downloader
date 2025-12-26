import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

function ErrorFallback({ error }) {
  return (
    <div className="p-10 text-red-500 bg-zinc-900 border border-red-500/20 rounded-lg m-10">
      <h1 className="text-2xl font-bold mb-4">Application Error</h1>
      <pre className="whitespace-pre-wrap font-mono text-sm">{error.toString()}</pre>
      <pre className="mt-4 text-xs text-muted-foreground">{error.stack}</pre>
    </div>
  )
}

function Root() {
  const [error, setError] = useState(null)

  useEffect(() => {
    const handleError = (event) => {
      setError(event.error || new Error(event.message))
    }
    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', (e) => handleError({ error: e.reason }))

    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleError)
    }
  }, [])

  if (error) {
    return <ErrorFallback error={error} />
  }

  return <App />
}

import { ThemeProvider } from './contexts/ThemeProvider'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <Root />
    </ThemeProvider>
  </StrictMode>,
)
