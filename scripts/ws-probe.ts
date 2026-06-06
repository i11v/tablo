// bun scripts/ws-probe.ts — subscribe to Anděl (node 1040) and print 2 messages
const ws = new WebSocket("ws://localhost:1337/api/ws?session=probe-1")
let count = 0
ws.onopen = () => {
  ws.send(JSON.stringify({ _tag: "Subscribe", selectors: [{ node: 1040, stops: null }] }))
}
ws.onmessage = (event) => {
  console.log(String(event.data).slice(0, 300))
  if (++count >= 2) {
    ws.close()
    process.exit(0)
  }
}
ws.onerror = (e) => {
  console.error("WS error", e)
  process.exit(1)
}
setTimeout(() => {
  console.error("timeout waiting for 2 messages")
  process.exit(1)
}, 40_000)
