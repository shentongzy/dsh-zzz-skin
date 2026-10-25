/**
 * dsh-zzz-skin —— 绝区零（Zenless Zone Zero）风格的 H.D.D. 皮肤。
 *
 * 参考画面（BV1wGH46iEun《把小鲸鱼改造成了fairy》）里那张脸是这样的：
 *   一整片深海军蓝底上，螺旋状排列的碎晶线框由外向内收束，
 *   收束的中心是一颗横向的、白到发青的高光椭圆 —— 合起来就是一只巨大的眼睛。
 *   外围还叠着一张更稀疏的大三角网。
 *
 * 所以这个皮肤的主元素就是那颗「大眼睛」：螺旋虹膜 + 亮瞳孔 + 外圈三角网。
 * 实现方式：host 插件用 `webServer.tapIndex()` 改 index.html，
 *   - <head> 里插样式（配色/尺寸都在 lib/skin.css，按 mtime 读，改完 F5 生效）
 *   - </body> 前插一层纯装饰浮层（pointer-events:none，永不吃点击）
 *   - 再插一段改名脚本：把窗口标题与界面里的品牌字样换成 Fairy
 *
 * 不改任何 React 组件、不注册 client 半边，卸载即消失。
 */

import { appendFileSync, createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

/** 插件名。 */
export const name = 'zzz-skin'

/** 需要宿主 HTTP 表层来改 index.html。 */
export const inject = ['webServer']

const STATE_PATH = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'zzz-skin.json')

/** 浮层节点 id，同时是 CSS 里写死的选择器，两边必须一致。 */
const ROOT_ID = 'zzz-hdd-hud'

/** 皮肤样式表（数据，不是代码）。 */
const CSS_PATH = fileURLToPath(new URL('./skin.css', import.meta.url))

/**
 * 诊断日志。存在的理由很具体：Windows 生产构建的 Electron 菜单里
 * **没有 reload 项**（`lib/main.js` 里 `role: "reload"` 只挂在 development 分支），
 * 所以 Ctrl+R / F5 无效，唯一能重新请求 index.html 的方式是重启应用。
 * 有这份日志才能区分「窗口没重新请求过页面」和「请求了但注入没生效」。
 */
const LOG_PATH = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'zzz-skin.log')
const LOG_MAX_BYTES = 96 * 1024

/** 客户端半边从这里取皮肤载荷（CSS + 浮层 HTML + 改名规则）。 */
const PAYLOAD_PATH = '/zzz-skin/payload.js'

/** 客户端半边开机前问一句：皮肤到底开着没有。 */
const STATUS_PATH = '/zzz-skin/status'

/** 追加一行诊断日志；任何失败都静默忽略，绝不影响注入。 */
function logLine(message) {
  try {
    let size = 0
    try {
      size = statSync(LOG_PATH).size
    } catch {
      size = 0
    }
    const line = `${new Date().toISOString()} ${message}\n`
    if (size > LOG_MAX_BYTES) writeFileSync(LOG_PATH, line, 'utf8')
    else appendFileSync(LOG_PATH, line, 'utf8')
  } catch {
    /* 只读盘就算了 */
  }
}

/** 界面里要被替换掉的原品牌名 → 新名字。 */
const RENAME_FROM = 'DeepSeek Harness'
const RENAME_TO = 'Fairy'

/* ------------------------------------------------------------------ */
/* 状态                                                                */
/* ------------------------------------------------------------------ */

function readEnabled() {
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
    if (typeof parsed?.enabled === 'boolean') return parsed.enabled
  } catch {
    /* 首次运行 */
  }
  return true
}

function writeEnabled(enabled) {
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true })
    writeFileSync(STATE_PATH, `${JSON.stringify({ enabled }, null, 2)}\n`, 'utf8')
  } catch {
    /* 只读盘就算了 */
  }
}

/* ------------------------------------------------------------------ */
/* 样式表：按 mtime 缓存，改 css 不必重载插件                            */
/* ------------------------------------------------------------------ */

let cssCache = { mtimeMs: -1, text: '' }

