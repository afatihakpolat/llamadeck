import { z } from 'zod'

export const UpdateStatusSchema = z.enum([
  'idle',
  'checking',
  'available',
  'not-available',
  'downloading',
  'downloaded',
  'error'
])
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>

export const UpdateInfoSchema = z.object({
  version: z.string(),
  releaseDate: z.string().optional(),
  releaseNotes: z.string().optional()
})
export type UpdateInfo = z.infer<typeof UpdateInfoSchema>

export const UpdateProgressSchema = z.object({
  percent: z.number(),
  bytesPerSecond: z.number(),
  transferred: z.number(),
  total: z.number()
})
export type UpdateProgress = z.infer<typeof UpdateProgressSchema>

export const UpdateStateSchema = z.object({
  status: UpdateStatusSchema,
  currentVersion: z.string(),
  available: UpdateInfoSchema.optional(),
  progress: UpdateProgressSchema.optional(),
  error: z.string().optional(),
  lastCheckedAt: z.string().optional()
})
export type UpdateState = z.infer<typeof UpdateStateSchema>

export const UpdatePreferencesSchema = z.object({
  checkOnLaunch: z.boolean(),
  autoDownload: z.boolean(),
  skippedVersion: z.string().optional()
})
export type UpdatePreferences = z.infer<typeof UpdatePreferencesSchema>