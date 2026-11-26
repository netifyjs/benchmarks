import { argumentsOf, cores, ready, whenListening } from '../../control.ts'

/**
 * Bytes left over from the last read
 */
type State = {
  /**
   * The unread tail, or null
   */
  pending: Uint8Array | null
}

const { port } = argumentsOf()
if (cores > 1 && Bun.env.BENCH_CHILD === undefined) {
  const children = Array.from({ length: cores }, () =>
    Bun.spawn({
      cmd: ['bun', Bun.main, ...process.argv.slice(2)],
      env: { ...Bun.env, BENCH_CHILD: '1' },
      stdout: 'ignore',
      stderr: 'inherit',
    }),
  )
  process.on('SIGTERM', (): void => {
    for (const child of children) child.kill()
    process.exit(0)
  })
  await whenListening(port)
  ready()
} else {
  Bun.listen<State>({
    hostname: '127.0.0.1',
    port,
    ...({ reusePort: cores > 1 } as object),
    socket: {
      open: (socket): void => {
        socket.data = { pending: null }
        socket.setNoDelay(true)
      },
      data: (socket, chunk: Uint8Array): void => {
        let bytes = chunk
        const pending = socket.data.pending
        if (pending !== null) {
          bytes = new Uint8Array(pending.length + chunk.length)
          bytes.set(pending)
          bytes.set(chunk, pending.length)
        }

        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        )
        let offset = 0
        while (bytes.length - offset >= 4) {
          const size = view.getUint32(offset)
          if (bytes.length - offset - 4 < size) break
          offset += 4 + size
        }

        socket.data.pending = offset < bytes.length ? bytes.slice(offset) : null
        if (offset > 0) socket.write(bytes.subarray(0, offset))
      },
    },
  })
  if (cores === 1) ready()
}
