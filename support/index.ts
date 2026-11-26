import {
  Channel,
  type ChannelHandler,
  type Logger,
  type Transport,
} from '@netifyjs/netify'

/**
 * Logs nothing so logging doesn't skew the numbers
 * @class
 */
export class SilentLogger implements Logger {
  /**
   * Swallowed
   */
  public debug(): void {
    return
  }

  /**
   * Also swallowed
   */
  public warn(): void {
    return
  }
}

/**
 * Fake socket that takes every write and throws it away
 * @class
 */
export class NullTransport implements Transport {
  /**
   * Always false, it acts like a stream
   */
  public readonly datagram: boolean

  /**
   * Placeholder peer address
   */
  public readonly remoteAddress: string

  /**
   * Placeholder peer port
   */
  public readonly remotePort: number

  /**
   * Running total of bytes written, handy for sanity checks
   */
  public written: number

  /**
   * Channel to feed written bytes back into, for round trip benchmarks
   */
  public loopback: Channel | null

  /**
   * Pretends to be a loopback peer
   */
  public constructor() {
    this.datagram = false
    this.remoteAddress = '127.0.0.1'
    this.remotePort = 0
    this.written = 0
    this.loopback = null
  }

  /**
   * Counts the bytes and claims they all went out
   * @param bytes whatever the pipeline flushed
   */
  public write(bytes: Uint8Array): number {
    this.written += bytes.length
    if (this.loopback !== null) void this.loopback.handleData(bytes.slice())
    return bytes.length
  }

  /**
   * Same as write for a range of an array
   * @param bytes the array
   * @param offset where it starts
   * @param length how many bytes
   */
  public writeRange(bytes: Uint8Array, offset: number, length: number): number {
    return this.write(bytes.subarray(offset, offset + length))
  }

  /**
   * Nothing to close
   */
  public end(): void {
    return
  }

  /**
   * No backpressure to apply
   */
  public pause(): void {
    return
  }

  /**
   * Nothing to resume either
   */
  public resume(): void {
    return
  }
}

/**
 * Last stop in the pipeline, counts what reaches it and drops it
 * @class
 */
export class Sink {
  /**
   * How many messages made it all the way through
   */
  public received: number

  /**
   * Starts the count at zero
   */
  public constructor() {
    this.received = 0
  }

  /**
   * Bumps the count
   */
  public channelRead(): void {
    this.received += 1
  }
}

/**
 * Everything a micro bench needs to poke at
 */
export type BenchChannel = {
  /**
   * Live channel to push messages through
   */
  readonly channel: Channel

  /**
   * Tells you how many messages came out the other end
   */
  readonly sink: Sink

  /**
   * Tells you how many bytes were written
   */
  readonly transport: NullTransport
}

/**
 * Builds an active channel over the fake transport, ready to fire reads at
 * @param handlers added in this order, with the sink tacked on last
 */
export const createChannel = async (
  ...handlers: ChannelHandler[]
): Promise<BenchChannel> => {
  const transport = new NullTransport()
  const sink = new Sink()
  const channel = new Channel(transport, {
    /**
     * Keep it quiet
     */
    logger: new SilentLogger(),
  })

  handlers.forEach((handler: ChannelHandler, index: number): void => {
    channel.pipeline.addLast<ChannelHandler>(`handler${String(index)}`, handler)
  })
  channel.pipeline.addLast<Sink>('sink', sink)
  await channel.activate()
  return { channel, sink, transport }
}
