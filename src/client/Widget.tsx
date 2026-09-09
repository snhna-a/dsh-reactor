/**
 * dsh-reactor — floating widget (v0.3)
 *
 * A draggable, resizable mascot bubble pinned to the bottom-right of the DSH
 * web shell. It shows live rule statistics, notifies on every trigger / error,
 * and expands into a full management panel: rule CRUD, trigger history,
 * action logs, token consumption and failure analysis.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactorApi, type Rule, type RuleAction, type RuleCondition, type Stats, type TriggerRecord, type ReactorEvent } from './api.js'

/** Default mascot (generated IP artwork). Users can override in settings. */
const MASCOT_URL =
  'https://aka.doubaocdn.com/s/8v2xtHluPo'

const LS_SCALE = 'dsh-reactor:scale'
const LS_POS = 'dsh-reactor:pos'
const LS_AVATAR = 'dsh-reactor:avatar'

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
    /* private mode etc. — ignore */
  }
}

const EV_TYPES: Record<string, { label: string; tone: string }> = {
  'rule-triggered': { label: '触发', tone: '#4ade80' },
  'rule-added': { label: '新规则', tone: '#38bdf8' },
  'rule-updated': { label: '规则更新', tone: '#38bdf8' },
  'rule-error': { label: '规则错误', tone: '#fb923c' },
  'action-failed': { label: '动作失败', tone: '#f87171' },
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

const CSS = `
.rxw-root, .rxw-root * { box-sizing: border-box; }
.rxw-root { position: fixed; z-index: 2147483000; font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.rxw-mascot { position: relative; width: 64px; height: 64px; border-radius: 50%; cursor: grab; touch-action: none; user-select: none; box-shadow: 0 6px 24px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.08) inset; transition: transform .12s ease, box-shadow .12s ease; }
.rxw-mascot:hover { box-shadow: 0 8px 30px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.12) inset; }
.rxw-mascot:active { cursor: grabbing; transform: scale(.96); }
.rxw-mascot img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block; pointer-events: none; }
.rxw-badge { position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px; background: #f87171; color: #fff; font-size: 11px; font-weight: 700; line-height: 20px; text-align: center; box-shadow: 0 2px 8px rgba(248,113,113,.5); }
.rxw-toasts { position: absolute; right: 0; bottom: calc(100% + 10px); display: flex; flex-direction: column; gap: 8px; width: 280px; }
.rxw-toast { background: rgba(17,24,39,.92); border: 1px solid rgba(255,255,255,.1); border-left: 3px solid var(--tone, #38bdf8); border-radius: 12px; padding: 8px 12px; color: #e5e7eb; font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.4); backdrop-filter: blur(8px); animation: rxw-in .18s ease-out; }
.rxw-toast b { display: block; font-size: 12px; margin-bottom: 2px; color: var(--tone, #38bdf8); }
.rxw-toast span { color: #9ca3af; }
@keyframes rxw-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.rxw-panel { position: fixed; display: flex; flex-direction: column; width: 420px; max-width: calc(100vw - 20px); height: min(620px, calc(100vh - 40px)); background: rgba(13,18,28,.96); border: 1px solid rgba(255,255,255,.1); border-radius: 16px; box-shadow: 0 16px 60px rgba(0,0,0,.55); color: #e5e7eb; font-size: 13px; overflow: hidden; backdrop-filter: blur(14px); }
.rxw-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: rgba(255,255,255,.04); border-bottom: 1px solid rgba(255,255,255,.08); }
.rxw-head img { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; }
.rxw-head h1 { font-size: 14px; font-weight: 600; margin: 0; color: #f8fafc; }
.rxw-head p { margin: 0; font-size: 11px; color: #64748b; }
.rxw-nav { display: flex; gap: 4px; padding: 8px 10px 0; }
.rxw-nav button { flex: 1; background: transparent; border: none; color: #94a3b8; font-size: 12px; padding: 7px 0 9px; cursor: pointer; border-bottom: 2px solid transparent; transition: color .12s; }
.rxw-nav button.on { color: #38bdf8; border-bottom-color: #38bdf8; font-weight: 600; }
.rxw-body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.rxw-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; }
.rxw-stat { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.07); border-radius: 12px; padding: 10px; }
.rxw-stat b { display: block; font-size: 20px; font-weight: 700; color: #f8fafc; }
.rxw-stat span { font-size: 11px; color: #64748b; }
.rxw-card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 10px 12px; }
.rxw-row { display: flex; align-items: center; gap: 8px; }
.rxw-row .grow { flex: 1; min-width: 0; }
.rxw-name { font-weight: 600; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rxw-meta { font-size: 11px; color: #64748b; margin-top: 2px; }
.rxw-chip { display: inline-block; font-size: 10px; padding: 1px 7px; border-radius: 8px; background: rgba(56,189,248,.14); color: #38bdf8; margin-right: 6px; }
.rxw-chip.green { background: rgba(74,222,128,.12); color: #4ade80; }
.rxw-chip.red { background: rgba(248,113,113,.12); color: #f87171; }
.rxw-switch { width: 34px; height: 18px; border-radius: 9px; border: none; cursor: pointer; position: relative; background: rgba(255,255,255,.15); transition: background .15s; flex: none; }
.rxw-switch.on { background: #22c55e; }
.rxw-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: left .15s; }
.rxw-switch.on::after { left: 18px; }
.rxw-icon-btn { background: transparent; border: none; color: #64748b; cursor: pointer; font-size: 14px; padding: 4px 6px; border-radius: 8px; }
.rxw-icon-btn:hover { color: #f87171; background: rgba(248,113,113,.1); }
.rxw-btn { background: #0ea5e9; color: #fff; border: none; border-radius: 10px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
.rxw-btn:hover { background: #0284c7; }
.rxw-btn.ghost { background: rgba(255,255,255,.08); color: #cbd5e1; }
.rxw-btn.danger { background: rgba(248,113,113,.16); color: #f87171; }
.rxw-field { margin-bottom: 10px; }
.rxw-field label { display: block; font-size: 11px; color: #94a3b8; margin-bottom: 4px; }
.rxw-field input, .rxw-field select, .rxw-field textarea { width: 100%; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 8px; color: #e5e7eb; padding: 7px 10px; font-size: 12px; }
.rxw-field input:focus, .rxw-field select:focus, .rxw-field textarea:focus { outline: none; border-color: #0ea5e9; }
.rxw-cond { display: grid; grid-template-columns: 1fr 84px 1fr 26px; gap: 6px; margin-bottom: 6px; }
.rxw-log { font-size: 12px; color: #cbd5e1; }
.rxw-log b { color: #e2e8f0; font-weight: 600; }
.rxw-log .ok { color: #4ade80; }
.rxw-log .err { color: #f87171; }
.rxw-empty { color: #475569; text-align: center; padding: 24px 0; font-size: 12px; }
.rxw-set { position: absolute; left: 0; bottom: 0; width: 220px; background: rgba(13,18,28,.98); border: 1px solid rgba(255,255,255,.12); border-radius: 12px; padding: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.5); z-index: 2; }
.rxw-set label { display: block; font-size: 11px; color: #94a3b8; margin: 6px 0 4px; }
.rxw-set input[type=range] { width: 100%; }
.rxw-set input[type=text] { width: 100%; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 8px; color: #e5e7eb; padding: 6px 8px; font-size: 12px; }
.rxw-foot { padding: 8px 14px; border-top: 1px solid rgba(255,255,255,.07); display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #64748b; }
.rxw-detail { font-size: 12px; }
.rxw-detail .tl { color: #94a3b8; margin-bottom: 4px; }
`

function injectCss(): void {
  const id = 'dsh-reactor-style'
  if (document.getElementById(id)) return
  const el = document.createElement('style')
  el.id = id
  el.textContent = CSS
  document.head.appendChild(el)
}

// ─── small building blocks ──────────────────────────────────────

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rxw-stat">
      <b style={tone ? { color: tone } : undefined}>{value}</b>
      <span>{label}</span>
    </div>
  )
}

