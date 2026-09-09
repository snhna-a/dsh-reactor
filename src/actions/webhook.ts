import type { Action } from '../types.js'

/** POST a JSON payload to a webhook URL. */
export async function runWebhookAction(action: Action, payload: unknown): Promise<void> {
  const body = {
    ...(action.payload ?? {}),
    _reactor: {
      payload,
      triggeredAt: new Date().toISOString(),
    },
  }
  const res = await fetch(action.target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`webhook returned ${res.status} ${res.statusText}`)
  }
}
