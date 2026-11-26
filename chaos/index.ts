import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Cluster } from '@netifyjs/netify'

import type { Tally } from './bots/index.ts'

const shards = Number(Bun.argv[2] ?? '4')
const players = Number(Bun.argv[3] ?? '2000')
const every = Number(Bun.argv[4] ?? '5000')
const duration = Number(Bun.env.CHAOS_DURATION ?? '30000')
const loads = Number(Bun.env.BENCH_LOADS ?? '4')
const zones = shards * 4 * 4
const port = 20000 + Math.floor(Math.random() * 500) * 8
const folder = mkdtempSync(join(tmpdir(), 'netify-chaos-'))
const env = {
  CHAOS_SHARDS: String(shards),
  CHAOS_PORT: String(port),
  CHAOS_DIR: folder,
  CHAOS_REGION: Bun.env.CHAOS_REGION ?? '4',
  CHAOS_CROSS: Bun.env.CHAOS_CROSS ?? '0.05',
}

const cluster = new Cluster({
  script: `${import.meta.dir}/shard/index.ts`,
  workers: shards,
  env,
}).start()
await cluster.whenReady()

const perLoad = Math.ceil(players / loads)
const bots = Array.from({ length: loads }, (_: unknown, index: number) =>
  Bun.spawn({
    cmd: [
      'bun',
      `${import.meta.dir}/bots/index.ts`,
      String(perLoad),
      String(index * perLoad),
      String(zones),
      String(duration),
    ],
    env: { ...Bun.env, ...env },
    stdout: 'pipe',
    stderr: 'inherit',
  }),
)

let kills = 0
const killer =
  every > 0
    ? setInterval((): void => {
        const shard = Math.floor(Math.random() * shards)
        const file = `${folder}/pid-${String(shard)}`
        if (!existsSync(file)) return

        try {
          process.kill(Number(readFileSync(file, 'utf8')), 'SIGKILL')
          kills += 1
        } catch {
          return
        }
      }, every)
    : null

const tallies = await Promise.all(
  bots.map(async (bot): Promise<Tally> => {
    const output = await new Response(bot.stdout).text()
    return JSON.parse(output.trim().split('\n').at(-1) ?? '{}') as Tally
  }),
)
if (killer !== null) clearInterval(killer)
await cluster.stop()

const anomalies = existsSync(`${folder}/anomalies`)
  ? readFileSync(`${folder}/anomalies`, 'utf8').trim().split('\n')
  : []
rmSync(folder, { recursive: true, force: true })

const total = tallies.reduce(
  (sum: Tally, tally: Tally): Tally => {
    sum.moves += tally.moves
    sum.handoffs += tally.handoffs
    sum.handoffTimes.push(...tally.handoffTimes)
    for (const [reason, times] of Object.entries(tally.refused)) {
      sum.refused[reason] = (sum.refused[reason] ?? 0) + times
    }
    sum.recalled += tally.recalled
    sum.lostTokens += tally.lostTokens
    sum.wrongState += tally.wrongState
    sum.stuck += tally.stuck
    sum.drops += tally.drops
    sum.recoveryTimes.push(...tally.recoveryTimes)
    sum.stepsLost += tally.stepsLost
    sum.steps += tally.steps
    return sum
  },
  {
    moves: 0,
    handoffs: 0,
    handoffTimes: [],
    refused: {},
    recalled: 0,
    lostTokens: 0,
    wrongState: 0,
    stuck: 0,
    drops: 0,
    recoveryTimes: [],
    stepsLost: 0,
    steps: 0,
  },
)

/**
 * A percentile of some timings in ms
 * @param times the timings
 * @param share 0.5 for the median
 */
const percentile = (times: number[], share: number): string => {
  const sorted = [...times].sort((a: number, b: number): number => a - b)
  const value =
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0
  return value.toFixed(1)
}

console.log(
  `${String(players)} players, ${String(shards)} shards, ${String(zones)} zones, ${String(duration / 1000)} s, ${every > 0 ? `a shard killed every ${String(every / 1000)} s (${String(kills)} kills)` : 'no kills'}`,
)
console.log(
  `handoffs: ${String(total.handoffs)} ok, median ${percentile(total.handoffTimes, 0.5)} ms, p99 ${percentile(total.handoffTimes, 0.99)} ms, ${String(total.moves)} moves inside a shard`,
)
console.log(
  `refused: ${JSON.stringify(total.refused)}, recalled ${String(total.recalled)}, lost ${String(total.lostTokens)}, wrong state ${String(total.wrongState)}, stuck ${String(total.stuck)}`,
)
console.log(
  `drops: ${String(total.drops)}, back in median ${percentile(total.recoveryTimes, 0.5)} ms, p99 ${percentile(total.recoveryTimes, 0.99)} ms, ${String(total.stepsLost)} of ${String(total.steps)} steps lost`,
)
console.log(
  `anomalies: ${anomalies.length === 0 ? 'none' : String(anomalies.length)}`,
)
for (const line of anomalies.slice(0, 10)) console.log(`  ${line}`)
