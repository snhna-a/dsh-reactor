import z from '@deepseek-ai/schemastery';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReactorEngine } from './engine.js';
import { registerTools } from './tools.js';
import { registerWebhookIngress } from './webhook-server.js';
import { registerApiServer } from './api-server.js';
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASCOT_CANDIDATES = [
    path.join(PACKAGE_ROOT, 'docs', 'assets', 'reactor-mascot.png'),
    path.join(PACKAGE_ROOT, 'assets', 'reactor-mascot.png'),
];
function loadMascot() {
    for (const p of MASCOT_CANDIDATES) {
        try {
            const bytes = fs.readFileSync(p);
            if (bytes && bytes.length > 0)
                return bytes;
        }
        catch {
            /* try next candidate */
        }
    }
    return null;
}
export const name = 'dsh-reactor';
export const inject = ['tools', 'webServer'];
export const Config = z.object({
    allowShell: z.boolean().default(true),
    maxConcurrentActions: z.number().default(3),
    defaultIntervalMs: z.number().default(60000),
    rules: z.array(z.any()).default([]),
    storePath: z.string(),
    historyPath: z.string(),
    maxHistoryEntries: z.number().default(500),
    webhookPath: z.string().default('/reactor/webhook'),
    webhookToken: z.string(),
    allowAgentSession: z.boolean().default(true),
    agentWorkspaceDir: z.string(),
    agentPreset: z.string().default('standard'),
    permissionPreset: z.string().default('workspace-write'),
    maxRetries: z.number().default(3),
    retryDelayMs: z.number().default(1000),
    apiPath: z.string().default('/reactor/api'),
    uiEnabled: z.boolean().default(true),
});
export function apply(ctx, config) {
    ctx.logger.info('[dsh-reactor] plugin loading...');
    const engine = new ReactorEngine(ctx, config);
    void engine.loadPersisted().then((restored) => {
        if (restored === 0) {
            if (config.rules && config.rules.length > 0) {
                for (const rule of config.rules) {
                    engine.addRule(rule);
                }
                ctx.logger.info(`[dsh-reactor] loaded ${config.rules.length} static rule(s) from config`);
            }
        }
    });
    registerTools(ctx, engine);
    const disposers = [];
    const ingressPath = config.webhookPath ?? '/reactor/webhook';
    const ingress = registerWebhookIngress(ctx, {
        path: ingressPath,
        token: config.webhookToken,
    }, (payload) => {
        engine.dispatchWebhook(payload, ingressPath);
    });
    if (ingress)
        disposers.push(ingress);
    if (config.uiEnabled !== false) {
        const api = registerApiServer(ctx, engine, {
            path: config.apiPath ?? '/reactor/api',
            token: config.webhookToken,
        });
        if (api)
            disposers.push(api);
        try {
            const mascotDisposer = ctx.webServer.register({
                kind: 'exact',
                path: '/reactor/mascot.png',
                handler: (_req, res) => {
                    const bytes = loadMascot();
                    if (!bytes) {
                        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                        res.end('mascot not found');
                        return;
                    }
                    res.writeHead(200, {
                        'Content-Type': 'image/png',
                        'Cache-Control': 'public, max-age=86400',
                        'Content-Length': String(bytes.length),
                    });
                    res.end(bytes);
                },
            });
            disposers.push(mascotDisposer);
        }
        catch (e) {
            ctx.logger.warn(`[dsh-reactor] mascot route failed: ${String(e)}`);
        }
    }
    ctx.effect(() => {
        return () => {
            for (const d of disposers)
                d();
            void engine.dispose();
        };
    });
    ctx.logger.info('[dsh-reactor] plugin loaded successfully');
}
