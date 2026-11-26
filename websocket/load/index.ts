export {}

const port = Number(Bun.argv[2])
const connections = Number(Bun.argv[3] ?? '64')
const window = 32
const duration = 5000
const warmup = 1000
const payload = new Uint8Array(64)

let received = 0
const sockets = await Promise.all(
  Array.from({ length: connections }, (): Promise<WebSocket> => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/`)
    socket.binaryType = 'arraybuffer'
    return new Promise<WebSocket>(
      (resolve: (socket: WebSocket) => void): void => {
        socket.onopen = (): void => {
          resolve(socket)
        }
      },
    )
  }),
)
for (const socket of sockets) {
  socket.onmessage = (): void => {
    received += 1
    socket.send(payload)
  }
  for (let index = 0; index < window; index++) socket.send(payload)
}

await Bun.sleep(warmup)
const start = received
await Bun.sleep(duration)
const messagesPerSecond = ((received - start) / duration) * 1000
console.log(JSON.stringify({ messagesPerSecond }))
process.exit(0)
