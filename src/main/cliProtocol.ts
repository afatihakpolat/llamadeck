import { z } from 'zod'

export const CLI_PROTOCOL_VERSION = 1
export const CLI_MAX_REQUEST_BYTES = 1024 * 1024

export const CliCommandNameSchema = z.enum([
  'app.show',
  'backend.list',
  'backend.use',
  'capabilities',
  'litellm.configGet',
  'litellm.configSet',
  'litellm.configValidate',
  'litellm.install',
  'litellm.logs',
  'litellm.models',
  'litellm.restart',
  'litellm.start',
  'litellm.status',
  'litellm.stop',
  'litellm.test',
  'litellm.update',
  'status',
  'template.create',
  'template.delete',
  'template.list',
  'template.get',
  'template.logs',
  'template.start',
  'template.stop',
  'template.update',
  'template.validate',
  'template.waitReady',
  'version'
])

export type CliCommandName = z.infer<typeof CliCommandNameSchema>

export const CliRequestSchema = z.object({
  protocol: z.literal(CLI_PROTOCOL_VERSION),
  token: z.string().min(1).max(256),
  command: CliCommandNameSchema,
  args: z.array(z.string().max(512 * 1024)).max(16)
})

export type CliRequest = z.infer<typeof CliRequestSchema>

export type CliResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: string; exitCode: number; code?: string }

export interface CliEndpointDescriptor {
  protocol: typeof CLI_PROTOCOL_VERSION
  pipeId: string
  token: string
  pid: number
}
