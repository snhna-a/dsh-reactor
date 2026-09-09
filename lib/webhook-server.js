async function readBoundedBody(req, maxBytes) {
    const chunks = []; let size = 0;
    for await (const raw of req) { const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw); size += chunk.byteLength; if (size > maxBytes) throw Object.assign(new Error('request body too large'), { status: 413 }); chunks.push(chunk); }
    return Buffer.concat(chunks).toString('utf8');
}
export function registerWebhookIngress(ctx, config, handler) {
    const webServer = ctx.webServer;
    if (!webServer || typeof webServer.register !== 'function') { ctx.logger.warn('[reactor] webServer service unavailable — webhook ingress disabled'); return null; }
    const path = config.path;
    const maxBytes = config.maxBodyBytes ?? 1024 * 1024;
    const token = config.token;
    const routeHandler = async (req, res) => {
        try {
            if (req.method !== 'POST') { res.setHeader?.('allow', 'POST'); res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' }); res.end('method not allowed'); return; }
            const contentType = req.headers?.['content-type'] ?? '';
            const mediaType = (Array.isArray(contentType) ? contentType[0] : contentType).split(';')[0]?.trim().toLowerCase();
            if (mediaType !== 'application/json') { res.writeHead(415, { 'content-type': 'text/plain; charset=utf-8' }); res.end('content type must be application/json'); return; }
            if (token) { const values = req.headersDistinct?.['x-reactor-token'] ?? []; if (values.length !== 1 || values[0] !== token) { res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' }); res.end('invalid token'); return; } }
            const body = await readBoundedBody(req, maxBytes);
            let payload; try { payload = JSON.parse(body); } catch { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end('request body is not valid JSON'); return; }
            try { handler(payload); } catch (err) { ctx.logger.warn(`[reactor] webhook dispatch failed: ${err}`); res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }); res.end('webhook engine unavailable'); return; }
            res.writeHead(202); res.end();
        } catch (err) { const status = err.status ?? 400; res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }); res.end(err instanceof Error ? err.message : 'bad request'); }
    };
    const disposer = webServer.register({ kind: 'exact', path, handler: routeHandler });
    ctx.logger.info(`[reactor] webhook ingress mounted at ${path}`);
    return disposer;
}
