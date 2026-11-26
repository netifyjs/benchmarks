/**
 * A framework under test
 */
type Framework = {
  /**
   * Shown in the results
   */
  readonly name: string

  /**
   * Runtime it runs on
   */
  readonly runtime: 'bun' | 'node' | 'java'

  /**
   * Which load driver talks to it
   */
  readonly protocol:
    | 'raw'
    | 'socketio'
    | 'colyseus'
    | 'tcp'
    | 'nestjs'
    | 'zeromq'
    | 'udp'
    | 'grpc'
    | 'moleculer'
    | 'http'

  /**
   * Which transport it belongs to
   */
  readonly transport: 'websocket' | 'tcp' | 'udp' | 'http'

  /**
   * Server folder under servers and its transport
   */
  readonly folder: string

  /**
   * Processes the server runs, one if left out
   */
  readonly cores?: number
}

/**
 * Where a framework's results are kept, multi-core runs apart from single core
 */
type GroupKey =
  | Framework['transport']
  | 'tcpcores'
  | 'udpcores'
  | 'httpcores'
  | 'websocketcores'

/**
 * The result group a framework belongs to
 * @param framework the framework
 * @returns The key
 */
const keyOf = (framework: Framework): GroupKey =>
  framework.cores === undefined
    ? framework.transport
    : framework.transport === 'tcp'
      ? 'tcpcores'
      : framework.transport === 'udp'
        ? 'udpcores'
        : framework.transport === 'http'
          ? 'httpcores'
          : 'websocketcores'

/**
 * One measured result
 */
type Result = {
  /**
   * Framework name
   */
  readonly name: string

  /**
   * Runtime it ran on
   */
  readonly runtime: string

  /**
   * Echoes or deliveries a second
   */
  readonly value: number
}

/**
 * Every framework, netify first
 */
const FRAMEWORKS: readonly Framework[] = [
  {
    name: 'netify',
    runtime: 'bun',
    protocol: 'tcp',
    transport: 'tcp',
    folder: 'netify',
  },
  {
    name: 'node:net',
    runtime: 'bun',
    protocol: 'tcp',
    transport: 'tcp',
    folder: 'net',
  },
  {
    name: 'Bun.listen',
    runtime: 'bun',
    protocol: 'tcp',
    transport: 'tcp',
    folder: 'bun',
  },
  {
    name: 'NestJS',
    runtime: 'bun',
    protocol: 'nestjs',
    transport: 'tcp',
    folder: 'nestjs',
  },
  {
    name: 'gRPC',
    runtime: 'bun',
    protocol: 'grpc',
    transport: 'tcp',
    folder: 'grpc',
  },
  {
    name: 'Moleculer',
    runtime: 'bun',
    protocol: 'moleculer',
    transport: 'tcp',
    folder: 'moleculer',
  },
  {
    name: 'ZeroMQ',
    runtime: 'node',
    protocol: 'zeromq',
    transport: 'tcp',
    folder: 'zeromq',
  },
  {
    name: 'Netty',
    runtime: 'java',
    protocol: 'tcp',
    transport: 'tcp',
    folder: 'netty',
  },
  {
    name: 'perfect-net',
    runtime: 'bun',
    protocol: 'tcp',
    transport: 'tcp',
    folder: 'perfect',
  },
  {
    name: 'netify',
    runtime: 'bun',
    protocol: 'udp',
    transport: 'udp',
    folder: 'netify',
  },
  {
    name: 'Bun.udpSocket',
    runtime: 'bun',
    protocol: 'udp',
    transport: 'udp',
    folder: 'bun',
  },
  {
    name: 'node:dgram',
    runtime: 'bun',
    protocol: 'udp',
    transport: 'udp',
    folder: 'dgram',
  },
  {
    name: 'netify',
    runtime: 'bun',
    protocol: 'http',
    transport: 'http',
    folder: 'netify',
  },
  {
    name: 'Bun.serve',
    runtime: 'bun',
    protocol: 'http',
    transport: 'http',
    folder: 'bun',
  },
  {
    name: 'node:http',
    runtime: 'bun',
    protocol: 'http',
    transport: 'http',
    folder: 'node',
  },
  {
    name: 'netify',
    runtime: 'bun',
    protocol: 'raw',
    transport: 'websocket',
    folder: 'netify',
  },
  {
    name: 'uWebSockets.js',
    runtime: 'node',
    protocol: 'raw',
    transport: 'websocket',
    folder: 'uws',
  },
  {
    name: 'ws',
    runtime: 'bun',
    protocol: 'raw',
    transport: 'websocket',
    folder: 'ws',
  },
  {
    name: 'Socket.IO',
    runtime: 'bun',
    protocol: 'socketio',
    transport: 'websocket',
    folder: 'socketio',
  },
  {
    name: 'Colyseus',
    runtime: 'bun',
    protocol: 'colyseus',
    transport: 'websocket',
    folder: 'colyseus',
  },
  {
    name: 'netify',
    runtime: 'bun',
    protocol: 'tcp',
    transport: 'tcp',
    folder: 'netify',
    cores: 4,
  },
  {
    name: 'node:net',
    runtime: 'bun',
    protocol: 'tcp',
    transport: 'tcp',
    folder: 'net',
    cores: 4,
  },
  {
    name: 'Bun.listen',
    runtime: 'bun',
    protocol: 'tcp',
    transport: 'tcp',
    folder: 'bun',
    cores: 4,
  },
  {
    name: 'Netty',
    runtime: 'java',
    protocol: 'tcp',
    transport: 'tcp',
    folder: 'netty',
    cores: 4,
  },
  {
    name: 'perfect-net',
    runtime: 'bun',
    protocol: 'tcp',
    transport: 'tcp',
    folder: 'perfect',
    cores: 4,
  },
  {
    name: 'netify',
    runtime: 'bun',
    protocol: 'udp',
    transport: 'udp',
    folder: 'netify',
    cores: 4,
  },
  {
    name: 'netify',
    runtime: 'bun',
    protocol: 'http',
    transport: 'http',
    folder: 'netify',
    cores: 4,
  },
  {
    name: 'Bun.serve',
    runtime: 'bun',
    protocol: 'http',
    transport: 'http',
    folder: 'bun',
    cores: 4,
  },
  {
    name: 'node:http',
    runtime: 'bun',
    protocol: 'http',
    transport: 'http',
    folder: 'node',
    cores: 4,
  },
  {
    name: 'netify',
    runtime: 'bun',
    protocol: 'raw',
    transport: 'websocket',
    folder: 'netify',
    cores: 4,
  },
  {
    name: 'ws',
    runtime: 'bun',
    protocol: 'raw',
    transport: 'websocket',
    folder: 'ws',
    cores: 4,
  },
  {
    name: 'uWebSockets.js',
    runtime: 'node',
    protocol: 'raw',
    transport: 'websocket',
    folder: 'uws',
    cores: 4,
  },
]

