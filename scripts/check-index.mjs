const base = 'http://127.0.0.1:3080'
const token = process.argv[2] || 'Ur2f2CiQcJXQTFoeiuytt_fAfo7ZMDfH5JDn30thdr4'

async function main() {
  // 1. plain root
  let r = await fetch(base + '/')
  console.log('1 GET /:', r.status, 'len:', (await r.text()).length)

  // 2. root with token query
  r = await fetch(base + '/?token=' + token)
  const html = await r.text()
  console.log('2 GET /?token=:', r.status, 'len:', html.length)

  // 3. root with token header (common: x-dsh-token / authorization)
  r = await fetch(base + '/', { headers: { 'x-dsh-token': token } })
  console.log('3 GET / x-dsh-token:', r.status, 'len:', (await r.text()).length)
  r = await fetch(base + '/', { headers: { authorization: 'Bearer ' + token } })
  console.log('4 GET / bearer:', r.status, 'len:', (await r.text()).length)

  // if token query worked, search for boot markers
  if (html.length > 1000) {
    console.log('--- markers in /?token= ---')
    for (const m of ['__DSH_BOOT__', 'dsh-reactor', 'plugins/??', 'client.js', 'ModuleLoader', 'reactor-widget']) {
      console.log(' ', m, ':', html.includes(m))
    }
    // extract combo urls
    const combos = [...html.matchAll(/(\/plugins\/\?\?[^"'\\s]+)/g)].map((x) => x[1])
    console.log('combos:', combos)
    const boot = html.match(/__DSH_BOOT__\s*=\s*({[\s\S]{0,2000})/)
    if (boot) console.log('boot head:', boot[1].slice(0, 800))
  }
}

main().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
