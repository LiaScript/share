// The service worker of the share page: every request of the shared UI (the
// frame and everything it loads from this origin) goes to the share page,
// which holds the WebRTC connection (a worker cannot), and its answer comes
// back as a stream, so the event stream of the chat stays open.
const OWN = ['/lia-share.js', '/lia-share-sw.js', '/lia-share-relay.html', '/lia-share-relay.js']
// the folder of the share page ('' at the root): the server knows no folder
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '')

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  const path = url.pathname.slice(BASE.length)
  if (url.origin != location.origin || !url.pathname.startsWith(BASE + '/') || OWN.includes(path)) return
  // a page in the tab is the share page itself, the UI lives in its frame
  if (e.request.mode == 'navigate' && e.request.destination == 'document') return
  e.respondWith(tunnel(e.request, path + url.search))
})

async function tunnel(request, path) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  // the origin of web pages has the relay, the other the share page; not
  // another tab of the same origin (liascript.github.io/course/ …)
  // ponytail: the first share tab carries all, one tab per origin is the use
  const at = (c) => new URL(c.url).pathname
  const page =
    windows.find((c) => at(c) == BASE + '/lia-share-relay.html') ||
    windows.find((c) => c.frameType == 'top-level' && (at(c) == BASE + '/' || at(c) == BASE + '/index.html'))
  if (!page) return new Response('Not connected', { status: 503 })

  const body = request.method == 'GET' || request.method == 'HEAD' ? null : await request.arrayBuffer()
  const { port1, port2 } = new MessageChannel()
  page.postMessage(
    {
      method: request.method,
      path,
      headers: [...request.headers],
      dest: request.destination,
      body,
    },
    [port2],
  )

  return new Promise((resolve) => {
    let out
    const stream = new ReadableStream({
      start(controller) { out = controller },
      cancel() { port1.postMessage('abort') },
    })
    port1.onmessage = ({ data }) => {
      if (data.status) {
        const empty = [101, 204, 205, 304].includes(data.status) || request.method == 'HEAD'
        resolve(new Response(empty ? null : stream, { status: data.status, headers: data.headers }))
      } else if (data.chunk) {
        out.enqueue(new Uint8Array(data.chunk))
      } else if (data.end) {
        out.close()
      } else if (data.error) {
        resolve(new Response(data.error, { status: 502 }))
        try { out.error(new Error(data.error)) } catch (_) {}
      }
    }
  })
}
