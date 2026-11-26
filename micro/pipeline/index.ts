import {
  ByteBuf,
  DuplexHandlerAdapter,
  InboundHandlerAdapter,
  type Channel,
  type HandlerContext,
} from '@netifyjs/netify'
import { bench, group } from 'mitata'

import { createChannel } from '../../support/index.ts'

/**
 * Does nothing but forward, so we measure pure hop cost
 * @class
 */
class PassThroughHandler extends DuplexHandlerAdapter {
  /**
   * Forwards the read to the next handler
   * @param context the next hop
   * @param message passed through untouched
   */
  public override channelRead(
    context: HandlerContext,
    message: unknown,
  ): Promise<void> {
    return context.fireChannelRead(message)
  }

  /**
   * Forwards the write towards the transport
   * @param context the next hop outbound
   * @param message passed through untouched
   */
  public override write(
    context: HandlerContext,
    message: unknown,
  ): Promise<void> {
    return context.write(message)
  }
}

/**
 * Forwards with an await, to see what async handlers cost
 * @class
 */
class AsyncHandler extends InboundHandlerAdapter {
  /**
   * Awaits the rest of the pipeline before returning
   * @param context the next hop
   * @param message passed through untouched
   */
  public override async channelRead(
    context: HandlerContext,
    message: unknown,
  ): Promise<void> {
    await context.fireChannelRead(message)
  }
}

/**
 * Echo with one flush per read batch, like the real server
 * @class
 */
class EchoHandler extends InboundHandlerAdapter {
  /**
   * Queues the write without flushing
   * @param context where to write back
   * @param message the bytes to echo
   */
  public override channelRead(context: HandlerContext, message: unknown): void {
    context.writeSync(message)
  }

  /**
   * Flushes the batch in one go
   * @param context the channel to flush
   */
  public override channelReadComplete(context: HandlerContext): Promise<void> {
    return context.flush()
  }
}

/**
 * How fast events move through a pipeline
 * @class
 */
export class PipelineSuite {
  /**
   * Handlers in each deep pipeline
   */
  private static readonly depth: number = 16

  /**
   * A channel with 16 pass-through handlers ahead of the sink
   */
  private static async deep(): Promise<Channel> {
    const handlers = Array.from(
      { length: PipelineSuite.depth },
      (): PassThroughHandler => new PassThroughHandler(),
    )

    return (await createChannel(...handlers)).channel
  }

  /**
   * Builds each channel once, then registers the timed bodies
   */
  public async register(): Promise<void> {
    const reads = await PipelineSuite.deep()
    const writes = await PipelineSuite.deep()
    const queued = await PipelineSuite.deep()
    const awaited = (await createChannel(new AsyncHandler())).channel
    const echo = (await createChannel(new EchoHandler())).channel
    const message = ByteBuf.allocate(16)
    const bytes = new Uint8Array(16)

    group('DefaultChannelPipelineBenchmark', (): void => {
      bench('fireChannelRead through 16 handlers', (): void => {
        void reads.pipeline.fireChannelRead(message)
      })
      bench('handleData through the event queue', (): void => {
        void queued.handleData(bytes)
      })
      bench('echo read through the event queue', (): void => {
        void echo.handleData(bytes)
      })
      bench('writeAndFlush through 16 handlers', (): void => {
        void writes.writeAndFlush(bytes)
      })
      bench(
        'fireChannelRead through an async handler',
        async (): Promise<void> => {
          await awaited.pipeline.fireChannelRead(message)
        },
      )
    })
  }
}
