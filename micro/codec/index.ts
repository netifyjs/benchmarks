import { bench, group } from 'mitata'
import { Packr } from 'msgpackr'
import protobuf from 'protobufjs'

import {
  BinaryCodec,
  ByteBuf,
  HttpRequestDecoder,
  LengthFieldBasedFrameDecoder,
  LengthFieldPrepender,
  MessagePackCodec,
  ProtobufCodec,
  TextWebSocketFrame,
  WebSocketFrameEncoder,
  type Channel,
} from '@netifyjs/netify'
import { createChannel } from '../../support/index.ts'

/**
 * HTTP, length field and WebSocket codecs on their own
 * @class
 */
export class CodecSuite {
  /**
   * Realistic Firefox GET with the usual header noise
   */
  private static readonly request: Uint8Array = new TextEncoder().encode(
    [
      'GET /api/users?page=2 HTTP/1.1',
      'Host: example.com',
      'User-Agent: Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/130.0',
      'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language: en-GB,en;q=0.5',
      'Accept-Encoding: gzip, deflate, br',
      'Connection: keep-alive',
      'Cookie: session=4f6a1c2e9b7d4a3f8e2c1b0a9d8e7f6a',
      '',
      '',
    ].join('\r\n'),
  )

  /**
   * Cuts a buffer into pieces to mimic data arriving in dribs and drabs
   * @param bytes what to cut up
   * @param size bytes per piece, the last one may be shorter
   */
  private static chunks(bytes: Uint8Array, size: number): Uint8Array[] {
    const chunks: Uint8Array[] = []

    for (let start = 0; start < bytes.length; start += size) {
      chunks.push(bytes.slice(start, start + size))
    }

    return chunks
  }

  /**
   * 32 back-to-back frames, each a 2-byte length and 64 bytes of body
   */
  private static frames(): Uint8Array {
    const frame = new Uint8Array(66).fill(97)
    frame[0] = 0
    frame[1] = 64

    const bytes = new Uint8Array(frame.length * 32)
    for (let index = 0; index < 32; index++)
      bytes.set(frame, index * frame.length)
    return bytes
  }

  /**
   * A channel whose writes are fed straight back in, so one write covers both directions
   * @param codec the codec under test
   */
  private static async roundTrip<T>(codec: BinaryCodec<T>): Promise<Channel> {
    const { channel, transport } = await createChannel(codec)

    transport.loopback = channel
    return channel
  }

  /**
   * Fresh channel with only an HTTP request decoder in it
   */
  private static async http(): Promise<Channel> {
    return (await createChannel(new HttpRequestDecoder())).channel
  }

  /**
   * Sets up the channels first so setup stays out of the timings
   */
  public async register(): Promise<void> {
    const whole = await CodecSuite.http()
    const split = await CodecSuite.http()
    const pieces = CodecSuite.chunks(CodecSuite.request, 16)
    const framed = (
      await createChannel(
        new LengthFieldBasedFrameDecoder({
          maxFrameLength: 1024,
          lengthFieldLength: 2,
          initialBytesToStrip: 2,
        }),
      )
    ).channel
    const frames = CodecSuite.frames()
    const prepended = (
      await createChannel(new LengthFieldPrepender({ lengthFieldLength: 2 }))
    ).channel
    const body = new Uint8Array(64)
    const masked = (
      await createChannel(new WebSocketFrameEncoder({ maskPayload: true }))
    ).channel
    const unmasked = (
      await createChannel(new WebSocketFrameEncoder({ maskPayload: false }))
    ).channel
    const payload = 'x'.repeat(128)

    const move = { id: 42, x: 103.5, y: 7.25, z: -88, hp: 100 }
    const isMove = (message: unknown): message is typeof move =>
      typeof message === 'object' && message !== null && 'id' in message
    const moveType = new protobuf.Type('Move')
      .add(new protobuf.Field('id', 1, 'uint32'))
      .add(new protobuf.Field('x', 2, 'float'))
      .add(new protobuf.Field('y', 3, 'float'))
      .add(new protobuf.Field('z', 4, 'float'))
      .add(new protobuf.Field('hp', 5, 'uint32'))
    new protobuf.Root().add(moveType)
    const json = new TextEncoder()
    const text = new TextDecoder()
    const codecs: Record<string, Channel> = {
      protobuf: await CodecSuite.roundTrip(
        new ProtobufCodec<typeof move>(moveType, isMove),
      ),
      msgpack: await CodecSuite.roundTrip(
        new MessagePackCodec<typeof move>(
          new Packr({ useRecords: true }),
          isMove,
        ),
      ),
      bytebuf: await CodecSuite.roundTrip(
        new BinaryCodec<typeof move>({
          encode: (message: typeof move): Uint8Array =>
            ByteBuf.allocate(17)
              .writeUint32(message.id)
              .writeFloat32(message.x)
              .writeFloat32(message.y)
              .writeFloat32(message.z)
              .writeUint8(message.hp)
              .toUint8Array(),
          decode: (bytes: Uint8Array): typeof move => {
            const input = ByteBuf.wrap(bytes)
            return {
              id: input.readUint32(),
              x: input.readFloat32(),
              y: input.readFloat32(),
              z: input.readFloat32(),
              hp: input.readUint8(),
            }
          },
          accepts: isMove,
        }),
      ),
      json: await CodecSuite.roundTrip(
        new BinaryCodec<typeof move>({
          encode: (message: typeof move): Uint8Array =>
            json.encode(JSON.stringify(message)),
          decode: (bytes: Uint8Array): typeof move =>
            JSON.parse(text.decode(bytes)) as typeof move,
          accepts: isMove,
        }),
      ),
    }

    group('BinaryCodecBenchmark', (): void => {
      for (const [name, channel] of Object.entries(codecs)) {
        bench(`encode and decode a move, ${name}`, (): void => {
          void channel.writeAndFlush(move)
        })
      }
    })

    group('HttpRequestDecoderBenchmark', (): void => {
      bench('decode whole request', (): void => {
        void whole.handleData(CodecSuite.request)
      })
      bench('decode request in 16 byte chunks', (): void => {
        for (const piece of pieces) void split.handleData(piece)
      })
    })

    group('LengthFieldBasedFrameDecoderBenchmark', (): void => {
      bench('decode 32 frames of 64 bytes', (): void => {
        void framed.handleData(frames)
      })
    })

    group('LengthFieldPrependerBenchmark', (): void => {
      bench('prepend 64 byte body', (): void => {
        void prepended.writeAndFlush(body)
      })
    })

    group('WebSocketFrameEncoderBenchmark', (): void => {
      bench('encode 128 byte text frame, masked', (): void => {
        void masked.writeAndFlush(new TextWebSocketFrame(payload))
      })
      bench('encode 128 byte text frame, unmasked', (): void => {
        void unmasked.writeAndFlush(new TextWebSocketFrame(payload))
      })
    })
  }
}
