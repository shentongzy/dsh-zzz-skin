/**
 * dsh-zzz-skin 的浏览器半边。
 *
 * 三件事：
 *   1. 装皮肤载荷，并每 2 秒轮询 payload —— 改 CSS 存盘就生效，不用重启应用。
 *   2. 把徽记钉在侧边栏上：水平居中、随栏宽伸缩、收起时收进侧边、列表溢出时缩一档。
 *   3. beacon 回传探测数据给宿主，写进 zzz-skin.log。
 *
 * 性能要点（之前"不跟手、掉帧"的原因）：
 *   · findSidebar 会遍历整棵 DOM 并读 computed style —— 改成带缓存的 resolveSidebar，
 *     只在缓存元素失效时才重新扫描；
 *   · 尺寸变化走 transform: scale（合成器），不走 width/height（触发布局）；
 *   · 拖拽期间关掉过渡，缩放严格跟着光标；松手 220ms 后才恢复缓动。
 */
// 模块一执行就遮住页面，避免"先看到界面再被开屏盖住"的那一帧
try {
  const de = document.documentElement
  de.setAttribute('data-zzz-boot-early', '1')
  de.style.setProperty('visibility', 'hidden', 'important')
} catch {
  /* 忽略 */
}

window.__ModuleLoader__.load({
  id: 'dsh-zzz-skin',
  factory() {
    return {
      inject: [],
      apply(ctx) {
        const STYLE_ID = 'zzz-hdd-hud-style'
        const CRITICAL_ID = 'zzz-brand-critical'
        const ROOT_ID = 'zzz-hdd-hud'
        const PAYLOAD = '/zzz-skin/payload.js'
        const STATUS = '/zzz-skin/status'
        const BEACON = '/zzz-skin/beacon'
        const BUILD = 'brand-2026-10-25b'
        const POLL_MS = 2000
        const SAFETY_MS = 500
        const COLLAPSED_W = 150
        const REF = 280

        /**
         * 徽记有两档移动速度。
         *
         *   · 停靠态（拖侧栏宽度、改窗口大小）：必须跟手，0.34s。
         *   · 主视觉那一趟：同一枚徽记从侧栏底部「游」到画面中央，1.2s 长缓出。
         *     这一趟是入场表演，不是跟手操作 —— 之前和停靠共用 0.34s，
         *     跨越大半个屏幕只给三分之一秒，看起来是被拽过去的，不像游过去。
         */
        const DOCK_MS = 340
        const SWIM_MS = 1200
        const DOCK_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
        // 慢起、长收：从角落「离港」时不弹，落定时几乎停住。纯 ease-out 一上来就把
        // 七成距离走完了，那还是「被拽过去」的手感，只是被拉长了。
        const SWIM_EASE = 'cubic-bezier(0.33, 0, 0.2, 1)'
        /** 离开主视觉后这段时间内仍然用慢速，让回程也是同一趟游动。 */
        const SWIM_TAIL_MS = SWIM_MS + 400

        /**
         * 首帧关键样式。
         *
         * 皮肤整套 CSS 走 /zzz-skin/payload.js，要等一次 fetch 才落地；而品牌行
         * 是 React 在挂载时就画出来的。中间这段空窗期里，官方字标是可见的，
         * 38px 的徽记也还没有尺寸约束（会按位图原始尺寸撑出来）—— 用户看到的
         * "闪一下 deepseek" 就是这一帧。这里先把"藏字标 + 徽记尺寸"两条最短的
         * 规则挂进 <head>，跟客户端模块同一时刻生效，不再受 payload 时序影响。
         */
        const CRITICAL_CSS = `[data-zzz-brand]{position:relative}
[class*="_brandIdentity"]{visibility:hidden!important}
[class*="_brand"]>svg,[class*="_brand"]>img:not(.zzz-brand-mark){visibility:hidden!important}
.zzz-brand-overlay{position:absolute;inset:0;z-index:2;display:flex;align-items:center;gap:10px;overflow:hidden;pointer-events:none}
.zzz-brand-mark{display:block;width:38px;height:38px;object-fit:contain;border-radius:50%;flex:0 0 auto}
.zzz-brand-name{font:650 23px/1 ui-sans-serif,'Segoe UI',system-ui,sans-serif;letter-spacing:.02em;color:#ece0e0;white-space:nowrap}`

        function installCriticalCss() {
          if (document.getElementById(CRITICAL_ID)) return
          const style = document.createElement('style')
          style.id = CRITICAL_ID
          style.textContent = CRITICAL_CSS
          ;(document.head || document.documentElement).appendChild(style)
        }

        let lastStamp = ''
        let lastGeometry = ''
        let observer = null
        let timer = null
        let safetyTimer = null
        let timerRename = null
        let lastRename = { from: '', to: '' }
        let resizeObs = null
        let sidebarEl = null
        let scrollEl = null
        let layoutRaf = 0
        let lastWidth = -1
        let lastWidthAt = 0
        let lastChangeAt = 0
        let textLeftCache = 0
        let textLeftAt = 0
        let composerEl = null
        let cornerHidden = false
        let lastWinW = 0
        let lastCornerSize = 0
        let contentEl = null
        let probed = false
        let probedCorner = false

        /* ------------------------------------------------------------ 工具 */

        /** 改过的文本节点与原值，用于还原。 */
        const renamedNodes = []
        let titleBefore = null

        function rename(from, to) {
          if (!from || !to) return
          if (titleBefore === null && document.title && document.title.indexOf(from) >= 0) {
            titleBefore = document.title
            document.title = document.title.split(from).join(to)
          }
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
          const hits = []
          let node
          while ((node = walker.nextNode())) {
            if (node.nodeValue && node.nodeValue.trim() === from) hits.push(node)
          }
          for (const hit of hits) {
            renamedNodes.push({ node: hit, prev: hit.nodeValue })
            hit.nodeValue = to
          }
        }

        /**
         * 还原品牌字样。插件被关掉、或页面转成原生外观时调用，
         * 否则左上角会一直挂着 Fairy。
         */
        function restoreBrand() {
          for (const item of renamedNodes) {
            try {
              if (item.node && item.node.isConnected) item.node.nodeValue = item.prev
            } catch {
              /* 节点已销毁就跳过 */
            }
          }
          renamedNodes.length = 0
          if (titleBefore !== null) {
            document.title = titleBefore
            titleBefore = null
          }
        }

        function report(payload) {
          try {
            fetch(BEACON, {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
              keepalive: true,
            }).catch(() => {})
          } catch {
            /* 探针失败无所谓 */
          }
        }

        let brandProbed = false
        let brandAt = 0

        /**
         * 品牌行是不是"已经处理过"。
         *
         * MutationObserver 里不能每来一次 DOM 变动就跑一遍几何扫描——流式输出时
         * 那等于每帧扫全树。这里只做一次便宜的 querySelector：
         *   · 行还在、覆盖层也在 → 没事，返回 false；
         *   · 行在、但没有 data-zzz-brand / 覆盖层 → React 刚把品牌行重新挂载
         *     （展开侧栏就是这条路径），得立刻补一次，赶在绘制之前；
         *   · 连行都没有 → 还没渲染出来，交给 rAF 泵去试。
         */
        function brandRowNeedsWork() {
          const host = sidebarEl && sidebarEl.isConnected ? sidebarEl : document.body
          if (!host) return false
          const row = host.querySelector('[data-zzz-brand]')
          if (row) return !row.querySelector('.zzz-brand-overlay')
          return Boolean(host.querySelector('[class*="_logoRow"]'))
        }

        /**
         * 把左上角品牌行改成「大眼睛 + Fairy」。
         *
         * 品牌标记本身是 sidebar.brand.mark 这个 single 槽位（现在被应用自己的 mf
         * 占着），替换它要覆盖官方 UI；这里走 DOM 替换更稳：找到顶部那行品牌，
         * 把图标换成静态大眼睛图，把 DeepSeek 字样换成 Fairy。React 重渲染后由
         * MutationObserver 再叫回来一次即可。
         */
        function brandify(force) {
          const now = performance.now()
          if (!force && now - brandAt < 600) return
          brandAt = now

          // 品牌行按**几何位置**找，不靠文字：截图里左上角的 deepseek 是矢量字标
          //（SVG 路径），根本没有文本节点，所以 /deepseek/ 永远匹配不到。
          // 条件：侧栏内、贴左上角、高度像一行品牌、里面有 svg 或 img。
          const host = sidebarEl && sidebarEl.isConnected ? sidebarEl : document.body
          let best = null
          for (const el of host.querySelectorAll('*')) {
            if (el.closest('#zzz-hdd-hud')) continue
            const r = el.getBoundingClientRect()
            if (r.top > 150 || r.left > 420) continue
            if (r.height < 18 || r.height > 64) continue
            if (r.width < 40 || r.width > 400) continue
            if (!el.querySelector('svg, img')) continue
            if (el.children.length > 4) continue // 品牌行子元素很少，排除大容器
            if (!best || r.top < best.r.top || (r.top === best.r.top && r.height > best.r.height)) {
              best = { el, r }
            }
          }

          if (!best) {
            if (!brandProbed) {
              brandProbed = true
              const sample = []
              for (const el of host.querySelectorAll('*')) {
                if (el.closest('#zzz-hdd-hud')) continue
                const r = el.getBoundingClientRect()
                if (r.top > 150 || r.left > 420 || r.height < 10 || r.height > 70) continue
                if (!el.querySelector('svg, img')) continue
                sample.push({
                  tag: el.tagName.toLowerCase(),
                  cls: String(el.className).slice(0, 40),
                  w: Math.round(r.width),
                  h: Math.round(r.height),
                  top: Math.round(r.top),
                  kids: el.children.length,
                })
                if (sample.length >= 10) break
              }
              report({ kind: 'brand-miss2', sample })
            }
            return
          }

          const row = best.el
          row.dataset.zzzBrand = '1'

          // 遮住官方品牌内容，但**保护一切可交互元素**。
          // 上一版只认 svg / img，结果 deepseek 那个字标（不是 svg）没被藏，和 Fairy 叠在一起；
          // 而更早的版本整行全藏，连折叠按钮都没了。这里按"藏内容、留交互"来分：
          const isInteractive = (node) =>
            node.tagName === 'BUTTON' ||
            node.tagName === 'A' ||
            node.getAttribute('role') === 'button' ||
            Boolean(node.querySelector('button, a, [role="button"]'))

          /**
           * 折叠开关。它同样是 button，但里面的 svg 就是**按钮图案本身**——
           * 当成"交互容器"进去藏非交互子元素，等于把图标擦掉。所以整个跳过：
           * 按模块级类名认（_toggle / _panelIcon 跟构建哈希无关，稳定），
           * 也就不会被 URL 语言或 aria-label 文案变化带偏。
           */
          const isToggleControl = (node) =>
            node.matches('[class*="_toggle"]') ||
            Boolean(node.querySelector('[class*="_toggle"], [class*="_panelIcon"]'))

          for (const child of row.children) {
            if (child.classList.contains('zzz-brand-overlay')) continue
            if (isToggleControl(child)) continue
            if (isInteractive(child)) {
              // 交互容器里只藏它自己的非交互子元素
              for (const inner of child.children) {
                if (isInteractive(inner) || isToggleControl(inner)) continue
                inner.style.visibility = 'hidden'
              }
              continue
            }
            child.style.visibility = 'hidden'
          }
          // 叠层：大眼睛 + 「Fairy」+ 一行小字（全名）
          const existing = row.querySelector('.zzz-brand-overlay')
          if (existing && !existing.querySelector('.zzz-brand-sub')) existing.remove()
          if (!row.querySelector('.zzz-brand-overlay')) {
            const overlay = document.createElement('div')
            overlay.className = 'zzz-brand-overlay'

            const img = document.createElement('img')
            img.className = 'zzz-brand-mark'
            img.alt = 'Fairy'
            img.src = '/zzz-skin/emblem.png?v=1'
            img.draggable = false

            const text = document.createElement('div')
            text.className = 'zzz-brand-text'

            const name = document.createElement('span')
            name.className = 'zzz-brand-name'
            name.textContent = 'Fairy'

            const sub = document.createElement('span')
            sub.className = 'zzz-brand-sub'
            sub.textContent = 'Ⅲ型总序式集成泛用人工智能'

            text.appendChild(name)
            text.appendChild(sub)
            overlay.appendChild(img)
            overlay.appendChild(text)
            row.appendChild(overlay)
          }

          if (!brandProbed) {
            brandProbed = true
            const ir = row.querySelector('img.zzz-brand-mark').getBoundingClientRect()
            report({
              kind: 'brand',
              build: BUILD,
              tag: row.tagName.toLowerCase(),
              cls: String(row.className).slice(0, 60),
              w: Math.round(best.r.width),
              h: Math.round(best.r.height),
              icon: [Math.round(ir.width), Math.round(ir.height)],
            })
          }
        }

        /* --------------------------------------------------- 找到左边那根栏 */

        function looksLikeSidebar(el) {
          if (!el || !el.isConnected) return false
          if (el.closest('#zzz-hdd-hud')) return false // 绝不可能是自己的浮层
          const r = el.getBoundingClientRect()
          return r.height >= 200 && r.left <= 6 && r.width >= 48 && r.width <= 560 && r.right > 60
        }

        /** 仅在缓存失效时扫描整棵树。下限 48px 是为了认出收起后的图标条。 */
        function resolveSidebar() {
          if (looksLikeSidebar(sidebarEl)) return sidebarEl
          sidebarEl = null
          scrollEl = null
          let bestScore = -1
          for (const el of document.body.querySelectorAll('*')) {
            // 跳过自己的浮层：.fairy-bloom 往左溢出成 400×400，会被误判成侧边栏
            if (el.closest('#zzz-hdd-hud')) continue
            const r = el.getBoundingClientRect()
            if (r.height < 200 || r.left > 6) continue
            if (r.width < 48 || r.width > 560) continue
            const cs = getComputedStyle(el)
            if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue
            let score = Math.min(r.width, 400)
            if (cs.borderRightWidth !== '0px') score += 400
            if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') score += 200
            if (cs.display.indexOf('flex') >= 0) score += 150
            if (score > bestScore) {
              bestScore = score
              sidebarEl = el
            }
          }
          if (resizeObs && sidebarEl) resizeObs.observe(sidebarEl)
          return sidebarEl
        }

        function resolveScroller() {
          if (scrollEl && scrollEl.isConnected) return scrollEl
          scrollEl = null
          if (!sidebarEl) return null
          let best = null
          for (const node of sidebarEl.querySelectorAll('*')) {
            const cs = getComputedStyle(node)
            if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue
            if (node.getBoundingClientRect().height < 80) continue
            if (!best || node.scrollHeight > best.scrollHeight) best = node
          }
          scrollEl = best
          return best
        }

        /* ------------------------------------------------------ 摆好徽记 */

        function releaseReserve() {
          if (!scrollEl) return
          if (scrollEl.dataset.zzzPad !== undefined) {
            scrollEl.style.paddingBottom = scrollEl.dataset.zzzPad
            delete scrollEl.dataset.zzzPad
            delete scrollEl.dataset.zzzReserve
          }
        }

        /**
         * 摆位。缩放原点统一放在**左下角**（0% 100%），因为"缩"这件事要朝左下角收。
         * 但原点在左边缘时，放大就会整体往右偏；所以 left 里把这部分补偿掉：
         *
         *   元素左边缘 = left - REF/2        （translateX(-50%)）
         *   视觉中线   = left - REF/2 + REF*s/2
         *   令它等于侧栏中线 → left = center + (REF/2)(1 - s)
         *
         * 于是竖向缩放贴着底边、横向缩放绕左边缘，中心仍然精确对齐侧栏中线。
         */
        function placeEmblem(emblem, { centerX, leftEdge, bottom, size, animate, ms }) {
          // 窗口刚变过尺寸 / 侧栏刚被拖动时不做过渡，严格跟手
          if (performance.now() - lastChangeAt < 280) animate = false
          const scale = size / REF
          // 原点在左边缘 → 视觉左沿 = 元素左沿 = left - REF/2
          // 居中模式用 centerX 补偿缩放偏移；贴边模式直接指定左沿
          const left =
            leftEdge !== undefined ? leftEdge + REF / 2 : centerX + (REF / 2) * (1 - scale)
          // ms 不传就是停靠速度；只有主视觉那一趟（以及它的回程）会传 SWIM_MS
          const duration = Number.isFinite(ms) ? ms : DOCK_MS
          const ease = duration >= SWIM_MS ? SWIM_EASE : DOCK_EASE
          emblem.style.transition = animate
            ? `transform ${duration}ms ${ease}, left ${duration}ms ${ease}, bottom ${duration}ms ${ease}, opacity 0.3s ease`
            : 'none'
          emblem.style.transformOrigin = '0% 100%'
          emblem.style.left = Math.round(left) + 'px'
          emblem.style.bottom = Math.round(bottom) + 'px'
          emblem.style.transform = `translateX(-50%) scale(${scale.toFixed(4)})`
          emblem.style.opacity = '0.96'
          return Math.round(size)
        }

        /** 找到正文的滚动容器（最大的、不属于侧栏的那种）。 */
        function resolveContentScroller() {
          if (contentEl && contentEl.isConnected) {
            const r = contentEl.getBoundingClientRect()
            if (r.width > 200 && r.height > 100) return contentEl
          }
          contentEl = null
          let best = null
          let bestArea = 0
          for (const node of document.body.querySelectorAll('*')) {
            if (node.closest('#zzz-hdd-hud')) continue
            const cs = getComputedStyle(node)
            if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue
            if (sidebarEl && sidebarEl.contains(node)) continue
            const r = node.getBoundingClientRect()
            if (r.height < window.innerHeight * 0.35) continue
            if (r.width < 260) continue
            const area = r.width * r.height
            if (area > bestArea) {
              bestArea = area
              best = node
            }
          }
          contentEl = best
          return best
        }

        /**
         * 正文「文字」真正从哪里开始 —— 只统计**下半部分**的文本块。
         *
         * 之前量的是列边框或第一层包装盒，但侧栏收起后正文列紧贴图标条开始，
         * 算出来是 64px，减掉边距就成负数，于是判定"没位置"把眼睛藏了。
         * 这里改成扫文本块的最小 left：会话列有边距、气泡也不顶格，
         * 得到的才是真实可用的空白宽度。
         */
        function resolveTextLeft() {
          const scroller = resolveContentScroller()
          if (!scroller) return window.innerWidth * 0.55
          const sr = scroller.getBoundingClientRect()

          // ① 居中列的左沿（便宜、稳定）：取最宽的一级子元素
          let wrapperLeft = sr.left
          let widest = 0
          for (const child of scroller.children) {
            const r = child.getBoundingClientRect()
            if (r.width > widest && r.width > 200) {
              widest = r.width
              wrapperLeft = Math.max(wrapperLeft, r.left)
            }
          }
          const byWrapper = wrapperLeft + 24 // 列内边距，保守估计

          // ② 实测文字左沿（较贵，但更贴边）
          let min = Infinity
          for (const node of scroller.querySelectorAll('*')) {
            if (node.children.length > 0) continue // 只认叶子文本
            if (node.closest('#zzz-hdd-hud')) continue
            const r = node.getBoundingClientRect()
            if (r.width < 40 || r.height < 12) continue
            if (r.left < 1) continue
            if (r.right > window.innerWidth) continue
            if (r.top > sr.bottom) continue
            const text = node.textContent
            if (!text || !text.trim()) continue
            if (r.left < min) min = r.left
          }

          // 两个估计取**较小**的那个：宁可把眼睛算小，也不能压到正文。
          return Number.isFinite(min) ? Math.min(min, byWrapper) : byWrapper
        }

        /** 文字左沿带 300ms 缓存：每帧扫全树是之前掉帧的主因。 */
        function textLeftCached() {
          const now = performance.now()
          if (now - textLeftAt < 300 && textLeftCache > 0) return textLeftCache
          textLeftAt = now
          textLeftCache = resolveTextLeft()
          return textLeftCache
        }

        function hideEmblem(emblem) {
          if (!emblem) return
          emblem.style.transition = 'transform 0.3s ease, opacity 0.3s ease'
          emblem.style.transformOrigin = '0% 100%'
          emblem.style.transform = 'translateX(-50%) scale(0.02)'
          emblem.style.opacity = '0'
          releaseReserve()
        }

        /**
         * 侧栏收起 / 找不到侧栏：挪到窗口左下角常驻。
         *
         * 这里的原则是**宁可见、不可藏**：默认就摆左下角，尺寸按可测到的空档走；
         * 一旦测量结果不可信（负数、过小），就退回一个稳妥的默认尺寸，
         * 而不是把它藏起来。只有窗口窄到 420px 以下才真的隐身。
         */
        /**
         * 输入框（composer）的矩形。它比正文更靠左，是左下角徽记最容易压到的东西。
         */
        function resolveComposerRect() {
          if (composerEl && composerEl.isConnected) return composerEl.getBoundingClientRect()
          composerEl = null
          const input = document.querySelector('textarea, [contenteditable="true"]')
          if (!input || (sidebarEl && sidebarEl.contains(input))) return null
          let node = input
          for (let i = 0; i < 6; i += 1) {
            const parent = node.parentElement
            if (!parent || parent === document.body) break
            const r = parent.getBoundingClientRect()
            node = parent
            if (r.width > 300 && r.height > 52) break
          }
          const r = node.getBoundingClientRect()
          if (r.width < 200 || r.height < 40) return null
          composerEl = node
          return r
        }

        function dockToCorner(emblem) {
          releaseReserve()
          const winW = window.innerWidth
          const winH = window.innerHeight
          // 边距固定 10：之前用"侧栏右沿"当边距，而侧栏收起后那条右沿时有时无，
          // 于是位置和尺寸每半秒在 10 / 120 之间来回跳。
          const leftMargin = 10
          const textLeft = textLeftCached()
          // 上限 = 停靠态尺寸的 1.2 倍
          const base = lastDockedSize || Math.round(Math.min(270 * 0.7, winH * 0.32, REF))
          const cap = Math.min(Math.round(base * 1.2), Math.round(winH * 0.5), 460)

          // 尺寸严格随可用空间走 —— **不设下限**，否则窗口变窄它就不动了。
          // 外发光会向外扩 12%，所以盒子要按视觉尺寸反算：box <= 空档 / 1.24。
          const GLOW = 1.24

          // 左下角要避让两个东西：正文文字列、以及更靠左的输入框。
          // 取两者中更靠近窗口的那条边作为边界。
          const composer = resolveComposerRect()
          const boundaries = []
          if (textLeft > 200) boundaries.push(textLeft) // 只在可信时采用
          if (composer && composer.left > 40) boundaries.push(composer.left)
          // 没有任何可信边界 → 直接判定放不下。
          // 之前这里退回 winW*0.55，是个巨大的数，于是窗口收窄时突然弹出一个大的。
          const limitLeft = boundaries.length ? Math.min(...boundaries) : 0

          let size = Math.round(Math.min(cap, (limitLeft - leftMargin) / GLOW))

          // 再套两道物理约束，防"收窄时反而弹出一个大的"：
          //   ① 尺寸不得超过窗口宽度的 12%（无论测量结果多离谱）
          //   ② 窗口在变窄的过程中，尺寸只允许缩小，不允许变大
          size = Math.min(size, Math.round(winW * 0.12))
          if (winW < lastWinW && size > lastCornerSize) size = lastCornerSize

          // 徽记留在真正的左下角，不往上飘
          const bottomOffset = 18
          // 太小就没意义了；窗口太窄也直接消失
          if (winW < 700 || size < 60) size = 0
          // 迟滞：一旦隐藏，只有「窗口在变大」且「尺寸够大」才重新出现。
          // 收窄途中永远不再冒出来 —— 这正是之前"消失后又弹一个大的"的路径。
          if (cornerHidden && (winW <= lastWinW || size < 78)) size = 0

          lastWinW = winW
          lastCornerSize = size > 0 ? size : lastCornerSize
          cornerHidden = size === 0

          const geometry = `corner:${winW}:${Math.round(textLeft)}:${size}`
          if (geometry !== lastGeometry) {
            lastGeometry = geometry
            report({
              kind: 'corner',
              winW,
              leftMargin,
              textLeft: Number.isFinite(textLeft) ? Math.round(textLeft) : null,
              composerLeft: composer ? Math.round(composer.left) : null,
              limitLeft: Math.round(limitLeft),
              bottomOffset,
              cap,
              size,
              hidden: size === 0,
            })
          }

          if (size === 0) {
            currentMode = 'hidden'
            hideEmblem(emblem)
            return
          }
          currentMode = 'corner'

          placeEmblem(emblem, {
            leftEdge: leftMargin,
            bottom: bottomOffset,
            size,
            animate: true,
            ms: performance.now() - heroSwimAt < SWIM_TAIL_MS ? SWIM_MS : DOCK_MS,
          })
        }

        /**
         * 空白会话的主视觉：把鲸鱼换成大眼睛，并在下面挂上「空洞深潜系统」标题块。
         * 这块是 React 渲染的，重渲染会把我们插的东西冲掉，所以带节流反复补。
         */
        let heroAt = 0
        let heroWatch = null
        let heroSeenAt = 0
        let heroMode = false
        let splashHold = false
        let returnSlow = false
        /** 最后一次离开主视觉的时刻：回程在 SWIM_TAIL_MS 内仍然走慢速。 */
        let heroSwimAt = -Infinity
        /** 上一次摆到主视觉的几何：没变就不再写样式，免得每 120ms 重排一次过渡。 */
        let heroPlaced = ''
        // 启动后 6 秒内属于「恢复上次会话」的窗口期，只有这段时间才做稳定性门槛；
        // 之后新建会话要立刻出现，不能再被门槛拖慢。
        const bootAt = performance.now()
        let heroProbed = false

        /** 主视觉文字层：只有文字，眼睛由左下角那枚滑过来。 */
        function heroLayer() {
          let box = document.getElementById('fairy-hero-layer')
          if (!box) {
            box = document.createElement('div')
            box.id = 'fairy-hero-layer'
            box.style.cssText =
              'position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:visible;'
            document.body.appendChild(box)
          }
          return box
        }

        /** 退出主视觉：记下时刻，好让接下来那次回程仍然用慢速。 */
        function leaveHero() {
          if (heroMode) heroSwimAt = performance.now()
          heroMode = false
          heroPlaced = ''
        }

        function heroify(force) {
          const now = performance.now()
          if (!force && now - heroAt < 700) return
          heroAt = now

          const box = heroLayer()
          const headline = document.querySelector('[class*="Hqq-bq_headline"]')

          let layer = box.querySelector('.fairy-hero')
          if (!layer) {
            layer = document.createElement('div')
            layer.className = 'fairy-hero'
            layer.innerHTML = `
              <div class="zzz-hero-title">HOLLOW DEEP DIVE SYSTEM</div>
              <div class="zzz-hero-rule"><i></i><span>空 洞 深 潜 系 统</span><i></i></div>
              <div class="zzz-hero-echo" aria-hidden="true">
                <b>HOLLOW DEEP DIVE SYSTEM</b>
                <b>HOLLOW DEEP DIVE SYSTEM</b>
                <b>HOLLOW DEEP DIVE SYSTEM</b>
              </div>`
            box.appendChild(layer)
          }

          const emblem = document.querySelector('#zzz-hdd-hud .fairy-emblem')

          if (!headline) {
            heroSeenAt = 0
            leaveHero()
            layer.classList.remove('is-on')
            layer.style.display = 'none'
            return
          }

          // 启动期（恢复上次会话）需要稳定性门槛
          if (now - bootAt < 2500) {
            if (!heroSeenAt) heroSeenAt = now
            if (now - heroSeenAt < 250) {
              layer.classList.remove('is-on')
              layer.style.display = 'none'
              return
            }
          }

          const r = headline.getBoundingClientRect()
          if (r.width < 40 || r.height < 20) {
            heroSeenAt = 0
            leaveHero()
            layer.style.display = 'none'
            return
          }

          // 眼睛尺寸：跟着主视觉区域走，最大 240
          const size = Math.round(Math.min(240, Math.max(120, r.width * 0.42), window.innerHeight * 0.3))

          // 把**同一枚**徽记滑到主视觉位置。这一趟是入场表演，不是跟手操作 ——
          // 用 SWIM_MS 的慢起长收，让它「游」过来，而不是被拽过来。
          // 几何没变就不再写：看门狗 120ms 一拍，反复写同一组值没意义，
          // 万一量到 1px 抖动还会把 1.2s 的过渡重新计时，看起来像在飘。
          heroMode = true
          if (emblem) {
            const centerX = r.left + r.width / 2
            const bottom = window.innerHeight - (r.top + size)
            const key = `${Math.round(centerX)}:${Math.round(bottom)}:${size}`
            if (key !== heroPlaced) {
              heroPlaced = key
              placeEmblem(emblem, {
                centerX,
                bottom,
                size,
                animate: true,
                ms: SWIM_MS,
              })
            }
          }

          // 文字层贴在眼睛下方
          layer.style.display = 'flex'
          layer.style.left = Math.round(r.left + r.width / 2) + 'px'
          layer.style.top = Math.round(r.top + size + 20) + 'px'
          layer.style.width = Math.round(Math.min(r.width, 760)) + 'px'
          // 触发一次淡入（每次进入空白会话都重放）
          if (!layer.classList.contains('is-on')) {
            layer.classList.remove('is-on')
            void layer.offsetWidth
            layer.classList.add('is-on')
          }

          if (!heroProbed) {
            heroProbed = true
            report({
              kind: 'hero6',
              eye: size,
              top: Math.round(r.top),
              h: Math.round(r.height),
              single: Boolean(emblem),
            })
          }
        }

        /** 一次性的现场快照，状态切换时发一条，方便我照着真实数字调参。 */
        function snapshot(state) {
          const win = [window.innerWidth, window.innerHeight]
          const side = sidebarEl && sidebarEl.isConnected ? sidebarEl.getBoundingClientRect() : null
          const inSide = sidebarEl && sidebarEl.isConnected ? resolveScroller() : null
          const inSideRect = inSide ? inSide.getBoundingClientRect() : null
          const content = contentEl && contentEl.isConnected ? contentEl.getBoundingClientRect() : null
          report({
            kind: 'diag',
            state,
            win,
            sidebar: side
              ? {
                  cls: String(sidebarEl.className).slice(0, 60),
                  left: Math.round(side.left),
                  right: Math.round(side.right),
                  w: Math.round(side.width),
                  h: Math.round(side.height),
                }
              : null,
            sideScroll: inSideRect
              ? { w: Math.round(inSideRect.width), left: Math.round(inSideRect.left) }
              : null,
            content: content
              ? {
                  cls: String(contentEl.className).slice(0, 60),
                  left: Math.round(content.left),
                  w: Math.round(content.width),
                }
              : null,
            textLeft: Math.round(resolveTextLeft()),
          })
        }

        let lastState = ''
        let currentMode = ''
        // 模式迟滞：进「左下角」要窄到 150 以下，回「停靠」要宽到 190 以上，
        // 中间这段保持现状 —— 否则侧栏收起过程中会在两种模式间反复横跳。
        let cornerLatched = false
        let lastDockedSize = 0

        function layoutEmblem() {
          const emblem = document.querySelector('#zzz-hdd-hud .fairy-emblem')
          // 主视觉期间眼睛归 heroify 管；开屏收尾期间归 bloomFinish 管
          if (heroMode || splashHold) return
          if (!emblem) return

          const el = resolveSidebar()
          const sr = el ? el.getBoundingClientRect() : null
          const scroll = el ? resolveScroller() : null
          const sidebarW = sr ? sr.width : 0

          // 迟滞用**侧栏外壳宽度**判断，不用会话列表的宽度 ——
          // 列表可能一时找不到，那不该被当成"侧栏收起了"。
          if (sidebarW < 150) cornerLatched = true
          else if (sidebarW > 190) cornerLatched = false

          if (!el || cornerLatched) {
            dockToCorner(emblem)
            return
          }

          // 侧栏是展开的。列表一时读不到就退回到外壳尺寸，仍然按"停靠"摆位，
          // 这样重新打开侧栏时尺寸一定会变回去，不会卡在左下角。
          const panelW = scroll ? scroll.getBoundingClientRect().width : sidebarW
          const anchorRect = scroll ? scroll.getBoundingClientRect() : sr

          const scrollRect = anchorRect
          const footerTopNow = Math.min(scrollRect.top + scrollRect.height, sr.bottom)

          // 量「上方文字的最低点」。这一步要遍历侧栏，开销大且结果会跳，
          // 所以做两件事：① 120ms 缓存；② 对结果做平滑，避免尺寸抽搐。
          const nowTb = performance.now()
          if (nowTb - textBottomAt > 120 || !textBottomCache) {
            textBottomAt = nowTb
            let lowest = scrollRect.top
            for (const node of el.querySelectorAll('*')) {
              if (node.closest('#zzz-hdd-hud')) continue
              const r = node.getBoundingClientRect()
              if (r.height < 14 || r.height > 64) continue
              if (r.width < 60) continue
              if (r.top < scrollRect.top - 2 || r.bottom > footerTopNow + 2) continue
              const t = (node.textContent || '').trim()
              if (!t) continue
              if (r.bottom > lowest) lowest = r.bottom
            }
            textBottomCache = lowest
          }
          const textBottom = textBottomCache

          const avail = Math.max(0, footerTopNow - textBottom - 14)
          let target = Math.min(panelW * 0.7, window.innerHeight * 0.32, REF, avail)
          const crowded = scroll ? scroll.scrollHeight - scroll.clientHeight > 0 : false
          if (crowded) target *= 0.9

          // 指数平滑：目标值跳变时尺寸平滑跟上，不再"抽搐"
          dockSizeSmooth = dockSizeSmooth ? dockSizeSmooth * 0.72 + target * 0.28 : target
          let size = Math.round(dockSizeSmooth)

          // 显隐迟滞：显示中 < 84 才隐藏；已隐藏要 > 104 才回来
          if (dockHidden) {
            if (size <= 104) {
              currentMode = 'hidden'
              hideEmblem(emblem, 0)
              return
            }
            dockHidden = false
          } else if (size < 84) {
            dockHidden = true
            currentMode = 'hidden'
            hideEmblem(emblem, 0)
            return
          }
          lastDockedSize = size // 左下角的上限按它的 1.5 倍算

          // 给列表底部留空间：眼睛永远压在留白里，绝不盖住会话条目
          if (scroll) {
            const reserve = size + 24
            if (scroll.dataset.zzzReserve !== String(reserve)) {
              if (scroll.dataset.zzzPad === undefined) scroll.dataset.zzzPad = scroll.style.paddingBottom || ''
              scroll.style.paddingBottom = reserve + 'px'
              scroll.dataset.zzzReserve = String(reserve)
            }
          }

          const footerTop = Math.min(scrollRect.top + scrollRect.height, sr.bottom)

          // 拖拽中（宽度刚变过）不加过渡，严格跟手；停下 220ms 后恢复缓动
          const now = performance.now()
          const measured = Math.round(panelW)
          // 首次测到宽度不算「刚变过」。否则启动后 280ms 内进入空白会话时，
          // 这一趟主视觉游动会被当成拖拽中的跟手摆位，直接瞬移过去 ——
          // 表现就是「眼睛啪一下出现在中间」，谁也没看见它滑。
          if (lastWidth < 0) {
            lastWidth = measured
            lastWidthAt = 0
          } else if (measured !== lastWidth) {
            lastWidth = measured
            lastWidthAt = now
            lastChangeAt = now
          }
          const dragging = now - lastWidthAt < 220

          currentMode = 'docked'
          cornerHidden = false // 回到停靠态，清掉左下角的隐藏迟滞
          // 刚从主视觉退回来：这一趟回程和去程同速，别在同一秒里换两种手感
          // returnSlow：开屏收尾（蓝光段）之后的第一次归位，也用慢速"游"回去
          const swimming = now - heroSwimAt < SWIM_TAIL_MS || returnSlow
          const applied = placeEmblem(emblem, {
            centerX: scrollRect.left + panelW / 2,
            bottom: window.innerHeight - (footerTop - 10),
            size,
            animate: !dragging,
            ms: swimming ? SWIM_MS : DOCK_MS,
          })

          const geometry = `dock:${Math.round(panelW)}:${applied}:${crowded}`
          if (geometry !== lastGeometry) {
            lastGeometry = geometry
            if (!probed) {
              probed = true
              report({
                kind: 'sidebar',
                cls: String(el.className).slice(0, 140),
                panelW: Math.round(panelW),
                height: Math.round(sr.height),
                crowded,
                size: applied,
                reserve,
              })
            }
          }
        }

        function scheduleLayout() {
          if (layoutRaf) return
          layoutRaf = requestAnimationFrame(() => {
            layoutRaf = 0
            try {
              layoutEmblem()
              try {
                brandify()
              } catch {
                /* 品牌替换失败不影响布局 */
              }
              try {
                heroify(true)
              } catch {
                /* 主视觉替换失败不影响布局 */
              }
              // 只在"停靠 / 左下角 / 隐身"这几种状态真的切换时打一份现场快照
              if (currentMode !== lastState) {
                lastState = currentMode
                try {
                  snapshot(currentMode)
                } catch {
                  /* 诊断失败不影响布局 */
                }
              }
            } catch {
              /* 布局失败保持现状，下一轮再来 */
            }
          })
        }

        /* --------------------------------------------------- 装卸皮肤载荷 */

        function render(payload) {
          // 插件被关掉：把改过的品牌字样还原回去，其余一律不动
          if (payload && payload.enabled === false) {
            try {
              restoreBrand()
            } catch {
              /* 忽略 */
            }
            return
          }
          let style = document.getElementById(STYLE_ID)
          if (!style) {
            style = document.createElement('style')
            style.id = STYLE_ID
            document.head.appendChild(style)
          }
          style.textContent = payload.css

          const holder = document.createElement('div')
          holder.innerHTML = payload.html ?? ''
          const fresh = Array.from(holder.childNodes)

          // 浮层现在有两个根节点，先把旧的都摘掉再整体插回
          const oldHud = document.getElementById(ROOT_ID)
          const oldBg = document.getElementById('zzz-hdd-bg')
          const anchor = oldHud || oldBg
          const parent = anchor && anchor.parentNode ? anchor.parentNode : document.body
          if (oldHud && oldHud.parentNode) oldHud.parentNode.removeChild(oldHud)
          if (oldBg && oldBg.parentNode) oldBg.parentNode.removeChild(oldBg)
          for (const node of fresh) parent.appendChild(node)

          lastRename = { from: payload.renameFrom, to: payload.renameTo }
          rename(lastRename.from, lastRename.to)
          probed = false
          lastGeometry = ''
          // 浮层刚被整体重建，主视觉和品牌要马上补回来，不能等节流
          heroAt = 0
          brandAt = 0
          try {
            heroify(true)
          } catch {
            /* 失败等下一轮 */
          }
          try {
            brandify(true)
          } catch {
            /* 失败等下一轮 */
          }
          scheduleLayout()
        }

        async function tick() {
          let payload
          try {
            const response = await fetch(PAYLOAD, { credentials: 'same-origin', cache: 'no-store' })
            if (!response.ok) return
            payload = await response.json()
          } catch {
            return
          }
          if (!payload || typeof payload.css !== 'string' || payload.css.trim() === '') return
          const stamp = `${payload.css.length}:${payload.css.slice(-80)}:${payload.html.length}`
          if (stamp === lastStamp) return
          lastStamp = stamp
          render(payload)
        }

        // 窗口尺寸变了，正文左沿也可能变，缓存要作废
        const onResize = () => {
          contentEl = null
          composerEl = null
          textLeftAt = 0
          lastChangeAt = performance.now()
          scheduleLayout()
        }

        /**
         * 开屏动画：直接播 assets/boot.mp4（宿主 route 提供，支持 Range）。
         * 点击任意位置跳过；播放结束或失败都会自动淡出。
         */
        function splash() {
          try {
            if (sessionStorage.getItem('zzz-splash-played') === '1') return
            sessionStorage.setItem('zzz-splash-played', '1')
          } catch {
            /* 忽略 */
          }

          const el = document.createElement('div')
          el.id = 'fairy-splash'

          const video = document.createElement('video')
          video.className = 'fs-video'
          video.src = '/zzz-skin/boot.mp4'
          video.autoplay = true
          // 不静音：DSH 是桌面应用，通常允许带声播放；失败时下面会退回静音
          video.muted = false
          video.volume = 1
          video.playsInline = true
          video.preload = 'auto'
          video.disablePictureInPicture = true

          const skip = document.createElement('div')
          skip.className = 'fs-skip'
          skip.textContent = '点击任意位置跳过'

          el.appendChild(video)
          el.appendChild(skip)
          document.body.appendChild(el)

          // 原生标题栏按钮盖不住，得请主进程把它们隐掉
          const tellTitleBar = (hidden) => {
            try {
              fetch('/zzz-skin/beacon', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ kind: 'titlebar', hidden }),
                keepalive: true,
              }).catch(() => {})
            } catch {
              /* 忽略 */
            }
          }
          tellTitleBar(true)

          let closed = false
          const done = () => {
            if (closed) return
            closed = true
            el.classList.add('is-out')
            try {
              video.pause()
            } catch {
              /* 忽略 */
            }
            tellTitleBar(false)
            setTimeout(() => el.remove(), 620)
            bloomFinish()
          }

          el.addEventListener('pointerdown', done)
          video.addEventListener('ended', done)
          video.addEventListener('error', done)
          // 保险：最长 20 秒
          setTimeout(done, 20000)

          const play = video.play()
          if (play && typeof play.catch === 'function') {
            play.catch(() => {
              // 带声播放被拦 → 退回静音再试一次，仍然不行才跳过
              try {
                video.muted = true
                const p2 = video.play()
                if (p2 && typeof p2.catch === 'function') p2.catch(() => done())
              } catch {
                done()
              }
            })
          }
        }

        let raisedEl = null
        let textBottomCache = 0
        let textBottomAt = 0
        let dockSizeSmooth = 0
        let dockHidden = false
        /** 把侧栏底部那行（用户名 / 新版本）抬到徽记之上。 */
        function raiseSidebarFooter() {
          if (!sidebarEl || !sidebarEl.isConnected) return
          const sr = sidebarEl.getBoundingClientRect()
          if (sr.width < 60 || sr.height < 120) return

          const own = (el) =>
            el.closest('#zzz-hdd-hud') ||
            el.closest('#zzz-hdd-bg') ||
            el.closest('#fairy-hero-layer') ||
            el.closest('#fairy-splash')

          const y = Math.round(sr.bottom - 26)
          const probes = [Math.round(sr.left + 40), Math.round(sr.left + sr.width - 40)]
          let target = null

          for (const x of probes) {
            // 用**复数**版本：该点最上层是我们自己的徽记，要往下挑真正的应用元素
            const stack = document.elementsFromPoint(x, y)
            let node = stack.find((el) => !own(el))
            for (let i = 0; i < 6 && node && node !== sidebarEl; i += 1) {
              const r = node.getBoundingClientRect()
              if (r.width > sr.width * 0.55) target = node
              node = node.parentElement
              if (node && own(node)) break
            }
            if (target) break
          }
          if (!target) return

          if (raisedEl !== target) {
            if (raisedEl) {
              raisedEl.style.position = ''
              raisedEl.style.zIndex = ''
            }
            raisedEl = target
          }
          raisedEl.style.position = 'relative'
          raisedEl.style.zIndex = '60'
        }

        let scrimAt = 0
        /** 清掉输入框周围的实色遮罩（打点定位，不依赖类名）。 */
        function clearComposerScrim() {
          const now = performance.now()
          if (now - scrimAt < 900) return
          scrimAt = now

          const input = document.querySelector('textarea, [contenteditable="true"]')
          if (!input) return
          const r = input.getBoundingClientRect()
          if (r.width < 40 || r.height < 10) return

          const pts = [
            [Math.max(2, r.left - 14), Math.max(2, r.top - 46)],
            [Math.max(2, r.left - 14), Math.max(2, r.bottom + 16)],
            [Math.max(2, r.right + 8), Math.max(2, r.top + r.height / 2)],
          ]
          const own = (el) =>
            el.closest('#zzz-hdd-hud') ||
            el.closest('#zzz-hdd-bg') ||
            el.closest('#fairy-hero-layer') ||
            el.closest('#fairy-splash')

          for (const [x, y] of pts) {
            for (const el of document.elementsFromPoint(x, y)) {
              if (own(el)) break
              const cs = getComputedStyle(el)
              if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none') {
                el.style.setProperty('background-color', 'transparent', 'important')
                el.style.setProperty('background-image', 'none', 'important')
              }
            }
          }
        }

        /** 输入框祖先链背景（诊断用）。 */
        function probeBackdrop() {
          const input = document.querySelector('textarea, [contenteditable="true"]')
          if (!input) return
          const chain = []
          let node = input
          for (let i = 0; i < 9 && node && node !== document.body; i += 1) {
            const cs = getComputedStyle(node)
            chain.push({
              tag: node.tagName.toLowerCase(),
              cls: String(node.className).slice(0, 46),
              bg: cs.backgroundColor,
              img: cs.backgroundImage.slice(0, 60),
            })
            node = node.parentElement
          }
          report({ kind: 'backdrop', chain })
        }

        /** 输入框周围多点叠层（诊断用）。 */
        function probeStack() {
          const input = document.querySelector('textarea, [contenteditable="true"]')
          if (!input) return
          const r = input.getBoundingClientRect()
          const pts = [
            ['above', Math.max(4, r.left + 40), Math.max(4, r.top - 30)],
            ['left', Math.max(4, r.left - 60), Math.max(4, r.top + r.height / 2)],
          ]
          report({
            kind: 'stack',
            pts: pts.map(([name, x, y]) => ({
              name,
              stack: document.elementsFromPoint(x, y)
                .slice(0, 5)
                .map((el) => ({
                  tag: el.tagName.toLowerCase(),
                  id: el.id || '',
                  cls: String(el.className || '').slice(0, 34),
                  bg: getComputedStyle(el).backgroundColor,
                })),
            })),
          })
        }

        /**
         * 视频之后的那一段：
         *   蓝光图淡入 → 大眼睛滑到中心（放大） → 停留 → 蓝光淡出 → 眼睛滑回原位。
         * 用 splashHold 让 layoutEmblem 暂时不要抢位置。
         */
        function bloomFinish() {
          const bloom = document.createElement('div')
          bloom.id = 'fairy-bloom-finish'
          document.body.appendChild(bloom)

          const emblem = document.querySelector('#zzz-hdd-hud .fairy-emblem')
          const cx = window.innerWidth / 2
          const cy = window.innerHeight / 2

          splashHold = true
          if (emblem) {
            emblem.style.transition = 'transform 0.85s cubic-bezier(.22,.61,.36,1), left 0.85s cubic-bezier(.22,.61,.36,1), bottom 0.85s cubic-bezier(.22,.61,.36,1), opacity 0.6s ease'
            const size = Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.42)
            placeEmblem(emblem, {
              centerX: cx,
              bottom: Math.round(window.innerHeight - (cy + size / 2)),
              size,
              animate: false,
            })
          }

          requestAnimationFrame(() => bloom.classList.add('is-in'))

          let released = false

          // 大眼睛现身时按当前时段播一句问候；**没有对应音频就完全安静**，
          // 不做文字提示、不做系统语音兜底。
          let voice = null
          fetch('/zzz-skin/greeting', { credentials: 'same-origin', cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((g) => {
              if (!g || !g.url || released) return
              try {
                voice = new Audio(g.url)
                voice.volume = 0.9
                const vp = voice.play()
                if (vp && typeof vp.catch === 'function') vp.catch(() => {})
              } catch {
                /* 播放被拦就安静 */
              }
            })
            .catch(() => {})

          /**
           * 收尾：停留结束与单击跳过共用同一个闸门，
           * 保证「蓝光淡出 / 语音停止 / 眼睛归位」只发生一次。
           */
          const release = (skipped) => {
            if (released) return
            released = true
            document.removeEventListener('pointerdown', onSkip, true)
            bloom.classList.add('is-out')
            // 只有"用户主动跳过"才掐掉语音；定时收尾让它把话说完
            if (skipped && voice) {
              try {
                voice.pause()
                voice.currentTime = 0
              } catch {
                /* 忽略 */
              }
            }
            splashHold = false
            if (emblem) emblem.style.transition = ''
            returnSlow = true
            // heroify 内部有几何缓存：不清掉就不会重摆，眼睛会停在画面中央
            heroPlaced = ''
            try {
              heroify(true) // 空会话：让主视觉重新把眼睛摆到标题上方
            } catch {
              /* 失败就走普通布局 */
            }
            scheduleLayout()
            setTimeout(() => {
              returnSlow = false
            }, 1400)
            setTimeout(() => bloom.remove(), 900)
          }

          // 单击任意位置跳过（捕获阶段：点在眼睛里也算）
          const onSkip = () => release(true)
          document.addEventListener('pointerdown', onSkip, true)

          // 停留 4.7 秒后自动收尾
          setTimeout(() => release(false), 4700)
          releaseBoot()
        }

        /** 放行：撤掉 html 上的类与内联隐藏。 */
        function releaseBoot() {
          const de = document.documentElement
          de.classList.remove('zzz-boot')
          de.style.removeProperty('visibility')
          de.removeAttribute('data-zzz-boot-early')
        }

        /**
         * 工作区改名：把界面里的 "default-workspace" 换成 "H.D.D"。
         * 为什么不动存储文件：DSH 运行时内存里有副本，退出时会写回旧值。
         */
        let wsAt = 0
        function renameWorkspace() {
          const now = performance.now()
          if (now - wsAt < 400) return
          wsAt = now
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
          const hits = []
          let node
          while ((node = walker.nextNode())) {
            const v = node.nodeValue
            if (!v) continue
            const t = v.trim()
            // 界面里显示的是本地化名「默认工作区」，存储里是 default-workspace —— 两个都换
            if (!['default-workspace', '默认工作区', 'Default Workspace'].includes(t)) continue
            if (node.parentElement && node.parentElement.closest('#zzz-hdd-hud')) continue
            hits.push(node)
          }
          for (const hit of hits) hit.nodeValue = 'H.D.D'
        }

        /**
         * 品牌叠层的显隐：侧栏折叠 / 不可见时一律藏起来，
         * 另外清掉已经脱离侧栏的孤儿叠层（否则它会孤零零留在屏幕上）。
         */
        function guardBrandLayer() {
          const layers = document.querySelectorAll('.zzz-brand-overlay')
          if (!layers.length) return
          const collapsed =
            !sidebarEl ||
            !sidebarEl.isConnected ||
            sidebarEl.getBoundingClientRect().width < COLLAPSED_W
          for (const el of layers) {
            const row = el.parentElement
            if (!row) {
              el.remove()
              continue
            }
            const inside = sidebarEl && sidebarEl.contains(row)
            el.style.display = collapsed || !inside ? 'none' : ''
          }
        }

        const start = () => {
          installCriticalCss()
          const de = document.documentElement
          if (de.getAttribute('data-zzz-boot-early') === '1') {
            report({
              kind: 'boot',
              hadClass: de.classList.contains('zzz-boot'),
              t: Math.round(performance.now()),
            })
          }
          // 不开屏（已播过 / reduced-motion）时，几百毫秒内就把遮罩撤掉，
          // 否则界面会一直是黑的。真正的兜底放在 35 秒。
          setTimeout(() => {
            if (!document.getElementById('fairy-splash') && !document.getElementById('fairy-bloom-finish')) {
              releaseBoot()
            }
          }, 800)
          setTimeout(() => {
            releaseBoot()
          }, 35000)
          try {
            splash()
          } catch {
            /* 开屏失败不影响功能 */
          }
          // 预热三层眼睛图像：主视觉第一次显示时如果现拉，会先出文字、后出图标。
          for (const layerName of ['outer', 'core', 'ring']) {
            const pre = new Image()
            pre.src = '/zzz-skin/emblem.png?l=' + layerName
          }
          // 首帧就开始抢品牌位：rAF 连续试 3 秒，尽量避免先闪一下官方标记
          let brandTries = 0
          const brandPump = () => {
            try {
              brandify(true)
            } catch {
              /* 失败无所谓 */
            }
            try {
              heroify(true)
            } catch {
              /* 失败无所谓 */
            }
            if (brandTries < 180 && !document.querySelector('[data-zzz-brand]')) {
              brandTries += 1
              requestAnimationFrame(brandPump)
            }
          }
          requestAnimationFrame(brandPump)

          // 主视觉看门狗：常驻、无节流、120ms 一次。
          // 出现和消失都靠它，不再依赖"显示后就退出"的一次性泵。
          setTimeout(() => {
            try {
              probeStack()
            } catch {
              /* 无妨 */
            }
            try {
              probeBackdrop()
            } catch {
              /* 探针失败无妨 */
            }
          }, 3500)

          heroWatch = setInterval(() => {
            try {
              renameWorkspace()
            } catch {
              /* 失败等下一拍 */
            }
            try {
              guardBrandLayer()
            } catch {
              /* 失败等下一拍 */
            }
            try {
              raiseSidebarFooter()
            } catch {
              /* 失败等下一拍 */
            }
            try {
              clearComposerScrim()
            } catch {
              /* 失败等下一拍 */
            }
            try {
              heroify(true)
            } catch {
              /* 失败等下一拍 */
            }
            try {
              brandify(true)
            } catch {
              /* 失败等下一拍 */
            }
          }, 120)

          tick()
          timer = setInterval(tick, POLL_MS)
          safetyTimer = setInterval(scheduleLayout, SAFETY_MS)

          resizeObs = new ResizeObserver(() => scheduleLayout())
          resolveSidebar()
          if (sidebarEl) resizeObs.observe(sidebarEl)
          if (document.body) resizeObs.observe(document.body)

          observer = new MutationObserver(() => {
            if (timerRename) clearTimeout(timerRename)
            timerRename = setTimeout(() => rename(lastRename.from, lastRename.to), 150)
            // 品牌行被 React 重新挂载时立刻补位：这一步在微任务里跑，赶得上下一帧绘制
            try {
              if (brandRowNeedsWork()) brandify(true)
            } catch {
              /* 补位失败不影响后续布局 */
            }
            scheduleLayout()
          })
          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'aria-expanded'],
          })

          window.addEventListener('resize', onResize, { passive: true })
          scheduleLayout()
        }

        /**
         * 皮肤关着的时候，这个客户端半边一律不碰官方界面 ——
         * 尤其是那条"藏官方字标"的关键样式：留着它，关掉皮肤后品牌行会变成空的。
         * 宿主老版本没有 /zzz-skin/status 路由时按"开着"处理（fail-open）。
         */
        async function skinEnabled() {
          try {
            const response = await fetch(STATUS, { credentials: 'same-origin', cache: 'no-store' })
            if (!response.ok) return true
            const status = await response.json()
            return status?.enabled !== false
          } catch {
            return true
          }
        }

        skinEnabled().then((enabled) => {
          if (!enabled) return
          installCriticalCss()
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start, { once: true })
          } else {
            start()
          }
        })

        ctx.effect(() => () => {
          if (timer) clearInterval(timer)
          if (heroWatch) clearInterval(heroWatch)
          if (safetyTimer) clearInterval(safetyTimer)
          if (timerRename) clearTimeout(timerRename)
          if (observer) observer.disconnect()
          if (resizeObs) resizeObs.disconnect()
          if (layoutRaf) cancelAnimationFrame(layoutRaf)
          window.removeEventListener('resize', onResize)
          releaseReserve()
          const style = document.getElementById(STYLE_ID)
          if (style) style.remove()
          const critical = document.getElementById(CRITICAL_ID)
          if (critical) critical.remove()
          const root = document.getElementById(ROOT_ID)
          if (root) root.remove()
        })
      },
    }
  },
})
