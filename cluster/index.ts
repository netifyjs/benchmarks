import {
  Cluster,
  WorkerGroup,
} from '@netifyjs/netify'
import type { LoadResult } from '../load/index.ts'

/**
 * Spawns a separate load process so a single client loop isn't the bottleneck
 * @param port the shared port the workers listen on
 */
const load = async (port: number): Promise<LoadResult> => {
  const child = Bun.spawn({
    cmd: ['bun', `${import.meta.dir}/../load/run.ts`, String(port), '64'],
    stdout: 'pipe',
    stderr: 'inherit',
  })

  const text = await new Response(child.stdout).text()
  return JSON.parse(text) as LoadResult
}

const variant = Bun.argv[2] ?? 'framed'
const workers = Number(Bun.argv[3] ?? '4')
const loaders = Number(Bun.argv[4] ?? '8')
const port = 29000 + Math.floor(Math.random() * 1000)

const mode = Bun.argv[5] ?? 'processes'
const script = `${import.meta.dir}/../server/index.ts`
const env = { BENCH_VARIANT: variant, BENCH_PORT: String(port) }
const servers =
  mode === 'threads'
    ? new WorkerGroup({ script, workers, env }).start()
    : new Cluster({ script, workers, env, restart: false }).start()
await Bun.sleep(800)

const results = await Promise.all(
  Array.from({ length: loaders }, (): Promise<LoadResult> => load(port)),
)
await servers.stop()

const total = results.reduce(
  (sum: number, result: LoadResult): number => sum + result.messagesPerSecond,
  0,
)
console.log(
  `${variant} x${String(workers)} ${mode}, ${String(loaders)} load processes: ${Math.round(
    total,
  ).toLocaleString('en-GB')} msg/s`,
)
