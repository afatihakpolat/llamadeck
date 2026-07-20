import { z } from 'zod'

const MAX_LITELLM_CONFIG_CHARACTERS = 1024 * 1024

export const LiteLlmConfigTextSchema = z.string().max(
  MAX_LITELLM_CONFIG_CHARACTERS,
  'LiteLLM config must be 1,048,576 characters or fewer.'
)

export const AgentHarnessIdSchema = z.enum(['codex', 'claude-code', 'gemini-cli', 'opencode'])
export const AgentSkillNameSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Skill names must use lowercase letters, numbers, and single hyphens.')
export const AgentSkillSourceIdSchema = z.string()
  .min(1)
  .max(160)
  .regex(/^(?:bundled|library):[a-z0-9]+(?:-[a-z0-9]+)*$/)
export const InstallAgentSkillInputSchema = z.object({
  harnessId: AgentHarnessIdSchema,
  sourceId: AgentSkillSourceIdSchema
}).strict()
export const RemoveAgentSkillInputSchema = z.object({
  harnessId: AgentHarnessIdSchema,
  skillName: AgentSkillNameSchema
}).strict()
export const DeleteAgentSkillSourceInputSchema = z.object({
  sourceId: AgentSkillSourceIdSchema
}).strict()
export const OpenAgentSkillsFolderInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('library') }).strict(),
  z.object({ kind: z.literal('harness'), harnessId: AgentHarnessIdSchema }).strict()
])

export const CommandTypeSchema = z.enum(['boolean', 'number', 'string', 'select', 'text'])
export type CommandType = z.infer<typeof CommandTypeSchema>

export const BackendBuildMetadataSchema = z.object({
  version: z.literal(1),
  flavor: z.literal('cuda'),
  buildMode: z.enum(['single', 'parallel'])
})
export type BackendBuildMetadata = z.infer<typeof BackendBuildMetadataSchema>

// Per-command structural shape produced by the parser.
export const CommandSchema = z.object({
  arg: z.string().regex(/^--[a-zA-Z][\w.-]*$/),
  short: z.string().regex(/^-[a-zA-Z0-9-]+$/).nullable().optional(),
  aliasLongs: z.array(z.string()).optional(),
  negationLongs: z.array(z.string()).optional(),
  negationShort: z.string().nullable().optional(),
  description: z.string(),
  type: CommandTypeSchema,
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  env: z.string().optional(),
  options: z.array(z.string()).optional(),
  deprecated: z.boolean().optional(),
  deprecationNote: z.string().optional(),
  section: z.string().optional()
})
export type Command = z.infer<typeof CommandSchema>

export const CommandCategorySchema = z.object({
  name: z.string(),
  commands: z.array(CommandSchema)
})

// Structural schema — the generator's output and the shipped snapshot's shape.
export const StructuralSchema = z.object({
  version: z.string(),
  generatedAt: z.string().optional(),
  categories: z.array(CommandCategorySchema)
})
export type StructuralSchemaType = z.infer<typeof StructuralSchema>

// Per-arg curated metadata, the overlay's atomic unit.
export const ArgOverlaySchema = z.object({
  label: z.string(),
  category: z.string(),
  icon: z.string(),
  placeholder: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional()
})
export type ArgOverlay = z.infer<typeof ArgOverlaySchema>

// The full overlay: section-to-category map + per-arg curated metadata.
export const OverlaySchema = z.object({
  version: z.literal('1.0'),
  sectionMap: z.record(z.string(), z.object({ name: z.string(), icon: z.string() })),
  args: z.record(z.string(), ArgOverlaySchema)
})
export type Overlay = z.infer<typeof OverlaySchema>

// The merged schema the renderer expects, matching the existing
// src/shared/types.ts CommandsSchema shape. Defined here for runtime
// validation when loading from disk.
export const MergedCommandSchema = CommandSchema.extend({
  label: z.string(),
  category: z.string().optional(),
  placeholder: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional()
})
export const MergedCategorySchema = z.object({
  name: z.string(),
  icon: z.string(),
  commands: z.array(MergedCommandSchema)
})
export const MergedSchema = z.object({
  version: z.string(),
  categories: z.array(MergedCategorySchema)
})
export type MergedCommandType = z.infer<typeof MergedCommandSchema>
export type MergedCategoryType = z.infer<typeof MergedCategorySchema>
export type MergedSchemaType = z.infer<typeof MergedSchema>
