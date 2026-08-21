#!/usr/bin/env node
/**
 * Repoint the pnpm overrides for the @mlightcad data-model package tree
 * (data-model, common, geometry-engine, graphic-interface) from the npm
 * registry to a local realdwg-web checkout, or back.
 *
 * The local checkout must be built first:
 *   cd ../realdwg-web && pnpm install && pnpm --filter @mlightcad/common build \
 *     && pnpm --filter @mlightcad/geometry-engine build \
 *     && pnpm --filter @mlightcad/graphic-interface build \
 *     && pnpm --filter @mlightcad/data-model build
 *
 * Usage (from repo root):
 *   node tools/use-local-realdwg.mjs            # switch to local checkout
 *   node tools/use-local-realdwg.mjs --off      # switch back to npm
 *   REALDWG_WEB_DIR=../../realdwg-web node tools/use-local-realdwg.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const toolsDir = dirname(fileURLToPath(import.meta.url))
const rootDir = join(toolsDir, '..')
const workspaceFile = join(rootDir, 'pnpm-workspace.yaml')

const LOCAL_PACKAGES = [
  '@mlightcad/common',
  '@mlightcad/geometry-engine',
  '@mlightcad/graphic-interface',
  '@mlightcad/data-model'
]

const DATA_MODEL_NPM_RANGE = "'^1.13.0'"

function localRealdwgDir() {
  const fromEnv = process.env.REALDWG_WEB_DIR
  const target = resolve(rootDir, fromEnv ?? '../realdwg-web')
  if (!existsSync(target)) {
    throw new Error(
      `Local realdwg-web checkout not found at ${target}. ` +
        `Point REALDWG_WEB_DIR at it (defaults to ../realdwg-web).`
    )
  }
  return target
}

function localOverrideFor(packageName, realdwgDir) {
  const pkgDir = join(realdwgDir, 'packages', packageName.split('/')[1])
  if (!existsSync(pkgDir)) {
    throw new Error(`Local package ${packageName} not found at ${pkgDir}`)
  }
  const rel = relative(rootDir, pkgDir).replaceAll('\\', '/')
  // link: keeps cad-viewer pointing at the live source dir, so rebuilds in
  // realdwg-web are picked up without re-running pnpm install in cad-viewer.
  return `'link:${rel}'`
}

function switchToLocal(content, realdwgDir) {
  let next = content
  // Remove any pre-existing local overrides first so re-running the tool is
  // idempotent (the workspace file may already be committed in local mode).
  next = next.replace(
    /^  '@mlightcad\/(?:common|geometry-engine|graphic-interface)': '(?:link|file):[^']*'[^\n]*\n?/gm,
    ''
  )
  // Replace the data-model override line with the full local package set.
  // The regex keeps the original 2-space indentation, so the first entry
  // carries no indent and the following ones use the same 2-space prefix.
  const localLines = LOCAL_PACKAGES.map(
    (name, i) =>
      `${i === 0 ? '' : '  '}'${name}': ${localOverrideFor(name, realdwgDir)}`
  ).join('\n')
  next = next.replace(
    /(['"]?@mlightcad\/data-model['"]?\s*:\s*)(['"]).*?\2/,
    localLines
  )
  if (next === content) {
    // Unchanged because the file is already in local mode (the idempotent
    // cleanup above is a no-op), or because the override key is missing.
    if (/['"]?@mlightcad\/data-model['"]?\s*:/.test(next)) {
      return next
    }
    throw new Error(
      'No @mlightcad/data-model override found in pnpm-workspace.yaml'
    )
  }
  return next
}

function switchToNpm(content) {
  const localLine = /^  '(@mlightcad\/(?:common|geometry-engine|graphic-interface))': '(?:link|file):[^']*'[^\n]*\n?/gm
  const withoutSiblings = content.replace(localLine, '')
  const next = withoutSiblings.replace(
    /(['"]?@mlightcad\/data-model['"]?\s*:\s*)(['"]).*?\2/,
    `$1${DATA_MODEL_NPM_RANGE}`
  )
  if (next === content) {
    throw new Error(
      'No @mlightcad/data-model override found in pnpm-workspace.yaml'
    )
  }
  return next
}

function main() {
  const mode = process.argv.includes('--off') ? 'off' : 'on'
  const original = readFileSync(workspaceFile, 'utf8')

  if (mode === 'on') {
    const realdwgDir = localRealdwgDir()
    console.log(`Switching pnpm overrides to local realdwg-web at ${realdwgDir}`)
    const next = switchToLocal(original, realdwgDir)
    if (next === original) {
      console.log('  already using local overrides')
      return
    }
    writeFileSync(workspaceFile, next, 'utf8')
    console.log('  updated pnpm-workspace.yaml')
    console.log('\nNext: pnpm install, then verify with: pnpm why @mlightcad/data-model')
  } else {
    console.log('Switching pnpm overrides back to the npm registry')
    const next = switchToNpm(original)
    if (next === original) {
      console.log('  already using npm overrides')
      return
    }
    writeFileSync(workspaceFile, next, 'utf8')
    console.log('  updated pnpm-workspace.yaml')
    console.log('\nNext: pnpm install')
  }
}

main()
