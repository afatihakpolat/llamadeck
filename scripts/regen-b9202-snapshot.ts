/**
 * Regenerates resources/commands/b9202.json from the b9202 help fixture
 * using the current parser. Run with: npx tsx scripts/regen-b9202-snapshot.ts
 *
 * The overlay.json is not touched — it has only curated metadata
 * (label, category, icon, placeholder, min, max) which doesn't depend on
 * the parser.
 */

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { parseHelpOutput } from '../src/main/commandsSchemaParser'
import { StructuralSchema } from '../src/main/schemas'

const repoRoot = join(__dirname, '..')
const helpFixturePath = join(repoRoot, 'src', 'main', '__tests__', 'fixtures', 'b9202-help.txt')
const snapshotOutPath = join(repoRoot, 'resources', 'commands', 'b9202.json')

const helpOutput = readFileSync(helpFixturePath, 'utf-8')
const commands = parseHelpOutput(helpOutput)

const sectionOrder = ['common params', 'sampling params', 'speculative params', 'example-specific params']
const categories = sectionOrder.map(section => ({
  name: section,
  commands: commands.filter(c => c.section === section)
}))

const structural = StructuralSchema.parse({
  version: 'b9202',
  generatedAt: new Date().toISOString(),
  categories
})

writeFileSync(snapshotOutPath, JSON.stringify(structural, null, 2))

const total = structural.categories.reduce((n, c) => n + c.commands.length, 0)
const withOptions = structural.categories.reduce(
  (n, c) => n + c.commands.filter(cmd => cmd.options).length, 0
)
console.log(`Regenerated ${snapshotOutPath}`)
console.log(`  ${total} total commands, ${withOptions} with select options`)
