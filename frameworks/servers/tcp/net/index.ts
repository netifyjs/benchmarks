import cluster from 'node:cluster'
import { createServer, type Socket } from 'node:net'

import { argumentsOf, cores, ready, whenListening } from '../../control.ts'

const { port } = argumentsOf()

/**
 * Echoes length framed messages, the way most Node TCP servers frame by hand
 * @param socket the connection
 */
const serve = (socket: Socket): void => {
  socket.setNoDelay(true)
  let pending: Buffer = Buffer.alloc(0)

  socket.on('data', (chunk: Buffer): void => {
    const bytes = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
    const replies: Buffer[] = []
    let offset = 0

    while (bytes.length - offset >= 4) {
      const size = bytes.readUInt32BE(offset)
      if (bytes.length - offset - 4 < size) break
      replies.push(bytes.subarray(offset, offset + 4 + size))
      offset += 4 + size
    }

    pending = offset === bytes.length ? Buffer.alloc(0) : bytes.subarray(offset)
    if (replies.length > 0) socket.write(Buffer.concat(replies))
  })
}

if (cores > 1 && cluster.isPrimary) {
  for (let index = 0; index < cores; index++) cluster.fork()
  process.on('SIGTERM', (): void => {
    for (const worker of Object.values(cluster.workers ?? {})) worker?.kill()
    process.exit(0)
  })
  await whenListening(port)
  ready()
} else {
  createServer(serve).listen(port, '127.0.0.1', (): void => {
    if (cores === 1) ready()
  })
}
