import {
  BinaryWebSocketFrame,
  HttpObjectAggregator,
  HttpServerCodec,
  InboundHandlerAdapter,
  ServerBootstrap,
  WebSocketBootstrap,
  WebSocketServerProtocolHandler,
  type Channel,
  type HandlerContext,
} from '@netifyjs/netify'
import { SilentLogger } from '../../support/index.ts'

/**
 * Sends every binary frame straight back, flushing once per read batch
 * @class
 */
class Echo extends InboundHandlerAdapter {
  /**
   * Queues the echo
   * @param context where it goes
   * @param message a frame
   */
  public override channelRead(context: HandlerContext, message: unknown): void {
    if (message instanceof BinaryWebSocketFrame) {
      context.writeSync(new BinaryWebSocketFrame(message.content))
    }
  }

  /**
   * Sends everything queued
   * @param context where it goes
   */
  public override channelReadComplete(context: HandlerContext): void {
    void context.flush()
  }
}

const variant = Bun.argv[2] ?? 'netify'
const port = Number(Bun.argv[3])

if (variant === 'bun') {
  Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch: (
      request: Request,
      server: Bun.Server<undefined>,
    ): Response | undefined =>
      server.upgrade(request) ? undefined : new Response('no', { status: 400 }),
    websocket: {
      message: (
        socket: Bun.ServerWebSocket<undefined>,
        message: string | Buffer,
      ): void => {
        socket.send(message)
      },
    },
  })
} else if (variant === 'native') {
  await new WebSocketBootstrap()
    .childOptions({ logger: new SilentLogger() })
    .childHandler((channel: Channel): void => {
      channel.pipeline.addLast<Echo>('echo', new Echo())
    })
    .bind({ hostname: '127.0.0.1', port })
} else {
  await new ServerBootstrap()
    .childOptions({ logger: new SilentLogger() })
    .childHandler((channel: Channel): void => {
      channel.pipeline
        .addLast<HttpServerCodec>('codec', new HttpServerCodec())
        .addLast<HttpObjectAggregator>(
          'aggregator',
          new HttpObjectAggregator(64 * 1024),
        )
        .addLast<WebSocketServerProtocolHandler>(
          'websocket',
          new WebSocketServerProtocolHandler('/'),
        )
        .addLast<Echo>('echo', new Echo())
    })
    .bind({ hostname: '127.0.0.1', port })
}

console.log('ready')
const started = performance.now()
setTimeout(
  (): void => {
    if (Bun.env.BENCH_CPU !== undefined) {
      const cpu = process.cpuUsage()
      const wall = (performance.now() - started) * 1000
      console.error(
        `${variant} cpu ${(((cpu.user + cpu.system) / wall) * 100).toFixed(0)}%, user ${((cpu.user / wall) * 100).toFixed(0)}%`,
      )
    }

    process.exit(0)
  },
  Number(Bun.argv[4] ?? '8000'),
)
