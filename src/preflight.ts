/**
 * dsh-reactor v0.12.3 — Runtime Capability Preflight
 *
 * Before spinning up an isolated Agent Session, check what the host can
 * actually do. If the rule needs shell/git/network and the host can't provide
 * it, block with 0 tokens instead of burning a silent 60s hang while the
 * Agent flails against ENOENT / not-found errors.
 */
import { existsSync, readdirSync, accessSync, constants, writeFileSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createConnection } from 'node:net'
import type { CapabilityKind, PreflightResult, RuntimeCapabilities } from './types.js'

/** Probe one capability; never throws — returns false with a note on failure. */
async function probe(cwd: string): Promise<RuntimeCapabilities> {
  const caps: RuntimeCapabilities = {
    workspace: false,
    filesystemRead: false,
    filesystemWrite: false,
    shell: false,
    git: false,
    network: false,
    notes: {},
  }

  // workspace + fs read
  try {
    if (existsSync(cwd)) {
      caps.workspace = true
      accessSync(cwd, constants.R_OK)
      caps.filesystemRead = true
      readdirSync(cwd)
    } else {
      caps.notes!.workspace = `not found: ${cwd}`
    }
  } catch (e: any) {
    caps.notes!.workspace = String(e?.message ?? e)
  }

  // fs write (best-effort probe file)
  try {
    if (caps.workspace) {
      const probeFile = `${cwd}/.reactor-preflight-probe`
      writeFileSync(probeFile, 'probe', 'utf8')
      unlinkSync(probeFile)
      caps.filesystemWrite = true
    }
  } catch (e: any) {
    caps.notes!.filesystemWrite = String(e?.message ?? e)
  }

  // shell
  try {
    execFileSync(process.platform === 'win32' ? 'cmd.exe' : 'echo',
      process.platform === 'win32' ? ['/c', 'echo ok'] : ['ok'],
      { timeout: 3000, stdio: 'ignore' })
    caps.shell = true
  } catch (e: any) {
    caps.notes!.shell = String(e?.message ?? e)
  }

  // git
  try {
    execFileSync('git', ['--version'], { timeout: 3000, stdio: 'ignore' })
    caps.git = true
  } catch (e: any) {
    caps.notes!.git = String(e?.message ?? e)
  }

  // network: TCP connect to github.com:443
  try {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = createConnection(443, 'github.com')
      const t = setTimeout(() => { sock.destroy(); resolve(false) }, 3000)
      sock.on('connect', () => { clearTimeout(t); sock.end(); resolve(true) })
      sock.on('error', () => { clearTimeout(t); resolve(false) })
    })
    caps.network = ok
    if (!ok) caps.notes!.network = 'tcp connect to github.com:443 timed out/refused'
  } catch (e: any) {
    caps.notes!.network = String(e?.message ?? e)
  }

  return caps
}

/**
 * Run preflight: compare required capabilities against what the host offers.
 */
export async function runPreflight(
  cwd: string,
  required: CapabilityKind[] | undefined,
): Promise<PreflightResult> {
  const caps = await probe(cwd)
  if (!required || required.length === 0) {
    if (!caps.workspace) {
      return { ok: false, missing: ['workspace'], reason: 'WORKSPACE_NOT_FOUND', caps }
    }
    return { ok: true, caps }
  }
  const missing: CapabilityKind[] = []
  for (const need of required) {
    if (!caps[need]) missing.push(need)
  }
  if (missing.length > 0) {
    return { ok: false, missing, reason: 'HOST_CAPABILITY_MISSING', caps }
  }
  return { ok: true, caps }
}
