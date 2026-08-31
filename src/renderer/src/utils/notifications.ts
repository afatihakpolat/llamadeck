export type NotificationTone = 'info' | 'success' | 'warning' | 'danger'

export interface AppNotificationInput {
  tone: NotificationTone
  title: string
  message?: string
  timeoutMs?: number
}

export interface AppNotification extends AppNotificationInput {
  id: string
  createdAt: number
  timeoutMs: number
}

let notificationSequence = 0

function getDefaultTimeout(tone: NotificationTone): number {
  if (tone === 'danger') return 10_000
  if (tone === 'warning') return 8_000
  return 6_000
}

export function createAppNotification(
  input: AppNotificationInput,
  createdAt = Date.now()
): AppNotification {
  notificationSequence += 1

  return {
    ...input,
    id: `notification-${createdAt}-${notificationSequence}`,
    createdAt,
    timeoutMs: input.timeoutMs ?? getDefaultTimeout(input.tone)
  }
}

export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === 'string' && error.trim()) return error.trim()

  try {
    const serialized = JSON.stringify(error)
    return serialized && serialized !== '{}' ? serialized : fallback
  } catch {
    return fallback
  }
}