function readCss() {
  try {
    const { mtimeMs } = statSync(CSS_PATH)
    if (mtimeMs !== cssCache.mtimeMs) {
      cssCache = { mtimeMs, text: readFileSync(CSS_PATH, 'utf8') }
    }
    return cssCache.text
  } catch {
    return ''
  }
}

/* ------------------------------------------------------------------ */
/* 图形：Fairy 的光圈徽记                                               */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 改名脚本                                                            */
/* ------------------------------------------------------------------ */

/**
 * 把窗口标题与界面里的品牌字样换成 Fairy。
 *
 * 只替换**整段文字节点恰好等于** RENAME_FROM 的情况，避免误伤正文；
 * 标题则只在仍含原品牌名时替换，保留会话名之类的前后缀。
 * 用 MutationObserver 兜住后渲染的内容，但只监听 childList
 * （改 nodeValue 不会触发 childList，因此不会自激循环）。
 */
const RENAME_SCRIPT = `<script id="${ROOT_ID}-rename">(function(){
  var FROM=${JSON.stringify(RENAME_FROM)}, TO=${JSON.stringify(RENAME_TO)};
  function fixTitle(){
    if(document.title && document.title.indexOf(FROM)>=0){
      document.title=document.title.split(FROM).join(TO);
    }
  }
  function fixNodes(){
    var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null);
    var n, hits=[];
    while((n=w.nextNode())){ if(n.nodeValue && n.nodeValue.trim()===FROM) hits.push(n); }
    for(var i=0;i<hits.length;i++){ hits[i].nodeValue=TO; }
  }
  function run(){ fixTitle(); fixNodes(); }
  try{
    var t=null;
    new MutationObserver(function(){ if(t)clearTimeout(t); t=setTimeout(run,120); })
      .observe(document.documentElement,{childList:true,subtree:true});
    run();
  }catch(e){}
})();</script>`

/**
 * 徽记用的是**从参考图裁出来的位图**（assets/emblem.png），不是手绘几何。
 * 之前手绘版一直差一口气：形状靠文字描述猜，永远对不上。位图是像素级一致。
 *
 * 位图带径向 alpha 淡出，所以贴在深色界面上不会出现蓝色方框。
 * 图片走独立路由 + 版本号，浏览器会缓存；换图后版本号变，自动失效。
 */
const EMBLEM_PATH = '/zzz-skin/emblem.png'
const EMBLEM_FILE = fileURLToPath(new URL('../assets/emblem.png', import.meta.url))

/** 三层位图：外壳（转）/ 内芯（呼吸，往白环里涨）/ 白环（锚点，不动）。 */
const LAYER_FILES = {
  outer: fileURLToPath(new URL('../assets/emblem-outer.png', import.meta.url)),
  core: fileURLToPath(new URL('../assets/emblem-core.png', import.meta.url)),
  ring: fileURLToPath(new URL('../assets/emblem-ring.png', import.meta.url)),
}

/** 用图片 mtime 当版本号，换图即刷新，不必重启。 */
function emblemVersion() {
  try {
    return String(Math.round(statSync(EMBLEM_FILE).mtimeMs))
  } catch {
    return '0'
  }
}

/** 每次渲染都重新拼，图片版本号才会跟着变。 */
function buildOverlay() {
  const v = emblemVersion()
  const src = (layer) => `${EMBLEM_PATH}?v=${v}&l=${layer}`
  // 背景纹理单独一层，沉到内容下面；前景只留徽记
  return `<div id="zzz-hdd-bg" aria-hidden="true">
<div class="fairy-sky"></div>
<div class="fairy-grid"></div>
<div class="fairy-scan"></div>
<div class="fairy-frame"><i></i><i></i><i></i><i></i></div>
</div>
<div id="zzz-hdd-hud" aria-hidden="true">
<div class="fairy-emblem">
  <div class="fairy-bloom"></div>
  <div class="fairy-bloom fairy-bloom--tight"></div>
  <img class="fairy-layer fairy-layer--outer" src="${src('outer')}" alt="" draggable="false">
  <img class="fairy-layer fairy-layer--core" src="${src('core')}" alt="" draggable="false">
  <img class="fairy-layer fairy-layer--ring" src="${src('ring')}" alt="" draggable="false">
</div>
</div>`
}

