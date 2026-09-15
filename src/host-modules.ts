/**
 * dsh-reactor — host package resolver.
 *
 * The plugin may be installed two ways:
 *   1. Normally: copied into the profile's node_modules, where a bare
 *      `import('@deepseek-ai/dsh-agent')` resolves via standard Node lookup.
 *   2. Linked for development (npm link / "link:..." bundle): the plugin's
 *      physical files live OUTSIDE the profile tree (e.g. on Desktop), so a
 *      bare import cannot see the host's @deepseek-ai/* packages — they sit in
 *      the npx cache that launched `dsh web`, or in the profile node_modules.
 *
 * This resolver tries the bare specifier first, then a set of absolute
 * candidate roots derived from the running process, npx cache and DSH homes.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { globSync } from 'node:fs'

let cachedRoots: string[] | null = null

/** Resolve a package directory to its ESM entry file via package.json exports/main. */
function resolveEntry(pkgDir: string): string | null {
  const pjPath = join(pkgDir, 'package.json')
  if (!existsSync(pjPath)) return null
  try {
    const pj = JSON.parse(readFileSync(pjPath, 'utf8'))
    // exports: prefer "." import/default, then any "." condition
    const exp = pj.exports
    if (exp) {
      const dot = exp['.'] ?? exp
      if (typeof dot === 'string') return join(pkgDir, dot)
      if (dot && typeof dot === 'object') {
        const pick = dot.import?.default ?? dot.import ?? dot.default ?? dot.require
        if (pick) {
          const target = typeof pick === 'string' ? pick : pick.default
          if (target) return join(pkgDir, target)
        }
      }
    }
    if (typeof pj.module === 'string') return join(pkgDir, pj.module)
    if (typeof pj.main === 'string') return join(pkgDir, pj.main)
    // Convention fallback
    for (const cand of ['lib/index.js', 'dist/index.js', 'index.js']) {
      if (existsSync(join(pkgDir, cand))) return join(pkgDir, cand)
    }
  } catch {
    /* fall through */
  }
  return null
}

/** Collect every node_modules root that could hold @deepseek-ai/*. */
function candidateRoots(): string[] {
  if (cachedRoots) return cachedRoots
  const roots: string[] = []
  const push = (p?: string | null) => {
    if (p && !roots.includes(p)) roots.push(p)
  }

  // 1. Walk up from the process entry (npx cache layout: _npx/<hash>/node_modules/.bin/.. )
  const entry = process.argv[1] || ''
  if (entry) {
    let dir = entry
    for (let i = 0; i < 12; i++) {
      const idx = dir.lastIndexOf('node_modules')
      if (idx !== -1) {
        push(join(dir.slice(0, idx), 'node_modules'))
        break
      }
      const next = join(dir, '..')
      if (next === dir) break
      dir = next
    }
  }

  // 2. npx cache: %LOCALAPPDATA%/npm-cache/_npx/*/node_modules
  try {
    const cacheBase = process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'npm-cache', '_npx')
      : join(homedir(), 'AppData', 'Local', 'npm-cache', '_npx')
    if (existsSync(cacheBase)) {
      for (const hash of globSync('*/node_modules', { cwd: cacheBase, withFileTypes: false })) {
        push(join(cacheBase, hash))
      }
    }
  } catch {
    /* best-effort */
  }

  // 3. DSH profile node_modules: ~/.dsh/profiles/*/node_modules
  try {
    const profilesBase = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles')
    if (existsSync(profilesBase)) {
      for (const prof of globSync('*/node_modules', { cwd: profilesBase, withFileTypes: false })) {
        push(join(profilesBase, prof))
      }
    }
  } catch {
    /* best-effort */
  }

  // 4. Current working directory and its ancestors (covers running inside profile)
  push(join(process.cwd(), 'node_modules'))

  cachedRoots = roots
  return roots
}

/**
 * Import a host package by bare name, falling back to absolute candidate
 * roots. Returns the module namespace, or throws with a detailed message.
 */
export async function importHostPackage(specifier: string): Promise<any> {
  // 1. Bare specifier (normal install).
  try {
    return await import(/* @vite-ignore */ specifier)
  } catch {
    /* fall through to absolute candidates */
  }

  // 2. Absolute candidates.
  const errors: string[] = []
  for (const root of candidateRoots()) {
    const pkgDir = join(root, specifier)
    if (!existsSync(pkgDir)) continue
    // Resolve the package's ESM entry (directory import is not supported).
    const entry = resolveEntry(pkgDir)
    if (!entry) {
      errors.push(`${pkgDir}: no resolvable entry`)
      continue
    }
    try {
      const url = new URL(`file:///${entry.replace(/\\/g, '/')}`).href
      return await import(/* @vite-ignore */ url)
    } catch (err) {
      errors.push(`${entry}: ${(err as Error)?.message ?? err}`)
    }
  }

  throw new Error(
    `cannot resolve host package "${specifier}". roots tried: [${candidateRoots().join(', ')}]${
      errors.length ? '; errors: ' + errors.join(' | ') : ''
    }`,
  )
}
