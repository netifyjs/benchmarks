import {
  Cluster,
  FullHttpRequest,
  FullHttpResponse,
  HttpMethod,
  HttpObjectAggregator,
  HttpResponseStatus,
  HttpServerCodec,
  InboundHandlerAdapter,
  ServerBootstrap,
  type Channel,
  type HandlerContext,
} from '@netifyjs/netify'
import { SilentLogger } from '../../../../support/index.ts'
import { argumentsOf, cores, ready, whenListening } from '../../control.ts'

/**
 * Answers GET / with plain text and anything else with a 404, flushing once per read
 * @class
 */
class HelloHandler extends InboundHandlerAdapter<unknown> {
  /**
   * Queues the response
   * @param context where it goes
   * @param message the request
   */
  public override channelRead(context: HandlerContext, message: unknown): void {
    if (!(message instanceof FullHttpRequest)) return

    const found = message.method === HttpMethod.GET && message.uri === '/'
    const response = found
      ? new FullHttpResponse(HttpResponseStatus.OK, 'Hello, World!')
      : new FullHttpResponse(HttpResponseStatus.NOT_FOUND, 'Not Found')
    response.headers.set('Content-Type', 'text/plain')
    response.setContentLength(response.content.readableBytes)
    context.writeSync(response)
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
        .addLast<HttpServerCodec>('codec', new HttpServerCodec())
        .addLast<HttpObjectAggregator>(
          'aggregator',
          new HttpObjectAggregator(64 * 1024),
        )
        .addLast<HelloHandler>('hello', new HelloHandler())
    })
    .bind({ hostname: '127.0.0.1', port })
  if (cores === 1) ready()
}