/* ------------------------------------------------------------------ */
/* 注入                                                                */
/* ------------------------------------------------------------------ */

/**
 * 幂等注入：已经注入过就原样返回，避免热重载叠加两份。
 * 样式表读不到（文件被删/权限不足）时整体不注入 —— 宁可不换肤，
 * 也不能把一层没有定位规则的 div 塞进正常文档流里把布局撑坏。
 */
function decorate(html) {
  if (typeof html !== 'string' || html.includes(`${ROOT_ID}-style`)) {
    logLine('tap: skipped (already injected or non-string)')
    return html
  }
  const css = readCss()
  if (css.trim() === '') {
    logLine('tap: ABORTED — skin.css unreadable or empty')
    return html
  }
  const styleTag = `<style id="${ROOT_ID}-style">${css}</style>`
  const withStyle = html.includes('</head>')
    ? html.replace('</head>', `${styleTag}</head>`)
    : `${styleTag}${html}`
  const payload = `${buildOverlay()}${RENAME_SCRIPT}`
  const out = withStyle.includes('</body>')
    ? withStyle.replace('</body>', `${payload}</body>`)
    : `${withStyle}${payload}`
  logLine(`tap: INJECTED css=${css.length} in=${html.length} out=${out.length}`)
  return out
}

/* ------------------------------------------------------------------ */
/* 插件主体                                                            */
/* ------------------------------------------------------------------ */

