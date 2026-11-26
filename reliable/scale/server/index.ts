import {
  InboundHandlerAdapter,
  ReliableBootstrap,
  ReliableMessage,
  type DatagramChannel,
  type HandlerContext,
} from '@netifyjs/netify'

/**
 * Counts what comes in and echoes it back
 * @class
 */
class Echo extends InboundHandlerAdapter {
  /**
   * Messages seen since the last reset
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
   * Echoes on the same lane
   * @param context unused
   * @param message should be a ReliableMessage
   */
  public override channelRead(context: HandlerContext, message: unknown): void {
    if (!(message instanceof ReliableMessage)) return

    this.count += 1
    message.reply(message.content)
  }
}

const echo = new Echo()
const server = await new ReliableBootstrap()
  .options({
    maxPeers: 100_000,
    encryption: Bun.env.BENCH_ENCRYPT === '1',
  })
  .handler((channel: DatagramChannel): void => {
    channel.pipeline.addLast<Echo>('echo', echo)
  })
  .bind({ hostname: '127.0.0.1', port: Number(Bun.env.BENCH_PORT) })

/**
 * Packet and resend counts summed over every peer
 */
const totals = (): Record<string, number> => {
  let packetsSent = 0
  let packetsReceived = 0
  let resends = 0
  for (const peer of server.handler.peers) {
    packetsSent += peer.stats.packetsSent
    packetsReceived += peer.stats.packetsReceived
    resends += peer.stats.resends
  }

  return { packetsSent, packetsReceived, resends }
}

let startedAt = performance.now()
let cpuAt = process.cpuUsage()
let peers = 0
for await (const line of console) {
  if (line === 'start') {
    echo.count = 0
    peers = server.handler.peers.size
    startedAt = performance.now()
    cpuAt = process.cpuUsage()
  } else if (line === 'stop') {
    const cpu = process.cpuUsage(cpuAt)
    console.log(
      JSON.stringify({
        seconds: (performance.now() - startedAt) / 1000,
        cpuMicros: cpu.user + cpu.system,
        systemMicros: cpu.system,
        messages: echo.count,
        peers,
        ...totals(),
      }),
    )
    break
  }
}

await server.channel.close()
process.exit(0)
