import type {
  UsageSessionRollup,
  UsageSummaryRollup,
  UsageTemplateRollup
} from '../../../shared/types'
import { getTemplateModelFolder } from './templateGrouping'

// A "model" in LlamaDeck is the leaf folder that holds the GGUF file(s) for a
// model family. Templates that point at different files inside the same folder
// (different quantizations, variants) belong to the same model group, mirroring
// the grouping used on the Templates screen (see groupTemplatesByModelFolder).

export const UNASSIGNED_MODEL_GROUP_KEY = 'unassigned'
export const UNASSIGNED_MODEL_GROUP_LABEL = 'No model selected'

export type UsageSessionSortKey = 'activity' | 'tokens' | 'requests' | 'duration'
export type UsageSessionGroupSortKey = UsageSessionSortKey | 'cost'
export type UsageTemplateGroupSortKey = 'activity' | 'tokens' | 'requests' | 'cost'

interface SortNodeAccessors<T> {
  label: (node: T) => string
  requestCount: (node: T) => number
  totalTokens: (node: T) => number
  lastActivityAt: (node: T) => string | undefined
  durationMs?: (node: T) => number
}

export interface UsageSessionTemplateGroup extends UsageSummaryRollup {
  templateId: string
  templateName: string
  // Captured from the sessions; keeps model-level pricing resolvable even when
  // the underlying template no longer exists.
  modelPath?: string
  modelFileName: string | null
  sessionCount: number
  durationMs: number
  lastActivityAt?: string
  sessions: UsageSessionRollup[]
}

export interface UsageSessionModelGroup extends UsageSummaryRollup {
  key: string
  label: string
  templateCount: number
  sessionCount: number
  durationMs: number
  lastActivityAt?: string
  templates: UsageSessionTemplateGroup[]
}

export interface UsageTemplateModelGroup extends UsageSummaryRollup {
  key: string
  label: string
  templateCount: number
  lastRequestAt?: string
  templates: UsageTemplateRollup[]
}

export function getModelGroupKey(modelPath?: string): string {
  const folderName = getTemplateModelFolder(modelPath)
  return folderName ? `model:${folderName.toLowerCase()}` : UNASSIGNED_MODEL_GROUP_KEY
}

export function getModelGroupLabel(modelPath?: string): string {
  return getTemplateModelFolder(modelPath) ?? UNASSIGNED_MODEL_GROUP_LABEL
}

export function getModelFileName(modelPath?: string): string | null {
  const normalizedPath = modelPath?.trim().replace(/\\/g, '/')
  if (!normalizedPath) return null

  const segments = normalizedPath.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? null
}

export function getUsageTimestampValue(timestamp?: string): number {
  if (!timestamp) return 0
  const value = new Date(timestamp).getTime()
  return Number.isFinite(value) ? value : 0
}

export function getSessionActivityTimestamp(session: UsageSessionRollup): string {
  return session.windowLastRequestAt
    ?? session.lastRequestAt
    ?? session.windowEndedAt
    ?? session.stoppedAt
    ?? session.windowStartedAt
    ?? session.startedAt
}

export function getSessionDurationMs(session: UsageSessionRollup): number {
  const startedAt = getUsageTimestampValue(session.windowStartedAt ?? session.startedAt)
  const endedAt = getUsageTimestampValue(
    session.windowEndedAt
      ?? session.windowLastRequestAt
      ?? session.stoppedAt
      ?? session.lastRequestAt
      ?? session.windowStartedAt
      ?? session.startedAt
  )

  if (!startedAt || !endedAt || endedAt <= startedAt) {
    return 0
  }

  return endedAt - startedAt
}

export function zeroSummary(): UsageSummaryRollup {
  return {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    exactUsageCount: 0,
    promptTokens: 0,
    cacheTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  }
}

export function mergeSummary(target: UsageSummaryRollup, source: UsageSummaryRollup): void {
  target.requestCount += source.requestCount
  target.successCount += source.successCount
  target.errorCount += source.errorCount
  target.exactUsageCount += source.exactUsageCount
  target.promptTokens += source.promptTokens
  target.cacheTokens += source.cacheTokens
  target.completionTokens += source.completionTokens
  target.totalTokens += source.totalTokens
}

