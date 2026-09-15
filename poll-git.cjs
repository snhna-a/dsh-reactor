// Poll remote HEAD SHA and emit JSON for dsh-reactor command source.
const { execSync } = require('node:child_process')
try {
  const out = execSync('git ls-remote https://github.com/snhna-a/dsh-reactor.git HEAD', {
    encoding: 'utf8',
    timeout: 30000,
  })
  const sha = out.trim().split(/\s+/)[0] || 'unknown'
  process.stdout.write(JSON.stringify({ hash: sha }))
} catch (e) {
  process.stdout.write(JSON.stringify({ hash: 'error', error: String(e.message || e).slice(0, 200) }))
}
