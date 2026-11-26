import { LoadGenerator, type LoadResult } from './load/index.ts'

/**
 * One line of the results table
 */
type Row = {
  /**
   * Which server this was, raw, netify or framed
   */
  readonly variant: string

  /**
   * What the load generator got out of it
   */
  readonly result: LoadResult
}

/**
 * Handle on a server we spawned
 */
type Server = {
  /**
   * Child process, killed once its run is over
   */
  readonly process: Bun.Subprocess<'ignore', 'pipe', 'inherit'>

  /**
   * Port it reported back on stdout
   */
  readonly port: number
}

/**
 * Spawns a server in a separate process so it doesn't share an event loop with the load
 * @param variant which server to run
 */
const startServer = async (variant: string): Promise<Server> => {
  const child = Bun.spawn({
    cmd: [
      'bun',
      ...(Bun.env.BENCH_PROFILE === undefined
        ? []
        : ['--cpu-prof-md', `--cpu-prof-dir=${Bun.env.BENCH_PROFILE}`]),
      Bun.env.BENCH_SERVER ?? `${import.meta.dir}/server/index.ts`,
      variant,
    ],
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'inherit',
  })

  const reader = child.stdout.getReader()
  const { value } = await reader.read()
  reader.releaseLock()
  const line = new TextDecoder().decode(value)
  const port = Number(/ready (\d+)/.exec(line)?.[1] ?? Number.NaN)
  if (Number.isNaN(port)) throw new Error('Server did not start')
  return { process: child, port }
}

const variants = (Bun.argv[2] ?? 'raw,netify,framed').split(',')
const size = Number(Bun.argv[3] ?? '64')
const rows: Row[] = []

for (const variant of variants) {
  const { process: server, port } = await startServer(variant)
  const result = await new LoadGenerator({
    port,
    connections: 64,
    window: 32,
    size,
    duration: 5000,
    warmup: 1000,
  }).run()
  server.kill()
  await server.exited
  rows.push({ variant, result })
}

const baseline = rows[0]?.result.messagesPerSecond ?? 1
console.log(`message body: ${String(size)} bytes, 64 connections, 32 in flight`)
for (const { variant, result } of rows) {
  const share = ((result.messagesPerSecond / baseline) * 100).toFixed(0)
  console.log(
    `${variant.padEnd(8)} ${Math.round(result.messagesPerSecond)
      .toLocaleString('en-GB')
      .padStart(12)} msg/s ${result.megabytesPerSecond
      .toFixed(1)
      .padStart(8)} MB/s ${share.padStart(4)}%`,
  )
}
