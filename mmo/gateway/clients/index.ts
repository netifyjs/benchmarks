import type { Socket } from 'bun'

/**
 * Bytes held for a sampled socket until a whole snapshot is in
 */
type Sample = {
  /**
   * Leftover from earlier reads
   */
  pending: Uint8Array
}

const port = Number(Bun.argv[2])
const count = Number(Bun.argv[3])
const duration = Number(Bun.argv[4] ?? '10000')
const every = 8
const sockets: Socket<Sample | null>[] = []
const latencies: number[] = []
let measuring = false

/**
 * Pulls whole snapshots out of the bytes and notes how late each one is
 * @param sample the socket's leftovers
 * @param bytes what just arrived
 */
const readSnapshots = (sample: Sample, bytes: Uint8Array): void => {
  const arrived = performance.timeOrigin + performance.now()
  const joined = new Uint8Array(sample.pending.length + bytes.length)
  joined.set(sample.pending)
  joined.set(bytes, sample.pending.length)

  const view = new DataView(joined.buffer)
  let at = 0
  while (joined.length - at >= 2) {
    const size = view.getUint16(at)
    if (joined.length - at < 2 + size) break

    if (measuring && size >= 8)
      latencies.push(arrived - view.getFloat64(at + 2))
    at += 2 + size
  }

  sample.pending = joined.subarray(at)
}

for (let index = 0; index < count; index++) {
  sockets.push(
    await Bun.connect<Sample | null>({
      hostname: '127.0.0.1',
      port,
      data: index % every === 0 ? { pending: new Uint8Array(0) } : null,
      socket: {
        /**
         * Only sampled sockets parse, the rest just drain
         */
        data: (socket: Socket<Sample | null>, bytes: Uint8Array): void => {
          if (socket.data !== null) readSnapshots(socket.data, bytes)
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

await Bun.sleep(1000)
measuring = true
await Bun.sleep(Math.max(0, duration - 1000))
clearInterval(timer)

for (const socket of sockets) socket.terminate()
console.log(JSON.stringify({ latencies }))
process.exit(0)
