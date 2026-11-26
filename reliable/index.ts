import {
  DatagramBootstrap,
  InboundHandlerAdapter,
  ReliableHandler,
  ReliableMessage,
  type DatagramChannel,
  type HandlerContext,
  type ReliableOptions,
  type ReliablePeer,
} from '@netifyjs/netify'

const hostname = '127.0.0.1'

/**
 * Counts arrivals and can echo them back
 * @class
 */
class Counter extends InboundHandlerAdapter {
  /**
   * Messages seen
   */
  public count: number

  /**
   * Whether to send each message back
   */
  private readonly echo: boolean

  /**
   * Called on every arrival
   */
  public onMessage: () => void

  /**
   * Starts at zero
   * @param echo send each message back
   */
  public constructor(echo: boolean) {
    super()

    this.count = 0
    this.echo = echo
    this.onMessage = (): void => undefined
  }

  /**
   * Counts and maybe echoes
   * @param context unused
   * @param message should be a ReliableMessage
   */
  public override channelRead(context: HandlerContext, message: unknown): void {
    if (!(message instanceof ReliableMessage)) return

    this.count += 1
    if (this.echo) message.reply(message.content)
    this.onMessage()
  }
}

/**
 * Binds one end with a counter behind the reliable handler
 * @param options handler settings
 * @param counter the counter
 */
const open = async (
  options: ReliableOptions,
  counter: Counter,
): Promise<[DatagramChannel, ReliableHandler]> => {
  const handler = new ReliableHandler(options)
  const channel = await new DatagramBootstrap()
    .handler((child: DatagramChannel): void => {
      child.pipeline.addLast<ReliableHandler>('reliable', handler)
      child.pipeline.addLast<Counter>('counter', counter)
    })
    .bind({ hostname })
  return [channel, handler]
}

/**
 * Server and client, returns the client's peer for the server
 * @param options shared settings
 * @param echo whether the server echoes
 */
const pair = async (
  options: Omit<ReliableOptions, 'role' | 'server'>,
  echo: boolean,
): Promise<{
  readonly peer: ReliablePeer
  readonly server: Counter
  readonly client: Counter
  readonly close: () => Promise<void>
}> => {
  const server = new Counter(echo)
  const client = new Counter(false)
  const [serverChannel] = await open({ ...options, role: 'server' }, server)
  const [clientChannel, handler] = await open(
    {
      ...options,
      role: 'client',
      server: { hostname, port: serverChannel.localAddress.port },
    },
    client,
  )
  const peer = await handler.connected

  return {
    peer,
    server,
    client,
    close: async (): Promise<void> => {
      await clientChannel.close()
      await serverChannel.close()
    },
  }
}

/**
 * Pushes messages one way and reports how many got through per second
 * @param label what to print
 * @param options shared settings
 * @param total how many to send
 */
const throughput = async (
  label: string,
  options: Omit<ReliableOptions, 'role' | 'server'>,
  total: number,
): Promise<void> => {
  const { peer, server, close } = await pair(options, false)
  const payload = new Uint8Array(64)
  const burst = 1000

  const started = performance.now()
  let sent = 0
  while (sent < total) {
    while (sent < total && sent - server.count < burst * 4) {
      for (let index = 0; index < burst; index++) peer.send(0, payload)
      sent += burst
    }

    const { promise, resolve } = Promise.withResolvers<undefined>()
    server.onMessage = (): void => {
      if (sent - server.count < burst * 2 || server.count === total) {
        resolve(undefined)
      }
    }
    await promise
  }

  const seconds = (performance.now() - started) / 1000

  console.log(
    `${label}: ${Math.round(total / seconds).toLocaleString('en-GB')} msg/s, ${String(peer.stats.resends)} resends`,
  )
  await close()
}

/**
 * Bounces one message back and forth and reports the median round trip
 * @param rounds how many round trips
 */
const latency = async (rounds: number): Promise<void> => {
  const { peer, client, close } = await pair({}, true)
  const payload = new Uint8Array(32)
  const samples: number[] = []

  for (let round = 0; round < rounds; round++) {
    const { promise, resolve } = Promise.withResolvers<undefined>()
    client.onMessage = (): void => {
      resolve(undefined)
    }
    const started = performance.now()
    peer.send(0, payload)
    await promise
    samples.push(performance.now() - started)
  }

  samples.sort((a: number, b: number): number => a - b)

  const median = samples[Math.floor(samples.length / 2)] ?? 0
  const tail = samples[Math.floor(samples.length * 0.99)] ?? 0
  console.log(
    `round trip: ${(median * 1000).toFixed(0)} µs median, ${(tail * 1000).toFixed(0)} µs p99`,
  )
  await close()
}

await throughput('reliable ordered, 64 B, no loss', {}, 500_000)
await throughput(
  'reliable ordered, 64 B, 5% loss',
  { simulate: { loss: 0.05 } },
  200_000,
)
await throughput(
  'reliable ordered, 64 B, encrypted',
  { encryption: true },
  200_000,
)
await throughput(
  'reliable ordered, 64 B, 5% loss, congestion control',
  { simulate: { loss: 0.05 }, congestion: true },
  200_000,
)
await latency(10_000)
