import {
  AttributeKey,
  ByteBuf,
  ChannelGroup,
  InboundHandlerAdapter,
  LengthFieldBasedFrameDecoder,
  ServerBootstrap,
  type Channel,
  type HandlerContext,
} from '@netifyjs/netify'
import { SilentLogger } from '../../support/index.ts'

/**
 * Where a player is, all we simulate
 */
type Player = {
  /**
   * Join order, sent as a uint32 in snapshots
   */
  readonly id: number

  /**
   * East to west
   */
  x: number

  /**
   * Up and down
   */
  y: number

  /**
   * North to south
   */
  z: number
}

/**
 * Printed as JSON at the end for the runner to pick up
 */
type Report = {
  /**
   * Ticks timed, only counting once someone has joined
   */
  readonly ticks: number

  /**
   * Median tick in ms
   */
  readonly medianMs: number

  /**
   * p99 tick in ms
   */
  readonly p99Ms: number

  /**
   * Worst tick in ms
   */
  readonly maxMs: number

  /**
   * User plus system CPU over wall time, 1 means a full core
   */
  readonly cpu: number

  /**
   * Snapshot bytes queued across all members, per second
   */
  readonly bytesPerSecond: number

  /**
   * Movement inputs applied per second
   */
  readonly inputsPerSecond: number
}

const zoneSize = 50
const port = Number(Bun.argv[2])
const duration = Number(Bun.argv[3] ?? '10000')
const playerKey = new AttributeKey<Player>('player')
const zones: { group: ChannelGroup; players: Set<Player> }[] = []
let joined = 0
let inputs = 0
let sent = 0

/**
 * Puts players in zones and applies their movement
 * @class
 */
class GameHandler extends InboundHandlerAdapter {
  /**
   * Drops each new player into the next zone of 50 in join order
   * @param context gives the player's channel
   */
  public override channelActive(context: HandlerContext): void {
    const player: Player = { id: joined, x: 0, y: 0, z: 0 }
    const index = Math.floor(joined / zoneSize)
    joined += 1
    zones[index] ??= {
      group: new ChannelGroup(),
      players: new Set<Player>(),
    }
    zones[index].group.add(context.channel)
    zones[index].players.add(player)
    context.channel.attributes.set(playerKey, player)
  }

  /**
   * Adds the three float deltas to the player's position
   * @param context gives the player's channel
   * @param message buffer of three floats
   */
  public override channelRead(context: HandlerContext, message: unknown): void {
    const player = context.channel.attributes.get(playerKey)
    if (player === null || !(message instanceof ByteBuf)) return
    player.x += message.readFloat32()
    player.y += message.readFloat32()
    player.z += message.readFloat32()
    inputs += 1
  }
}

await new ServerBootstrap()
  .childOptions({ logger: new SilentLogger() })
  .childHandler((channel: Channel): void => {
    channel.pipeline
      .addLast<LengthFieldBasedFrameDecoder>(
        'framer',
        new LengthFieldBasedFrameDecoder({
          maxFrameLength: 1024,
          lengthFieldLength: 2,
          initialBytesToStrip: 2,
        }),
      )
      .addLast<GameHandler>('game', new GameHandler())
  })
  .bind({ hostname: '127.0.0.1', port })

const times: number[] = []
const started = performance.now()
const usage = process.cpuUsage()
const timer = setInterval((): void => {
  const tickStart = performance.now()
  for (const zone of zones) {
    const snapshot = ByteBuf.allocate(2 + zone.players.size * 16)
    snapshot.writeUint16(zone.players.size * 16)
    for (const player of zone.players) {
      snapshot
        .writeUint32(player.id)
        .writeFloat32(player.x)
        .writeFloat32(player.y)
        .writeFloat32(player.z)
    }

    sent += snapshot.readableBytes * zone.group.size
    zone.group.broadcastSync(snapshot)
  }

  if (joined > 0) times.push(performance.now() - tickStart)
}, 50)

console.log('ready')
await Bun.sleep(duration)
clearInterval(timer)

const elapsed = (performance.now() - started) / 1000
const cpu = process.cpuUsage(usage)
const sorted = [...times].sort(
  (first: number, second: number): number => first - second,
)
const at = (share: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0
const report: Report = {
  ticks: times.length,
  medianMs: at(0.5),
  p99Ms: at(0.99),
  maxMs: sorted.at(-1) ?? 0,
  cpu: (cpu.user + cpu.system) / 1e6 / elapsed,
  bytesPerSecond: sent / elapsed,
  inputsPerSecond: inputs / elapsed,
}
console.log(JSON.stringify(report))
process.exit(0)
