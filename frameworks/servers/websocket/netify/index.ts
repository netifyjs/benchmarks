import {
  BinaryWebSocketFrame,
  Cluster,
  InboundHandlerAdapter,
  WebSocketBootstrap,
  WebSocketChannel,
  WebSocketHandshakeComplete,
  type HandlerContext,
} from '@netifyjs/netify'
import { SilentLogger } from '../../../../support/index.ts'
import {
  argumentsOf,
  cores,
  payload,
  ready,
  runBroadcast,
  whenListening,
} from '../../control.ts'

/**
 * Echoes binary frames and joins the room
 * @class
 */
class EchoHandler extends InboundHandlerAdapter {
  /**
   * Sends the bytes back
   * @param context where the reply goes
   * @param message a frame
   */
  public override channelRead(context: HandlerContext, message: unknown): void {
    if (message instanceof BinaryWebSocketFrame) {
      context.writeSync(message.content)
    }
  }

  /**
   * Joins the room once the socket is up
   * @param context the channel's context
   * @param event a user event
   */
  public override userEventTriggered(
    context: HandlerContext,
    event: unknown,
  ): void {
    if (
      event instanceof WebSocketHandshakeComplete &&
      context.channel instanceof WebSocketChannel
    ) {
      context.channel.subscribe('room')
    }
  }
}

const { mode, port } = argumentsOf()
if (cores > 1 && Cluster.workerId === null) {
  const cluster = new Cluster({
    script: Bun.main,
    workers: cores,
    argv: process.argv.slice(2),
    restart: false,
  }).start()
  process.on('SIGTERM', (): void => {
    void cluster.stop().then((): never => process.exit(0))
  })
  await whenListening(port)
  ready()
  await new Promise<never>((): void => undefined)
}

const server = await new WebSocketBootstrap()
  .options({ maxConnections: 100_000, reusePort: cores > 1 })
  .childOptions({ logger: new SilentLogger() })
  .childHandler((channel: WebSocketChannel): void => {
    channel.pipeline.addLast<EchoHandler>('echo', new EchoHandler())
  })
  .bind({ hostname: '127.0.0.1', port })

if (cores === 1) ready()
if (mode === 'broadcast') {
  runBroadcast((): void => {
    server.publish('room', payload)
  })
}