/**
 * Load processes per run
 */
const LOADS = Number(Bun.env.BENCH_LOADS ?? '4')

/**
 * Load processes for multi-core runs, more so the extra cores have work
 */
const CORE_LOADS = Number(Bun.env.BENCH_CORE_LOADS ?? '10')

/**
 * Runs per scenario, the median is kept
 */
const RUNS = Number(Bun.env.BENCH_RUNS ?? '3')

/**
 * How Node gets started, asdf Node 24 unless NODE_BIN says otherwise
 */
const NODE = Bun.env.NODE_BIN ?? 'node'

/**
 * Java for the Netty server, the one on your path unless JAVA_BIN says otherwise
 */
const JAVA = Bun.env.JAVA_BIN ?? 'java'

/**
 * Warm-up for JVM servers in ms, longer so the JIT has settled
 */
const JAVA_WARMUP = '5000'

/**
 * Command that starts a framework's server
 * @param framework the framework
 * @param mode echo or broadcast
 * @param port port to use
 * @returns The command line
 */
const commandOf = (
  framework: Framework,
  mode: string,
  port: number,
): string[] => {
  const folder = `${import.meta.dir}/servers/${framework.transport}/${framework.folder}`
  if (framework.runtime === 'java') {
    return [
      JAVA,
      '-cp',
      `${folder}/jars/*`,
      `${folder}/Server.java`,
      mode,
      String(port),
    ]
  }

  return [
    framework.runtime === 'bun' ? 'bun' : NODE,
    `${folder}/index.ts`,
    mode,
    String(port),
  ]
}

/**
 * Next server port, kept below the ephemeral range clients use
 */
let lastPort = 21000 + Math.floor(Math.random() * 4000)

/**
 * Hands out a fresh server port each run
 * @returns The port
 */
const nextPort = (): number => {
  lastPort += 1
  return lastPort
}

/**
 * Environment for child processes
 */
const ENV = {
  ...Bun.env,
  ASDF_NODEJS_VERSION: Bun.env.ASDF_NODEJS_VERSION ?? '24.20.0',
}

