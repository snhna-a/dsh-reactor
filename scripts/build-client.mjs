/**
 * dsh-reactor — client bundle builder (v0.3)
 *
 * Produces `lib/client.js` in the exact format the DSH web client expects:
 *
 *   window.__ModuleLoader__.load({
 *     id: 'dsh-reactor',
 *     factory: (require) => { ...; return module.exports }
 *   })
 *
 * `react` stays external and is resolved through the factory `require` at
 * runtime (the module table provides it). esbuild emits `var __require =
 * ...typeof require !== 'undefined' ? require ...`, which lexically resolves
 * to the factory parameter once the bundle is wrapped inside it.
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const outFile = join(root, '..', 'lib', 'client.js')
const outMap = join(root, '..', 'lib', 'client.js.map')

mkdirSync(dirname(outFile), { recursive: true })

const result = await build({
  entryPoints: [join(root, '..', 'src', 'client', 'index.ts')],
  outfile: outFile,
  bundle: true,
  format: 'iife',
  globalName: '__dshReactorExports',
  platform: 'browser',
  jsx: 'transform',
  target: 'es2020',
  external: ['react', 'react-dom'],
  write: false,
  sourcemap: true,
  logLevel: 'info',
  metafile: false,
})

const bundleFile = result.outputFiles.find((f) => f.path.endsWith('.js'))
const mapFile = result.outputFiles.find((f) => f.path.endsWith('.map'))
if (!bundleFile) throw new Error('esbuild produced no js output')

const bundleCode = bundleFile.text
const mapCode = mapFile ? mapFile.text : ''

const wrapped = `window.__ModuleLoader__.load({
  id: "dsh-reactor",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${bundleCode}
    module.exports = (typeof __dshReactorExports !== "undefined" ? __dshReactorExports : module.exports);
    return module.exports;
  }
});
${mapCode ? `//# sourceMappingURL=client.js.map` : ''}
`

writeFileSync(outFile, wrapped)
if (mapCode) {
  // strip sourcesContent already handled by esbuild; keep the map as-is
  writeFileSync(outMap, mapCode)
}

// The raw esbuild IIFE is embedded above; nothing else to clean.
console.log(`[build-client] wrote ${outFile} (${wrapped.length} bytes)`)
