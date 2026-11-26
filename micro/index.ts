import { run } from 'mitata'

import { BufferSuite } from './buffer/index.ts'
import { CodecSuite } from './codec/index.ts'
import { PipelineSuite } from './pipeline/index.ts'

/**
 * One line of the printed table
 */
type Row = {
  /**
   * As registered with mitata
   */
  readonly name: string

  /**
   * Average ns per op
   */
  readonly nanoseconds: number
}

new BufferSuite().register()
await new PipelineSuite().register()
await new CodecSuite().register()

const pattern = Bun.argv[2]
const { context, benchmarks } = await run({
  format: 'quiet',
  ...(pattern === undefined ? {} : { filter: new RegExp(pattern) }),
})

const rows: Row[] = benchmarks.flatMap((trial): Row[] =>
  trial.runs.flatMap((entry): Row[] =>
    entry.stats === undefined
      ? []
      : [{ name: entry.name, nanoseconds: entry.stats.avg }],
  ),
)
const width = Math.max(...rows.map((row: Row): number => row.name.length))

console.log(`${context.cpu.name ?? 'unknown cpu'}, ${context.runtime ?? 'bun'}`)
console.log(
  `${'Benchmark'.padEnd(width)}  ${'ns/op'.padStart(10)}  ${'ops/ms'.padStart(12)}`,
)
for (const row of rows) {
  const operations = 1e6 / row.nanoseconds
  console.log(
    `${row.name.padEnd(width)}  ${row.nanoseconds.toFixed(1).padStart(10)}  ${operations
      .toFixed(1)
      .padStart(12)}`,
  )
}
