/**
 * dsh-reactor — client entry (v0.3 widget)
 *
 * Mounts the floating widget directly into the page body, mirroring the
 * approach proven by dsh-cron-panel: the client plugin runs `ctx.effect`,
 * creates a plain DOM host, renders React into it via react-dom/client, and
 * appends it to `document.body`. The widget root uses `position: fixed`, so no
 * slot registration (slots/shell.overlay) is required — this avoids the
 * client-side slot chain entirely and works wherever the client bundle loads.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ReactorWidget } from './Widget.js'

/**
 * Client plugin entry.
 * @param ctx - the client Cordis context (browser side).
 */
export function apply(ctx: unknown): void {
  const c = ctx as {
    effect(cb: () => (() => void) | void): unknown
  }
  c.effect(() => {
    const host = document.createElement('div')
    host.dataset.reactorWidgetHost = ''
    const root = createRoot(host)
    root.render(React.createElement(ReactorWidget))
    document.body.appendChild(host)
    return () => {
      root.unmount()
      host.remove()
    }
  })
}

export default { apply }