function compareSortNodes<T>(
  left: T,
  right: T,
  sortKey: UsageSessionGroupSortKey,
  accessors: SortNodeAccessors<T>,
  costOf: (node: T) => number,
  isUnassigned: (node: T) => boolean
): number {
  const leftUnassigned = isUnassigned(left)
  const rightUnassigned = isUnassigned(right)
  if (leftUnassigned !== rightUnassigned) {
    return leftUnassigned ? 1 : -1
  }

  const leftCost = sortKey === 'cost' ? costOf(left) : 0
  const rightCost = sortKey === 'cost' ? costOf(right) : 0
  const leftActivity = getUsageTimestampValue(accessors.lastActivityAt(left))
  const rightActivity = getUsageTimestampValue(accessors.lastActivityAt(right))
  const leftDuration = accessors.durationMs ? accessors.durationMs(left) : 0
  const rightDuration = accessors.durationMs ? accessors.durationMs(right) : 0
  const leftTotalTokens = accessors.totalTokens(left)
  const rightTotalTokens = accessors.totalTokens(right)
  const leftRequestCount = accessors.requestCount(left)
  const rightRequestCount = accessors.requestCount(right)
  const labelDifference = accessors.label(left).localeCompare(accessors.label(right))

  if (sortKey === 'cost') {
    return (rightCost - leftCost)
      || (rightRequestCount - leftRequestCount)
      || (rightActivity - leftActivity)
      || labelDifference
  }

  if (sortKey === 'requests') {
    return (rightRequestCount - leftRequestCount)
      || (rightTotalTokens - leftTotalTokens)
      || (rightActivity - leftActivity)
      || labelDifference
  }

  if (sortKey === 'duration') {
    return (rightDuration - leftDuration)
      || (rightTotalTokens - leftTotalTokens)
      || (rightRequestCount - leftRequestCount)
      || labelDifference
  }

  if (sortKey === 'activity') {
    return (rightActivity - leftActivity)
      || (rightTotalTokens - leftTotalTokens)
      || (rightRequestCount - leftRequestCount)
      || labelDifference
  }

  return (rightTotalTokens - leftTotalTokens)
    || (rightRequestCount - leftRequestCount)
    || (rightActivity - leftActivity)
    || labelDifference
}

function updateLastActivity(target: { lastActivityAt?: string }, session: UsageSessionRollup): void {
  const activityAt = getSessionActivityTimestamp(session)
  if (!target.lastActivityAt || getUsageTimestampValue(target.lastActivityAt) < getUsageTimestampValue(activityAt)) {
    target.lastActivityAt = activityAt
  }
}

function createEmptySessionTemplateGroup(session: UsageSessionRollup): UsageSessionTemplateGroup {
  return {
    templateId: session.templateId,
    templateName: session.templateName,
    modelPath: session.modelPath,
    modelFileName: getModelFileName(session.modelPath),
    sessionCount: 0,
    durationMs: 0,
    lastActivityAt: getSessionActivityTimestamp(session),
    sessions: [],
    ...zeroSummary()
  }
}

export function buildSessionModelGroups(sessions: UsageSessionRollup[]): UsageSessionModelGroup[] {
  const groups = new Map<string, UsageSessionModelGroup>()
  const templateGroups = new Map<string, UsageSessionTemplateGroup>()

  for (const session of sessions) {
    const key = getModelGroupKey(session.modelPath)
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        label: getModelGroupLabel(session.modelPath),
        templateCount: 0,
        sessionCount: 0,
        durationMs: 0,
        lastActivityAt: getSessionActivityTimestamp(session),
        templates: [],
        ...zeroSummary()
      }
      groups.set(key, group)
    }

    const templateKey = `${key}::${session.templateId}`
    let templateGroup = templateGroups.get(templateKey)
    if (!templateGroup) {
      templateGroup = createEmptySessionTemplateGroup(session)
      templateGroups.set(templateKey, templateGroup)
      group.templateCount += 1
      group.templates.push(templateGroup)
    }

    if (!templateGroup.modelPath && session.modelPath) {
      templateGroup.modelPath = session.modelPath
    }
    if (!templateGroup.modelFileName && session.modelPath) {
      templateGroup.modelFileName = getModelFileName(session.modelPath)
    }

    templateGroup.sessionCount += 1
    templateGroup.durationMs += getSessionDurationMs(session)
    mergeSummary(templateGroup, session)
    updateLastActivity(templateGroup, session)
    templateGroup.sessions.push(session)

    group.sessionCount += 1
    group.durationMs += getSessionDurationMs(session)
    mergeSummary(group, session)
    updateLastActivity(group, session)
  }

  return Array.from(groups.values())
}

