# LiaScript Share

The page behind the links of `liadev --share`: it opens a
[LiaScript DevServer](https://github.com/LiaScript/LiaScript-DevServer) that runs
on somebody else's machine, with its courses and its AI chat, over WebRTC.

https://liascript.github.io/share/#room=…&key=…

No server sees the content. The page finds the DevServer through the
[y-webrtc](https://github.com/yjs/y-webrtc) signalling servers of LiaScript
(`signaling.json`, with TURN servers in `ice.json` for phones behind the NAT
of their carrier), which only carry the handshake sealed with the key of the
link; after that the data goes end to end encrypted (DTLS) between the two
machines. Room and key are in the part of the link
after `#`, which the browser never sends to a server.

How it works: `index.html` with `lia-share.js` dials the DevServer in the room
and shows it in a frame; `lia-rtc.mjs` is the signalling and the framing of the
data channel, the same module the DevServer uses. The service worker `lia-share-sw.js` hands every request
of that frame to the page, which sends it over the data channel and streams
the answer back. `lia-share-relay.html` does the same for web pages in the
chat, under a second origin, so that a web page never reaches the chat.
The UI of each tab lives below `tab-<id>/`, so two logins in one browser
(`liadev --users`) never cross: the service worker asks every share tab, and
the one with that id answers.

This is an experiment. The files are copied from `share/` of the DevServer
repository, change them there.
