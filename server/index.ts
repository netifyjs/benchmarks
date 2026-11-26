import type { TCPSocketListenOptions } from 'bun'

import {
  InboundHandlerAdapter,
  LengthFieldBasedFrameDecoder,
  LengthFieldPrepender,
  ServerBootstrap,
  type Channel,
  type HandlerContext,
} from '@netifyjs/netify'
import { SilentLogger } from '../support/index.ts'

/**
 * Echoes reads back with one flush per read batch
 * @class
 */
class BatchEchoHandler extends InboundHandlerAdapter {
  /**
   * Queues it, the flush happens once per read batch
   * @param context used to queue the reply
   * @param message what to send back
   */
  public override channelRead(context: HandlerContext, message: unknown): void {
    context.writeSync(message)
  }

  /**
   * One flush for the whole batch
   * @param context used to flush
   */
  public override channelReadComplete(context: HandlerContext): Promise<void> {
    return context.flush()
  }
}

/**
 * Which echo server to run
 */
type Variant = 'raw' | 'netify' | 'framed'

/**
 * Per-socket state for the raw server
 */
type RawState = {
  /**
   * Bytes the socket wouldn't take yet, oldest first
   */
  readonly queue: Uint8Array[]
}

/**
 * Plain Bun echo with no framework, the ceiling we compare against
 * @param port where to listen, 0 for any
 */
const startRaw = (port: number): number => {
  const settings: TCPSocketListenOptions<RawState> & {
    readonly reusePort: boolean
  } = {
    hostname: '127.0.0.1',
    port,
    reusePort: true,
    data: { queue: [] },
    socket: {
      /**
       * Fresh queue per socket, plus TCP_NODELAY if NODELAY=1
       */
      open: (socket): void => {
        socket.data = { queue: [] }
        if (Bun.env.NODELAY === '1') socket.setNoDelay(true)
      },
      /**
       * Writes straight back, keeping order by queueing behind any backlog
       */
      data: (socket, bytes: Uint8Array): void => {
        const queue = socket.data.queue
        if (queue.length > 0) {
          queue.push(bytes)
          return
        }

        const written = socket.write(bytes)
        if (written < bytes.length)
          queue.push(bytes.subarray(Math.max(written, 0)))
      },
      /**
       * Works through the backlog until the socket fills up again
       */
      drain: (socket): void => {
        const queue = socket.data.queue
        for (let head = queue[0]; head !== undefined; head = queue[0]) {
          const written = socket.write(head)
          if (written < head.length) {
            queue[0] = head.subarray(Math.max(written, 0))
            return
          }

          queue.shift()
        }
      },
    },
  }
  const listener = Bun.listen<RawState>(settings)
  return listener.port
}

/**
 * Same echo through netify, with or without length framing
 * @param variant netify for bare bytes, framed for 4-byte length prefixes
 * @param port where to listen, 0 for any
 */
const startNetify = async (
  variant: 'netify' | 'framed',
  port: number,
): Promise<number> => {
  const server = await new ServerBootstrap()
    .childOptions({
      /**
       * Keep logging out of the measurements
       */
      logger: new SilentLogger(),
      /**
       * Nagle off unless NODELAY=0
       */
      noDelay: Bun.env.NODELAY !== '0',
    })
    .childHandler((channel: Channel): void => {
      if (variant === 'framed') {
        channel.pipeline
          .addLast<LengthFieldBasedFrameDecoder>(
            'framer',
            new LengthFieldBasedFrameDecoder({
              maxFrameLength: 1024 * 1024,
              lengthFieldLength: 4,
              initialBytesToStrip: 4,
            }),
          )
          .addLast<LengthFieldPrepender>(
            'prepender',
            new LengthFieldPrepender({ lengthFieldLength: 4 }),
          )
      }

      channel.pipeline.addLast<BatchEchoHandler>('echo', new BatchEchoHandler())
    })
    .options({ reusePort: true })
    .bind({ hostname: '127.0.0.1', port })
  return server.port
}

const variant = (Bun.env.BENCH_VARIANT ?? Bun.argv[2] ?? 'raw') as Variant
const requested = Number(Bun.env.BENCH_PORT ?? Bun.argv[3] ?? '0')
const port =
  variant === 'raw'
    ? startRaw(requested)
    : await startNetify(variant, requested)

process.on('SIGTERM', (): void => {
  process.exit(0)
})
console.log(`ready ${String(port)}`)
