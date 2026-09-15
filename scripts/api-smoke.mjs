const base = 'http://127.0.0.1:3080'
const j = (r) => r.json().catch(() => r.text())

async function main() {
  // 1. webhook push
  let r = await fetch(base + '/reactor/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'error' }),
  })
  console.log('1 webhook:', r.status)

  // 2. create rule
  r = await fetch(base + '/reactor/api/rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'widget-test',
      source_kind: 'command',
      source_target: 'echo {"status":"ok"}',
      source_interval_ms: 60000,
      conditions: [{ field: '$.status', op: 'eq', value: 'ok' }],
      actions: [{ kind: 'webhook', target: 'https://httpbin.org/post' }],
    }),
  })
  const created = await j(r)
  console.log('2 create:', r.status, JSON.stringify(created))
  const id = created.rule_id

  // 3. list rules
  r = await fetch(base + '/reactor/api/rules')
  const list = await j(r)
  console.log('3 rules count:', list.rules.length, '| has widget-test:', list.rules.some((x) => x.name === 'widget-test'))

  // 4. history
  r = await fetch(base + '/reactor/api/history')
  const h = await j(r)
  console.log('4 history count:', h.records.length)

  // 5. stats
  r = await fetch(base + '/reactor/api/stats')
  const s = await j(r)
  console.log('5 stats:', JSON.stringify(s.stats))

  // 6. events
  r = await fetch(base + '/reactor/api/events?since=0')
  const e = await j(r)
  console.log('6 events seq:', e.seq, 'count:', e.events.length)

  // 7. delete test rule
  r = await fetch(base + '/reactor/api/rules?ruleId=' + id, { method: 'DELETE' })
  console.log('7 delete:', r.status, JSON.stringify(await j(r)))

  // 8. list again
  r = await fetch(base + '/reactor/api/rules')
  const list2 = await j(r)
  console.log('8 rules after delete:', list2.rules.map((x) => x.name))
}

main().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
