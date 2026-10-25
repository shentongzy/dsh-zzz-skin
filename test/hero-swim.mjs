#!/usr/bin/env node
/**
 * 主视觉「游动」速度回归：量那枚大眼睛从侧栏底部滑到画面中央到底花了多久。
 *
 * 存在的理由：这趟移动是入库表演，不是跟手操作 —— 之前和「拖侧栏」共用 0.34s，
 * 横跨大半个屏幕只给三分之一秒，看起来是被拽过去的。现在拆成两档
 * （DOCK_MS=340 / SWIM_MS=1200），这个脚本就负责盯住「真的走 1.2 秒」这件事，
 * 而不是只检查代码里那个常数。
 *
 * 用法：node test/hero-swim.mjs [--port=9333]（需要带调试端口的 Edge，
 *       见 ../browser-automation/launch-edge.ps1）
 */
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const PORT = args.port || process.env.CDP_PORT || 9333
const CDP = `http://127.0.0.1:${PORT}`
const SHOT_DIR = args.shot ? resolve(String(args.shot)) : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const skinCss = readFileSync(`${root}lib/skin.css`, 'utf8')
const clientJs = readFileSync(`${root}lib/client.js`, 'utf8')
const LAYERS = {
  outer: readFileSync(`${root}assets/emblem-outer.png`),
  core: readFileSync(`${root}assets/emblem-core.png`),
  ring: readFileSync(`${root}assets/emblem-ring.png`),
}

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

