import { appendFileSync, writeFileSync } from 'node:fs'

import {
  Cluster,
  LineBasedFrameDecoder,
  ServerBootstrap,
  ShardLink,
  ShardMap,
  SimpleInboundHandler,
  StringDecoder,
  StringEncoder,
  type Channel,
  type HandlerContext,
} from '@netifyjs/netify'
import { SilentLogger } from '../../support/index.ts'

/**
 * What a shard keeps about a player
 */
type Player = {
  /**
   * Stays the same across shards
   */
  readonly id: number

  /**
   * Where they are
   */
  zone: number

  /**
   * Moves made so far, the bot checks this after every handoff
   */
  steps: number
}

/**
 * Anything a bot sends
 */
type Command =
  | {
      /**
       * Starting fresh
       */
      readonly type: 'join'
      /**
       * Which player
       */
      readonly id: number
      /**
       * Where they start
       */
      readonly zone: number
    }
  | {
      /**
       * Arriving from another shard
       */
      readonly type: 'claim'
      /**
       * From the handoff
       */
      readonly token: string
    }
  | {
      /**
       * Coming back after the new shard lost them
       */
      readonly type: 'recall'
      /**
       * From the handoff
       */
      readonly token: string
    }
  | {
      /**
       * One move
       */
      readonly type: 'step'
    }
  | {
      /**
       * Walking into another zone
       */
      readonly type: 'cross'
      /**
       * The zone they walk into
       */
      readonly zone: number
    }

const count = Number(Bun.env.CHAOS_SHARDS)
const base = Number(Bun.env.CHAOS_PORT)
const folder = Bun.env.CHAOS_DIR ?? ''
const regionSize = Number(Bun.env.CHAOS_REGION ?? '4')

const shards = new ShardMap({ count, port: base })
const link = await ShardLink.open()
const players = new Map<Channel, Player>()
const sent = new Set<string>()

/**
 * Notes something that should never happen, in a file that outlives the shard
 * @param line what went wrong
 */
const report = (line: string): void => {
  appendFileSync(`${folder}/anomalies`, `${line}\n`)
}

link.on('present', (data: unknown, from: number): void => {
  const id = Number(data)
  for (const player of players.values()) {
    if (player.id === id) {
      report(
        `player ${String(id)} on shard ${String(link.id)} and ${String(from)}`,
      )
    }
  }
})

/**
 * The shard that owns a zone
 * @param zone the zone
 */
const ownerOf = (zone: number): number =>
  shards.shardOf(Math.floor(zone / regionSize))

/**
 * Runs the bot protocol, one JSON line each way
 * @class
 */
class PlayerHandler extends SimpleInboundHandler<string> {
  /**
   * Takes lines
   * @param message whatever the decoder passed on
   */
  protected override accepts(message: unknown): message is string {
    return typeof message === 'string'
  }

  /**
   * Handles one command
   * @param context the bot's connection
   * @param line a JSON command
   */
  protected override async messageReceived(
    context: HandlerContext,
    line: string,
  ): Promise<void> {
    const command = JSON.parse(line) as Command
    const channel = context.channel

    switch (command.type) {
      case 'join': {
        players.set(channel, { id: command.id, zone: command.zone, steps: 0 })
        this.answer(context, { type: 'state', steps: 0 })
        return
      }
      case 'claim': {
        const player = await link
          .claim<Player>(command.token)
          .catch((): null => null)
        if (player === null) {
          this.answer(context, { type: 'lost' })
          return
        }

        players.set(channel, player)
        link.broadcast('present', player.id)
        this.answer(context, { type: 'state', steps: player.steps })
        return
      }
      case 'recall': {
        const player = await link
          .recall<Player>(command.token)
          .catch((): null => null)
        if (player === null) {
          this.answer(context, {
            type: 'lost',
            reason: sent.has(command.token) ? 'claimed' : 'restarted',
          })
          return
        }

        players.set(channel, player)
        this.answer(context, { type: 'state', steps: player.steps })
        return
      }
      case 'step': {
        const player = players.get(channel)
        if (player !== undefined) player.steps += 1
        return
      }
      case 'cross':
        this.cross(context, command.zone)
    }
  }

  /**
   * Moves a player within this shard or hands them to another one
   * @param context the bot's connection
   * @param zone where they're going
   */
  private cross(context: HandlerContext, zone: number): void {
    const player = players.get(context.channel)
    if (player === undefined) {
      this.answer(context, { type: 'stay', reason: 'Not joined' })
      return
    }

    const target = ownerOf(zone)
    if (target === link.id) {
      player.zone = zone
      this.answer(context, { type: 'moved' })
      return
    }

    try {
      const token = link.handoff(target, { ...player, zone })
      sent.add(token)
      players.delete(context.channel)
      this.answer(context, {
        type: 'go',
        port: shards.portOf(target),
        token,
      })
    } catch (error) {
      this.answer(context, {
        type: 'stay',
        reason: error instanceof Error ? error.message : 'Handoff failed',
      })
    }
  }

  /**
   * Hangs up on a bot whose connection broke
   * @param context the bot's connection
   */
  public override exceptionCaught(context: HandlerContext): Promise<void> {
    return context.close()
  }

  /**
   * Forgets the player once the connection drops
   * @param context the bot's connection
   */
  public override channelInactive(context: HandlerContext): void {
    players.delete(context.channel)
  }

  /**
   * Sends one JSON line back
   * @param context the bot's connection
   * @param reply what to send
   */
  private answer(context: HandlerContext, reply: object): void {
    context.writeAndFlushSync(`${JSON.stringify(reply)}\n`)
  }
}

await new ServerBootstrap()
  .childOptions({ logger: new SilentLogger() })
  .childHandler((channel: Channel): void => {
    channel.pipeline
      .addLast<LineBasedFrameDecoder>(
        'framer',
        new LineBasedFrameDecoder({ maxLength: 4096 }),
      )
      .addLast<StringDecoder>('decoder', new StringDecoder())
      .addLast<StringEncoder>('encoder', new StringEncoder())
      .addLast<PlayerHandler>('player', new PlayerHandler())
  })
  .bind({ hostname: '127.0.0.1', port: shards.portOf(link.id) })

writeFileSync(`${folder}/pid-${String(link.id)}`, String(process.pid))
Cluster.ready()