export function sortSessionRollupsBy(sessions: UsageSessionRollup[], sortKey: UsageSessionSortKey): UsageSessionRollup[] {
  const byActivity = (left: UsageSessionRollup, right: UsageSessionRollup): number =>
    getUsageTimestampValue(getSessionActivityTimestamp(right)) - getUsageTimestampValue(getSessionActivityTimestamp(left))

  return [...sessions].sort((left, right) => {
    switch (sortKey) {
      case 'tokens':
        return right.totalTokens - left.totalTokens
          || right.requestCount - left.requestCount
          || byActivity(left, right)
      case 'requests':
        return right.requestCount - left.requestCount
          || right.totalTokens - left.totalTokens
          || byActivity(left, right)
      case 'duration':
        return getSessionDurationMs(right) - getSessionDurationMs(left)
          || right.totalTokens - left.totalTokens
          || right.requestCount - left.requestCount
      default:
        return byActivity(left, right)
          || right.totalTokens - left.totalTokens
          || right.requestCount - left.requestCount
    }
  })
}

function sortSessionRollupsByCost(sessions: UsageSessionRollup[], costOfSession: (session: UsageSessionRollup) => number): UsageSessionRollup[] {
  return [...sessions].sort((left, right) =>
    costOfSession(right) - costOfSession(left)
      || right.requestCount - left.requestCount
      || (getUsageTimestampValue(getSessionActivityTimestamp(right)) - getUsageTimestampValue(getSessionActivityTimestamp(left)))
  )
}

export function sortSessionTemplateGroups(
  groups: UsageSessionTemplateGroup[],
  sortKey: UsageSessionGroupSortKey,
  costOfTemplate?: (group: UsageSessionTemplateGroup) => number
): UsageSessionTemplateGroup[] {
  return [...groups].sort((left, right) =>
    compareSortNodes(
      left,
      right,
      sortKey,
      {
        label: (node) => node.templateName,
        requestCount: (node) => node.requestCount,
        totalTokens: (node) => node.totalTokens,
        lastActivityAt: (node) => node.lastActivityAt,
        durationMs: (node) => node.durationMs
      },
      (node) => (costOfTemplate ? costOfTemplate(node) : 0),
      () => false
    )
  )
}

export function sortSessionModelGroups(
  groups: UsageSessionModelGroup[],
  sortKey: UsageSessionGroupSortKey,
  costOfGroup?: (group: UsageSessionModelGroup) => number
): UsageSessionModelGroup[] {
  return [...groups].sort((left, right) =>
    compareSortNodes(
      left,
      right,
      sortKey,
      {
        label: (node) => node.label,
        requestCount: (node) => node.requestCount,
        totalTokens: (node) => node.totalTokens,
        lastActivityAt: (node) => node.lastActivityAt,
        durationMs: (node) => node.durationMs
      },
      (node) => (costOfGroup ? costOfGroup(node) : 0),
      (node) => node.key === UNASSIGNED_MODEL_GROUP_KEY
    )
  )
}

function sumTemplateCosts(group: UsageSessionModelGroup, costOfTemplate?: (template: UsageSessionTemplateGroup) => number): number {
  if (!costOfTemplate) return 0
  return group.templates.reduce((total, template) => total + costOfTemplate(template), 0)
}

export interface SessionModelGroupSortOptions {
  costOfTemplate?: (template: UsageSessionTemplateGroup) => number
  costOfSession?: (session: UsageSessionRollup) => number
}

