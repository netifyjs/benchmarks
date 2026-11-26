import {
  ByteBuf,
  Gateway,
  InboundHandlerAdapter,
  LengthFieldBasedFrameDecoder,
  ServerBootstrap,
  ShardLink,
  type Channel,
  type HandlerContext,
  type ShardPeer,
} from '@netifyjs/netify'
import { SilentLogger } from '../../../support/index.ts'

/**
 * Where a player is, all we simulate
 */
type Player = {
  /**
   * Sent as a uint32 in snapshots
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
 * Which part this process plays
 */
type Role = 'single' | 'world' | 'gateway'

/**
 * Printed as JSON at the end for the runner to pick up
 */
type Report = {
  /**
   * What this process did
   */
  readonly role: Role

  /**
   * Ticks timed, zero on gateways
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
   * User plus system CPU over wall time, 1 means a full core
   */
  readonly cpu: number

  /**
   * Movement inputs applied per second
   */
  readonly inputsPerSecond: number

  /**
   * Share of the CPU time spent in the kernel
   */
  readonly kernel: number
}

const zoneSize = 50
const reach = Number(Bun.env.BENCH_REACH ?? '0')
const role = Bun.argv[2] as Role
const id = Number(Bun.argv[3])
const count = Number(Bun.argv[4])
const port = Number(Bun.argv[5])
const duration = Number(Bun.argv[6])
const folder = Bun.argv[7] ?? ''
const gateways = count - 1

const peers = Array.from(
  { length: count },
  (_: unknown, index: number): ShardPeer => ({
    unix: `${folder}/shard-${String(index)}.sock`,
  }),
)
const link =
  role === 'single'
    ? await ShardLink.open()
    : await ShardLink.open({ id, peers })
const gateway = new Gateway(link)

const zones: Player[][] = []
const players = new Map<number, Player>()
let inputs = 0
let local = 0
let joins: number[] = []
let moves: number[] = []

/**
 * Puts a player in their zone on the world side
 * @param player the id
 */
const join = (player: number): void => {
  const entry: Player = { id: player, x: 0, y: 0, z: 0 }
  const zone = Math.floor(player / zoneSize)

  zones[zone] ??= []
  zones[zone].push(entry)
  players.set(player, entry)
}

/**
 * Applies one movement on the world side
 * @param player the id
 * @param x east to west
 * @param y up and down
 * @param z north to south
 */
const move = (player: number, x: number, y: number, z: number): void => {
  const entry = players.get(player)
  if (entry === undefined) return

  entry.x += x
  entry.y += y
  entry.z += z
  inputs += 1
}

/**
 * Gives each socket a player id and passes its moves on
 * @class
 */
class PlayerHandler extends InboundHandlerAdapter {
  /**
   * Ids handed out so far on this process
   */
  private readonly ids: WeakMap<Channel, number>

  /**
   * Starts with nobody
   */
  public constructor() {
    super()

    this.ids = new WeakMap<Channel, number>()
  }

  /**
   * Takes the next id and joins its zone topic
   * @param context the new player
   */
  public override channelActive(context: HandlerContext): void {
    const player = role === 'single' ? local : id - 1 + gateways * local
    local += 1

    this.ids.set(context.channel, player)
    const zone = Math.floor(player / zoneSize)
    for (let offset = -reach; offset <= reach; offset++) {
      gateway.subscribe(context.channel, String(zone + offset))
    }

    if (role === 'single') join(player)
    else joins.push(player)
  }

  /**
   * Applies or queues three float deltas
   * @param context the player
   * @param message buffer of three floats
   */
  public override channelRead(context: HandlerContext, message: unknown): void {
    const player = this.ids.get(context.channel)
    if (player === undefined || !(message instanceof ByteBuf)) return

    const x = message.readFloat32()
    const y = message.readFloat32()
    const z = message.readFloat32()

    if (role === 'single') move(player, x, y, z)
    else moves.push(player, x, y, z)
  }
}

if (role !== 'world') {
  await new ServerBootstrap()
    .childOptions({ logger: new SilentLogger() })
    .options({ reusePort: true })
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
        .addLast<PlayerHandler>('player', new PlayerHandler())
    })
    .bind({ hostname: '127.0.0.1', port })
}

if (role === 'world') {
  link.on('join', (data: unknown): void => {
    for (const player of data as number[]) join(player)
  })
  link.on('move', (data: unknown): void => {
    const batch = data as number[]
    for (let at = 0; at < batch.length; at += 4) {
      move(
        batch[at] ?? 0,
        batch[at + 1] ?? 0,
        batch[at + 2] ?? 0,
        batch[at + 3] ?? 0,
      )
    }
  })
}

const times: number[] = []
let counted = 0
const started = performance.now()
const usage = process.cpuUsage()

const timer = setInterval((): void => {
  if (role === 'gateway') {
    if (joins.length > 0) link.send(0, 'join', joins)
    if (moves.length > 0) link.send(0, 'move', moves)
    joins = []
    moves = []
    return
  }

  const tickStart = performance.now()
  const sentAt = performance.timeOrigin + tickStart

  for (let zone = 0; zone < zones.length; zone++) {
    const members = zones[zone] ?? []
    const snapshot = ByteBuf.allocate(10 + members.length * 16)
    snapshot.writeUint16(8 + members.length * 16).writeFloat64(sentAt)
    for (const player of members) {
      snapshot
        .writeUint32(player.id)
        .writeFloat32(player.x)
        .writeFloat32(player.y)
        .writeFloat32(player.z)
    }

    gateway.publish(String(zone), snapshot)
  }

  const busy = inputs > counted
  counted = inputs
  queueMicrotask((): void => {
    if (busy) times.push(performance.now() - tickStart)
  })
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
  role,
  ticks: times.length,
  medianMs: at(0.5),
  p99Ms: at(0.99),
  cpu: (cpu.user + cpu.system) / 1e6 / elapsed,
  kernel: cpu.system / (cpu.user + cpu.system),
  inputsPerSecond: inputs / elapsed,
}
console.log(JSON.stringify(report))
process.exit(0)
