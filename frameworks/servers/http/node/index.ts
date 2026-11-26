import cluster from 'node:cluster'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'

import { argumentsOf, cores, ready, whenListening } from '../../control.ts'

const { port } = argumentsOf()
if (cores > 1 && cluster.isPrimary) {
  for (let index = 0; index < cores; index++) cluster.fork()
  process.on('SIGTERM', (): void => {
    for (const worker of Object.values(cluster.workers ?? {})) worker?.kill()
    process.exit(0)
  })
  await whenListening(port)
  ready()
} else {
  createServer((request: IncomingMessage, response: ServerResponse): void => {
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end('Hello, World!')
  }).listen(port, '127.0.0.1', (): void => {
    if (cores === 1) ready()
  })
}