export function buildSortedSessionModelGroups(
  sessions: UsageSessionRollup[],
  sortKey: UsageSessionGroupSortKey,
  costOptions?: SessionModelGroupSortOptions
): UsageSessionModelGroup[] {
  const baseKey: UsageSessionSortKey = sortKey === 'cost' ? 'tokens' : sortKey
  // In cost mode the nested template rows follow the same axis as the rows
  // around them (most expensive template first), mirroring the pre-existing
  // flat "group by template" cost sort.
  const templateKey: UsageSessionGroupSortKey = sortKey === 'cost' ? 'cost' : baseKey
  const groups = buildSessionModelGroups(sessions)

  for (const group of groups) {
    group.templates = sortSessionTemplateGroups(group.templates, templateKey, costOptions?.costOfTemplate)
    for (const template of group.templates) {
      template.sessions = sortKey === 'cost' && costOptions?.costOfSession
        ? sortSessionRollupsByCost(template.sessions, costOptions.costOfSession)
        : sortSessionRollupsBy(template.sessions, baseKey)
    }
  }

  return sortSessionModelGroups(groups, sortKey, (group) => sumTemplateCosts(group, costOptions?.costOfTemplate))
}

export function buildTemplateModelGroups(rollups: UsageTemplateRollup[]): UsageTemplateModelGroup[] {
  const groups = new Map<string, UsageTemplateModelGroup>()

  for (const rollup of rollups) {
    const key = getModelGroupKey(rollup.modelPath)
    const group = groups.get(key) ?? {
      key,
      label: getModelGroupLabel(rollup.modelPath),
      templateCount: 0,
      lastRequestAt: rollup.lastRequestAt,
      templates: [],
      ...zeroSummary()
    }

    group.templateCount += 1
    group.templates.push(rollup)
    mergeSummary(group, rollup)
    if (!group.lastRequestAt || (rollup.lastRequestAt && rollup.lastRequestAt > group.lastRequestAt)) {
      group.lastRequestAt = rollup.lastRequestAt
    }
    groups.set(key, group)
  }

  return Array.from(groups.values())
}

export function sortUsageTemplateRollups(
  rollups: UsageTemplateRollup[],
  sortKey: UsageTemplateGroupSortKey,
  costOfRollup?: (rollup: UsageTemplateRollup) => number
): UsageTemplateRollup[] {
  return [...rollups].sort((left, right) =>
    compareSortNodes(
      left,
      right,
      sortKey,
      {
        label: (node) => node.templateName,
        requestCount: (node) => node.requestCount,
        totalTokens: (node) => node.totalTokens,
        lastActivityAt: (node) => node.lastRequestAt
      },
      (node) => (costOfRollup ? costOfRollup(node) : 0),
      () => false
    )
  )
}

export function sortTemplateModelGroups(
  groups: UsageTemplateModelGroup[],
  sortKey: UsageTemplateGroupSortKey,
  costOfGroup?: (group: UsageTemplateModelGroup) => number
): UsageTemplateModelGroup[] {
  return [...groups].sort((left, right) =>
    compareSortNodes(
      left,
      right,
      sortKey,
      {
        label: (node) => node.label,
        requestCount: (node) => node.requestCount,
        totalTokens: (node) => node.totalTokens,
        lastActivityAt: (node) => node.lastRequestAt
      },
      (node) => (costOfGroup ? costOfGroup(node) : 0),
      (node) => node.key === UNASSIGNED_MODEL_GROUP_KEY
    )
  )
}

export function buildSortedTemplateModelGroups(
  rollups: UsageTemplateRollup[],
  sortKey: UsageTemplateGroupSortKey = 'tokens',
  costOfRollup?: (rollup: UsageTemplateRollup) => number
): UsageTemplateModelGroup[] {
  const groups = buildTemplateModelGroups(rollups)

  for (const group of groups) {
    group.templates = sortUsageTemplateRollups(group.templates, sortKey, costOfRollup)
  }

  return sortTemplateModelGroups(
    groups,
    sortKey,
    (group) => group.templates.reduce((total, rollup) => total + (costOfRollup ? costOfRollup(rollup) : 0), 0)
  )
}
