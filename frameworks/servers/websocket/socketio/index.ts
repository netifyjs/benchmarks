import { Server, type Socket } from 'socket.io'

import { argumentsOf, payload, ready, runBroadcast } from '../../control.ts'

const { mode, port } = argumentsOf()
const io = new Server({
  transports: ['websocket'],
  perMessageDeflate: false,
  serveClient: false,
})

io.on('connection', (socket: Socket): void => {
  void socket.join('room')
  socket.on('m', (data: Uint8Array): void => {
    socket.emit('m', data)
  })
})
io.listen(port)
ready()
if (mode === 'broadcast') {
  runBroadcast((): void => {
    io.to('room').emit('m', payload)
  })
}
