/**
 * 给 test/harness.html 起一个静态服务：夹具页 + /zzz-skin/emblem.png。
 *
 * 夹具原本用 file:// 也能跑，但徽记位图加载不出来（截图里是两个破图标），
 * 所以这里复刻宿主那两条路由，让离线夹具和真机看到的是同一张图。
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const assets = {
  outer: `${here}../assets/emblem-outer.png`,
  core: `${here}../assets/emblem-core.png`,
  ring: `${here}../assets/emblem-ring.png`,
}

export function startHarnessServer(port = 0) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/zzz-skin/emblem.png') {
      const layer = url.searchParams.get('l')
      try {
        const bytes = readFileSync(assets[layer] ?? `${here}../assets/emblem.png`)
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
        res.end(bytes)
      } catch {
        res.writeHead(404)
        res.end()
      }
      return
    }
    if (url.pathname === '/' || url.pathname === '/harness.html') {
      try {
        const html = readFileSync(`${here}harness.html`)
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(html)
      } catch {
        res.writeHead(404)
        res.end()
      }
      return
    }
    res.writeHead(404)
    res.end()
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { port } = await startHarnessServer(Number(process.argv[2] || 0))
  console.log(`harness: http://127.0.0.1:${port}/harness.html`)
}
