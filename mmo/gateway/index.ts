import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * What each server process prints as its last line
 */
type Report = {
  /**
   * What the process did
   */
  readonly role: string

  /**
   * Ticks timed
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
   * CPU time over wall time, 1 means a full core
   */
  readonly cpu: number

  /**
   * Player inputs handled per second
   */
  readonly inputsPerSecond: number

  /**
   * Share of the CPU time spent in the kernel
   */
  readonly kernel: number
}

/**
 * What each client process prints
 */
type Arrivals = {
  /**
   * Ms from tick start to arrival, for the sampled sockets
   */
  readonly latencies: number[]
}

const players = Number(Bun.argv[2] ?? '5000')
const gateways = Number(Bun.argv[3] ?? '0')
const loads = Number(Bun.env.BENCH_LOADS ?? '4')
const duration = 10000
const port = 28000 + Math.floor(Math.random() * 900)
const folder = mkdtempSync(join(tmpdir(), 'netify-gateway-'))
const count = gateways + 1

const spawn = (role: string, id: number): Bun.Subprocess<'ignore', 'pipe'> =>
  Bun.spawn({
    cmd: [
      'bun',
      `${import.meta.dir}/server/index.ts`,
      role,
      String(id),
      String(count),
      String(port),
      String(duration + 6000),
      folder,
    ],
    stdout: 'pipe',
    stderr: 'inherit',
  })

const servers =
  gateways === 0
    ? [spawn('single', 0)]
    : Array.from(
        { length: count },
        (_: unknown, id: number): Bun.Subprocess<'ignore', 'pipe'> =>
          spawn(id === 0 ? 'world' : 'gateway', id),
      )
await Bun.sleep(800)

const clients = Array.from({ length: loads }, () =>
  Bun.spawn({
    cmd: [
      'bun',
      `${import.meta.dir}/clients/index.ts`,
      String(port),
      String(Math.ceil(players / loads)),
      String(duration),
    ],
    stdout: 'pipe',
    stderr: 'inherit',
  }),
)

const arrivals = await Promise.all(
  clients.map(async (client): Promise<Arrivals> => {
    const output = await new Response(client.stdout).text()
    return JSON.parse(output.trim().split('\n').at(-1) ?? '{}') as Arrivals
  }),
)
const reports = await Promise.all(
  servers.map(async (server): Promise<Report> => {
    const output = await new Response(server.stdout).text()
    return JSON.parse(output.trim().split('\n').at(-1) ?? '{}') as Report
  }),
)
rmSync(folder, { recursive: true, force: true })

const latencies = arrivals
  .flatMap((arrival: Arrivals): number[] => arrival.latencies)
  .sort((first: number, second: number): number => first - second)
const at = (share: number): number =>
  latencies[
    Math.min(latencies.length - 1, Math.floor(latencies.length * share))
  ] ?? 0

console.log(
  `${String(players)} players, ${gateways === 0 ? 'one process' : `world plus ${String(gateways)} gateways`}, zones of 50, 20 Hz`,
)
console.log(
  `delivery: median ${at(0.5).toFixed(1)} ms, p99 ${at(0.99).toFixed(1)} ms, max ${at(1).toFixed(1)} ms over ${latencies.length.toLocaleString('en-GB')} samples`,
)
for (const report of reports) {
  const tick =
    report.ticks > 0
      ? `, tick median ${report.medianMs.toFixed(1)} ms, p99 ${report.p99Ms.toFixed(1)} ms`
      : ''
  console.log(
    `${report.role}: cpu ${(report.cpu * 100).toFixed(0)}% (${(report.kernel * 100).toFixed(0)}% kernel)${tick}, ${Math.round(report.inputsPerSecond).toLocaleString('en-GB')} inputs/s`,
  )
}