export function apply(ctx) {
  let enabled = readEnabled()
  logLine(`plugin loaded: enabled=${enabled} css=${readCss().length} bytes`)


  /**
   * 隐藏 / 恢复原生标题栏按钮（Electron titleBarOverlay）。
   * symbolColor 与 color 相同即可让三个按钮"看不见"，但依然站得住位置。
   */
  let overlayOriginal = null
  /** 在包装模块里递归找 BrowserWindow。 */
  function resolveBrowserWindow(mod) {
    const seen = new Set()
    const stack = [mod]
    const keys = ['default', 'module', 'exports', 'electron', 'main']
    let guard = 0
    while (stack.length && guard < 60) {
      guard += 1
      const cur = stack.pop()
      if (!cur || typeof cur !== 'object' || seen.has(cur)) continue
      seen.add(cur)
      try {
        if (typeof cur.BrowserWindow?.getAllWindows === 'function') return cur.BrowserWindow
      } catch {
        /* 忽略 */
      }
      for (const k of keys) {
        try {
          const next = cur[k]
          if (next) stack.push(next)
          // 处理 cur.module.exports 这种两层结构
          if (next && typeof next === 'object' && next.exports) stack.push(next.exports)
        } catch {
          /* 忽略 */
        }
      }
    }
    return null
  }

  /** 依次尝试多种取 electron 的途径，返回第一个能拿到 BrowserWindow 的结果。 */
  async function findBrowserWindow() {
    const attempts = []
    const req = createRequire(import.meta.url)

    const tryRequire = (label, fn) => {
      try {
        const mod = fn()
        const BW = resolveBrowserWindow(mod)
        attempts.push(label + (BW ? ':ok' : ':empty'))
        return BW
      } catch (err) {
        attempts.push(label + ':fail(' + String(err && err.message ? err.message : err).slice(0, 40) + ')')
        return null
      }
    }

    let BW = tryRequire('require', () => req('electron'))
    if (BW) return { BW, attempts }

    BW = tryRequire('mainModule', () => process.mainModule && process.mainModule.require('electron'))
    if (BW) return { BW, attempts }

    BW = tryRequire('global', () => globalThis.require && globalThis.require('electron'))
    if (BW) return { BW, attempts }

    BW = tryRequire('remote', () => req('@electron/remote'))
    if (BW) return { BW, attempts }

    BW = tryRequire('electron/main', () => req('electron/main'))
    if (BW) return { BW, attempts }

    return { BW: null, attempts }
  }

  async function setTitleBarHidden(hidden) {
    try {
      const { BW, attempts } = await findBrowserWindow()
      if (!BW) {
        logLine('titlebar: no route to BrowserWindow -> ' + attempts.join(' | '))
        return
      }
      for (const win of BW.getAllWindows()) {
        if (typeof win.setTitleBarOverlay !== 'function') {
          logLine('titlebar: window has no setTitleBarOverlay')
          continue
        }
        if (!overlayOriginal) {
          try {
            overlayOriginal =
              typeof win.getTitleBarOverlay === 'function'
                ? win.getTitleBarOverlay()
                : { color: '#000000', symbolColor: '#ffffff' }
          } catch {
            overlayOriginal = { color: '#000000', symbolColor: '#ffffff' }
          }
        }
        const base = overlayOriginal || { color: '#000000', symbolColor: '#ffffff' }
        win.setTitleBarOverlay(
          hidden
            ? { color: base.color || '#000000', symbolColor: base.color || '#000000' }
            : { color: base.color, symbolColor: base.symbolColor },
        )
        logLine('titlebar: applied hidden=' + hidden + ' base=' + JSON.stringify(base) + ' via=' + attempts.join(','))
      }
    } catch (err) {
      logLine('titlebar control failed: ' + String(err && err.message ? err.message : err))
    }
  }





  // 路径一：改写 index.html（如果窗口在插件注册之后才请求页面，这条就够用）
  ctx.effect(
    () =>
      ctx.webServer.tapIndex((html) => {
        logLine(`tap called: html=${typeof html === 'string' ? html.length : 'non-string'} enabled=${enabled}`)
        if (!enabled) return html
        // 第一帧就把界面遮住，等开屏播完再放出（否则会先闪一下对话界面）
        html = html.replace(/<html([^>]*)>/i, (m, attrs) =>
          /zzz-boot/.test(attrs) ? m : `<html${attrs} class="zzz-boot">`,
        )
        return decorate(html)
      }),
    'dsh-zzz-skin: index tap',
  )

  // 路径二：给客户端半边提供「皮肤载荷」。
  // 存在的理由是时序 —— 桌面窗口的 loadURL 可能早于本插件注册 tap，
  // 那样首屏永远拿不到注入。客户端半边在页面里跑，跟谁先谁后无关。
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: STATUS_PATH,
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          // 客户端开机第一件事就是问这个：只有开着皮肤，才允许动官方品牌行
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ enabled }))
        },
      }),
    'dsh-zzz-skin: status route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: PAYLOAD_PATH,
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          if (!enabled) {
            res.writeHead(204)
            res.end()
            return
          }
          const body = JSON.stringify({ css: readCss(), html: buildOverlay(), renameFrom: RENAME_FROM, renameTo: RENAME_TO })
          logLine(`payload served: ${body.length} bytes`)
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(req.method === 'HEAD' ? undefined : body)
        },
      }),
    'dsh-zzz-skin: payload route',
  )

  // 路径三：徽记位图本体。带长期缓存 + 版本号，换图只换 URL 就够。
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: EMBLEM_PATH,
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          let bytes
          try {
            // ?l=outer|inner|eye 取分层；不带参数就是整张
            const layer = (() => {
              try {
                return new URL(req.url ?? '/', 'http://x').searchParams.get('l')
              } catch {
                return null
              }
            })()
            const file = LAYER_FILES[layer] ?? EMBLEM_FILE
            bytes = readFileSync(file)
          } catch {
            res.writeHead(404)
            res.end()
            return
          }
          res.writeHead(200, {
            'content-type': 'image/png',
            'content-length': String(bytes.length),
            'cache-control': 'public, max-age=31536000, immutable',
          })
          res.end(req.method === 'HEAD' ? undefined : bytes)
        },
      }),
    'dsh-zzz-skin: emblem route',
  )

  // 路径五：开屏视频。支持 Range（浏览器需要它才能流畅播放/拖动），
  // 文件放在插件 assets/boot.mp4。
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/zzz-skin/boot.mp4',
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          const file = fileURLToPath(new URL('../assets/boot.mp4', import.meta.url))
          let size
          try {
            size = statSync(file).size
          } catch {
            res.writeHead(404)
            res.end()
            return
          }
          const range = req.headers?.range
          if (range) {
            const m = /bytes=(\d*)-(\d*)/.exec(range)
            const start = m && m[1] ? Number(m[1]) : 0
            const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
            if (start >= size || start > end) {
              res.writeHead(416, { 'content-range': `bytes */${size}` })
              res.end()
              return
            }
            res.writeHead(206, {
              'content-type': 'video/mp4',
              'content-length': String(end - start + 1),
              'content-range': `bytes ${start}-${end}/${size}`,
              'accept-ranges': 'bytes',
              'cache-control': 'no-cache',
            })
            if (req.method === 'HEAD') {
              res.end()
              return
            }
            createReadStream(file, { start, end }).pipe(res)
            return
          }
          res.writeHead(200, {
            'content-type': 'video/mp4',
            'content-length': String(size),
            'accept-ranges': 'bytes',
            'cache-control': 'no-cache',
          })
          if (req.method === 'HEAD') {
            res.end()
            return
          }
          createReadStream(file).pipe(res)
        },
      }),
    'dsh-zzz-skin: boot video route',
  )




  // 路径八：开屏问候（JSON：时段 + 变体 + 文本 + 音频 URL）
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/zzz-skin/greeting',
        handler: (req, res) => {
          const bucket = greetBucket(new Date().getHours())
          const list = GREETINGS[bucket] || []
          // 只在**实际存在音频**的句子里随机，避免抽到被删掉的句子导致没声音
          const available = list.map((_, i) => i).filter((i) => greetWav(bucket, i) !== null)
          const index = available.length
            ? available[Math.floor(Math.random() * available.length)]
            : 0
          const wav = available.length ? greetWav(bucket, index) : null
          const body = JSON.stringify({
            bucket,
            index,
            text: list[index] || '',
            url: wav ? '/zzz-skin/greeting.wav?b=' + bucket + '&n=' + index : null,
          })
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(body)
        },
      }),
    'dsh-zzz-skin: greeting json route',
  )

  // 路径九：问候音频本体
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/zzz-skin/greeting.wav',
      handler: (req, res) => {
        let bucket = 'afternoon'
        let index = 0
        try {
          const u = new URL(req.url ?? '/', 'http://x')
          bucket = u.searchParams.get('b') || bucket
          index = Number(u.searchParams.get('n') || 0) || 0
        } catch {
          /* 用默认值 */
        }
        const file = greetWav(bucket, index)
        if (!file) {
          res.writeHead(404)
          res.end()
          return
        }
        let bytes
        try {
          bytes = readFileSync(file)
        } catch {
          res.writeHead(404)
          res.end()
          return
        }
        res.writeHead(200, {
          'content-type': 'audio/wav',
          'content-length': String(bytes.length),
          'cache-control': 'public, max-age=600',
        })
        res.end(req.method === 'HEAD' ? undefined : bytes)
      },
    }),
  )

  // 路径七：开屏那句 Fairy 语音
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/zzz-skin/fairy-voice.wav',
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          let bytes
          try {
            bytes = readFileSync(fileURLToPath(new URL('../assets/fairy-voice.wav', import.meta.url)))
          } catch {
            res.writeHead(404)
            res.end()
            return
          }
          res.writeHead(200, {
            'content-type': 'audio/wav',
            'content-length': String(bytes.length),
            'cache-control': 'public, max-age=31536000, immutable',
          })
          res.end(req.method === 'HEAD' ? undefined : bytes)
        },
      }),
    'dsh-zzz-skin: fairy voice route',
  )

  // 路径六：开屏收尾用的蓝光图
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/zzz-skin/bloom.png',
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          let bytes
          try {
            bytes = readFileSync(fileURLToPath(new URL('../assets/bloom.png', import.meta.url)))
          } catch {
            res.writeHead(404)
            res.end()
            return
          }
          res.writeHead(200, {
            'content-type': 'image/png',
            'content-length': String(bytes.length),
            'cache-control': 'public, max-age=31536000, immutable',
          })
          res.end(req.method === 'HEAD' ? undefined : bytes)
        },
      }),
    'dsh-zzz-skin: bloom route',
  )


  /* ---------------- 开屏问候：按时间段变化 ----------------
     每个时段 3 句，随机挑一句。语音优先用 assets/voice/<bucket>-<n>.wav
     （你以后可以把自己录的 Fairy 语音按这个命名放进去，会自动生效）；
     没有就用 Windows 中文语音现场合成并缓存。
     ------------------------------------------------------ */
  const GREETINGS = {
    morning: ['主人，早上好。本机已为您启动。', '主人，早安。今天也请多指教。', '主人，早。系统已就绪。'],
    noon: ['主人，中午好。要不要休息一下？', '主人，午安。本机持续待机中。', '主人，正午了。别只顾着工作。'],
    afternoon: ['主人，下午好。本机在岗。', '主人，下午好。需要我做什么？', '主人，下午了。您还没说今天要做什么。'],
    evening: ['主人，晚上好。本机已就位。', '主人，晚上好。今天辛苦了。', '主人，天黑了。我还在。'],
    night: ['主人，这么晚还没睡？', '主人，夜深了。请注意休息。', '主人，凌晨了。我为您保持清醒。'],
  }

  function greetBucket(hour) {
    if (hour >= 5 && hour < 11) return 'morning'
    if (hour >= 11 && hour < 14) return 'noon'
    if (hour >= 14 && hour < 18) return 'afternoon'
    if (hour >= 18 && hour < 23) return 'evening'
    return 'night'
  }

  const VOICE_DIR = () => fileURLToPath(new URL('../assets/voice/', import.meta.url))

  /** 只认 assets/voice/<bucket>-<index>.wav，没有就返回 null（不合成）。 */
  function greetWav(bucket, index) {
    const file = join(VOICE_DIR(), bucket + '-' + index + '.wav')
    try {
      statSync(file)
      return file
    } catch {
      return null
    }
  }




  // 路径四：客户端回传探针。客户端量到侧边栏的尺寸后 POST 过来，写进日志 ——
  // 这样我才能看到真实 DOM 的数据，而不是靠猜。只写日志，不影响任何逻辑。
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/zzz-skin/beacon',
        handler: (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405)
            res.end()
            return
          }
          let body = ''
          req.on('data', (chunk) => {
            if (body.length < 4000) body += chunk
          })
          req.on('end', () => {
            try {
              const msg = JSON.parse(body)
              if (msg && msg.kind === 'titlebar') {
                void setTitleBarHidden(Boolean(msg.hidden))
              }
            } catch {
              /* 不是 JSON 就只记日志 */
            }
            logLine(`beacon ${body.slice(0, 900)}`)
            res.writeHead(204)
            res.end()
          })
        },
      }),
    'dsh-zzz-skin: beacon route',
  )

  ctx.inject(['commands'], (commandCtx) => {
    // /skin 与 /hdd 共用同一个处理函数：H.D.D 模式就是这套皮肤 + 人设
    const runSkinCommand = ({ rawInput }) => {
      const argument = (rawInput ?? '').trim().toLowerCase()
      if (argument === 'status') {
        return { kind: 'success', text: enabled ? 'H.D.D. 模式：已启动。' : 'H.D.D. 模式：已关闭。' }
      }
      if (argument !== '' && !['on', 'off', 'toggle'].includes(argument)) {
        return { kind: 'error', text: `不予执行的参数：${argument}。可用：on / off / status。` }
      }
      enabled = argument === 'on' ? true : argument === 'off' ? false : !enabled
      writeEnabled(enabled)
      return {
        kind: 'success',
        text: enabled
          ? 'H.D.D. 模式已启动。刷新页面（F5）后生效。'
          : 'H.D.D. 模式已关闭。刷新页面（F5）后恢复原生外观。',
      }
    }

    commandCtx.effect(
      () =>
        commandCtx.commands.register({
          name: 'skin',
          description: '切换 H.D.D. 模式（旧名）',
          input: { hint: '[on|off|status]' },
          handler: runSkinCommand,
        }),
      'dsh-zzz-skin: /skin command',
    )

    commandCtx.effect(
      () =>
        commandCtx.commands.register({
          name: 'hdd',
          description: '切换 H.D.D. 模式（皮肤 + 人设）',
          input: { hint: '[on|off|status]' },
          handler: runSkinCommand,
        }),
      'dsh-zzz-skin: /hdd command',
    )
  })

  ctx.logger?.info?.('dsh-zzz-skin: H.D.D. skin %s', enabled ? 'equipped' : 'off')
}
