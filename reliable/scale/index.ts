/**
 * What a load process reports
 */
type LoadReport = {
  /**
   * Messages sent
   */
  readonly sent: number

  /**
   * Echoes received
   */
  readonly received: number
}

/**
 * What the server reports
 */
type ServerReport = {
  /**
   * Wall time measured
   */
  readonly seconds: number

  /**
   * CPU time used
   */
  readonly cpuMicros: number

  /**
   * Kernel share of the CPU time
   */
  readonly systemMicros: number

  /**
   * Messages handled
   */
  readonly messages: number

  /**
   * Peers connected
   */
  readonly peers: number

  /**
   * Packets the server sent
   */
  readonly packetsSent: number

  /**
   * Packets the server took in
   */
  readonly packetsReceived: number

  /**
   * Reliable messages sent again
   */
  readonly resends: number
}

const clients = Number(Bun.argv[2] ?? '1000')
const rate = Number(Bun.argv[3] ?? '30')
const loads = Number(Bun.argv[4] ?? '4')
const seconds = 5
const port = 31000 + Math.floor(Math.random() * 1000)
const env = { ...Bun.env, BENCH_PORT: String(port) }

const server = Bun.spawn({
  cmd: [
    ...(Bun.env.BENCH_PROFILE === undefined
      ? ['bun']
      : ['bun', '--cpu-prof-md', `--cpu-prof-dir=${Bun.env.BENCH_PROFILE}`]),
    `${import.meta.dir}/server/index.ts`,
  ],
  env,
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'inherit',
})
await Bun.sleep(500)

const perLoad = Math.ceil(clients / loads)
const children = Array.from(
  { length: loads },
  (): Bun.Subprocess<'ignore', 'pipe', 'pipe'> =>
    Bun.spawn({
      cmd: [
        'bun',
        `${import.meta.dir}/load/index.ts`,
        String(port),
        String(perLoad),
        String(rate),
        String(seconds),
      ],
      env: { ...env, BENCH_DELAY: String(1000 + clients) },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    }),
)
await Promise.all(
  children.map(
    async (child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>): Promise<void> => {
      const reader = child.stderr.getReader()
      let text = ''
      while (!text.includes('ready')) {
        const { value, done } = await reader.read()
        if (done) break
        text += new TextDecoder().decode(value)
      }

      reader.releaseLock()
    },
  ),
)

await Bun.sleep(1000 + clients)
void server.stdin.write('start\n')
const reports = await Promise.all(
  children.map(
    async (
      child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
    ): Promise<LoadReport> =>
      JSON.parse(await new Response(child.stdout).text()) as LoadReport,
  ),
)
void server.stdin.write('stop\n')
const stats = JSON.parse(
  (await new Response(server.stdout).text()).trim(),
) as ServerReport
await server.exited

const sent = reports.reduce(
  (sum: number, report: LoadReport): number => sum + report.sent,
  0,
)
const received = reports.reduce(
  (sum: number, report: LoadReport): number => sum + report.received,
  0,
)
const cpuShare = stats.cpuMicros / (stats.seconds * 1_000_000)
console.log(
  [
    `${String(stats.peers)} peers at ${String(rate)} Hz${Bun.env.BENCH_ENCRYPT === '1' ? ', encrypted' : ''}`,
    `server ${Math.round(stats.messages / stats.seconds).toLocaleString('en-GB')} msg/s in, same out`,
    `server CPU ${(cpuShare * 100).toFixed(0)}% of a core, ${((stats.systemMicros / stats.cpuMicros) * 100).toFixed(0)}% of it in the kernel`,
    `${(stats.cpuMicros / stats.messages).toFixed(2)} µs CPU per echoed message`,
    `${((cpuShare * 1000) / stats.peers).toFixed(3)} ms CPU per peer per second`,
    `echoes ${String(received)} of ${String(sent)}`,
    `packets ${String(stats.packetsReceived)} in, ${String(stats.packetsSent)} out, ${String(stats.resends)} resends`,
  ].join('\n  '),
)
