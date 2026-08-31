import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { getErrorMessage } from '../utils/notifications'

export default function UnhandledErrorReporter() {
  const pushNotification = useStore((state) => state.pushNotification)

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      pushNotification({
        tone: 'danger',
        title: 'Unexpected background error',
        message: getErrorMessage(event.error ?? event.message)
      })
    }

    const handleRejection = (event: PromiseRejectionEvent) => {
      pushNotification({
        tone: 'danger',
        title: 'Background task failed',
        message: getErrorMessage(event.reason)
      })
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)
    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
    }
  }, [pushNotification])

  return null
}