function RuleRow({
  rule,
  onToggle,
  onDelete,
  onOpen,
}: {
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
          onClick={(e) => {
            e.stopPropagation()
            onToggle(rule.id, !rule.enabled)
          }}
        />
        <button
          className="rxw-icon-btn"
          title="删除规则"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(rule.id)
          }}
        >
          ✕
        </button>
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
            {Object.entries(OP_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          {c.op === 'exists' || c.op === 'changed' ? (
            <span />
          ) : (
            <input
              placeholder="值"
              value={String(c.value ?? '')}
              onChange={(e) => update(i, { value: e.target.value })}
            />
          )}
          <button
            className="rxw-icon-btn"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >✕</button>
        </div>
      ))}
      <button
        className="rxw-btn ghost"
        style={{ padding: '4px 10px', fontSize: 12 }}
        onClick={() => onChange([...value, { field: '$.status', op: 'eq', value: 'ok' }])}
      >
        + 条件
      </button>
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
          <select
            value={a.kind}
            style={{ width: 110, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, color: '#e5e7eb', padding: '7px 6px', fontSize: 12 }}
            onChange={(e) => update(i, { kind: e.target.value as RuleAction['kind'] })}
          >
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <input
            placeholder={a.kind === 'agent-talk' ? '注入给 Agent 的提示词' : a.kind === 'webhook' ? 'https://…' : '命令'}
            style={{ flex: 1, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, color: '#e5e7eb', padding: '7px 10px', fontSize: 12 }}
            value={a.target}
            onChange={(e) => update(i, { target: e.target.value })}
          />
          <button className="rxw-icon-btn" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button
        className="rxw-btn ghost"
        style={{ padding: '4px 10px', fontSize: 12 }}
        onClick={() => onChange([...value, { kind: 'shell', target: '' }])}
      >
        + 动作
      </button>
    </div>
  )
}

