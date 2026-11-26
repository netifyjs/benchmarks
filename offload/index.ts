import type { LoadResult } from '../load/index.ts'

const workers = Bun.argv[2] ?? '0'
const port = 26000 + Math.floor(Math.random() * 1000)

const server = Bun.spawn({
  cmd: ['bun', `${import.meta.dir}/server/index.ts`],
  env: { ...Bun.env, WORKERS: workers, BENCH_PORT: String(port) },
  stdout: 'ignore',
  stderr: 'inherit',
})
await Bun.sleep(1200)

const loads = [1, 2].map(async (): Promise<LoadResult> => {
  const child = Bun.spawn({
    cmd: ['bun', `${import.meta.dir}/../load/run.ts`, String(port), '16'],
    stdout: 'pipe',
    stderr: 'inherit',
  })
  return JSON.parse(await new Response(child.stdout).text()) as LoadResult
})
const total = (await Promise.all(loads)).reduce(
  (sum: number, result: LoadResult): number => sum + result.messagesPerSecond,
  0,
)
server.kill()
await server.exited

const label = workers === '0' ? 'inline' : `offloaded to ${workers} workers`
console.log(
  `200 µs of work per message, ${label}: ${Math.round(total).toLocaleString('en-GB')} msg/s`,
)
