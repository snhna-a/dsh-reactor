import { execa } from 'execa'
import type { Action } from '../types.js'

/**
 * Replace {{payload.field}} placeholders in a template string with values from payload.
 */
export function interpolate(template: string, payload: unknown): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, path: string) => {
    const parts = path.trim().split('.')
    let cur: unknown = payload
    for (const p of parts) {
      if (cur == null) return ''
      cur = (cur as Record<string, unknown>)[p]
    }
    return String(cur ?? '')
  })
}

/** Execute a shell command action. Output is inherited (visible in dsh logs). */
export async function runShellAction(action: Action, payload: unknown): Promise<void> {
  const command = interpolate(action.target, payload)
  await execa(command, { shell: true, stdio: 'inherit' })
}
