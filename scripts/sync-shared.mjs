// Copies shared/ into <mod>/hooks/shared/ for each marketplace plugin with a
// hooks module, so no mod needs another installed. --check writes nothing and
// fails when a copy differs.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isCheck = process.argv.includes('--check')

const marketplace = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'))
const mods = marketplace.plugins.map(plugin => plugin.source).filter(hasHooksModule)
const files = readdirSync(join(root, 'shared'))

function hasHooksModule(source) {
  const hooks = join(root, source, 'hooks', 'hooks.json')
  return existsSync(hooks) && Array.isArray(JSON.parse(readFileSync(hooks, 'utf8')).modules)
}

let differing = 0
for (const mod of mods) {
  for (const file of files) {
    const source = readFileSync(join(root, 'shared', file), 'utf8')
    const target = join(root, mod, 'hooks', 'shared', file)
    if (existsSync(target) && readFileSync(target, 'utf8') === source) continue
    if (isCheck) {
      console.error(`${join(mod, 'hooks', 'shared', file)} differs from shared/${file}`)
      differing += 1
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, source)
    console.log(`wrote ${join(mod, 'hooks', 'shared', file)}`)
  }
}
process.exit(differing === 0 ? 0 : 1)
