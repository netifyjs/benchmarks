import {
  Cluster,
  InboundHandlerAdapter,
  LengthFieldBasedFrameDecoder,
  LengthFieldPrepender,
  ServerBootstrap,
  type Channel,
  type HandlerContext,
} from '@netifyjs/netify'
import { SilentLogger } from '../../../../support/index.ts'
import { argumentsOf, cores, ready, whenListening } from '../../control.ts'

/**
 * Sends each frame back, flushing once per read
 * @class
 */
class EchoHandler extends InboundHandlerAdapter {
  /**
   * Queues the frame
   * @param context where it goes
   * @param message the frame
   */
  public override channelRead(context: HandlerContext, message: unknown): void {
    context.writeSync(message)
  }

  /**
   * Sends what's queued
   * @param context where it goes
   */
  public override channelReadComplete(context: HandlerContext): Promise<void> {
    return context.flush()
  }
}

const { port } = argumentsOf()
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
} else {
  await new ServerBootstrap()
    .options({ reusePort: cores > 1 })
    .childOptions({ logger: new SilentLogger() })
    .childHandler((channel: Channel): void => {
      channel.pipeline
        .addLast<LengthFieldBasedFrameDecoder>(
          'framer',
          new LengthFieldBasedFrameDecoder({
            maxFrameLength: 64 * 1024,
            lengthFieldLength: 4,
            initialBytesToStrip: 4,
          }),
        )
        .addLast<LengthFieldPrepender>(
          'prepender',
          new LengthFieldPrepender({ lengthFieldLength: 4 }),
        )
        .addLast<EchoHandler>('echo', new EchoHandler())
    })
    .bind({ hostname: '127.0.0.1', port })
  if (cores === 1) ready()
}
