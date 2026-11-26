import type { Socket } from 'bun'

/**
 * Anything a shard sends back
 */
type Reply =
  | {
      /**
       * Joined or claimed
       */
      readonly type: 'state'
      /**
       * Steps the shard has
       */
      readonly steps: number
    }
  | {
      /**
       * Token unknown on the new shard
       */
      readonly type: 'lost'
      /**
       * Why the old shard couldn't give them back
       */
      readonly reason?: string
    }
  | {
      /**
       * Same shard, new zone
       */
      readonly type: 'moved'
    }
  | {
      /**
       * Handed off
       */
      readonly type: 'go'
      /**
       * New shard's port
       */
      readonly port: number
      /**
       * Claim it with this
       */
      readonly token: string
    }
  | {
      /**
       * Handoff failed, still on the old shard
       */
      readonly type: 'stay'
      /**
       * Why
       */
      readonly reason: string
    }

/**
 * What every bot process adds up and prints
 */
export type Tally = {
  /**
   * Zone changes on one shard
   */
  moves: number
  /**
   * Handoffs that arrived with the right state
   */
  handoffs: number
  /**
   * Ms from asking to cross until the new shard had them
   */
  handoffTimes: number[]
  /**
   * Handoffs refused, by reason, player kept their state
   */
  refused: Record<string, number>
  /**
   * Players taken back by the old shard after the new one lost them
   */
  recalled: number
  /**
   * Players neither shard could give back
   */
  lostTokens: number
  /**
   * Arrived with different steps than they left with
   */
  wrongState: number
  /**
   * Gave up waiting for a reply
   */
  stuck: number
  /**
   * Connections dropped under the bot
   */
  drops: number
  /**
   * Ms from a drop until back in the game
   */
  recoveryTimes: number[]
  /**
   * Steps gone with a crashed shard
   */
  stepsLost: number
  /**
   * Steps taken in total
   */
  steps: number
}

const count = Number(Bun.argv[2])
const first = Number(Bun.argv[3])
const zones = Number(Bun.argv[4])
const duration = Number(Bun.argv[5])
const base = Number(Bun.env.CHAOS_PORT)
const shardCount = Number(Bun.env.CHAOS_SHARDS)
const regionSize = Number(Bun.env.CHAOS_REGION ?? '4')
const crossChance = Number(Bun.env.CHAOS_CROSS ?? '0.05')
const waitLimit = 10_000

const tally: Tally = {
  moves: 0,
  handoffs: 0,
  handoffTimes: [],
  refused: {},
  recalled: 0,
  lostTokens: 0,
  wrongState: 0,
  stuck: 0,
  drops: 0,
  recoveryTimes: [],
  stepsLost: 0,
  steps: 0,
}
const deadline = performance.now() + duration

/**
 * The port of the shard that owns a zone, matching ShardMap's round robin
 * @param zone the zone
 */
const portOf = (zone: number): number =>
  base + (Math.floor(zone / regionSize) % shardCount)

/**
 * One player walking around, with its own idea of its state
 * @class
 */
class Bot {
  /**
   * Same on every shard
   */
  private readonly id: number

  /**
   * Where it thinks it is
   */
  private zone: number

  /**
   * Steps the shard should have
   */
  private steps: number

  /**
   * Open connection, or null
   */
  private socket: Socket | null

  /**
   * Partial line from the last read
   */
  private pending: string

  /**
   * Waiting for the next reply, or null
   */
  private waiter: PromiseWithResolvers<Reply | null> | null

  /**
   * Set when the socket closed without being asked to
   */
  private dropped: PromiseWithResolvers<void>

  /**
   * Starts in a zone
   * @param id the player id
   * @param zone where it starts
   */
  public constructor(id: number, zone: number) {
    this.id = id
    this.zone = zone
    this.steps = 0
    this.socket = null
    this.pending = ''
    this.waiter = null
    this.dropped = Promise.withResolvers<void>()
  }

  /**
   * Plays until the deadline
   */
  public async play(): Promise<void> {
    await this.enter()

    while (performance.now() < deadline) {
      const crossing = Math.random() < crossChance
      if (crossing) await this.cross()
      else this.step()

      const pause = Bun.sleep(100)
      const outcome = await Promise.race([
        pause.then((): 'tick' => 'tick'),
        this.dropped.promise.then((): 'drop' => 'drop'),
      ])
      if (outcome === 'drop') await this.recover()
    }

    this.socket?.end()
  }

  /**
   * Joins fresh, retrying until a shard answers
   */
  private async enter(): Promise<void> {
    for (;;) {
      if (await this.connect(portOf(this.zone))) {
        this.send({ type: 'join', id: this.id, zone: this.zone })
        const reply = await this.next()
        if (reply?.type === 'state') {
          this.steps = 0
          return
        }
      }

      if (performance.now() > deadline) return
      await Bun.sleep(200)
    }
  }

