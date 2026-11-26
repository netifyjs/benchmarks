import {
  ByteBuf,
  InboundHandlerAdapter,
  LengthFieldBasedFrameDecoder,
  LengthFieldPrepender,
  OffloadHandler,
  ServerBootstrap,
  WorkerPool,
  type Channel,
  type HandlerContext,
} from '@netifyjs/netify'
import { SilentLogger } from '../../support/index.ts'
import { burn } from '../burn/index.ts'

const micros = Number(Bun.env.BURN ?? '200')
const workers = Number(Bun.env.WORKERS ?? '0')
const pool =
  workers > 0
    ? new WorkerPool<Uint8Array, Uint8Array>({
        script: new URL('../work/index.ts', import.meta.url).href,
        workers,
        maxQueued: 1 << 20,
      })
    : null

/**
 * Copies frames out of the buffer so they can cross to a worker
 * @class
 */
class Bytes extends InboundHandlerAdapter {
  /**
   * Hands on a plain copy of the frame
   * @param context where to pass it
   * @param message a decoded frame
   */
  public override channelRead(
    context: HandlerContext,
    message: unknown,
  ): Promise<void> {
    return context.fireChannelRead(
      message instanceof ByteBuf
        ? message.readBytes(message.readableBytes)
        : message,
    )
  }
}

/**
 * Does the heavy work right here on the network thread
 * @class
 */
class Inline extends InboundHandlerAdapter {
  /**
   * Burns the CPU, then echoes
   * @param context where to write back
   * @param message the frame
   */
  public override channelRead(context: HandlerContext, message: unknown): void {
    if (message instanceof Uint8Array) context.writeSync(burn(message, micros))
  }

  /**
   * One flush per batch
   * @param context where to flush
   */
  public override channelReadComplete(context: HandlerContext): Promise<void> {
    return context.flush()
  }
}

/**
 * Echoes whatever the workers send back
 * @class
 */
class Echo extends InboundHandlerAdapter {
  /**
   * Queues the result
   * @param context where to write back
   * @param message the worker's output
   */
  public override channelRead(context: HandlerContext, message: unknown): void {
    context.writeSync(message)
  }

  /**
   * One flush per batch
   * @param context where to flush
   */
  public override channelReadComplete(context: HandlerContext): Promise<void> {
    return context.flush()
  }
}

const server = await new ServerBootstrap()
  .childOptions({ logger: new SilentLogger() })
  .childHandler((channel: Channel): void => {
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
      .addLast<Bytes>('bytes', new Bytes())
    if (pool === null) {
      channel.pipeline.addLast<Inline>('work', new Inline())
      return
    }

    channel.pipeline
      .addLast<OffloadHandler<Uint8Array, Uint8Array>>(
        'work',
        new OffloadHandler<Uint8Array, Uint8Array>({
          pool,
          accepts: (message: unknown): message is Uint8Array =>
            message instanceof Uint8Array,
          maxInFlight: 64,
        }),
      )
      .addLast<Echo>('echo', new Echo())
  })
  .bind({ hostname: '127.0.0.1', port: Number(Bun.env.BENCH_PORT ?? '0') })

console.log(`ready ${String(server.port)}`)
