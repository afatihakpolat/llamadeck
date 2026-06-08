/**
 * One-time migration: split resources/commands.json into
 *   - resources/commands/overlay.json  (curated metadata only)
 *   - resources/commands/b9202.json    (shipped structural snapshot)
 *
 * Run from the repo root with:  npx tsx scripts/migrate-commands-overlay.ts
 * (or compile and run with node)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { parseHelpOutput } from '../src/main/commandsSchemaParser'
import { StructuralSchema, OverlaySchema } from '../src/main/schemas'

const repoRoot = join(__dirname, '..')
const existingPath = join(repoRoot, 'resources', 'commands.json')
const helpFixturePath = join(repoRoot, 'src', 'main', '__tests__', 'fixtures', 'b9202-help.txt')
const overlayOutPath = join(repoRoot, 'resources', 'commands', 'overlay.json')
const snapshotOutPath = join(repoRoot, 'resources', 'commands', 'b9202.json')

if (!existsSync(existingPath)) {
  console.error(`Existing schema not found: ${existingPath}`)
  process.exit(1)
}
if (!existsSync(helpFixturePath)) {
  console.error(`Help fixture not found: ${helpFixturePath}`)
  process.exit(1)
}

const existing = JSON.parse(readFileSync(existingPath, 'utf-8'))

// 1) Build the overlay by extracting curated fields per arg.
const args: Record<string, any> = {}
for (const cat of existing.categories) {
  for (const cmd of cat.commands) {
    const entry: any = { label: cmd.label, category: cat.name, icon: cat.icon }
    if (cmd.placeholder) entry.placeholder = cmd.placeholder
    if (cmd.min !== undefined) entry.min = cmd.min
    if (cmd.max !== undefined) entry.max = cmd.max
    args[cmd.arg] = entry
  }
}

// 2) Section-to-category map. These are the only 4 sections the parser
//    produces; customisation requires editing overlay.json after migration.
const sectionMap = {
  'common params': { name: 'Performance', icon: 'Cpu' },
  'sampling params': { name: 'Sampling', icon: 'Sliders' },
  'speculative params': { name: 'Speculative Decoding', icon: 'GitBranch' },
  'example-specific params': { name: 'Server', icon: 'Server' }
}

const overlay = OverlaySchema.parse({ version: '1.0', sectionMap, args })

// 3) Run the parser against the b9202 help fixture to produce the snapshot.
const helpOutput = readFileSync(helpFixturePath, 'utf-8')
const commands = parseHelpOutput(helpOutput)
const sectionOrder = Object.keys(sectionMap)
const categories = sectionOrder.map(section => ({
  name: section,
  commands: commands.filter(c => c.section === section)
}))
const structural = StructuralSchema.parse({
  version: 'b9202',
  generatedAt: new Date().toISOString(),
  categories
})

// 4) Write outputs.
mkdirSync(join(repoRoot, 'resources', 'commands'), { recursive: true })
writeFileSync(overlayOutPath, JSON.stringify(overlay, null, 2))
writeFileSync(snapshotOutPath, JSON.stringify(structural, null, 2))

const overlayCount = Object.keys(overlay.args).length
const structCount = structural.categories.reduce((n, c) => n + c.commands.length, 0)
console.log(`Wrote ${overlayOutPath} (${overlayCount} curated args)`)
console.log(`Wrote ${snapshotOutPath} (${structCount} structural commands)`)
console.log('Next steps:')
console.log('  1. Verify the files look right')
console.log('  2. Delete resources/commands.json')
console.log('  3. Update src/main/ipc.ts to use the loader')
