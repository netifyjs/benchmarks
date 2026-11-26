import { bench, do_not_optimize, group } from 'mitata'

import {
  BitReader,
  BitWriter,
  ByteBuf,
  Quantizer,
} from '@netifyjs/netify'

/**
 * ByteBuf allocation and read/write speed
 * @class
 */
export class BufferSuite {
  /**
   * Same sizes as Netty's allocator benchmark, so results line up
   */
  private static readonly sizes: readonly number[] = [
    0, 256, 1024, 4096, 16384, 65536,
  ]

  /**
   * Adds the allocator and access groups to mitata
   */
  public register(): void {
    group('ByteBufAllocatorBenchmark', (): void => {
      BufferSuite.sizes.forEach((size: number, index: number): void => {
        bench(
          `unpooledHeapAllocAndFree_${String(index + 1)}_${String(size)}`,
          (): void => {
            do_not_optimize(ByteBuf.allocate(size))
          },
        )
      })
    })

    group('ByteBufBenchmark', (): void => {
      const buffer = ByteBuf.allocate(8192)

      bench('writeReadUint32 x1024', (): void => {
        buffer.clear()
        for (let index = 0; index < 1024; index++) buffer.writeUint32(index)
        let sum = 0
        for (let index = 0; index < 1024; index++) sum += buffer.readUint32()
        do_not_optimize(sum)
      })
      bench('setGetUint16 x1024', (): void => {
        let sum = 0
        for (let index = 0; index < 2048; index += 2) {
          buffer.setUint16(index, index)
          sum += buffer.getUint16(index)
        }

        do_not_optimize(sum)
      })
      bench('writeReadInt64 x1024', (): void => {
        buffer.clear()
        for (let index = 0; index < 1024; index++)
          buffer.writeInt64(BigInt(index))
        let sum = 0n
        for (let index = 0; index < 1024; index++) sum += buffer.readInt64()
        do_not_optimize(sum)
      })
      bench('writeReadVarUint x1024, small values', (): void => {
        buffer.clear()
        for (let index = 0; index < 1024; index++) buffer.writeVarUint(index)
        let sum = 0
        for (let index = 0; index < 1024; index++) sum += buffer.readVarUint()
        do_not_optimize(sum)
      })
      bench('pack 1024 fields of 10 bits', (): void => {
        buffer.clear()
        const writer = new BitWriter(buffer)
        for (let index = 0; index < 1024; index++) writer.write(index, 10)
        writer.finish()
        const reader = new BitReader(buffer)
        let sum = 0
        for (let index = 0; index < 1024; index++) sum += reader.read(10)
        do_not_optimize(sum)
      })
      bench('quantise 1024 positions to 20 bits', (): void => {
        let sum = 0
        for (let index = 0; index < 1024; index++) {
          sum += BufferSuite.position.decode(
            BufferSuite.position.encode(index * 3.7 - 1800),
          )
        }

        do_not_optimize(sum)
      })
      bench('writeString 64 bytes', (): void => {
        buffer.clear()
        do_not_optimize(
          buffer.writeString(
            'The quick brown fox jumps over the lazy dog, again and again!!',
          ),
        )
      })
      bench('indexOf CRLF in 1 KiB', (): void => {
        const haystack = BufferSuite.haystack()
        do_not_optimize(haystack.indexOf(BufferSuite.crlf))
      })
    })
  }

  /**
   * Positions across a 4 km world in 20 bits
   */
  private static readonly position: Quantizer = new Quantizer({
    min: -2048,
    max: 2048,
    bits: 20,
  })

  /**
   * What indexOf looks for
   */
  private static readonly crlf: Uint8Array = Uint8Array.of(13, 10)

  /**
   * 1 KiB of a's with CRLF at the very end, the worst case for the search
   */
  private static readonly text: ByteBuf = ByteBuf.wrap(
    new TextEncoder().encode(`${'a'.repeat(1022)}\r\n`),
  )

  /**
   * Hands back the shared buffer
   */
  private static haystack(): ByteBuf {
    return BufferSuite.text
  }
}
