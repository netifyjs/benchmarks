import {
  Cluster,
  DatagramBootstrap,
  DatagramPacket,
  InboundHandlerAdapter,
  type DatagramChannel,
  type HandlerContext,
} from '@netifyjs/netify'
import { SilentLogger } from '../../../../support/index.ts'
import { argumentsOf, cores, ready } from '../../control.ts'

/**
 * Sends each packet back to its sender
 * @class
 */
class EchoHandler extends InboundHandlerAdapter {
  /**
   * Queues the reply
   * @param context where it goes
   * @param message the packet
   */
  public override channelRead(context: HandlerContext, message: unknown): void {
    if (message instanceof DatagramPacket) {
      context.writeSync(message.reply(message.content))
    }
  }

  /**
   * Sends what's queued in one batch
   * @param context where it goes
   */
  public override channelReadComplete(context: HandlerContext): Promise<void> {
    return context.flush()
  }
}

const { port } = argumentsOf()

if (cores > 1 && Cluster.workerId === null) {
  const cluster = new Cluster({
    script: import.meta.path,
    workers: cores,
    argv: Bun.argv.slice(2),
  }).start()
  await cluster.whenReady()
  ready()
} else {
  await new DatagramBootstrap()
    .options({ logger: new SilentLogger() })
    .handler((channel: DatagramChannel): void => {
      channel.pipeline.addLast<EchoHandler>('echo', new EchoHandler())
    })
    .bind({ hostname: '127.0.0.1', port: port + (Cluster.workerId ?? 0) })

  if (Cluster.workerId === null) ready()
  else Cluster.ready()
}
