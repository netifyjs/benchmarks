import { createSocket, type RemoteInfo } from 'node:dgram'

import { argumentsOf, ready } from '../../control.ts'

const { port } = argumentsOf()
const socket = createSocket('udp4')

socket.on('message', (message: Buffer, remote: RemoteInfo): void => {
  socket.send(message, remote.port, remote.address)
})
socket.bind(port, '127.0.0.1', ready)
