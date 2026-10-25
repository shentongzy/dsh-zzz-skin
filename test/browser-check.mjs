#!/usr/bin/env node
/**
 * 浏览器端回归：在真实 Chromium（无头 Edge，调试端口 9333）里跑 test/harness.html，
 * 检查三件事 ——
 *   ① 折叠按钮的 svg 图标还在（原 bug：按钮在、图案没了）；
 *   ② 官方 DeepSeek 字标从**第一帧**就不可见，包括皮肤载荷没到、以及 React
 *      重新挂载品牌行的那一帧（原 bug：收缩 / 展开时会闪一下）；
 *   ③ 左上角 Fairy 覆盖层正常铺开（38px 徽记 + Fairy 字）。
 *
 * 用法：node test/browser-check.mjs [--port=9333] [--shot=dir]
 * 前提：Edge 已用 --remote-debugging-port 启动（见 browser-automation/launch-edge.ps1）。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { startHarnessServer } from './serve-harness.mjs'

// 直接跑一遍夹具生成器：保证测的是当前这份 client.js / skin.css，而不是上一轮的产物
await import('./harness.mjs')

const here = fileURLToPath(new URL('.', import.meta.url))
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const PORT = args.port || process.env.CDP_PORT || 9333
const BASE = `http://127.0.0.1:${PORT}`
const SHOT_DIR = args.shot ? resolve(String(args.shot)) : null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function target() {
  const all = await (await fetch(`${BASE}/json/list`)).json()
  const page = all.find((t) => t.type === 'page')
  if (!page) throw new Error('没有可用标签页')
  return page
}

async function connect() {
  const t = await target()
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', () => rej(new Error('CDP 连接失败')))
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
  // 起一个本地静态服务：夹具页 + 徽记位图（file:// 下图片加载不出来）
  const { server, port } = await startHarnessServer(0)
  const PAGE = `http://127.0.0.1:${port}/harness.html`

  const cdp = await connect()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 822,
    deviceScaleFactor: 2,
    mobile: false,
  })

  const results = []
  const check = (label, ok, detail) => {
    results.push({ label, ok })
    console.log(`${ok ? 'YES' : 'NO '} ${label}${detail === undefined ? '' : '  ' + JSON.stringify(detail)}`)
  }
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  const nav = async (url) => {
    await cdp.send('Page.navigate', { url })
    await sleep(1200)
  }
  const shot = async (name, clip) => {
    if (!SHOT_DIR) return
    mkdirSync(SHOT_DIR, { recursive: true })
    const r = await cdp.send('Page.captureScreenshot', clip ? { format: 'png', clip: { ...clip, scale: 1 } } : { format: 'png' })
    const file = join(SHOT_DIR, name)
    writeFileSync(file, Buffer.from(r.data, 'base64'))
    console.log('shot', file)
  }
  const shotHeader = (name) => shot(name, { x: 0, y: 0, width: 340, height: 170 })

  const PROBE = `(() => {
    const row = document.querySelector('[class*="_logoRow"]');
    const toggle = row && row.querySelector('[class*="_toggle"]');
    const icon = toggle && toggle.querySelector('svg');
    const identity = row && row.querySelector('[class*="_brandIdentity"]');
    const wordmark = row && row.querySelector('[class*="_brandName"] svg');
    const overlay = row && row.querySelector('.zzz-brand-overlay');
    const box = (el) => el ? { v: getComputedStyle(el).visibility, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null;
    return {
      toggleIcon: box(icon), identity: box(identity), wordmark: box(wordmark),
      overlay: box(overlay), overlayImg: box(overlay && overlay.querySelector('img')),
      overlayLabel: overlay ? overlay.textContent.trim() : null,
      overlaySub: overlay && overlay.querySelector('.zzz-brand-sub') ? overlay.querySelector('.zzz-brand-sub').textContent.trim() : null,
      critical: !!document.getElementById('zzz-brand-critical'),
      skinStyle: !!document.getElementById('zzz-hdd-hud-style'),
    };
  })()`

  // ① 完整皮肤：payload 到位之后的稳态
  await nav(`${PAGE}?warm=1`)
  await sleep(1500)
  const full = await evaluate(PROBE)
  check('折叠按钮的图标可见（16px svg）', full.toggleIcon?.v === 'visible' && full.toggleIcon?.w > 0, full.toggleIcon)
  check('官方 brandIdentity 被隐藏', full.identity?.v === 'hidden')
  check(
    'Fairy 覆盖层在位（徽记 38px + Fairy 字 + 全名小字）',
    full.overlayImg?.w === 38 && String(full.overlayLabel ?? '').startsWith('Fairy') && Boolean(full.overlaySub),
    { img: full.overlayImg, label: full.overlayLabel, sub: full.overlaySub },
  )
  await shotHeader('after-header.png')

  // ② 首帧：皮肤载荷还没到（fetch 永远挂着），此时只有客户端注入的关键样式
  // 换一个查询串，确保是整页重载而不是同文档 hash 导航
  await nav(`${PAGE}?cold=1#nopayload`)
  await sleep(1200)
  const cold = await evaluate(PROBE)
  check('关键样式在载荷之前就注入', cold.critical === true && cold.skinStyle === false)
  check('载荷未到也看不见官方字标', cold.identity?.v === 'hidden' && cold.wordmark?.v === 'hidden', cold.wordmark)
  check('载荷未到时按钮图标同样在', cold.toggleIcon?.v === 'visible' && cold.toggleIcon?.w > 0, cold.toggleIcon)
  check('载荷未到时徽记已是 38px（不是位图原始尺寸）', cold.overlayImg?.w === 38, cold.overlayImg)

  // ③ React 重新挂载品牌行的那一帧：插入后立刻同步测量，中间不给任何 JS 机会
  const remount = await evaluate(`(() => {
    const row = document.querySelector('[class*="_logoRow"]');
    const toggle = row.querySelector('[class*="_toggle"]');
    const fresh = document.createElement('button');
    fresh.type = 'button';
    fresh.className = '_2H3hWW_brand _2H3hWW_wide';
    fresh.innerHTML = '<span class="_2H3hWW_brandIdentity" aria-hidden="true"><span class="_2H3hWW_brandMark">' +
      '<svg width="24" height="24"><circle cx="12" cy="12" r="10"/></svg></span>' +
      '<span class="_2H3hWW_brandName"><svg width="132" height="22"><text x="0" y="17">DeepSeek</text></svg></span></span>';
    row.insertBefore(fresh, toggle);
    const name = fresh.querySelector('[class*="_brandName"] svg');
    const r = name.getBoundingClientRect();
    return { visibility: getComputedStyle(name).visibility, w: Math.round(r.width), h: Math.round(r.height) };
  })()`)
  check('重新挂载的新节点同步测量即不可见（无闪烁窗口）', remount.visibility === 'hidden', remount)
  await shotHeader('after-remount.png')

  // ④ 对照：旧版"藏交互容器里的非交互子元素"的写法，会连折叠按钮的图标一起藏
  const legacy = await evaluate(`(() => {
    const row = document.querySelector('[class*="_logoRow"]');
    const toggle = row.querySelector('[class*="_toggle"]');
    for (const inner of toggle.children) inner.style.visibility = 'hidden';
    const icon = toggle.querySelector('svg');
    const v = getComputedStyle(icon).visibility;
    for (const inner of toggle.children) inner.style.visibility = '';
    return v;
  })()`)
  check('复现旧写法：按钮在、图标被藏（bug 现场）', legacy === 'hidden', { visibility: legacy })

  // ⑤ /skin off 之后：关键样式一条都不许留，官方品牌行必须原样可见
  await nav(`${PAGE}?off=1#disabled`)
  await sleep(1200)
  const off = await evaluate(PROBE)
  check('皮肤关掉时关键样式不注入', off.critical === false && off.skinStyle === false)
  check('皮肤关掉时官方品牌行照旧（字标可见）', off.identity?.v === 'visible' && off.wordmark?.v === 'visible', off.wordmark)
  check('皮肤关掉时按钮图标照旧', off.toggleIcon?.v === 'visible', off.toggleIcon)

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
