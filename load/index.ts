import type { Socket } from 'bun'

/**
 * Knobs for one load run
 */
export type LoadOptions = {
  /**
   * Echo server to hit on localhost
   */
  readonly port: number

  /**
   * How many sockets to open at once
   */
  readonly connections: number

  /**
   * Messages each socket keeps in flight, topped up as echoes return
   */
  readonly window: number

  /**
   * Body size in bytes, not counting the 4-byte length prefix
   */
  readonly size: number

  /**
   * Measured window in ms
   */
  readonly duration: number

  /**
   * Warm-up in ms before counting starts, lets the JIT settle
   */
  readonly warmup: number
}

/**
 * What a run measured
 */
export type LoadResult = {
  /**
   * Round trips completed per second
   */
  readonly messagesPerSecond: number

  /**
   * MiB per second, counting both directions
   */
  readonly megabytesPerSecond: number
}

/**
 * Per-socket bookkeeping
 */
type Connection = {
  /**
   * Leftover bytes from a message that's only half arrived
   */
  partial: number

  /**
   * Whatever the socket wouldn't take yet, or null
   */
  backlog: Uint8Array | null
}

/**
 * Hammers an echo server with fixed-size messages and counts what comes back
 * @class
 */
export class LoadGenerator {
  /**
   * Run settings as passed in
   */
  private readonly options: LoadOptions

  /**
   * Prebuilt message, reused for every send
   */
  private readonly message: Uint8Array

  /**
   * Echoes seen during the measured window
   */
  private counted: number

  /**
   * Off during warm-up, on while measuring
   */
  private measuring: boolean

  /**
   * Builds the message up front so sending stays cheap
   * @param options how hard and how long to push
   */
  public constructor(options: LoadOptions) {
    this.options = options
    this.message = LoadGenerator.frame(options.size)
    this.counted = 0
    this.measuring = false
  }

  /**
   * A 4-byte big-endian length followed by that many letter a's
   * @param size body length in bytes
   */
  private static frame(size: number): Uint8Array {
    const message = new Uint8Array(4 + size).fill(97)

    new DataView(message.buffer).setUint32(0, size)
    return message
  }

  /**
   * Opens every socket, warms up, measures, then tears it all down
   */
  public async run(): Promise<LoadResult> {
    const sockets = await Promise.all(
      Array.from(
        { length: this.options.connections },
        (): Promise<Socket<Connection>> => this.open(),
      ),
    )

    await Bun.sleep(this.options.warmup)
    this.measuring = true
    const started = performance.now()
    await Bun.sleep(this.options.duration)
    const elapsed = (performance.now() - started) / 1000
    this.measuring = false

    for (const socket of sockets) socket.terminate()
    const messagesPerSecond = this.counted / elapsed
    return {
      messagesPerSecond,
      megabytesPerSecond:
        (messagesPerSecond * this.message.length * 2) / (1024 * 1024),
    }
  }

  /**
   * Connects one socket and sends its first window of messages
   */
  private async open(): Promise<Socket<Connection>> {
    const length = this.message.length

    const socket = await Bun.connect<Connection>({
      hostname: '127.0.0.1',
      port: this.options.port,
      data: { partial: 0, backlog: null },
      socket: {
        /**
         * Counts whole messages by length and sends one new message per echo
         */
        data: (client: Socket<Connection>, bytes: Uint8Array): void => {
          const total = client.data.partial + bytes.length
          const complete = Math.floor(total / length)
          client.data.partial = total % length
          if (this.measuring) this.counted += complete
          if (complete > 0) this.send(client, complete)
        },
        /**
         * Socket has room again, keep writing
         */
        drain: (client: Socket<Connection>): void => {
          this.flush(client)
        },
      },
    })

    this.send(socket, this.options.window)
    return socket
  }

  /**
   * Packs count copies into one buffer behind any backlog
   * @param socket where to send
   * @param count how many messages
   */
  private send(socket: Socket<Connection>, count: number): void {
    const batch = new Uint8Array(this.message.length * count)
    for (let index = 0; index < count; index++) {
      batch.set(this.message, index * this.message.length)
    }

    const backlog = socket.data.backlog
    socket.data.backlog =
      backlog === null ? batch : LoadGenerator.join(backlog, batch)
    this.flush(socket)
  }

  /**
   * Writes what it can and keeps the rest for the next drain
   * @param socket the socket to flush
   */
  private flush(socket: Socket<Connection>): void {
    const backlog = socket.data.backlog
    if (backlog === null) return

    const written = socket.write(backlog)
    socket.data.backlog =
      written >= backlog.length ? null : backlog.subarray(Math.max(written, 0))
  }

  /**
   * Concatenates two buffers into a fresh one
   * @param first goes first
   * @param second appended after it
   */
  private static join(first: Uint8Array, second: Uint8Array): Uint8Array {
    const joined = new Uint8Array(first.length + second.length)

    joined.set(first)
    joined.set(second, first.length)
    return joined
  }
}
