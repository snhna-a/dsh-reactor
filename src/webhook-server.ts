/**
 * dsh-reactor — webhook ingress endpoint (P1-2)
 *
 * Registers an exact HTTP route on the injected `webServer` (when present).
 * Any POST with a JSON body becomes an event payload delivered to the engine,
 * where rules whose source.kind === 'webhook' evaluate conditions and run
 * their actions. This lets external systems PUSH events into dsh-reactor
 * instead of relying on polling alone.
 *
 * HTTP contract:
 *   POST <path>  (application/json)
 *   202 Accepted — event dispatched (evaluated asynchronously)
 *   400 Bad Request — missing/invalid JSON body
 *   401 Unauthorized — token mismatch (when token configured)
 *   405 Method Not Allowed — not POST
 *   413 Payload Too Large — body exceeds maxBodyBytes
 *   415 Unsupported Media Type — content-type is not application/json
 *   503 Service Unavailable — engine unavailable
 */
import type { Context } from '@deepseek-ai/cordis'

export interface WebhookIngressConfig {
  /** Exact absolute path (starts with '/', no trailing slash). */
  path: string
  /** Optional shared token; when set, requires header x-reactor-token to match. */
  token?: string
  /** Body ceiling in bytes. Default 1 MiB. */
  maxBodyBytes?: number
}

/** Minimal shapes of the injected webServer service and HTTP request/response. */
interface HttpRequest {
  method?: string
  headers?: Record<string, string | string[] | undefined>
  headersDistinct?: Record<string, string[] | undefined>
  [Symbol.asyncIterator](): AsyncIterator<Buffer | string>
}

interface HttpResponse {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
  setHeader?(name: string, value: string): void
}

interface WebServerLike {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: HttpRequest, res: HttpResponse) => Promise<void> | void
  }): () => void
}

/** Read a bounded UTF-8 body from the request stream. */
async function readBoundedBody(req: HttpRequest, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    size += chunk.byteLength
    if (size > maxBytes) {
      throw Object.assign(new Error('request body too large'), { status: 413 })
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Register the webhook endpoint as a reversible effect.
 * Returns the disposer, or null when webServer is unavailable.
 */
export function registerWebhookIngress(
  ctx: Context,
  config: WebhookIngressConfig,
  handler: (payload: unknown) => void,
): (() => void) | null {
  // Use ctx.get() instead of direct property access: webServer is an OPTIONAL
  // dependency (absent in headless profiles). Direct access would require
  // declaring it in `inject`, which would block plugin startup when missing.
  const webServer = ctx.get('webServer') as WebServerLike | undefined
  if (!webServer) {
    ctx.logger.warn('[reactor] webServer service unavailable — webhook ingress disabled')
    return null
  }

  const path = config.path
  const maxBytes = config.maxBodyBytes ?? 1024 * 1024
  const token = config.token

  const routeHandler = async (req: HttpRequest, res: HttpResponse): Promise<void> => {
    try {
      if (req.method !== 'POST') {
        res.setHeader?.('allow', 'POST')
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      const contentType = req.headers?.['content-type'] ?? ''
      const mediaType = (Array.isArray(contentType) ? contentType[0] : contentType)
        .split(';')[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        res.writeHead(415, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('content type must be application/json')
        return
      }
      if (token) {
        const values = req.headersDistinct?.['x-reactor-token'] ?? []
        if (values.length !== 1 || values[0] !== token) {
          res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('invalid token')
          return
        }
      }
      const body = await readBoundedBody(req, maxBytes)
      let payload: unknown
      try {
        payload = JSON.parse(body)
      } catch {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('request body is not valid JSON')
        return
      }
      // Fire-and-forget: respond 202 before evaluation settles.
      try {
        handler(payload)
      } catch (err) {
        ctx.logger.warn(`[reactor] webhook dispatch failed: ${err}`)
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('webhook engine unavailable')
        return
      }
      res.writeHead(202)
      res.end()
    } catch (err) {
      const status = (err as { status?: number }).status ?? 400
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(err instanceof Error ? err.message : 'bad request')
    }
  }

  // Reversible registration: the disposer is awaited by cordis on unload.
  const disposer = webServer.register({
    kind: 'exact',
    path,
    handler: routeHandler,
  })
  ctx.logger.info(`[reactor] webhook ingress mounted at ${path}`)
  return disposer
}