  /**
   * Gets back in after the shard went away
   */
  private async recover(): Promise<void> {
    const started = performance.now()
    tally.drops += 1
    tally.stepsLost += this.steps

    await this.enter()
    tally.recoveryTimes.push(performance.now() - started)
  }

  /**
   * Takes one step
   */
  private step(): void {
    this.send({ type: 'step' })
    this.steps += 1
    tally.steps += 1
  }

  /**
   * Walks into the next zone over
   */
  private async cross(): Promise<void> {
    const zone = (this.zone + 1) % zones
    const started = performance.now()

    this.send({ type: 'cross', zone })
    const reply = await this.next()
    if (reply === null) return

    switch (reply.type) {
      case 'moved':
        this.zone = zone
        tally.moves += 1
        return
      case 'stay':
        tally.refused[reply.reason] = (tally.refused[reply.reason] ?? 0) + 1
        return
      case 'go':
        await this.arrive(zone, reply.port, reply.token, started)
        return
      default:
        tally.wrongState += 1
    }
  }

  /**
   * Moves to the new shard and checks it got everything
   * @param zone the new zone
   * @param port the new shard
   * @param token from the old shard
   * @param started when the crossing began
   */
  private async arrive(
    zone: number,
    port: number,
    token: string,
    started: number,
  ): Promise<void> {
    const home = portOf(this.zone)
    this.close()

    const reply = (await this.connect(port))
      ? await this.ask({ type: 'claim', token })
      : null
    if (reply?.type === 'state') {
      this.zone = zone
      this.check(reply.steps)
      tally.handoffs += 1
      tally.handoffTimes.push(performance.now() - started)
      return
    }

    this.close()
    const back = (await this.connect(home))
      ? await this.ask({ type: 'recall', token })
      : null
    if (back?.type === 'state') {
      this.check(back.steps)
      tally.recalled += 1
      return
    }

    tally.lostTokens += 1
    const why =
      back === null
        ? 'old shard unreachable'
        : back.type === 'lost'
          ? (back.reason ?? 'unknown')
          : back.type
    tally.refused[`lost: ${why}`] = (tally.refused[`lost: ${why}`] ?? 0) + 1
    tally.stepsLost += this.steps
    this.close()
    await this.enter()
  }

  /**
   * Sends a command and waits for its reply
   * @param command what to send
   */
  private ask(command: object): Promise<Reply | null> {
    const reply = this.next()

    this.send(command)
    return reply
  }

  /**
   * Counts a shard whose steps don't match the bot's
   * @param steps what the shard has
   */
  private check(steps: number): void {
    if (steps !== this.steps) tally.wrongState += 1
  }

  /**
   * Opens a connection, false if nothing's listening
   * @param port where to connect
   */
  private async connect(port: number): Promise<boolean> {
    this.dropped = Promise.withResolvers<void>()
    this.pending = ''

    try {
      this.socket = await Bun.connect({
        hostname: '127.0.0.1',
        port,
        socket: {
          /**
           * Splits replies into lines
           */
          data: (_: Socket, bytes: Uint8Array): void => {
            this.read(bytes)
          },
          /**
           * Notices the shard going away
           */
          close: (socket: Socket): void => {
            if (this.socket !== socket) return

            this.socket = null
            this.waiter?.resolve(null)
            this.dropped.resolve()
          },
        },
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * Hangs up without counting it as a drop
   */
  private close(): void {
    const socket = this.socket
    this.socket = null
    socket?.end()
  }

  /**
   * Waits for the next reply, null if the connection dropped or it took too long
   */
  private async next(): Promise<Reply | null> {
    const waiter = Promise.withResolvers<Reply | null>()
    this.waiter = waiter

    const timer = setTimeout((): void => {
      tally.stuck += 1
      waiter.resolve(null)
    }, waitLimit)
    const reply = await waiter.promise
    clearTimeout(timer)

    this.waiter = null
    return reply
  }

  /**
   * Hands each whole line to whoever is waiting
   * @param bytes what came in
   */
  private read(bytes: Uint8Array): void {
    this.pending += new TextDecoder().decode(bytes)

    let end = this.pending.indexOf('\n')
    while (end >= 0) {
      const line = this.pending.slice(0, end)
      this.pending = this.pending.slice(end + 1)
      this.waiter?.resolve(JSON.parse(line) as Reply)
      end = this.pending.indexOf('\n')
    }
  }

  /**
   * Sends one JSON line
   * @param command what to send
   */
  private send(command: object): void {
    this.socket?.write(`${JSON.stringify(command)}\n`)
  }
}

const bots = Array.from(
  { length: count },
  (_: unknown, index: number): Bot =>
    new Bot(first + index, (first + index) % zones),
)
await Promise.all(bots.map((bot: Bot): Promise<void> => bot.play()))

console.log(JSON.stringify(tally))
process.exit(0)
