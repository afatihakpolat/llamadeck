import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AppErrorBoundary from './components/AppErrorBoundary'
import NotificationCenter from './components/NotificationCenter'
import UnhandledErrorReporter from './components/UnhandledErrorReporter'
import './styles/global.css'
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
    <UnhandledErrorReporter />
    <NotificationCenter />
  </React.StrictMode>
)
