import cluster from 'node:cluster'
import uWS from 'uWebSockets.js'

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

const app = uWS.App().ws('/*', {
  compression: uWS.DISABLED,
  maxPayloadLength: 1024 * 1024,
  idleTimeout: 120,
  open: (socket: uWS.WebSocket<unknown>): void => {
    socket.subscribe('room')
  },
  message: (
    socket: uWS.WebSocket<unknown>,
    message: ArrayBuffer,
    isBinary: boolean,
  ): void => {
    socket.send(message, isBinary)
  },
})

app.listen('127.0.0.1', port, (token: unknown): void => {
  if (token === false) process.exit(1)
  if (cores === 1) ready()
})
if (mode === 'broadcast') {
  runBroadcast((): void => {
    app.publish('room', payload, true)
  })
}
