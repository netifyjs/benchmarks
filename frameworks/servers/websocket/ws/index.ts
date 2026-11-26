import cluster from 'node:cluster'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'

import {
  argumentsOf,
  payload,
  ready,
  runBroadcast,
  cores,
  whenListening,
} from '../../control.ts'

const { mode, port } = argumentsOf()
if (cores > 1 && cluster.isPrimary) {
  for (let index = 0; index < cores; index++) cluster.fork()
  process.on('SIGTERM', (): void => {
    for (const worker of Object.values(cluster.workers ?? {})) worker?.kill()
    process.exit(0)
  })
  await whenListening(port)
  ready()
  await new Promise<never>((): void => undefined)
}

const server = new WebSocketServer({
  host: '127.0.0.1',
  port,
  perMessageDeflate: false,
})

server.on('connection', (socket: WebSocket): void => {
  socket.on('message', (data: RawData, isBinary: boolean): void => {
    socket.send(data, { binary: isBinary })
  })
})
server.on('listening', (): void => {
  if (cores === 1) ready()
})
if (mode === 'broadcast') {
  runBroadcast((): void => {
    for (const client of server.clients) client.send(payload)
  })
}
