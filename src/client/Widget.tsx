/**
 * dsh-reactor — floating widget (v0.4.0)
 *
 * Light-theme redesign with clock-themed mascot:
 *   - transparent mascot (full-body chibi, no circular crop)
 *   - hover reveals a "管理面板" pill button; mascot click only shows stat bubble
 *   - panel: white bg, deep-blue header, gold accents (matches mascot palette)
 *   - close button moved to panel footer (not corner)
 *   - expanded settings: mascot scale, panel width, bubble toggle, theme
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactorApi, type Rule, type RuleAction, type RuleCondition, type Stats, type TriggerRecord, type ReactorEvent } from './api.js'

/** Local mascot served by the host plugin (no external CDN dependency). */
const MASCOT_URL = '/reactor/mascot.png'

const LS_SCALE = 'dsh-reactor:scale'
const LS_POS = 'dsh-reactor:pos'
const LS_AVATAR = 'dsh-reactor:avatar'
const LS_BUBBLE = 'dsh-reactor:bubble'
const LS_PANEL_W = 'dsh-reactor:panelW'
const LS_THEME = 'dsh-reactor:theme'

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeLS(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

const EV_TYPES: Record<string, { label: string; tone: string }> = {
  'rule-triggered': { label: '触发', tone: '#16a34a' },
  'rule-added': { label: '新规则', tone: '#2563eb' },
  'rule-updated': { label: '规则更新', tone: '#2563eb' },
  'rule-error': { label: '规则错误', tone: '#ea580c' },
  'action-failed': { label: '动作失败', tone: '#dc2626' },
}

const OP_LABELS: Record<string, string> = {
  eq: '等于', ne: '不等于', gt: '大于', lt: '小于', gte: '≥', lte: '≤',
  contains: '包含', matches: '匹配', exists: '存在', changed: '变化',
}

const SOURCE_LABELS: Record<string, string> = {
  'http-poll': 'HTTP 轮询', 'file-watch': '文件监听', command: '命令输出', webhook: 'Webhook 推送',
}

const ACTION_LABELS: Record<string, string> = {
  shell: '执行命令', webhook: 'Webhook 调用', 'agent-talk': 'Agent 会话',
}

type View = { name: 'overview' } | { name: 'rules' } | { name: 'new' } | { name: 'detail'; ruleId: string }
type Anchor = { h: 'left' | 'right' | null; hOff: number; v: 'top' | 'bottom' | null; vOff: number }

function fmtTime(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function fmtTokens(t?: { input?: number; output?: number }): string {
  if (!t) return '—'
  const total = (t.input ?? 0) + (t.output ?? 0)
  return `${total.toLocaleString()} (in ${(t.input ?? 0).toLocaleString()} / out ${(t.output ?? 0).toLocaleString()})`
}

/* ─────────────────────────── CSS (light theme) ─────────────────────────── */
const CSS = `
.rxw-root, .rxw-root * { box-sizing: border-box; }
.rxw-root { position: fixed; z-index: 2147483000; font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }

/* Mascot: transparent full-body, no circular crop */
.rxw-mascot-wrap { position: relative; cursor: grab; touch-action: none; user-select: none; }
.rxw-mascot-wrap:active { cursor: grabbing; }
.rxw-mascot { display: block; filter: drop-shadow(0 8px 20px rgba(30,58,95,.28)); transition: transform .18s cubic-bezier(.34,1.56,.64,1), filter .2s ease; transform-origin: 50% 100%; }
.rxw-mascot-wrap:hover .rxw-mascot { filter: drop-shadow(0 10px 28px rgba(30,58,95,.4)); }
.rxw-mascot-wrap.pressed .rxw-mascot { transform: scaleY(.88) scaleX(1.06); }
.rxw-mascot-wrap.glow .rxw-mascot { animation: rxw-glow 1.2s ease-out; }
@keyframes rxw-glow { 0% { filter: drop-shadow(0 0 0 rgba(212,168,67,.8)); } 70% { filter: drop-shadow(0 0 24px rgba(212,168,67,.6)); } 100% { filter: drop-shadow(0 8px 20px rgba(30,58,95,.28)); } }
.rxw-mascot img { display: block; pointer-events: none; -webkit-user-drag: none; }
.rxw-root.flipped .rxw-mascot img { transform: scaleX(-1); transform-origin: center; }

/* Unread badge */
.rxw-badge { position: absolute; top: 4px; right: 8px; min-width: 22px; height: 22px; padding: 0 7px; border-radius: 11px; background: linear-gradient(135deg, #dc2626, #b91c1c); color: #fff; font-size: 11px; font-weight: 700; line-height: 22px; text-align: center; box-shadow: 0 2px 10px rgba(220,38,38,.5); }

/* Hover "管理面板" pill button */
.rxw-open-btn { position: absolute; top: -8px; left: 50%; transform: translateX(-50%) translateY(-4px); opacity: 0; pointer-events: none; transition: opacity .18s ease, transform .18s cubic-bezier(.34,1.56,.64,1); background: linear-gradient(135deg, #1e3a5f, #2c3e6b); color: #f0c040; border: 1.5px solid rgba(240,192,64,.5); border-radius: 20px; padding: 6px 16px; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; box-shadow: 0 4px 16px rgba(30,58,95,.35); letter-spacing: .03em; z-index: 3; }
.rxw-mascot-wrap:hover .rxw-open-btn, .rxw-open-btn.visible { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0); }
.rxw-open-btn:hover { background: linear-gradient(135deg, #2c3e6b, #3b4f7a); border-color: #f0c040; box-shadow: 0 6px 22px rgba(30,58,95,.45); }
.rxw-open-btn::after { content: ''; position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%); border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 6px solid #2c3e6b; }

/* Stat bubble (mascot click) */
.rxw-bubble { position: absolute; bottom: calc(100% + 18px); left: 50%; transform: translateX(-50%) translateY(8px) scale(.95); width: 230px; pointer-events: none; opacity: 0; transition: opacity .2s ease, transform .22s cubic-bezier(.34,1.56,.64,1); z-index: 2; }
.rxw-bubble.open { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); pointer-events: auto; }
.rxw-bubble svg { display: block; width: 100%; height: auto; }
.rxw-bubble-content { position: absolute; top: 12px; left: 16px; right: 16px; bottom: 26px; display: flex; flex-direction: column; gap: 3px; color: #1e293b; }
.rxw-bubble-title { font-size: 10px; font-weight: 700; color: #1e3a5f; letter-spacing: .06em; text-transform: uppercase; }
.rxw-bubble-main { font-size: 22px; font-weight: 800; color: #1e3a5f; line-height: 1.1; }
.rxw-bubble-main span { font-size: 12px; color: #64748b; font-weight: 500; }
.rxw-bubble-sub { font-size: 11px; color: #64748b; }
.rxw-bubble-err { font-size: 11px; color: #dc2626; font-weight: 600; }

/* Settings menu (hamburger) */
.rxw-menu-btn { position: absolute; bottom: 6px; left: -2px; width: 26px; height: 26px; border: none; border-radius: 8px; background: rgba(30,58,95,.88); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; padding: 0; opacity: 0; transition: opacity .15s; z-index: 2; }
.rxw-mascot-wrap:hover .rxw-menu-btn, .rxw-menu-btn.visible { opacity: 1; }
.rxw-menu-btn span { display: block; width: 13px; height: 2px; background: #f0c040; border-radius: 1px; }
.rxw-menu { position: fixed; min-width: 220px; background: rgba(255,255,255,0.82); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(30,58,95,.18); border-radius: 14px; padding: 14px 16px; box-shadow: 0 8px 32px rgba(30,58,95,.15); z-index: 2147483001; opacity: 0; transform: scale(.94) translateY(-4px); transform-origin: bottom center; transition: opacity .16s ease, transform .2s cubic-bezier(.34,1.56,.64,1); pointer-events: none; color-scheme: light; }
.rxw-menu.open { opacity: 1; transform: none; pointer-events: auto; }
.rxw-menu label { display: block; font-size: 11px; color: #475569; margin: 8px 0 4px; font-weight: 600; }
.rxw-menu input[type=range] { width: 100%; accent-color: #1e3a5f; }
.rxw-menu input[type=text] { width: 100%; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; color: #1e293b; padding: 7px 9px; font-size: 12px; }
.rxw-menu input[type=text]:focus { outline: none; border-color: #1e3a5f; box-shadow: 0 0 0 3px rgba(30,58,95,.1); }
.rxw-menu-row { display: flex; align-items: center; gap: 8px; margin: 7px 0; color: #334155; font-size: 12px; }
.rxw-menu-val { font-size: 11px; color: #1e3a5f; font-weight: 700; min-width: 36px; text-align: right; }

/* ── Panel (light theme) ── */
.rxw-panel { position: fixed; display: flex; flex-direction: column; width: 460px; max-width: calc(100vw - 20px); height: min(660px, calc(100vh - 40px)); background: #ffffff; border: 1px solid rgba(30,58,95,.12); border-radius: 18px; box-shadow: 0 24px 70px rgba(30,58,95,.22), 0 0 0 1px rgba(255,255,255,.6) inset; color: #1e293b; font-size: 13px; overflow: hidden; }
.rxw-head { display: flex; align-items: center; gap: 12px; padding: 14px 18px; background: linear-gradient(135deg, #1e3a5f 0%, #2c3e6b 60%, #3b4f7a 100%); border-bottom: 2px solid #f0c040; }
.rxw-head img { width: 42px; height: 42px; border-radius: 50%; object-fit: cover; box-shadow: 0 2px 10px rgba(0,0,0,.3); border: 2px solid rgba(240,192,64,.4); }
.rxw-head h1 { font-size: 16px; font-weight: 700; margin: 0; color: #ffffff; letter-spacing: .02em; }
.rxw-head p { margin: 2px 0 0; font-size: 11px; color: rgba(240,192,64,.85); }
.rxw-head .grow { flex: 1; min-width: 0; }
.rxw-nav { display: flex; gap: 0; padding: 0 12px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
.rxw-nav button { flex: 1; background: transparent; border: none; color: #64748b; font-size: 12px; padding: 10px 0 11px; cursor: pointer; border-bottom: 2px solid transparent; transition: color .12s; font-weight: 500; }
.rxw-nav button.on { color: #1e3a5f; border-bottom-color: #f0c040; font-weight: 700; }
.rxw-nav button:hover:not(.on) { color: #334155; }
.rxw-body { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; background: #ffffff; }
.rxw-body::-webkit-scrollbar { width: 6px; }
.rxw-body::-webkit-scrollbar-thumb { background: rgba(30,58,95,.2); border-radius: 3px; }
.rxw-body::-webkit-scrollbar-track { background: transparent; }

/* Stats */
.rxw-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.rxw-stat { background: linear-gradient(135deg, #f8fafc, #f1f5f9); border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 8px; text-align: center; transition: border-color .15s, box-shadow .15s; }
.rxw-stat:hover { border-color: rgba(30,58,95,.25); box-shadow: 0 2px 10px rgba(30,58,95,.08); }
.rxw-stat b { display: block; font-size: 22px; font-weight: 800; color: #1e3a5f; line-height: 1.1; }
.rxw-stat span { font-size: 10px; color: #64748b; margin-top: 3px; display: block; font-weight: 500; }

/* Cards */
.rxw-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; transition: border-color .15s, background .15s, box-shadow .15s; }
.rxw-card:hover { border-color: rgba(30,58,95,.2); background: #ffffff; box-shadow: 0 2px 10px rgba(30,58,95,.06); }
.rxw-row { display: flex; align-items: center; gap: 8px; }
.rxw-row .grow { flex: 1; min-width: 0; }
.rxw-name { font-weight: 600; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rxw-meta { font-size: 11px; color: #64748b; margin-top: 3px; }
.rxw-chip { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 10px; background: rgba(30,58,95,.08); color: #1e3a5f; margin-right: 6px; font-weight: 600; }
.rxw-chip.green { background: rgba(22,163,74,.1); color: #16a34a; }
.rxw-chip.red { background: rgba(220,38,38,.1); color: #dc2626; }
.rxw-chip.gold { background: rgba(212,168,67,.12); color: #92600a; }

/* Switch */
.rxw-switch { width: 38px; height: 22px; border-radius: 11px; border: none; cursor: pointer; position: relative; background: #cbd5e1; transition: background .15s; flex: none; }
.rxw-switch.on { background: #1e3a5f; }
.rxw-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: left .15s; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
.rxw-switch.on::after { left: 18px; }

/* Icon button */
.rxw-icon-btn { background: transparent; border: none; color: #94a3b8; cursor: pointer; font-size: 14px; padding: 5px 8px; border-radius: 8px; transition: color .12s, background .12s; }
.rxw-icon-btn:hover { color: #dc2626; background: rgba(220,38,38,.08); }

/* Buttons */
.rxw-btn { background: linear-gradient(135deg, #1e3a5f, #2c3e6b); color: #ffffff; border: none; border-radius: 10px; padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer; transition: transform .1s, box-shadow .15s, background .15s; box-shadow: 0 2px 10px rgba(30,58,95,.25); }
.rxw-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(30,58,95,.35); background: linear-gradient(135deg, #2c3e6b, #3b4f7a); }
.rxw-btn:active { transform: translateY(0); }
.rxw-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
.rxw-btn.gold { background: linear-gradient(135deg, #d4a843, #f0c040); color: #1e3a5f; box-shadow: 0 2px 10px rgba(212,168,67,.3); }
.rxw-btn.gold:hover { background: linear-gradient(135deg, #f0c040, #f5d060); box-shadow: 0 4px 16px rgba(212,168,67,.4); }
.rxw-btn.ghost { background: #f1f5f9; color: #475569; box-shadow: none; border: 1px solid #e2e8f0; }
.rxw-btn.ghost:hover { background: #e2e8f0; color: #1e293b; }
.rxw-btn.danger { background: rgba(220,38,38,.08); color: #dc2626; box-shadow: none; border: 1px solid rgba(220,38,38,.2); }
.rxw-btn.danger:hover { background: rgba(220,38,38,.14); }

/* Form fields */
.rxw-field { margin-bottom: 14px; }
.rxw-field label { display: block; font-size: 11px; color: #475569; margin-bottom: 5px; font-weight: 600; }
.rxw-field input, .rxw-field select, .rxw-field textarea { width: 100%; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 9px; color: #1e293b; padding: 8px 11px; font-size: 12px; transition: border-color .12s, box-shadow .12s; }
.rxw-field input:focus, .rxw-field select:focus, .rxw-field textarea:focus { outline: none; border-color: #1e3a5f; box-shadow: 0 0 0 3px rgba(30,58,95,.1); }
.rxw-cond { display: grid; grid-template-columns: 1fr 80px 1fr 28px; gap: 6px; margin-bottom: 6px; }

/* Logs */
.rxw-log { font-size: 12px; color: #475569; }
.rxw-log b { color: #1e293b; font-weight: 600; }
.rxw-log .ok { color: #16a34a; font-weight: 600; }
.rxw-log .err { color: #dc2626; font-weight: 600; }
.rxw-empty { color: #94a3b8; text-align: center; padding: 32px 0; font-size: 12px; }

/* Footer with close button (not corner) */
.rxw-foot { padding: 12px 16px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; gap: 10px; background: #f8fafc; }
.rxw-foot-info { font-size: 11px; color: #64748b; }
.rxw-close-btn { display: flex; align-items: center; gap: 6px; background: linear-gradient(135deg, #1e3a5f, #2c3e6b); color: #f0c040; border: 1px solid rgba(240,192,64,.3); border-radius: 20px; padding: 7px 20px; font-size: 12px; font-weight: 700; cursor: pointer; transition: transform .1s, box-shadow .15s, background .15s; box-shadow: 0 2px 10px rgba(30,58,95,.2); }
.rxw-close-btn:hover { background: linear-gradient(135deg, #2c3e6b, #3b4f7a); border-color: #f0c040; box-shadow: 0 4px 16px rgba(30,58,95,.3); transform: translateY(-1px); }
.rxw-close-btn:active { transform: translateY(0); }

/* Detail section */
.rxw-detail .tl { color: #1e3a5f; margin-bottom: 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
.rxw-preset { display: inline-block; background: rgba(212,168,67,.1); border: 1px solid rgba(212,168,67,.25); color: #92600a; border-radius: 10px; padding: 6px 12px; font-size: 11px; cursor: pointer; margin: 0 6px 6px 0; transition: background .12s, border-color .12s; font-weight: 500; }
.rxw-preset:hover { background: rgba(212,168,67,.18); border-color: rgba(212,168,67,.4); }
`

function injectCss(): void {
  const id = 'dsh-reactor-style'
  if (document.getElementById(id)) return
  const el = document.createElement('style')
  el.id = id
  el.textContent = CSS
  document.head.appendChild(el)
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rxw-stat">
      <b style={tone ? { color: tone } : undefined}>{value}</b>
      <span>{label}</span>
    </div>
  )
}

function RuleRow({ rule, onToggle, onDelete, onOpen }: {
  rule: Rule
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
  onOpen: (id: string) => void
}) {
  return (
    <div className="rxw-card" onClick={() => onOpen(rule.id)} style={{ cursor: 'pointer' }}>
      <div className="rxw-row">
        <div className="grow">
          <div className="rxw-name">{rule.name}</div>
          <div className="rxw-meta">
            <span className="rxw-chip">{SOURCE_LABELS[rule.source.kind] ?? rule.source.kind}</span>
            {rule.triggerCount ? <span className="rxw-chip green">触发 {rule.triggerCount}</span> : null}
            最后 {fmtTime(rule.lastTriggered)}
          </div>
        </div>
        <button
          className={`rxw-switch ${rule.enabled ? 'on' : ''}`}
          title={rule.enabled ? '停用' : '启用'}
          onClick={(e) => { e.stopPropagation(); onToggle(rule.id, !rule.enabled) }}
        />
        <button className="rxw-icon-btn" title="删除规则" onClick={(e) => { e.stopPropagation(); onDelete(rule.id) }}>✕</button>
      </div>
    </div>
  )
}

function ConditionEditor({ value, onChange }: { value: RuleCondition[]; onChange: (v: RuleCondition[]) => void }) {
  const update = (i: number, patch: Partial<RuleCondition>) => {
    const next = value.slice()
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }
  return (
    <div>
      {value.map((c, i) => (
        <div className="rxw-cond" key={i}>
          <input placeholder="$.status" value={c.field} onChange={(e) => update(i, { field: e.target.value })} />
          <select value={c.op} onChange={(e) => update(i, { op: e.target.value as RuleCondition['op'] })}>
            {Object.entries(OP_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
          </select>
          {c.op === 'exists' || c.op === 'changed' ? (<span />) : (
            <input placeholder="值" value={String(c.value ?? '')} onChange={(e) => update(i, { value: e.target.value })} />
          )}
          <button className="rxw-icon-btn" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="rxw-btn ghost" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => onChange([...value, { field: '$.status', op: 'eq', value: 'ok' }])}>+ 条件</button>
    </div>
  )
}

function ActionEditor({ value, onChange }: { value: RuleAction[]; onChange: (v: RuleAction[]) => void }) {
  const update = (i: number, patch: Partial<RuleAction>) => {
    const next = value.slice()
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }
  return (
    <div>
      {value.map((a, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <select value={a.kind} style={{ width: 110, background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 9, color: '#1e293b', padding: '8px 6px', fontSize: 12 }} onChange={(e) => update(i, { kind: e.target.value as RuleAction['kind'] })}>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
          </select>
          <input placeholder={a.kind === 'agent-talk' ? '注入给 Agent 的提示词' : a.kind === 'webhook' ? 'https://…' : '命令'} style={{ flex: 1, background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 9, color: '#1e293b', padding: '8px 10px', fontSize: 12 }} value={a.target} onChange={(e) => update(i, { target: e.target.value })} />
          <button className="rxw-icon-btn" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="rxw-btn ghost" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => onChange([...value, { kind: 'shell', target: '' }])}>+ 动作</button>
    </div>
  )
}

function RuleDetail({ ruleId, api, onBack }: { ruleId: string; api: ReactorApi; onBack: () => void }) {
  const [history, setHistory] = useState<TriggerRecord[]>([])
  const [rule, setRule] = useState<Rule | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([api.listRules(), api.history(ruleId, 200)])
      .then(([r, h]) => {
        if (!alive) return
        setRule(r.rules.find((x) => x.id === ruleId) ?? null)
        setHistory(h.records)
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [api, ruleId])

  const failed = history.filter((h) => h.actions?.some((a) => !a.ok))

  return (
    <div className="rxw-detail">
      <div className="rxw-row" style={{ marginBottom: 12 }}>
        <button className="rxw-btn ghost" onClick={onBack} style={{ padding: '6px 14px', fontSize: 12 }}>← 返回</button>
        <div className="grow">
          <div className="rxw-name" style={{ fontSize: 15 }}>{rule?.name ?? ruleId}</div>
          <div className="rxw-meta">
            {rule ? <span className="rxw-chip">{SOURCE_LABELS[rule.source.kind] ?? rule.source.kind}</span> : null}
            {rule ? <span className="rxw-chip">{rule.conditions.length} 条件 / {rule.actions.length} 动作</span> : null}
            {failed.length ? <span className="rxw-chip red">{failed.length} 次含失败</span> : null}
          </div>
        </div>
      </div>
      {rule?.description ? <div className="rxw-card" style={{ marginBottom: 10 }}>{rule.description}</div> : null}
      <div className="rxw-card">
        <div className="tl">执行历史（最近 {history.length} 条）</div>
        {history.length === 0 ? (<div className="rxw-empty">还没有触发记录</div>) : (
          [...history].reverse().map((h) => {
            const fail = h.actions?.find((a) => !a.ok)
            return (
              <div key={h.id} style={{ borderBottom: '1px solid #e2e8f0', padding: '9px 0' }}>
                <div className="rxw-row">
                  <span className={`rxw-chip ${h.matched ? 'green' : ''}`} style={h.matched ? undefined : { background: '#f1f5f9', color: '#94a3b8' }}>{h.matched ? '命中' : '未命中'}</span>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>{fmtTime(h.at)}</span>
                  {h.failureClass ? <span className="rxw-chip red">{h.failureClass}</span> : null}
                  {h.sessionResult?.tokens ? <span className="rxw-chip gold">Tokens {fmtTokens(h.sessionResult.tokens)}</span> : null}
                  {fail ? <span className="rxw-chip red">失败：{(fail.error ?? '').slice(0, 50)}</span> : null}
                </div>
                {h.actions?.map((a, i) => (
                  <div key={i} className="rxw-log" style={{ marginTop: 6 }}>
                    <span className={a.ok ? 'ok' : 'err'}>[{a.ok ? '✓' : '✗'}]</span>{' '}
                    <b>{ACTION_LABELS[a.kind] ?? a.kind}</b> {a.target.slice(0, 50)}
                    {a.attempts && a.attempts > 1 ? ` · 重试 ${a.attempts - 1} 次` : ''}
                    {a.error ? <span className="err"> — {a.error.slice(0, 70)}</span> : null}
                    {a.attemptLog?.map((at, j) => !at.ok ? (
                      <div key={j} style={{ color: '#dc2626', fontSize: 11, marginLeft: 14, marginTop: 2 }}>第 {j + 1} 次尝试失败（{at.ms}ms）：{at.error?.slice(0, 70)}</div>
                    ) : null)}
                  </div>
                ))}
                {h.steps && h.steps.length > 0 ? (
                  <div style={{ marginTop: 6, padding: '6px 8px', background: '#f8fafc', borderRadius: 6 }}>
                    {h.steps.map((s, i) => (
                      <div key={i} style={{ fontSize: 11, color: s.status === 'failed' ? '#dc2626' : s.status === 'skipped' ? '#94a3b8' : '#16a34a', lineHeight: 1.6 }}>
                        <span style={{ color: '#94a3b8' }}>·</span> {s.type}: {s.status}
                        {s.summary ? <span style={{ color: '#475569' }}> — {s.summary.slice(0, 80)}</span> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function RuleForm({ api, onCreated }: { api: ReactorApi; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Rule['source']['kind']>('command')
  const [target, setTarget] = useState('')
  const [intervalMs, setIntervalMs] = useState(60000)
  const [conditions, setConditions] = useState<RuleCondition[]>([{ field: '$.status', op: 'eq', value: 'error' }])
  const [actions, setActions] = useState<RuleAction[]>([{ kind: 'shell', target: '' }])
  const [logic, setLogic] = useState<'AND' | 'OR'>('AND')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    setErr('')
    if (!name.trim()) { setErr('请填写规则名称'); return }
    if (!target.trim()) { setErr('请填写事件源目标'); return }
    const cleanActions = actions.filter((a) => a.target.trim())
    if (!cleanActions.length) { setErr('至少需要一个动作'); return }
    setBusy(true)
    try {
      await api.createRule({
        name: name.trim(),
        source_kind: kind,
        source_target: target.trim(),
        source_interval_ms: kind === 'http-poll' || kind === 'command' ? intervalMs : undefined,
        conditions,
        condition_logic: logic,
        actions: cleanActions,
        enabled: true,
      })
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const presets: Array<{ label: string; kind: Rule['source']['kind']; target: string; intervalMs?: number }> = [
    { label: 'GitHub Release 监控', kind: 'http-poll', target: 'https://api.github.com/repos/owner/repo/releases/latest', intervalMs: 600000 },
    { label: '命令输出检查', kind: 'command', target: 'echo {"status":"error"}', intervalMs: 30000 },
    { label: '文件变化监听', kind: 'file-watch', target: 'C:\\logs\\app.log' },
  ]

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        {presets.map((p) => (
          <span key={p.label} className="rxw-preset" onClick={() => { setKind(p.kind); setTarget(p.target); if (p.intervalMs) setIntervalMs(p.intervalMs) }}>{p.label}</span>
        ))}
      </div>
      <div className="rxw-field">
        <label>规则名称</label>
        <input value={name} placeholder="例如：GitHub 新版本自动拉取并运行" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="rxw-field">
        <label>事件源类型</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as Rule['source']['kind'])}>
          {Object.entries(SOURCE_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
        </select>
      </div>
      <div className="rxw-field">
        <label>{kind === 'file-watch' ? '文件路径' : kind === 'http-poll' ? '轮询 URL' : kind === 'webhook' ? 'Webhook 路径' : '命令（输出 JSON 作为事件载荷）'}</label>
        <input value={target} onChange={(e) => setTarget(e.target.value)} />
      </div>
      {(kind === 'http-poll' || kind === 'command') && (
        <div className="rxw-field">
          <label>轮询间隔（毫秒）</label>
          <input type="number" value={intervalMs} onChange={(e) => setIntervalMs(Number(e.target.value))} />
        </div>
      )}
      <div className="rxw-field">
        <label>条件（JSONPath 字段 + 比较符）</label>
        <ConditionEditor value={conditions} onChange={setConditions} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>组合逻辑</span>
          <select value={logic} onChange={(e) => setLogic(e.target.value as 'AND' | 'OR')} style={{ width: 100 }}>
            <option value="AND">全部满足</option>
            <option value="OR">任一满足</option>
          </select>
        </div>
      </div>
      <div className="rxw-field">
        <label>动作（命中后执行）</label>
        <ActionEditor value={actions} onChange={setActions} />
      </div>
      {err ? <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 10, fontWeight: 500 }}>{err}</div> : null}
      <button className="rxw-btn gold" style={{ width: '100%' }} disabled={busy} onClick={submit}>{busy ? '创建中…' : '创建规则'}</button>
    </div>
  )
}

export function ReactorWidget() {
  const api = useMemo(() => new ReactorApi(), [])
  const [open, setOpen] = useState(false)
  const [bubbleOpen, setBubbleOpen] = useState(false)
  const [view, setView] = useState<View>({ name: 'overview' })
  const [rules, setRules] = useState<Rule[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [events, setEvents] = useState<ReactorEvent[]>([])
  const [lastSeq, setLastSeq] = useState(0)
  const [scale, setScale] = useState(() => readLS(LS_SCALE, 1))
  const [anchor, setAnchor] = useState<Anchor>(() => readLS(LS_POS, { h: 'right', hOff: 0, v: 'bottom', vOff: 0 }))
  const [avatar, setAvatar] = useState(() => readLS(LS_AVATAR, MASCOT_URL))
  const [bubbleOn, setBubbleOn] = useState(() => readLS(LS_BUBBLE, true))
  const [panelW, setPanelW] = useState(() => readLS(LS_PANEL_W, 460))
  const [menuOpen, setMenuOpen] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [glow, setGlow] = useState(false)
  const [hovering, setHovering] = useState(false)
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(() => {
    api.listRules().then((r) => setRules(r.rules)).catch(() => {})
    api.stats().then((s) => setStats(s.stats)).catch(() => {})
  }, [api])

  useEffect(() => {
    injectCss()
    refresh()
    const t1 = window.setInterval(refresh, 30000)
    const t2 = window.setInterval(() => {
      api.events(lastSeq).then((res) => {
        if (res.seq > lastSeq) {
          setLastSeq(res.seq)
          if (res.events.length) {
            setEvents((prev) => [...prev, ...res.events].slice(-100))
            const hasTrigger = res.events.some((e) => e.type === 'rule-triggered' || e.type === 'action-failed')
            if (hasTrigger) {
              setGlow(true)
              window.setTimeout(() => setGlow(false), 1200)
              if (bubbleOn && !open) {
                setBubbleOpen(true)
                window.setTimeout(() => setBubbleOpen(false), 4500)
              }
            }
            refresh()
          }
        }
      }).catch(() => {})
    }, 5000)
    return () => { window.clearInterval(t1); window.clearInterval(t2) }
  }, [api, lastSeq, refresh, bubbleOn, open])

  // close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const unread = events.filter((e) => e.type === 'rule-triggered' || e.type === 'rule-error' || e.type === 'action-failed').length

  const onToggle = useCallback((id: string, enabled: boolean) => {
    api.updateRule(id, { enabled }).then(() => refresh()).catch(() => {})
  }, [api, refresh])

  const onDelete = useCallback((id: string) => {
    if (!window.confirm('确认删除这条规则？此操作不可恢复。')) return
    api.deleteRule(id).then(() => refresh()).catch(() => {})
  }, [api, refresh])

  const MASCOT_SIZE = 96 // base px for full-body chibi

  const computePos = (anc: Anchor): { left?: number; top?: number; right?: number; bottom?: number; flipped: boolean } => {
    const vp = { w: window.innerWidth, h: window.innerHeight }
    const size = MASCOT_SIZE * scale
    const flipped = anc.h === 'left'
    if (anc.h === 'right' && anc.v === 'bottom') return { right: anc.hOff + 16, bottom: anc.vOff + 16, flipped }
    if (anc.h === 'left' && anc.v === 'bottom') return { left: anc.hOff + 16, bottom: anc.vOff + 16, flipped }
    if (anc.h === 'right' && anc.v === 'top') return { right: anc.hOff + 16, top: anc.vOff + 16, flipped }
    if (anc.h === 'left' && anc.v === 'top') return { left: anc.hOff + 16, top: anc.vOff + 16, flipped }
    // free position
    const left = anc.h === null ? anc.hOff : (anc.h === 'left' ? anc.hOff : vp.w - size - anc.hOff)
    const top = anc.v === null ? anc.vOff : (anc.v === 'top' ? anc.vOff : vp.h - size - anc.vOff)
    return { left, top, flipped }
  }

  const pos = computePos(anchor)

  const dragStart = (e: React.PointerEvent) => {
    if (open) return
    setPressed(true)
    const rect = rootRef.current?.getBoundingClientRect()
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: rect?.left ?? 0, oy: rect?.top ?? 0, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const dragMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (dx * dx + dy * dy > 25) d.moved = true
    const size = MASCOT_SIZE * scale
    const x = Math.max(4, Math.min(window.innerWidth - size - 4, d.ox + dx))
    const y = Math.max(4, Math.min(window.innerHeight - size - 4, d.oy + dy))
    setAnchor({ h: null, hOff: x, v: null, vOff: y })
  }
  const dragEnd = (e: React.PointerEvent) => {
    setPressed(false)
    const d = dragRef.current
    dragRef.current = null
    if (!d || !d.moved) return
    const size = MASCOT_SIZE * scale
    const vp = { w: window.innerWidth, h: window.innerHeight }
    const cx = d.ox + (e.clientX - d.sx) + size / 2
    const cy = d.oy + (e.clientY - d.sy) + size / 2
    let h: Anchor['h'] = null
    let hOff = 0
    if (cx < vp.w / 4) { h = 'left'; hOff = 0 }
    else if (cx > vp.w * 3 / 4) { h = 'right'; hOff = 0 }
    else { h = null; hOff = d.ox + (e.clientX - d.sx) }
    let v: Anchor['v'] = null
    let vOff = 0
    if (cy < vp.h / 4) { v = 'top'; vOff = 0 }
    else if (cy > vp.h * 3 / 4) { v = 'bottom'; vOff = 0 }
    else { v = null; vOff = d.oy + (e.clientY - d.sy) }
    const next = { h, hOff, v, vOff }
    setAnchor(next)
    writeLS(LS_POS, next)
  }

  // Mascot click: only show stat bubble, do NOT open panel
  const mascotClick = () => {
    if (dragRef.current?.moved) return
    if (menuOpen) { setMenuOpen(false); return }
    if (open) return // panel already open, ignore mascot click
    setBubbleOpen((v) => !v)
    if (!bubbleOpen) {
      window.setTimeout(() => setBubbleOpen(false), 5000)
    }
  }

  // Open panel button (hover-revealed)
  const openPanel = (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen(true)
    setBubbleOpen(false)
    setMenuOpen(false)
  }

  const panelPos = (() => {
    const size = MASCOT_SIZE * scale
    const w = panelW
    const h = Math.min(660, window.innerHeight - 40)
    // mascot center
    let mx = window.innerWidth / 2, my = window.innerHeight / 2
    if (pos.left !== undefined) mx = pos.left + size / 2
    else if (pos.right !== undefined) mx = window.innerWidth - pos.right - size / 2
    if (pos.top !== undefined) my = pos.top + size / 2
    else if (pos.bottom !== undefined) my = window.innerHeight - pos.bottom - size / 2
    // horizontal: panel on the side with more space
    let left: number | undefined, right: number | undefined
    if (mx < window.innerWidth / 2) {
      left = Math.min(Math.max(10, mx + size / 2 + 10), window.innerWidth - w - 10)
    } else {
      right = Math.min(Math.max(10, window.innerWidth - mx + size / 2 + 10), window.innerWidth - w - 10)
    }
    // vertical: keep panel fully on screen, prefer near mascot
    const top = Math.max(12, Math.min(my - size / 2 - 10, window.innerHeight - h - 12))
    return left !== undefined ? { left, top } : { right, top }
  })()

  // settings menu: fixed directly above mascot (horizontally centered),
  // falls back below if not enough space above. Stays put while resizing.
  const menuPos = (() => {
    const menuW = 230
    const menuH = 340
    const size = MASCOT_SIZE * scale
    // mascot top-left corner
    let mascotLeft = window.innerWidth / 2 - size / 2
    let mascotTop = window.innerHeight / 2 - size / 2
    if (pos.left !== undefined) mascotLeft = pos.left
    else if (pos.right !== undefined) mascotLeft = window.innerWidth - pos.right - size
    if (pos.top !== undefined) mascotTop = pos.top
    else if (pos.bottom !== undefined) mascotTop = window.innerHeight - pos.bottom - size
    // horizontally centered on mascot, clamped to viewport
    const left = Math.max(8, Math.min(mascotLeft + size / 2 - menuW / 2, window.innerWidth - menuW - 8))
    // prefer above mascot; fall back below if insufficient space
    const aboveTop = mascotTop - menuH - 4
    const top = aboveTop >= 4
      ? aboveTop
      : Math.min(mascotTop + size + 4, window.innerHeight - menuH - 4)
    return { left, top }
  })()

  return (
    <div className={`rxw-root ${pos.flipped ? 'flipped' : ''}`} ref={rootRef} style={{ left: pos.left, top: pos.top, right: pos.right, bottom: pos.bottom }}>
      {/* Stat bubble (mascot click) */}
      <div className={`rxw-bubble ${bubbleOpen && !open ? 'open' : ''}`}>
        <svg viewBox="0 0 230 120" preserveAspectRatio="none">
          <path fill="#ffffff" stroke="rgba(30,58,95,.2)" strokeWidth="2" strokeLinejoin="round" d="M 14 10 Q 14 4 22 4 L 208 4 Q 216 4 216 10 L 216 82 Q 216 90 208 90 L 130 90 L 115 110 L 110 90 L 22 90 Q 14 90 14 82 Z" />
        </svg>
        <div className="rxw-bubble-content">
          <div className="rxw-bubble-title">dsh-reactor · 实时状态</div>
          <div className="rxw-bubble-main">{stats?.totalTriggers ?? 0} <span>次触发</span></div>
          <div className="rxw-bubble-sub">{stats?.enabledRules ?? 0} 规则运行中 · 最后 {fmtTime(stats?.lastTriggerAt)}</div>
          {stats?.failedActions ? <div className="rxw-bubble-err">⚠ {stats.failedActions} 次动作失败</div> : null}
        </div>
      </div>

      {/* Mascot + hover open button */}
      <div
        className={`rxw-mascot-wrap ${pressed ? 'pressed' : ''} ${glow ? 'glow' : ''}`}
        style={{ width: MASCOT_SIZE * scale, height: MASCOT_SIZE * scale, transformOrigin: 'bottom center' }}
        onPointerDown={dragStart}
        onPointerMove={dragMove}
        onPointerUp={dragEnd}
        onPointerCancel={() => { setPressed(false); dragRef.current = null }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClick={mascotClick}
      >
        <div className="rxw-mascot" style={{ width: '100%', height: '100%' }}>
          <img src={avatar} alt="dsh-reactor" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { (e.target as HTMLImageElement).src = MASCOT_URL }} />
        </div>
        {unread > 0 && !open ? <span className="rxw-badge">{unread > 99 ? '99+' : unread}</span> : null}

        {/* Hover-revealed "管理面板" button */}
        <button
          className={`rxw-open-btn ${hovering || open ? 'visible' : ''}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={openPanel}
          title="打开管理面板"
        >
          ⚙ 管理面板
        </button>

        {/* Settings (hamburger) */}
        <button
          className={`rxw-menu-btn ${hovering || menuOpen ? 'visible' : ''}`}
          title="设置"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
        >
          <span /><span /><span />
        </button>
      </div>

      {/* Settings menu */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="rxw-menu open"
          style={menuPos}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ margin: 0 }}>挂件大小</label>
            <span className="rxw-menu-val">{scale.toFixed(1)}x</span>
          </div>
          <input type="range" min={0.5} max={2.5} step={0.1} value={scale} onChange={(e) => { const v = Number(e.target.value); setScale(v); writeLS(LS_SCALE, v) }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <label style={{ margin: 0 }}>面板宽度</label>
            <span className="rxw-menu-val">{panelW}px</span>
          </div>
          <input type="range" min={360} max={640} step={20} value={panelW} onChange={(e) => { const v = Number(e.target.value); setPanelW(v); writeLS(LS_PANEL_W, v) }} />

          <label>形象图片 URL</label>
          <input type="text" value={avatar} onChange={(e) => setAvatar(e.target.value)} onBlur={() => writeLS(LS_AVATAR, avatar)} />

          <div className="rxw-menu-row">
            <input type="checkbox" checked={bubbleOn} onChange={(e) => { setBubbleOn(e.target.checked); writeLS(LS_BUBBLE, e.target.checked) }} style={{ accentColor: '#1e3a5f' }} />
            <span>触发时自动弹出气泡</span>
          </div>

          <button className="rxw-btn ghost" style={{ width: '100%', marginTop: 10, padding: '7px 0', fontSize: 12 }} onClick={() => { setAvatar(MASCOT_URL); writeLS(LS_AVATAR, MASCOT_URL) }}>恢复默认形象</button>
        </div>
      )}

      {/* Management panel (light theme) */}
      {open && (
        <div className="rxw-panel" style={{ ...panelPos, width: panelW }}>
          <div className="rxw-head">
            <img src={avatar} alt="" onError={(e) => { (e.target as HTMLImageElement).src = MASCOT_URL }} />
            <div className="grow">
              <h1>dsh-reactor</h1>
              <p>事件驱动的 Agent 自动规则引擎</p>
            </div>
          </div>
          <div className="rxw-nav">
            <button className={view.name === 'overview' ? 'on' : ''} onClick={() => setView({ name: 'overview' })}>总览</button>
            <button className={view.name === 'rules' ? 'on' : ''} onClick={() => setView({ name: 'rules' })}>规则</button>
            <button className={view.name === 'new' ? 'on' : ''} onClick={() => setView({ name: 'new' })}>新建</button>
          </div>
          <div className="rxw-body">
            {view.name === 'overview' && (
              <>
                <div className="rxw-stats">
                  <Stat label="规则总数" value={stats?.totalRules ?? 0} />
                  <Stat label="启用中" value={stats?.enabledRules ?? 0} tone="#16a34a" />
                  <Stat label="累计触发" value={stats?.totalTriggers ?? 0} tone="#1e3a5f" />
                  <Stat label="执行动作" value={stats?.totalActions ?? 0} />
                  <Stat label="失败动作" value={stats?.failedActions ?? 0} tone={stats?.failedActions ? '#dc2626' : undefined} />
                  <Stat label="最近触发" value={fmtTime(stats?.lastTriggerAt)} />
                </div>
                <div className="rxw-card">
                  <div className="tl">最近事件</div>
                  {events.length === 0 ? (<div className="rxw-empty">暂无事件——创建规则后，轮询/推送事件会出现在这里</div>) : (
                    [...events].reverse().slice(0, 20).map((e) => (
                      <div key={e.seq} className="rxw-row" style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                        <span className="rxw-chip" style={{ background: `${EV_TYPES[e.type]?.tone ?? '#94a3b8'}1a`, color: EV_TYPES[e.type]?.tone ?? '#94a3b8' }}>{EV_TYPES[e.type]?.label ?? e.type}</span>
                        <span className="grow" style={{ color: '#334155', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.ruleName ?? e.ruleId}</span>
                        <span style={{ color: '#94a3b8', fontSize: 11 }}>{fmtTime(e.at)}</span>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
            {view.name === 'rules' && (
              rules.length === 0 ? (
                <div className="rxw-empty">还没有规则。<br /><button className="rxw-btn gold" style={{ marginTop: 14 }} onClick={() => setView({ name: 'new' })}>创建第一条规则</button></div>
              ) : (
                rules.map((r) => (<RuleRow key={r.id} rule={r} onToggle={onToggle} onDelete={onDelete} onOpen={(id) => setView({ name: 'detail', ruleId: id })} />))
              )
            )}
            {view.name === 'new' && <RuleForm api={api} onCreated={() => { setView({ name: 'rules' }); refresh() }} />}
            {view.name === 'detail' && <RuleDetail key={view.ruleId} ruleId={view.ruleId} api={api} onBack={() => setView({ name: 'rules' })} />}
          </div>
          {/* Footer with close button (not in corner) */}
          <div className="rxw-foot">
            <span className="rxw-foot-info">总触发 {stats?.totalTriggers ?? 0} · 总动作 {stats?.totalActions ?? 0}</span>
            <button className="rxw-close-btn" onClick={() => setOpen(false)}>
              <span>✕</span> 收起面板
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
