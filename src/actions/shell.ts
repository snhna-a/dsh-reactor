import { execa } from 'execa'
import type { Action } from '../types.js'

/**
 * Replace {{payload.field}} / {{field}} placeholders in a template string
 * with values from the event payload. Both spellings are supported:
 * the leading `payload.` prefix is stripped when present.
 */
export function interpolate(template: string, payload: unknown): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, path: string) => {
    let p = path.trim()
    if (p.startsWith('payload.')) p = p.slice('payload.'.length)
    const parts = p.split('.')
    let cur: unknown = payload
    for (const part of parts) {
      if (cur == null) return ''
      cur = (cur as Record<string, unknown>)[part]
    }
    return String(cur ?? '')
  })
}

/** Execute a shell command action. Output is inherited (visible in dsh logs). */
export async function runShellAction(action: Action, payload: unknown): Promise<void> {
  const command = interpolate(action.target, payload)
  await execa(command, { shell: true, stdio: 'inherit' })
}