/**
 * Reads a process's stdout line by line until a line matches
 * @param stream the stdout
 * @param match what to wait for
 * @returns The matching line
 */
const waitFor = async (
  stream: ReadableStream<Uint8Array>,
  match: (line: string) => boolean,
): Promise<string> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ''

  for (;;) {
    const { value, done } = await reader.read()
    if (done) throw new Error('Process ended early')
    buffered += decoder.decode(value)
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    const found = lines.find(match)
    if (found !== undefined) {
      reader.releaseLock()
      return found
    }
  }
}

/**
 * Starts a framework's server
 * @param framework the framework
 * @param mode echo or broadcast
 * @param port port to use
 * @returns The process
 */
const startServer = async (
  framework: Framework,
  mode: string,
  port: number,
): Promise<Bun.Subprocess<'pipe', 'pipe', 'inherit'>> => {
  const server = Bun.spawn({
    cmd: commandOf(framework, mode, port),
    env: { ...ENV, BENCH_CORES: String(framework.cores ?? 1) },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  })
  await waitFor(server.stdout, (line: string): boolean => line === 'ready')
  return server
}

/**
 * Starts the load processes
 * @param framework the framework
 * @param mode echo or broadcast
 * @param port server port
 * @param clients connections per process
 * @returns The processes
 */
const startLoads = (
  framework: Framework,
  mode: string,
  port: number,
  clients: number,
): Bun.Subprocess<'pipe', 'pipe', 'inherit'>[] =>
  Array.from(
    { length: framework.cores === undefined ? LOADS : CORE_LOADS },
    (): Bun.Subprocess<'pipe', 'pipe', 'inherit'> =>
      Bun.spawn({
        cmd: [
          ...(framework.protocol === 'zeromq'
            ? [NODE, `${import.meta.dir}/load/zeromq/index.ts`]
            : ['bun', `${import.meta.dir}/load/index.ts`]),
          framework.protocol,
          mode,
          String(port),
          String(clients),
        ],
        env: {
          ...ENV,
          BENCH_CORES: String(framework.cores ?? 1),
          ...(framework.runtime === 'java'
            ? { BENCH_WARMUP: JAVA_WARMUP }
            : {}),
        },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'inherit',
      }),
  )

/**
 * Pipelined echo from 64 clients
 * @param framework the framework
 * @returns Echoes a second
 */
const echo = async (framework: Framework): Promise<number> => {
  const port = nextPort()
  const server = await startServer(framework, 'echo', port)
  const loads = startLoads(framework, 'echo', port, 16)

  const values = await Promise.all(
    loads.map(async (load): Promise<number> => {
      const line = await waitFor(load.stdout, (text: string): boolean =>
        text.startsWith('{'),
      )
      return (JSON.parse(line) as { value: number }).value
    }),
  )
  server.kill()
  await server.exited
  return values.reduce((sum: number, value: number): number => sum + value, 0)
}

/**
 * Three seconds of room broadcasts to 1000 clients
 * @param framework the framework
 * @returns Deliveries a second
 */
const broadcast = async (framework: Framework): Promise<number> => {
  const port = nextPort()
  const server = await startServer(framework, 'broadcast', port)
  const loads = startLoads(framework, 'broadcast', port, 250)

  await Promise.all(
    loads.map((load): Promise<string> =>
      waitFor(load.stdout, (line: string): boolean => line === 'connected'),
    ),
  )
  await Bun.sleep(500)
  void server.stdin.write('go\n')
  void server.stdin.flush()
  await waitFor(server.stdout, (line: string): boolean =>
    line.startsWith('done'),
  )
  await Bun.sleep(1000)

  const values = await Promise.all(
    loads.map(async (load): Promise<number> => {
      void load.stdin.write('report\n')
      void load.stdin.flush()
      const line = await waitFor(load.stdout, (text: string): boolean =>
        text.startsWith('{'),
      )
      return (JSON.parse(line) as { value: number }).value
    }),
  )
  server.kill()
  await server.exited
  return (
    values.reduce((sum: number, value: number): number => sum + value, 0) / 3
  )
}

/**
 * Runs a scenario RUNS times and keeps the median
 * @param scenario echo or broadcast
 * @param framework the framework
 * @returns The median result
 */
const median = async (
  scenario: (framework: Framework) => Promise<number>,
  framework: Framework,
): Promise<number> => {
  const values: number[] = []
  for (let run = 0; run < RUNS; run++) values.push(await scenario(framework))

  values.sort((first: number, second: number): number => first - second)
  return values[Math.floor(values.length / 2)] ?? 0
}

