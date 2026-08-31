import React, { useEffect } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useStore } from '../store/useStore'
import type { AppNotification, NotificationTone } from '../utils/notifications'

function NotificationIcon({ tone }: { tone: NotificationTone }) {
  if (tone === 'success') return <CheckCircle2 size={17} />
  if (tone === 'warning') return <AlertTriangle size={17} />
  if (tone === 'danger') return <XCircle size={17} />
  return <Info size={17} />
}

function NotificationToast({ notification }: { notification: AppNotification }) {
  const dismissNotification = useStore((state) => state.dismissNotification)

  useEffect(() => {
    if (notification.timeoutMs <= 0) return

    const timer = window.setTimeout(() => {
      dismissNotification(notification.id)
    }, notification.timeoutMs)

    return () => window.clearTimeout(timer)
  }, [dismissNotification, notification.id, notification.timeoutMs])

  return (
    <article
      className={`app-notification ${notification.tone}`}
      role={notification.tone === 'danger' ? 'alert' : 'status'}
      aria-live={notification.tone === 'danger' ? 'assertive' : 'polite'}
    >
      <span className="app-notification-icon"><NotificationIcon tone={notification.tone} /></span>
      <span className="app-notification-copy">
        <strong>{notification.title}</strong>
        {notification.message ? <span>{notification.message}</span> : null}
      </span>
      <button
        type="button"
        className="app-notification-dismiss"
        onClick={() => dismissNotification(notification.id)}
        aria-label={`Dismiss ${notification.title}`}
      >
        <X size={15} />
      </button>
    </article>
  )
}

export default function NotificationCenter() {
  const notifications = useStore((state) => state.notifications)

  if (notifications.length === 0) return null

  return (
    <aside className="app-notification-center" aria-label="Application notifications">
      {notifications.map((notification) => (
        <NotificationToast key={notification.id} notification={notification} />
      ))}
    </aside>
  )
}