const LIST = Array.from({ length: 8 }, (_, i) => `<div>会话 ${i + 1}</div>`).join('')

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>hero swim</title>
<style id="skin-css">${skinCss}</style>
<style>
html,body{margin:0;height:100%;background:#01040a;color:#e8e6ee;font:14px/1.4 system-ui,'Segoe UI',sans-serif}
.app{display:flex;height:100%}
.side{width:280px;flex:0 0 auto;height:100%;display:flex;flex-direction:column;border-right:1px solid rgba(90,140,220,.35);box-sizing:border-box}
.side .list{flex:1;overflow-y:auto;padding:8px 0}
.side .list>div{height:60px}
.main{flex:1;overflow-y:auto;padding:24px}
.Hqq-bq_headline{width:760px;height:460px;margin:32px auto 0}
</style></head>
<body>
<div class="app">
  <div class="side"><div class="list">${LIST}</div></div>
  <div class="main"><div class="Hqq-bq_headline"></div><div style="height:900px">正文</div></div>
</div>
${OVERLAY}
<script>
  window.__ModuleLoader__ = { load: ({ factory }) => { window.__plugin = factory() } }
  window.fetch = async (url) => {
    const u = String(url)
    if (u.includes('/zzz-skin/status')) return new Response(JSON.stringify({ enabled: true }), { status: 200 })
    if (u.includes('payload.js')) return new Response(JSON.stringify({ css: '', html: '', renameFrom: 'DeepSeek Harness', renameTo: 'Fairy' }), { status: 200 })
    if (u.includes('beacon')) return new Response('', { status: 204 })
    return new Response('', { status: 404 })
  }
  // 逐帧记录徽记的位置，用来量「这趟到底走了多久」（记浮点，别把亚像素动效抹掉）
  window.__sample = (ms) => new Promise((resolve) => {
    const out = []
    const t0 = performance.now()
    const step = () => {
      const el = document.querySelector('#zzz-hdd-hud .fairy-emblem')
      if (el) {
        const r = el.getBoundingClientRect()
        out.push([Math.round(performance.now() - t0), Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10])
      }
      if (performance.now() - t0 < ms) requestAnimationFrame(step)
      else resolve(out)
    }
    requestAnimationFrame(step)
  })
</script>
<script>${clientJs}</script>
<script>window.__plugin.apply({ effect: (fn) => { fn() } })</script>
</body></html>`

/**
 * 从逐帧位置里量出「第一次动」到「贴住终点不再动」的毫秒数。
 *
 * 不能用「和第一帧不同」当判据：徽记到了终点以后，每一帧都还是「和第一帧不同」，
 * 那样量出来会是整个采样窗口。这里改成：先找第一次位移，再找**之后一直贴着终点**
 * （±1.2px，容得下 1px 的四舍五入抖动）的那一帧。
 */
function travel(trace) {
  const dist = (a, b) => Math.hypot(a[1] - b[1], a[2] - b[2])
  let first = -1
  for (let i = 1; i < trace.length; i += 1) {
    if (dist(trace[i], trace[i - 1]) > 0.2) {
      first = i - 1
      break
    }
  }
  if (first < 0) return { ms: 0, from: null, to: null, frames: trace.length }
  const end = trace[trace.length - 1]
  let arrived = trace.length - 1
  for (let i = first; i < trace.length; i += 1) {
    let stable = true
    for (let j = i; j < trace.length; j += 1) {
      if (dist(trace[j], end) > 1.2) {
        stable = false
        break
      }
    }
    if (stable) {
      arrived = i
      break
    }
  }
  return { ms: trace[arrived][0] - trace[first][0], from: trace[first], to: trace[arrived], frames: trace.length }
}

async function target() {
  const all = await (await fetch(`${CDP}/json/list`)).json()
  const page = all.find((t) => t.type === 'page')
  if (!page) throw new Error('没有可用标签页（Edge 起了吗？端口 ' + PORT + '）')
  return page
}

async function connect() {
  const t = await target()
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', () => rej(new Error('CDP 连接失败：' + CDP)))
  })
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
  })
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id
      pending.set(mid, { resolve: res, reject: rej })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  return { send, close: () => ws.close() }
}

async function main() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/zzz-skin/emblem.png') {
      const bytes = LAYERS[url.searchParams.get('l')] ?? LAYERS.outer
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
      res.end(bytes)
      return
    }
    if (url.pathname === '/' || url.pathname === '/hero.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(PAGE)
      return
    }
    res.writeHead(404)
    res.end()
  })
  const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

  const cdp = await connect()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
  try {
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  } catch {
    /* 老版本没有这条命令，无妨 */
  }

  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }

  const results = []
  const check = (label, ok, detail) => {
    results.push({ label, ok })
    console.log(`${ok ? 'YES' : 'NO '} ${label}${detail === undefined ? '' : '  ' + JSON.stringify(detail)}`)
  }
  const shot = async (name) => {
    if (!SHOT_DIR) return
    mkdirSync(SHOT_DIR, { recursive: true })
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const file = join(SHOT_DIR, name)
    writeFileSync(file, Buffer.from(r.data, 'base64'))
    console.log('shot', file)
  }

  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/hero.html` })
  await sleep(120)
  // 采样挂到页面上异步跑，不阻塞下面的截图 —— 好抓一张「滑到一半」的现场
  await cdp.send('Runtime.evaluate', {
    expression: 'window.__r = null; window.__sample(2600).then((v) => { window.__r = v })',
  })
  await sleep(520)
  await shot('hero-mid.png')
  let enter = null
  for (let i = 0; i < 40 && !enter; i += 1) {
    await sleep(100)
    enter = await evaluate('window.__r')
  }
  if (!enter) throw new Error('采样没回来：主视觉根本没触发？')
  await shot('hero-settled.png')
  const enterTravel = travel(enter)
  const enterTransition = await evaluate(
    `(document.querySelector('#zzz-hdd-hud .fairy-emblem') || {}).style?.transition ?? null`,
  )
  const enterOpacity = await evaluate(`(() => {
    const el = document.querySelector('#zzz-hdd-hud .fairy-emblem')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), left: Math.round(r.left), top: Math.round(r.top), visible: getComputedStyle(el).opacity }
  })()`)

  console.log('enter trace:', enterTravel.frames, 'frames, travel', enterTravel.ms, 'ms', enterTravel.from, '->', enterTravel.to)
  if (enterTravel.ms < 700 || enterTravel.ms > 1600) console.log('  head', enter.slice(0, 4), 'tail', enter.slice(-4))
  check('进入主视觉：徽记真的在动（不是瞬移）', enterTravel.ms > 0, enterTravel)
  check('进入主视觉：这一趟 ≈ 1.2s（700–1600ms）', enterTravel.ms >= 700 && enterTravel.ms <= 1600, enterTravel.ms)
  check('进入主视觉：过渡写着 1200ms', String(enterTransition).includes('1200ms'), enterTransition)
  check('停稳后徽记有尺寸、不透明', Boolean(enterOpacity && enterOpacity.w > 100 && enterOpacity.visible !== '0'), enterOpacity)

  // 回到会话：标题块消失 → 眼睛要原路游回侧栏底部，速度同样是慢的
  await evaluate(`document.querySelector('[class*="Hqq-bq_headline"]').remove()`)
  const back = await evaluate('window.__sample(2600)')
  const backTravel = travel(back)
  console.log('back trace:', backTravel.frames, 'frames, travel', backTravel.ms, 'ms', backTravel.from, '->', backTravel.to)
  check('退出主视觉：回程也在动', backTravel.ms > 0, backTravel)
  check('退出主视觉：回程同样 ≈ 1.2s（700–1600ms）', backTravel.ms >= 700 && backTravel.ms <= 1600, backTravel.ms)

  // 回程结束、慢速窗口过期之后，徽记要退回「跟手」的 0.34s
  await sleep(1200)
  const dock = await evaluate(`(() => {
    const el = document.querySelector('#zzz-hdd-hud .fairy-emblem')
    if (!el) return null
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return { duration: cs.transitionDuration, left: Math.round(r.left), top: Math.round(r.top) }
  })()`)
  check('停靠态恢复跟手速度（0.34s）', dock && dock.duration.includes('0.34s'), dock)

  cdp.close()
  server.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
