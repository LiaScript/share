// The share page: joins the room of the link (#room=…&key=…), holds the
// WebRTC connection to the DevServer of the teacher (src/share.ts) and shows
// its UI in a frame. The service worker hands every request of that frame
// here, this page sends it over the data channel and passes the answer back.
// Web pages in the shell run under another origin (web=… of the link), so
// they never reach the chat: there lia-share-relay.html hands their requests
// here, and they go to the proxy of the DevServer.
import { joinRoom } from 'https://cdn.jsdelivr.net/npm/@trystero-p2p/nostr@0.26.0/+esm'

const APP = 'liascript-devserver-share'
const status = document.getElementById('status')
const link = new URLSearchParams(location.hash.slice(1))
const web = link.get('web') ? new URL(link.get('web')) : null
// this page may sit in a folder (https://liascript.github.io/share/): the
// server hands out paths below it, the service worker strips it again
// and the UI of this tab sits below tab-<id>, apart from other tabs
const tab = Math.random().toString(36).slice(2, 10)
const folder = new URL('.', location.href).href.replace(/\/$/, '')
const here = folder + '/tab-' + tab

function say(text) {
  status.textContent = text
  status.hidden = false
}

if (!link.get('room') || !link.get('key')) {
  say('This link is incomplete, ask for a new one.')
} else {
  start().catch((e) => say('Could not connect: ' + e.message))
}

async function start() {
  // the newest worker before the frame: an older one from the cache of the
  // browser does not know the paths of this page and answered 404
  const reg = await navigator.serviceWorker.register('lia-share-sw.js', { updateViaCache: 'none' })
  await reg.update().catch(() => {})
  const fresh = reg.installing || reg.waiting
  if (fresh && fresh.state != 'activated') {
    await new Promise((resolve) => fresh.addEventListener('statechange', () => fresh.state == 'activated' && resolve()))
  }
  await navigator.serviceWorker.ready

  const peers = joinRoom({ appId: APP, password: link.get('key') }, link.get('room'))
  const hello = peers.makeAction('hello')
  const req = peers.makeAction('req')
  const res = peers.makeAction('res')
  const abort = peers.makeAction('abort')

  let host = null
  let next = 0
  const pending = new Map()
  let frame = null
  let lost = false

  // the requests of a host that left fail, their pages ask again
  function gone() {
    for (const port of pending.values()) port.postMessage({ error: 'The teacher’s server is gone.' })
    pending.clear()
    lost = true
  }

  hello.onMessage = (data, { peerId }) => {
    if (!data?.host) return
    // a restarted host is a new peer, the old one may not have left yet
    if (host && host != peerId) gone()
    host = peerId
    status.hidden = true
    if (!frame) {
      frame = document.createElement('iframe')
      frame.src = here + '/'
      document.body.append(frame)
    } else if (lost) {
      // back after a restart: an event stream that failed does not retry
      lost = false
      frame.contentWindow.location.reload()
    }
  }

  peers.onPeerLeave = (peerId) => {
    if (peerId != host) return
    host = null
    gone()
    say('Connection lost, waiting for the teacher’s server…')
  }

  // a request of a service worker, its answer goes back through port
  function forward(data, port, isWeb) {
    if (!port) return
    // a request of another share tab
    if (data.tab !== tab) return port.postMessage({ notMine: true })
    if (!host) return port.postMessage({ error: 'Not connected.' })
    const id = ++next
    pending.set(id, port)
    port.onmessage = () => {
      pending.delete(id)
      if (host) abort.send({ id }, { target: host })
    }
    const { body, tab: _, ...meta } = data
    // the login of a server with users (liadev --users), its page sets it
    let token = null
    try {
      token = sessionStorage.getItem('lia-share-token')
    } catch (e) {}
    const m = { ...meta, id, origin: here, web: isWeb, ...(web ? { webOrigin: web.href.replace(/\/$/, '') + '/tab-' + tab } : {}), ...(token ? { token } : {}) }
    if (body) req.send(new Uint8Array(body), { target: host, metadata: m })
    else req.send(m, { target: host })
  }
  navigator.serviceWorker.onmessage = ({ data, ports: [port] }) => forward(data, port, false)

  if (web) {
    const relay = document.createElement('iframe')
    relay.style.display = 'none'
    relay.src = new URL('lia-share-relay.html?tab=' + tab, web).href
    relay.onload = () => {
      const { port1, port2 } = new MessageChannel()
      port1.onmessage = ({ data, ports: [port] }) => forward(data, port, true)
      relay.contentWindow.postMessage('lia-share', web.origin, [port2])
    }
    document.body.append(relay)
  }

  res.onMessage = (data, { metadata }) => {
    if (metadata) {
      pending.get(metadata.id)?.postMessage({ chunk: data })
      return
    }
    const port = pending.get(data?.id)
    if (!port) return
    port.postMessage(data)
    if (data.end || data.error) pending.delete(data.id)
  }
}
