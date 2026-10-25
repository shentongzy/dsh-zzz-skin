/**
 * 离线排障夹具：把真实应用里的侧栏品牌行结构 + 真实的 SidebarRoot CSS
 * 还原成一个静态页面，再让 dsh-zzz-skin 的浏览器半边在它上面跑一遍。
 *
 * 目的：不重启桌面应用，也能验证
 *   ① 折叠按钮里的 svg 有没有被藏掉（原 bug）；
 *   ② 重新展开时品牌字标会不会闪出来（CSS 兜底是否真的从第一帧就藏住）；
 *   ③ 左上角的 Fairy 覆盖层有没有正确铺上。
 *
 * 用法：node test/harness.mjs  → 生成 test/harness.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = fileURLToPath(new URL('../', import.meta.url))

// 从 app.asar 里导出来的 SidebarRoot 客户端，只为拿它的 CSS 字符串
// （test/fixtures/sidebar-client.js 是 dsh-client-ui-sidebar@当前安装版本的原样拷贝，
//   只想换一份新版本时用 SIDEBAR_CLIENT 指过去即可）
const SIDEBAR_CLIENT =
  process.env.SIDEBAR_CLIENT || fileURLToPath(new URL('./fixtures/sidebar-client.js', import.meta.url))

const sidebarSrc = readFileSync(SIDEBAR_CLIENT, 'utf8')
const cssMatch = sidebarSrc.match(/const css = ("(?:[^"\\]|\\.)*");/)
if (!cssMatch) throw new Error('SidebarRoot css string not found')
const appCss = JSON.parse(cssMatch[1])

const skinCss = readFileSync(`${root}lib/skin.css`, 'utf8')
const clientJs = readFileSync(`${root}lib/client.js`, 'utf8')

const OVERLAY = `<div id="zzz-hdd-hud" aria-hidden="true">
<div class="fairy-sky"></div>
<div class="fairy-grid"></div>
<div class="fairy-emblem">
  <div class="fairy-bloom"></div>
  <div class="fairy-bloom fairy-bloom--tight"></div>
  <img class="fairy-layer fairy-layer--outer" src="/zzz-skin/emblem.png?v=0&l=outer" alt="" draggable="false">
  <img class="fairy-layer fairy-layer--core" src="/zzz-skin/emblem.png?v=0&l=core" alt="" draggable="false">
  <img class="fairy-layer fairy-layer--ring" src="/zzz-skin/emblem.png?v=0&l=ring" alt="" draggable="false">
</div>
<div class="fairy-scan"></div>
<div class="fairy-frame"><i></i><i></i><i></i><i></i></div>
</div>`

const PAYLOAD = JSON.stringify({
  css: skinCss,
  html: OVERLAY,
  renameFrom: 'DeepSeek Harness',
  renameTo: 'Fairy',
})

const FISH = `<svg class="fish" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#4d6bfe"/></svg>`
const WORDMARK = `<svg class="wordmark" width="132" height="22" viewBox="0 0 132 22"><text x="0" y="17" font-size="18" fill="#e8e6ee">DeepSeek</text></svg>`

const html = `<!doctype html>
<html data-windows-titlebar>
<head>
<meta charset="utf-8">
<title>harness</title>
<style id="app-css">${appCss}
:root{--dsh-windows-titlebar-height:40px;--dsw-specific-sidebar-fill:#01030a;--dsw-alias-label-primary:#e8e6ee;--dsw-alias-bg-base:#01040a;--dsw-alias-label-secondary:#8fa3c4;--dsw-radius-sm:6px;--dsw-radius-md:10px;--ds-ease-in-out:cubic-bezier(.4,0,.2,1)}
html,body{margin:0;height:100%;background:#01040a;color:#e8e6ee;font:14px/1.4 system-ui,'Segoe UI',sans-serif}
/* 复刻 dsh-client-ui-layout 的 Windows 标题栏：所有列上方先让出 40px */
[data-windows-titlebar] .BynINW_frame{box-sizing:border-box;padding-top:var(--dsh-windows-titlebar-height);height:100%}
</style>
</head>
<body>
<div class="BynINW_frame" style="display:flex;height:100%;padding-top:40px;box-sizing:border-box">
  <div class="side" style="width:280px;flex:0 0 auto;height:100%">
    <div class="_2H3hWW_root _2H3hWW_quietBars" id="root" style="width:280px">
      <div class="_2H3hWW_logoRow" data-window-drag="true" id="logoRow">
        <button type="button" class="_2H3hWW_brand _2H3hWW_wide" id="brandBtn" aria-label="新建会话">
          <span class="_2H3hWW_brandIdentity" aria-hidden="true">
            <span class="_2H3hWW_brandMark">${FISH}</span>
            <span class="_2H3hWW_brandName">${WORDMARK}</span>
          </span>
        </button>
        <button type="button" class="_2H3hWW_iconButton _2H3hWW_toggle" id="toggle" aria-label="收起侧边栏">
          <svg class="_2H3hWW_panelIcon" width="16" height="16" viewBox="0 0 16 16"><path d="M2 3h12M2 8h7M2 13h12" stroke="currentColor" stroke-width="1.5"/></svg>
        </button>
      </div>
      <button type="button" class="_2H3hWW_newSession" style="margin-top:8px">新建会话</button>
      <div class="_2H3hWW_panelList" style="flex:1;overflow-y:auto;padding:8px 0">
        <div style="height:60px">会话 A</div><div style="height:60px">会话 B</div>
      </div>
    </div>
  </div>
  <div class="content" style="flex:1;overflow-y:auto;padding:24px">正文</div>
</div>
<script>
  window.__beacons = []
  window.__ModuleLoader__ = { load: ({ factory }) => { window.__plugin = factory() } }
  window.fetch = async (url, opts) => {
    const u = String(url)
    // #disabled 模拟 /skin off 之后的真机：宿主说皮肤关着
    const disabled = location.hash === '#disabled'
    if (u.includes('/zzz-skin/status')) {
      return new Response(JSON.stringify({ enabled: !disabled }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (disabled) return new Response('', { status: 204 })
    if (u.includes('payload.js')) {
      // #nopayload 模拟「皮肤载荷还没到」的首帧现场：请求永远挂着
      if (location.hash === '#nopayload') return new Promise(() => {})
      return new Response(${JSON.stringify(PAYLOAD)}, { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (u.includes('beacon')) {
      try { window.__beacons.push(JSON.parse(opts && opts.body)) } catch {}
      return new Response('', { status: 204 })
    }
    return new Response('', { status: 404 })
  }
</script>
<script>${clientJs}</script>
<script>
  if (!window.__plugin) throw new Error('plugin not registered')
  window.__plugin.apply({ effect: (fn) => { fn() } })
</script>
</body>
</html>`

writeFileSync(`${here}harness.html`, html)
console.log('wrote', `${here}harness.html`, html.length, 'bytes')
