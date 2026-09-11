import React, { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './contexts/ThemeProvider'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
          <div className="max-w-xl w-full p-6 bg-card border border-destructive/40 rounded-xl shadow-2xl">
            <h1 className="text-xl font-bold text-destructive mb-2">Application Error</h1>
            <p className="text-sm text-muted-foreground mb-4">Nexus encountered an unexpected error:</p>
            <pre className="p-3 bg-secondary/80 rounded-lg font-mono text-xs text-destructive overflow-auto max-h-48 whitespace-pre-wrap">
              {this.state.error?.toString()}
            </pre>
            {this.state.error?.stack && (
              <pre className="mt-2 p-3 bg-secondary/40 rounded-lg font-mono text-[11px] text-muted-foreground overflow-auto max-h-48 whitespace-pre-wrap">
                {this.state.error.stack}
              </pre>
            )}
            <button
              onClick={() => window.location.reload()}
              className="mt-6 px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
