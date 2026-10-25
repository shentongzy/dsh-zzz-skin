/**
 * 生成可视预览：把同一段注入逻辑套到一张仿 DSH 布局的假页面上，
 * 再用 Edge headless 截图，就能在装进真机之前先看颜色/线框/可读性。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'skin-preview-'))
const mod = await import('../lib/index.js')

let transform
mod.apply({
  effect: (fn) => fn(),
  webServer: {
    tapIndex: (fn) => { transform = fn; return () => {} },
    register: () => () => {},
  },
  inject: () => {},
  logger: { info: () => {} },
})

const MOCK = `<!doctype html><html><head><meta charset="utf-8"><title>H.D.D. preview</title>
<style>
  /* 极简仿 DSH 布局，颜色全部走 --dsw-* 令牌 */
  *{box-sizing:border-box} html,body{margin:0;height:100%}
  body{font:14px/1.6 ui-sans-serif,"Segoe UI",system-ui,sans-serif;
       background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
       display:flex;overflow:hidden}
  aside{width:320px;flex:0 0 320px;background:var(--dsw-specific-sidebar-fill);
         border-right:1px solid var(--dsw-alias-border-l1);padding:14px;display:flex;flex-direction:column;gap:6px}
  /* 侧栏底部的「名字」区：徽记必须停在它上面，不能压到 */
  .who{margin-top:auto;display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:7px;
       border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:12.5px}
  .who .ava{width:22px;height:22px;border-radius:50%;flex:0 0 22px;
            background:radial-gradient(circle at 40% 35%,#7fb6e8,#255a9c);border:1px solid var(--dsw-alias-border-l2)}
  .brand{font-weight:600;letter-spacing:.14em;font-size:12px;color:var(--dsw-alias-label-secondary);
         text-transform:uppercase;margin-bottom:10px}
  .row{padding:8px 10px;border-radius:6px;color:var(--dsw-alias-label-secondary);font-size:13px}
  .row.active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);
              box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
  main{flex:1;display:flex;flex-direction:column;min-width:0}
  header{height:52px;display:flex;align-items:center;gap:10px;padding:0 20px;
         border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
  .dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
  .chat{flex:1;padding:26px 32px;display:flex;flex-direction:column;gap:18px;overflow:hidden}
  .msg{max-width:74%;padding:11px 14px;border-radius:9px;background:var(--dsw-alias-bg-layer-1);
       border:1px solid var(--dsw-alias-border-l1);font-size:13.5px}
  .msg.me{align-self:flex-end;background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
  .msg code{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--dsw-alias-brand-primary)}
  .tool{align-self:flex-start;font-size:12.5px;color:var(--dsw-alias-label-secondary);
        border:1px dashed var(--dsw-alias-border-l2);border-radius:6px;padding:7px 11px}
  .composer{margin:0 32px 22px;padding:12px 14px;border-radius:10px;
            border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);
            color:var(--dsw-alias-label-secondary);display:flex;justify-content:space-between}
  .send{color:var(--dsw-alias-brand-primary);font-weight:600}
  .warn{color:var(--dsw-alias-state-warn-primary)} .err{color:var(--dsw-alias-state-error-primary)}
</style></head><body>
<aside>
  <div class="brand">Workspaces</div>
  <div class="row active">default-workspace</div>
  <div class="row">lab3_work</div>
  <div class="row">desktop-pet</div>
  <div class="row">mnist</div>
  <div class="row">browser-automation</div>
  <div class="row">acl-recovery</div>
  <div class="who"><span class="ava"></span>主人</div>
</aside>
<main>
  <header><span class="dot"></span><strong>Fairy 模式</strong>
    <span style="color:var(--dsw-alias-label-secondary);font-size:12px">deepseek-flash · high</span></header>
  <div class="chat">
    <div class="msg me">把小鲸鱼改造成了 fairy，顺便给我做套皮肤</div>
    <div class="msg">主人，重做了。这回照着您本人来的——底色 <code>#01040a</code>，<br>
      宝蓝环 <code>#092f75</code>，暖白环 <code>#ece0e0</code>。<br>
      那颗小白点偏在右下，是照您照片量的位置。</div>
    <div class="tool">tapIndex · injected into &lt;head&gt; + &lt;/body&gt;</div>
    <div class="msg">主人，扫描线已经铺好了。<span class="warn">警告</span>：长时间盯着它看，会觉得整个世界都在刷新。</div>
    <div class="msg me">就这样，别再加了</div>
    <div class="msg">肯定。是我，都是我。<br><span class="err">否定。</span>刚才那句不是我说的。</div>
  </div>
  <div class="composer"><span>输入消息，/ 唤起命令…</span><span class="send">发送 ⏎</span></div>
</main>
</body></html>`

// 预览是 file:// 页面，取不到宿主路由，把图片换成同一份本地文件
const layerFile = (name) => new URL(`../assets/emblem-${name}.png`, import.meta.url).href
const html = transform(MOCK).replace(
  /src="\/zzz-skin\/emblem\.png\?v=\d+&l=(outer|inner|eye|core|ring)"/g,
  (_m, layer) => `src="${layerFile(layer)}"`,
)
writeFileSync(new URL('./preview.html', import.meta.url), html, 'utf8')
console.log('wrote preview.html')
