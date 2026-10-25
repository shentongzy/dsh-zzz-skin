import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'skin-live-'))
const m = await import('dsh-zzz-skin')
let t
m.apply({ effect: (f) => f(), webServer: { tapIndex: (fn) => { t = fn; return () => {} } }, inject: () => {}, logger: { info: () => {} } })
const out = t('<html><head></head><body></body></html>')
const check = (label, ok) => console.log((ok ? 'YES ' : 'NO  ') + label)
check('the big glowing pupil', out.includes('zzz-eye-pupil'))
check('spiral iris (radial fibres)', out.includes('zzz-iris-radial'))
check('iris cells (chords + diagonals)', out.includes('zzz-iris-chord') && out.includes('zzz-iris-diag'))
check('vignette focuses the eye', out.includes('zzz-vignette'))
check('rename script -> Fairy', out.includes('zzz-hdd-hud-rename') && out.includes('"Fairy"'))
check('css loaded from skin.css on disk', out.includes('.zzz-eye-pupil'))
check('injected exactly once', (out.match(/id="zzz-hdd-hud"/g) ?? []).length === 1)
check('no leftover ring-swirl from v2', !out.includes('zzz-core'))
console.log('\nserved html length:', out.length)
