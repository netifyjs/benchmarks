/**
 * What each shard prints as its last line
 */
type Report = {
  /**
   * Ticks run during the test
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
   * CPU time over wall time, 1 means a full core
   */
  readonly cpu: number

  /**
   * Snapshot bytes queued for sending, per second
   */
  readonly bytesPerSecond: number

  /**
   * Player inputs handled per second
   */
  readonly inputsPerSecond: number
}

const players = Number(Bun.argv[2] ?? '5000')
const shards = Number(Bun.argv[3] ?? '1')
const duration = 10000
const base = 27000 + Math.floor(Math.random() * 900)
const perShard = Math.ceil(players / shards)

const servers = Array.from({ length: shards }, (_: unknown, index: number) =>
  Bun.spawn({
    cmd: [
      'bun',
      ...(Bun.env.BENCH_PROFILE === undefined
        ? []
        : ['--cpu-prof-md', `--cpu-prof-dir=${Bun.env.BENCH_PROFILE}`]),
      `${import.meta.dir}/server/index.ts`,
      String(base + index),
      String(duration + 3000),
    ],
    stdout: 'pipe',
    stderr: 'inherit',
  }),
)
await Bun.sleep(500)

const clients = Array.from(
  { length: shards * 2 },
  (_: unknown, index: number) =>
    Bun.spawn({
      cmd: [
        'bun',
        `${import.meta.dir}/clients/index.ts`,
        String(base + Math.floor(index / 2)),
        String(Math.ceil(perShard / 2)),
        String(duration),
      ],
      stdout: 'ignore',
      stderr: 'inherit',
    }),
)
await Promise.all(clients.map((client): Promise<number> => client.exited))

const reports = await Promise.all(
  servers.map(async (server): Promise<Report> => {
    const output = await new Response(server.stdout).text()
    return JSON.parse(output.trim().split('\n').at(-1) ?? '{}') as Report
  }),
)
console.log(
  `${String(players)} players over ${String(shards)} shard(s), zones of 50, 20 Hz`,
)
reports.forEach((report: Report, index: number): void => {
  console.log(
    `shard ${String(index)}: median ${report.medianMs.toFixed(1)} ms, p99 ${report.p99Ms.toFixed(1)} ms, cpu ${(report.cpu * 100).toFixed(0)}%, ${(report.bytesPerSecond / 1e6).toFixed(1)} MB/s out, ${Math.round(report.inputsPerSecond).toLocaleString('en-GB')} inputs/s`,
  )
})
