import { argumentsOf, ready } from '../../control.ts'

const { port } = argumentsOf()

let replies: (Uint8Array | number | string)[] = []
let scheduled = false

/**
 * Sends every reply from this burst in one call
 */
const flush = (): void => {
  scheduled = false
  socket.sendMany(replies)
  replies = []
}

const socket = await Bun.udpSocket({
  hostname: '127.0.0.1',
  port,
  socket: {
    /**
     * Queues the echo and flushes once the burst is over
     * @param _socket unused
     * @param bytes the datagram
     * @param from sender port
     * @param address sender address
     */
    data: (
      _socket: unknown,
      bytes: Uint8Array,
      from: number,
      address: string,
    ): void => {
      replies.push(bytes, from, address)
      if (scheduled) return

      scheduled = true
      setImmediate(flush)
    },
  },
})
ready()