/**
 * Prints one scenario's table
 * @param title the scenario
 * @param results what was measured
 */
const print = (title: string, results: readonly Result[]): void => {
  console.log(`\n${title}`)
  const best = Math.max(
    ...results.map((result: Result): number => result.value),
  )
  for (const result of results) {
    const name = `${result.name} (${result.runtime})`.padEnd(26)
    const value = Math.round(result.value).toLocaleString('en-GB').padStart(12)
    console.log(
      `  ${name}${value}/s  ${((result.value / best) * 100).toFixed(0).padStart(4)}%`,
    )
  }
}

const filters = Bun.argv[2]?.split(',') ?? null
const chosen = FRAMEWORKS.filter(
  (framework: Framework): boolean =>
    filters === null ||
    filters.some(
      (filter: string): boolean =>
        filter === keyOf(framework) ||
        filter === `${keyOf(framework)}/${framework.folder}`,
    ),
)

/**
 * Results for one transport
 */
type Group = {
  /**
   * Pipelined echo
   */
  echo: Result[]

  /**
   * Room broadcast, WebSocket only
   */
  broadcast: Result[]
}

const groups: Record<GroupKey, Group> = {
  tcp: { echo: [], broadcast: [] },
  udp: { echo: [], broadcast: [] },
  websocket: { echo: [], broadcast: [] },
  http: { echo: [], broadcast: [] },
  tcpcores: { echo: [], broadcast: [] },
  udpcores: { echo: [], broadcast: [] },
  httpcores: { echo: [], broadcast: [] },
  websocketcores: { echo: [], broadcast: [] },
}
for (const framework of chosen) {
  const group = groups[keyOf(framework)]
  group.echo.push({
    name: framework.name,
    runtime: framework.runtime,
    value: await median(echo, framework),
  })
  if (framework.transport === 'websocket' && framework.cores === undefined) {
    group.broadcast.push({
      name: framework.name,
      runtime: framework.runtime,
      value: await median(broadcast, framework),
    })
  }
}

const titles: Record<GroupKey, string> = {
  tcp: 'TCP echo, 64 clients with 32 length framed messages in flight, 64 bytes',
  udp: 'UDP echo, 64 sockets with 32 datagrams in flight, 64 bytes',
  websocket: 'WebSocket echo, 64 clients with 32 messages in flight, 64 bytes',
  http: 'HTTP plaintext, 64 keep-alive connections with 16 pipelined requests',
  tcpcores:
    'TCP echo on 4 cores, 160 clients with 32 length framed messages in flight',
  udpcores: 'UDP echo on 4 cores, 160 sockets with 32 datagrams in flight',
  httpcores:
    'HTTP plaintext on 4 cores, 160 keep-alive connections with 16 pipelined requests',
  websocketcores:
    'WebSocket echo on 4 cores, 160 clients with 32 messages in flight',
}
for (const transport of [
  'tcp',
  'udp',
  'websocket',
  'http',
  'tcpcores',
  'udpcores',
  'httpcores',
  'websocketcores',
] as const) {
  const group = groups[transport]
  if (group.echo.length > 0) print(titles[transport], group.echo)
  if (group.broadcast.length > 0) {
    print(
      'WebSocket room broadcast to 1000 clients, 64 byte messages, deliveries',
      group.broadcast,
    )
  }
}

const file = `${import.meta.dir}/results.json`
const previous = (await Bun.file(file).exists())
  ? ((await Bun.file(file).json()) as Partial<Record<GroupKey, Group>>)
  : {}
const merged: Partial<Record<GroupKey, Group>> = { ...previous }
/**
 * Replaces the measured frameworks and keeps the rest
 * @param before what was saved last time
 * @param after what was measured now
 * @returns The merged list
 */
const mergeResults = (before: Result[] = [], after: Result[]): Result[] => [
  ...before.filter(
    (old: Result): boolean =>
      !after.some((result: Result): boolean => result.name === old.name),
  ),
  ...after,
]

for (const transport of [
  'tcp',
  'udp',
  'websocket',
  'http',
  'tcpcores',
  'udpcores',
  'httpcores',
  'websocketcores',
] as const) {
  if (groups[transport].echo.length === 0) continue
  merged[transport] = {
    echo: mergeResults(previous[transport]?.echo, groups[transport].echo),
    broadcast: mergeResults(
      previous[transport]?.broadcast,
      groups[transport].broadcast,
    ),
  }
}
await Bun.write(file, `${JSON.stringify(merged, null, 2)}\n`)
