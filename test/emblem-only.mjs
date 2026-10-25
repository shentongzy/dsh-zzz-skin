/**
 * 只渲染徽记本身（600px，黑底），用来和参考图做 1:1 对照。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'emblem-'))
const mod = await import('../lib/index.js')

let transform
mod.apply({
  effect: (fn) => fn(),
  webServer: {
    tapIndex: (fn) => {
      transform = fn
      return () => {}
    },
    register: () => () => {},
  },
  inject: () => {},
  logger: { info: () => {} },
})

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>emblem</title>
<style>
  html,body{margin:0;height:100%;background:#01040a;}
</style></head><body></body></html>`

// 覆盖样式必须排在注入样式**之后**（同优先级下后者胜），所以塞在 body 末尾
const OVERRIDE = `<style>
  #zzz-hdd-hud .fairy-emblem{
    left:50%; top:50%; bottom:auto; width:600px; height:600px;
    transform:translate(-50%,-50%); opacity:1; animation:none !important;
  }
  #zzz-hdd-hud .fairy-emblem::before{display:none;}
  #zzz-hdd-hud .fairy-grid{display:none;}
  #zzz-hdd-hud .fairy-layer,
  #zzz-hdd-hud .fairy-layer{animation:none !important;}
</style>`

const withOverride = PAGE.replace('</body>', `${OVERRIDE}</body>`)
// 预览是 file:// 页面，取不到宿主路由，把图片换成同一份本地文件
const layerFile = (name) => new URL(`../assets/emblem-${name}.png`, import.meta.url).href
const html = transform(withOverride).replace(
  /src="\/zzz-skin\/emblem\.png\?v=\d+&l=(outer|inner|eye|core|ring)"/g,
  (_m, layer) => `src="${layerFile(layer)}"`,
)
writeFileSync(new URL('./emblem.html', import.meta.url), html, 'utf8')
console.log('wrote emblem.html')

