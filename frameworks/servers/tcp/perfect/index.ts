import cluster from 'node:cluster'

import {
  eff,
  runSafe,
  scoped,
  sleep,
  type Eff,
  type Throws,
} from '@spilne/perfect-core'
import {
  BinaryCodec,
  Tcp,
  type Connection,
  type NetError,
} from '@spilne/perfect-net'

import { argumentsOf, cores, ready, whenListening } from '../../control.ts'

const { port } = argumentsOf()

/**
 * Sends every message straight back
 * @param connection one client
 */
const echo = (
  connection: Connection<Uint8Array>,
): Eff<void, Throws<NetError>> =>
  connection.messages.forEach(
    (message: Uint8Array): Eff<void, Throws<NetError>> =>
      connection.send(message),
  )

/**
 * Listens until the process is killed
 */
const serve = scoped(
  eff(function* () {
    yield* Tcp.listen(
      { host: '127.0.0.1', port },
      {
        /**
         * Frames as raw bytes
         */
        codec: BinaryCodec.bytes,
        /**
         * Runs for each client
         */
        handle: echo,
      },
    )

    if (cores === 1) ready()
    yield* sleep(2 ** 31 - 1)
  }),
)

if (cores > 1 && cluster.isPrimary) {
  for (let index = 0; index < cores; index++) cluster.fork()
  process.on('SIGTERM', (): void => {
    for (const worker of Object.values(cluster.workers ?? {})) worker?.kill()
    process.exit(0)
  })
  await whenListening(port)
  ready()
} else {
  const { error } = await runSafe(serve)
  if (error !== null) throw new Error('Server failed', { cause: error })
}
