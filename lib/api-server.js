async function readBoundedBody(req, maxBytes = 1024 * 1024) {
    const chunks = []; let size = 0;
    for await (const raw of req) { const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw); size += chunk.byteLength; if (size > maxBytes) throw Object.assign(new Error('request body too large'), { status: 413 }); chunks.push(chunk); }
    return Buffer.concat(chunks).toString('utf8');
}
function json(res, status, body) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
function parseQuery(req) { const raw = req.url?.split('?')[1] ?? ''; const out = {}; for (const pair of raw.split('&')) { if (!pair) continue; const [k, ...v] = pair.split('='); out[decodeURIComponent(k)] = decodeURIComponent(v.join('=')); } return out; }
function toPublicRule(rule, includePayload) {
    if (!rule) return null;
    const { lastPayload, ...rest } = rule;
    let payload = null;
    if (includePayload && lastPayload !== undefined) { try { const s = JSON.stringify(lastPayload); payload = s.length > 4096 ? { truncated: true, preview: s.slice(0, 4096) } : lastPayload; } catch { payload = String(lastPayload).slice(0, 4096); } }
    return { ...rest, lastPayload: payload };
}
export function registerApiServer(ctx, engine, config) {
    const webServer = ctx.webServer;
    if (!webServer || typeof webServer.register !== 'function') { ctx.logger.warn('[reactor] webServer service unavailable — widget REST API disabled'); return null; }
    const base = (config.path ?? '/reactor/api').replace(/\/+$/, '');
    const token = config.token;
    const authorize = (req, res) => { if (!token) return true; const values = req.headersDistinct?.['x-reactor-token'] ?? []; if (values.length === 1 && values[0] === token) return true; json(res, 401, { error: 'invalid token' }); return false; };
    const requireJson = async (req, res) => {
        const contentType = req.headers?.['content-type'] ?? '';
        const mediaType = (Array.isArray(contentType) ? contentType[0] : contentType).split(';')[0]?.trim().toLowerCase();
        if (mediaType !== 'application/json') { json(res, 415, { error: 'content type must be application/json' }); return null; }
        let body; try { body = await readBoundedBody(req); } catch (err) { json(res, err.status ?? 400, { error: err instanceof Error ? err.message : 'bad request' }); return null; }
        try { const parsed = JSON.parse(body); if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) { json(res, 400, { error: 'request body must be a JSON object' }); return null; } return parsed; } catch { json(res, 400, { error: 'request body is not valid JSON' }); return null; }
    };
    const routes = [
        { method: 'GET', path: 'rules', handler: async (req, res, q) => { if (q.ruleId) { const rule = toPublicRule(engine.getRule(q.ruleId), true); if (!rule) { json(res, 404, { error: `rule not found: ${q.ruleId}` }); return; } json(res, 200, { rule }); return; } const rules = engine.listRules().map((r) => toPublicRule(r, false)); json(res, 200, { rules }); } },
        { method: 'POST', path: 'rules', handler: async (req, res) => { const body = await requireJson(req, res); if (!body) return; const { name, source_kind, source_target, conditions, actions } = body; if (typeof name !== 'string' || !name.trim()) { json(res, 400, { error: 'name (string) is required' }); return; } if (typeof source_kind !== 'string' || typeof source_target !== 'string' || !Array.isArray(conditions) || !Array.isArray(actions)) { json(res, 400, { error: 'source_kind, source_target, conditions and actions are required' }); return; } const id = `reactor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; engine.addRule({ id, name: name.trim(), description: typeof body.description === 'string' ? body.description : undefined, source: { kind: source_kind, target: source_target, ...(typeof body.source_interval_ms === 'number' ? { intervalMs: body.source_interval_ms } : {}) }, conditions, conditionLogic: body.condition_logic === 'OR' ? 'OR' : 'AND', actions, cooldownMs: typeof body.cooldown_ms === 'number' ? body.cooldown_ms : undefined, enabled: body.enabled !== false, triggerCount: 0 }); json(res, 201, { rule_id: id, name: name.trim() }); } },
        { method: 'PATCH', path: 'rules', handler: async (req, res) => { const body = await requireJson(req, res); if (!body) return; const id = body.id; const patch = body.patch; if (typeof id !== 'string' || !patch || typeof patch !== 'object' || Array.isArray(patch)) { json(res, 400, { error: 'id (string) and patch (object) are required' }); return; } const ok = engine.updateRule(id, patch); if (!ok) { json(res, 404, { error: `rule not found: ${id}` }); return; } json(res, 200, { ok: true, rule: toPublicRule(engine.getRule(id), false) }); } },
        { method: 'DELETE', path: 'rules', handler: async (_req, res, q) => { if (!q.ruleId) { json(res, 400, { error: 'ruleId query parameter is required' }); return; } const removed = engine.removeRule(q.ruleId); if (!removed) { json(res, 404, { error: `rule not found: ${q.ruleId}` }); return; } json(res, 200, { removed: true }); } },
        { method: 'GET', path: 'history', handler: async (_req, res, q) => { const records = engine.listHistory(q.ruleId || undefined); const limit = Math.max(1, Math.min(Number(q.limit) || 50, 500)); json(res, 200, { records: records.slice(-limit) }); } },
        { method: 'GET', path: 'stats', handler: async (_req, res) => { json(res, 200, { stats: engine.getStats() }); } },
        { method: 'GET', path: 'events', handler: async (_req, res, q) => { const since = Number(q.since) || 0; json(res, 200, { seq: engine.getEventSeq(), events: engine.listEvents(since) }); } },
    ];
    const disposer = webServer.register({ kind: 'prefix', path: base, handler: async (req, res) => { try { const url = new URL(req.url ?? '/', 'http://dsh'); const rel = url.pathname === base ? '' : url.pathname.slice(base.length).replace(/^\/+/, ''); const route = routes.find((r) => r.method === req.method && r.path === rel); if (!route) { json(res, 404, { error: `unknown ${req.method ?? '?'} route /${rel}` }); return; } if (!authorize(req, res)) return; await route.handler(req, res, parseQuery(req)); } catch (err) { ctx.logger.warn(`[reactor] api ${req.method ?? '?'} ${req.url ?? '?'} error: ${err}`); try { json(res, 500, { error: err instanceof Error ? err.message : 'internal error' }); } catch { /* response already sent */ } } } });
    ctx.logger.info(`[reactor] widget REST API mounted at ${base}/* (${routes.length} routes)`);
    return () => { disposer(); };
}
