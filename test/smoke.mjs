/**
 * dsh-zzz-skin 离线自测：用假上下文抓住 tapIndex 的 transform，
 * 验证注入正确、幂等、可关闭。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const home = mkdtempSync(join(tmpdir(), 'skin-test-'))
process.env.DSH_HOME = home

const mod = await import('../lib/index.js')
assert.equal(mod.name, 'zzz-skin')
assert.deepEqual(mod.inject, ['webServer'])

let transform
let commandDef
const routes = []
const ctx = {
  effect: (fn) => fn(),
  webServer: {
    tapIndex: (fn) => {
      transform = fn
      return () => {}
    },
    register: (route) => {
      routes.push(route)
      return () => {}
    },
  },
  inject: (deps, cb) => cb({
    effect: (fn) => fn(),
    commands: { register: (def) => { commandDef = def; return () => {} } },
  }),
  logger: { info: () => {} },
}

mod.apply(ctx)
assert.equal(typeof transform, 'function')
console.log('✓ tapIndex registered')

// 客户端半边的载荷路由
const payloadRoute = routes.find((r) => r.path === '/zzz-skin/payload.js')
assert.ok(payloadRoute, 'payload route registered')
assert.equal(payloadRoute.kind, 'exact')
console.log('✓ payload route for the client half')

// 开关状态路由：客户端开机先问它，关着皮肤就不碰官方品牌行
const statusRoute = routes.find((r) => r.path === '/zzz-skin/status')
assert.ok(statusRoute, 'status route registered')
const readStatus = () => {
  let body = ''
  statusRoute.handler({ method: 'GET' }, { writeHead: () => {}, end: (chunk) => { if (chunk !== undefined) body = chunk } })
  return JSON.parse(body)
}
assert.equal(readStatus().enabled, true, 'skin reports enabled by default')
console.log('✓ status route reports the skin switch')

{
  let status = 0
  let headers = {}
  let body = ''
  const res = {
    writeHead: (code, hdrs) => { status = code; headers = hdrs ?? {} },
    end: (chunk) => { if (chunk !== undefined) body = chunk },
  }
  payloadRoute.handler({ method: 'GET' }, res)
  assert.equal(status, 200)
  assert.match(headers['content-type'], /application\/json/)
  assert.equal(headers['cache-control'], 'no-store')
  const payload = JSON.parse(body)
  assert.ok(payload.css.includes('.fairy-layer'), 'payload carries css')
  assert.ok(payload.html.includes('fairy-layer--outer'), 'payload carries the emblem layers')
  assert.ok(payload.html.includes('l=core') && payload.html.includes('l=ring'), 'payload carries core + ring layers')
  assert.ok(!payload.html.includes('l=eye'), 'eye is no longer a separate layer')
  assert.equal(payload.renameTo, 'Fairy')
  console.log('✓ payload carries css + emblem img + rename rule')
}

const page = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app">hi</div></body></html>'
const out = transform(page)

assert.ok(out.includes('zzz-hdd-hud-style'), 'style tag injected')
assert.ok(out.includes('id="zzz-hdd-hud"'), 'overlay injected')
assert.ok(/--dsw-alias-bg-base:\s*#[0-9a-f]{6}/i.test(out), 'base token overridden from skin.css')
assert.ok(!/rgba\(1, 4, 10, 0\.85\)/.test(out), 'full-screen veil is no longer near-black')
assert.ok(/fairy-beam/.test(out), 'oscilloscope sweep line present')
assert.ok(/--dsw-alias-brand-primary:\s*#3f93d9/.test(out), 'royal-blue accent from skin.css')
assert.ok(/pointer-events:\s*none/.test(out), 'overlay never eats clicks')
assert.ok(out.indexOf('zzz-hdd-hud-style') < out.indexOf('</head>'), 'style inside head')
assert.ok(out.indexOf('id="zzz-hdd-hud"') < out.indexOf('</body>'), 'overlay inside body')
console.log('✓ injects style into <head> and overlay into <body>')

// 徽记现在是从参考图裁出来的位图（像素级一致），外加正交网格背景
assert.ok(out.includes('fairy-layer--outer'), 'outer layer (rotates)')
assert.ok(out.includes('fairy-layer--core'), 'core layer (breathes)')
assert.ok(out.includes('fairy-layer--ring'), 'ring layer (static anchor)')
// ring 必须排在 core 之后，才能把 core 涨出来的部分裁掉
assert.ok(out.indexOf('fairy-layer--core') < out.indexOf('fairy-layer--ring'), 'ring paints above core')
assert.ok(/\/zzz-skin\/emblem\.png\?v=\d+&l=outer/.test(out), 'versioned layer url')
assert.ok(out.includes('fairy-emblem'), 'emblem container')
assert.ok(out.includes('fairy-grid'), 'orthogonal grid background')
assert.ok(!out.includes('fairy-glyph'), 'single-bitmap version is gone')
console.log('✓ Fairy emblem bitmap + grid background')

// 位图路由
const emblemRoute = routes.find((r) => r.path === '/zzz-skin/emblem.png')
assert.ok(emblemRoute, 'emblem route registered')
{
  let status = 0
  let headers = {}
  let bytes = null
  const res = {
    writeHead: (code, hdrs) => { status = code; headers = hdrs ?? {} },
    end: (chunk) => { if (chunk !== undefined) bytes = chunk },
  }
  emblemRoute.handler({ method: 'GET' }, res)
  assert.equal(status, 200)
  assert.equal(headers['content-type'], 'image/png')
  assert.ok(bytes && bytes.length > 10000, 'emblem png bytes served')
  assert.match(headers['cache-control'], /immutable/)
  console.log('✓ emblem png served,', bytes.length, 'bytes')
}

// 改名脚本：把标题与品牌字样换成 Fairy
assert.ok(out.includes('zzz-hdd-hud-rename'), 'rename script injected')
assert.ok(out.includes('"DeepSeek Harness"'), 'rename source string embedded')
assert.ok(out.includes('"Fairy"'), 'rename target string embedded')
assert.equal((out.match(/zzz-hdd-hud-rename/g) ?? []).length, 1, 'rename script injected once')
console.log('✓ rename script renames the app to Fairy')

// 幂等：再跑一次不能叠加第二份
const twice = transform(out)
assert.equal((twice.match(/zzz-hdd-hud-style/g) ?? []).length, 1, 'idempotent style')
assert.equal((twice.match(/id="zzz-hdd-hud"/g) ?? []).length, 1, 'idempotent overlay')
console.log('✓ injection is idempotent')

// 命令：status / off / on
assert.ok(['skin', 'hdd'].includes(commandDef.name), 'command is registered')
let r = commandDef.handler({ rawInput: 'status' })
assert.match(r.text, /已启动|已装备/)
r = commandDef.handler({ rawInput: 'off' })
assert.equal(r.kind, 'success')
assert.equal(transform(page), page, 'off returns the page untouched')
assert.equal(readStatus().enabled, false, 'status flips when the skin is switched off')
console.log('✓ /skin off detaches the skin (page returned byte-identical)')

r = commandDef.handler({ rawInput: 'on' })
assert.ok(transform(page).includes('zzz-hdd-hud-style'))
r = commandDef.handler({ rawInput: 'nope' })
assert.equal(r.kind, 'error')
console.log('✓ /skin on|off|status and invalid-argument handling')

// 没有 </head> 的畸形页面也不能崩
const bare = transform('<div>x</div>')
assert.ok(bare.includes('zzz-hdd-hud-style'))
console.log('✓ survives markup without </head></body>')

console.log('\nALL PASS')
