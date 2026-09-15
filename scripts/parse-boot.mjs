import fs from 'node:fs'
const html = fs.readFileSync(process.env.TEMP + '\\dsh-index.html', 'utf8')
const m = html.match(/__DSH_BOOT__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/)
if (!m) {
  console.log('no boot found')
  process.exit(1)
}
const boot = JSON.parse(m[1].replace(/&amp;/g, '&'))
console.log('rev:', boot.rev, 'entries:', boot.entries.length)
for (const e of boot.entries) {
  if (e.id.includes('dsh-reactor') || e.id.includes('whale')) {
    console.log('--- entry ---')
    console.log(JSON.stringify(e, null, 2))
  }
}
fs.writeFileSync(process.env.TEMP + '\\dsh-boot.json', JSON.stringify(boot, null, 2))
