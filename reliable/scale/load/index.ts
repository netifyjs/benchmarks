import {
  InboundHandlerAdapter,
  ReliableBootstrap,
  ReliableMessage,
  type DatagramChannel,
  type HandlerContext,
  type ReliableClient,
} from '@netifyjs/netify'

const port = Number(Bun.argv[2])
const clients = Number(Bun.argv[3])
const rate = Number(Bun.argv[4])
const seconds = Number(Bun.argv[5])

/**
 * Counts echoes
 * @class
 */
class Counter extends InboundHandlerAdapter {
  /**
   * Echoes seen
   */
  public count: number

  /**
   * Starts at zero
   */
  public constructor() {
    super()

    this.count = 0
  }

  /**
   * Counts it
   * @param context unused
   * @param message should be a ReliableMessage
   */
  public override channelRead(context: HandlerContext, message: unknown): void {
    if (message instanceof ReliableMessage) this.count += 1
  }
}

const counter = new Counter()
const bootstrap = new ReliableBootstrap()
  .options({
    tick: 50,
    ackDelay: Number(Bun.env.BENCH_ACK_DELAY ?? '1'),
    encryption: Bun.env.BENCH_ENCRYPT === '1',
  })
  .handler((channel: DatagramChannel): void => {
    channel.pipeline.addLast<Counter>('counter', counter)
  })

const connected: ReliableClient[] = []
for (let start = 0; start < clients; start += 100) {
  const batch = Array.from(
    { length: Math.min(100, clients - start) },
    (): Promise<ReliableClient> =>
      bootstrap.connect({ hostname: '127.0.0.1', port }),
  )
  connected.push(...(await Promise.all(batch)))
}

console.error('ready')
await Bun.sleep(Number(Bun.env.BENCH_DELAY ?? '0'))

const payload = new Uint8Array(64)
let sent = 0
const timer = setInterval((): void => {
  for (const client of connected) client.peer.send(0, payload)
  sent += connected.length
}, 1000 / rate)
await Bun.sleep(seconds * 1000)
clearInterval(timer)
await Bun.sleep(300)

console.log(JSON.stringify({ sent, received: counter.count }))
await Promise.all(
  connected.map((client: ReliableClient): Promise<void> =>
    client.channel.close(),
  ),
)
process.exit(0)