// ─── detail view ────────────────────────────────────────────────

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
    return () => {
      alive = false
    }
  }, [api, ruleId])

  const failed = history.filter((h) => h.actions?.some((a) => !a.ok))

  return (
    <div className="rxw-detail">
      <div className="rxw-row" style={{ marginBottom: 10 }}>
        <button className="rxw-btn ghost" onClick={onBack} style={{ padding: '5px 10px', fontSize: 12 }}>← 返回</button>
        <div className="grow">
          <div className="rxw-name">{rule?.name ?? ruleId}</div>
          <div className="rxw-meta">
            {rule ? <span className="rxw-chip">{SOURCE_LABELS[rule.source.kind] ?? rule.source.kind}</span> : null}
            {rule ? <span className="rxw-chip">{rule.conditions.length} 条件 / {rule.actions.length} 动作</span> : null}
            {failed.length ? <span className="rxw-chip red">{failed.length} 次含失败</span> : null}
          </div>
        </div>
      </div>

      {rule?.description ? <div className="rxw-card" style={{ marginBottom: 8 }}>{rule.description}</div> : null}

      <div className="rxw-card" style={{ marginBottom: 8 }}>
        <div className="tl">执行历史（最近 {history.length} 条）</div>
        {history.length === 0 ? (
          <div className="rxw-empty">还没有触发记录</div>
        ) : (
          [...history].reverse().map((h) => {
            const fail = h.actions?.find((a) => !a.ok)
            return (
              <div key={h.id} style={{ borderBottom: '1px solid rgba(255,255,255,.06)', padding: '7px 0' }}>
                <div className="rxw-row">
                  <span className={`rxw-chip ${h.matched ? 'green' : ''}`} style={h.matched ? undefined : { background: 'rgba(148,163,184,.12)', color: '#94a3b8' }}>
                    {h.matched ? '命中' : '未命中'}
                  </span>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>{fmtTime(h.at)}</span>
                  {h.sessionResult?.tokens ? <span className="rxw-chip">Tokens {fmtTokens(h.sessionResult.tokens)}</span> : null}
                  {fail ? <span className="rxw-chip red">失败：{(fail.error ?? '').slice(0, 60)}</span> : null}
                </div>
                {h.actions?.map((a, i) => (
                  <div key={i} className="rxw-log" style={{ marginTop: 4 }}>
                    <span className={a.ok ? 'ok' : 'err'}>[{a.ok ? '✓' : '✗'}]</span>{' '}
                    <b>{ACTION_LABELS[a.kind] ?? a.kind}</b> {a.target.slice(0, 60)}
                    {a.attempts && a.attempts > 1 ? ` · 重试 ${a.attempts - 1} 次` : ''}
                    {a.error ? <span className="err"> — {a.error.slice(0, 80)}</span> : null}
                    {a.attemptLog?.map((at, j) =>
                      !at.ok ? (
                        <div key={j} style={{ color: '#f87171', fontSize: 11, marginLeft: 14 }}>
                          第 {at.at + 1} 次尝试失败（{at.ms}ms）：{at.error?.slice(0, 80)}
                        </div>
                      ) : null,
                    )}
                  </div>
                ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── main widget ────────────────────────────────────────────────

export function ReactorWidget() {
  const api = useMemo(() => new ReactorApi(), [])
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>({ name: 'overview' })
  const [rules, setRules] = useState<Rule[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [events, setEvents] = useState<ReactorEvent[]>([])
  const [lastSeq, setLastSeq] = useState(0)
  const [scale, setScale] = useState(() => readLS(LS_SCALE, 1))
  const [pos, setPos] = useState(() => readLS<{ x: number; y: number } | null>(LS_POS, null))
  const [avatar, setAvatar] = useState(() => readLS(LS_AVATAR, MASCOT_URL))
  const [showSet, setShowSet] = useState(false)
  const [toasts, setToasts] = useState<ReactorEvent[]>([])
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(() => {
    api.listRules().then((r) => setRules(r.rules)).catch(() => {})
    api.stats().then((s) => setStats(s.stats)).catch(() => {})
  }, [api])

  // bootstrap + periodic refresh
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
            setToasts((prev) => [...res.events.slice(-3), ...prev].slice(0, 3))
            // refresh data when anything happened
            refresh()
          }
        }
      }).catch(() => {})
    }, 5000)
    return () => {
      window.clearInterval(t1)
      window.clearInterval(t2)
    }
  }, [api, lastSeq, refresh])

  // auto-dismiss toasts
  useEffect(() => {
    if (!toasts.length) return
    const t = window.setTimeout(() => setToasts((prev) => prev.slice(0, -1)), 4500)
    return () => window.clearTimeout(t)
  }, [toasts])

  const unread = events.filter((e) => e.type === 'rule-triggered' || e.type === 'rule-error' || e.type === 'action-failed').length

  const onToggle = useCallback(
    (id: string, enabled: boolean) => {
      api.updateRule(id, { enabled }).then(() => refresh()).catch(() => {})
    },
    [api, refresh],
  )

  const onDelete = useCallback(
    (id: string) => {
      if (!window.confirm('确认删除这条规则？此操作不可恢复。')) return
      api.deleteRule(id).then(() => refresh()).catch(() => {})
    },
    [api, refresh],
  )

  const dragStart = (e: React.PointerEvent) => {
    if (open || showSet) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos?.x ?? window.innerWidth - 90, oy: pos?.y ?? window.innerHeight - 90 }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const dragMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const x = Math.max(8, Math.min(window.innerWidth - 80, d.ox + (e.clientX - d.sx)))
    const y = Math.max(8, Math.min(window.innerHeight - 80, d.oy + (e.clientY - d.sy)))
    setPos({ x, y })
    writeLS(LS_POS, { x, y })
  }
  const dragEnd = () => {
    dragRef.current = null
  }

  const mascotStyle: React.CSSProperties = {
    transform: `scale(${scale})`,
    transformOrigin: 'bottom right',
  }
  const rootStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { right: 18, bottom: 18 }

  const panelStyle: React.CSSProperties = pos
    ? { left: Math.max(8, pos.x - 420 + 64), top: Math.max(8, pos.y - 420) }
    : { right: 18, bottom: 92 }

  return (
    <div className="rxw-root" ref={rootRef} style={rootStyle}>
      {toasts.length > 0 && !open ? (
        <div className="rxw-toasts">
          {toasts.map((t, i) => (
            <div key={`${t.seq}-${i}`} className="rxw-toast" style={{ '--tone': EV_TYPES[t.type]?.tone ?? '#38bdf8' } as React.CSSProperties}>
              <b>{EV_TYPES[t.type]?.label ?? t.type} · {t.ruleName ?? t.ruleId}</b>
              {t.type === 'rule-triggered' ? <span>{t.matched ? '条件命中，已执行动作' : '轮询完成，条件未命中'}{t.triggerCount ? `（累计 ${t.triggerCount} 次）` : ''}</span> : null}
              {t.error ? <span>{t.error.slice(0, 120)}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div
        className="rxw-mascot"
        style={mascotStyle}
        onPointerDown={dragStart}
        onPointerMove={dragMove}
        onPointerUp={dragEnd}
        onClick={() => {
          if (dragRef.current) return
          setOpen((v) => !v)
        }}
      >
        <img src={avatar} alt="dsh-reactor" />
        {unread > 0 && !open ? <span className="rxw-badge">{unread > 99 ? '99+' : unread}</span> : null}
        {!open && (
          <button
            className="rxw-icon-btn"
            style={{ position: 'absolute', left: -18, top: 0, color: '#64748b', fontSize: 13 }}
            onClick={(e) => {
              e.stopPropagation()
              setShowSet((v) => !v)
            }}
          >⚙</button>
        )}
        {showSet && !open ? (
          <div className="rxw-set" onClick={(e) => e.stopPropagation()}>
            <label>大小 {scale.toFixed(1)}x</label>
            <input
              type="range" min={0.6} max={2.5} step={0.1}
              value={scale}
              onChange={(e) => {
                const v = Number(e.target.value)
                setScale(v)
                writeLS(LS_SCALE, v)
              }}
            />
            <label>形象图片 URL</label>
            <input
              type="text" value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
              onBlur={() => writeLS(LS_AVATAR, avatar)}
            />
            <button
              className="rxw-btn ghost" style={{ width: '100%', marginTop: 8, padding: '5px 0', fontSize: 12 }}
              onClick={() => {
                setAvatar(MASCOT_URL)
                writeLS(LS_AVATAR, MASCOT_URL)
              }}
            >
              恢复默认形象
            </button>
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="rxw-panel" style={panelStyle}>
          <div className="rxw-head">
            <img src={avatar} alt="" />
            <div className="grow">
              <h1>dsh-reactor</h1>
              <p>事件驱动的 Agent 自动规则引擎</p>
            </div>
            <button className="rxw-icon-btn" onClick={() => setOpen(false)} style={{ fontSize: 16 }}>✕</button>
          </div>
          <div className="rxw-nav">
            <button className={view.name === 'overview' ? 'on' : ''} onClick={() => setView({ name: 'overview' })}>总览</button>
            <button className={view.name === 'rules' ? 'on' : ''} onClick={() => setView({ name: 'rules' })}>规则</button>
            <button className={view.name === 'new' ? 'on' : ''} onClick={() => setView({ name: 'new' })}>新建</button>
          </div>
          <div className="rxw-body">
            {view.name === 'overview' ? (
              <>
                <div className="rxw-stats">
                  <Stat label="规则总数" value={stats?.totalRules ?? 0} />
                  <Stat label="启用中" value={stats?.enabledRules ?? 0} tone="#4ade80" />
                  <Stat label="累计触发" value={stats?.totalTriggers ?? 0} tone="#38bdf8" />
                  <Stat label="执行动作" value={stats?.totalActions ?? 0} />
                  <Stat label="失败动作" value={stats?.failedActions ?? 0} tone={stats?.failedActions ? '#f87171' : undefined} />
                  <Stat label="最近触发" value={fmtTime(stats?.lastTriggerAt)} />
                </div>
                <div className="rxw-card">
                  <div className="tl" style={{ color: '#94a3b8', marginBottom: 6 }}>最近事件</div>
                  {events.length === 0 ? (
                    <div className="rxw-empty">暂无事件——创建规则后，轮询/推送事件会出现在这里</div>
                  ) : (
                    [...events].reverse().slice(0, 20).map((e) => (
                      <div key={e.seq} className="rxw-row" style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                        <span className="rxw-chip" style={{ '--tone': EV_TYPES[e.type]?.tone } as React.CSSProperties}>
                          {EV_TYPES[e.type]?.label ?? e.type}
                        </span>
                        <span className="grow" style={{ color: '#cbd5e1', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.ruleName ?? e.ruleId}
                        </span>
                        <span style={{ color: '#64748b', fontSize: 11 }}>{fmtTime(e.at)}</span>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : null}

            {view.name === 'rules' ? (
              rules.length === 0 ? (
                <div className="rxw-empty">
                  还没有规则。
                  <br />
                  <button className="rxw-btn" style={{ marginTop: 10 }} onClick={() => setView({ name: 'new' })}>创建第一条规则</button>
                </div>
              ) : (
                rules.map((r) => (
                  <RuleRow key={r.id} rule={r} onToggle={onToggle} onDelete={onDelete} onOpen={(id) => setView({ name: 'detail', ruleId: id })} />
                ))
              )
            ) : null}

            {view.name === 'new' ? <RuleForm api={api} onCreated={() => { setView({ name: 'rules' }); refresh() }} /> : null}

            {view.name === 'detail' ? (
              <RuleDetail key={view.ruleId} ruleId={view.ruleId} api={api} onBack={() => setView({ name: 'rules' })} />
            ) : null}
          </div>
          <div className="rxw-foot">
            <span>总触发 {stats?.totalTriggers ?? 0} · 总动作 {stats?.totalActions ?? 0}</span>
            <button className="rxw-btn ghost" style={{ padding: '3px 10px', fontSize: 11 }} onClick={refresh}>刷新</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ─── create-rule form ───────────────────────────────────────────

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
    if (!name.trim()) {
      setErr('请填写规则名称')
      return
    }
    if (!target.trim()) {
      setErr('请填写事件源目标')
      return
    }
    const cleanActions = actions.filter((a) => a.target.trim())
    if (!cleanActions.length) {
      setErr('至少需要一个动作')
      return
    }
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
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {presets.map((p) => (
          <button
            key={p.label}
            className="rxw-btn ghost"
            style={{ padding: '4px 10px', fontSize: 11 }}
            onClick={() => {
              setKind(p.kind)
              setTarget(p.target)
              if (p.intervalMs) setIntervalMs(p.intervalMs)
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="rxw-field">
        <label>规则名称</label>
        <input value={name} placeholder="例如：GitHub 新版本自动拉取并运行" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="rxw-field">
        <label>事件源类型</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as Rule['source']['kind'])}>
          {Object.entries(SOURCE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <div className="rxw-field">
        <label>{kind === 'file-watch' ? '文件路径' : kind === 'http-poll' ? '轮询 URL' : kind === 'webhook' ? 'Webhook 路径（推送 JSON 到此）' : '命令（输出 JSON 作为事件载荷）'}</label>
        <input value={target} onChange={(e) => setTarget(e.target.value)} />
      </div>
      {kind === 'http-poll' || kind === 'command' ? (
        <div className="rxw-field">
          <label>轮询间隔（毫秒）</label>
          <input type="number" value={intervalMs} onChange={(e) => setIntervalMs(Number(e.target.value))} />
        </div>
      ) : null}
      <div className="rxw-field">
        <label>条件（JSONPath 字段 + 比较符）</label>
        <ConditionEditor value={conditions} onChange={setConditions} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>组合逻辑</span>
          <select value={logic} onChange={(e) => setLogic(e.target.value as 'AND' | 'OR')} style={{ width: 80 }}>
            <option value="AND">全部满足</option>
            <option value="OR">任一满足</option>
          </select>
        </div>
      </div>
      <div className="rxw-field">
        <label>动作（命中后执行）</label>
        <ActionEditor value={actions} onChange={setActions} />
      </div>
      {err ? <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{err}</div> : null}
      <button className="rxw-btn" style={{ width: '100%' }} disabled={busy} onClick={submit}>
        {busy ? '创建中…' : '创建规则'}
      </button>
    </div>
  )
}
