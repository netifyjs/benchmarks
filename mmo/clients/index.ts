import type { Socket } from 'bun'

const port = Number(Bun.argv[2])
const count = Number(Bun.argv[3])
const duration = Number(Bun.argv[4] ?? '10000')
const sockets: Socket[] = []
let received = 0

for (let index = 0; index < count; index++) {
  sockets.push(
    await Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        /**
         * Only tallies bytes, nobody reads the snapshots
         */
        data: (socket: Socket, bytes: Uint8Array): void => {
          received += bytes.length
        },
      },
    }),
  )
}

const input = new Uint8Array(14)
new DataView(input.buffer).setUint16(0, 12)
const timer = setInterval((): void => {
  for (const socket of sockets) socket.write(input)
}, 50)

await Bun.sleep(duration)
clearInterval(timer)
for (const socket of sockets) socket.terminate()
console.log(JSON.stringify({ received }))
process.exit(0)
