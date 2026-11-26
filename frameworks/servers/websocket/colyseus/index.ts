import { Room, Server, type Client } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'

import { argumentsOf, payload, ready, runBroadcast } from '../../control.ts'

/**
 * The one room every client joins
 */
const rooms: GameRoom[] = []

/**
 * Echoes each message back to its sender
 * @class
 */
class GameRoom extends Room {
  /**
   * Room for every bench client
   */
  public override maxClients = 100_000

  /**
   * Sets up the echo
   */
  public override onCreate(): void {
    this.autoDispose = false
    rooms.push(this)
    this.onMessage('m', (client: Client, message: Uint8Array): void => {
      client.send('m', message)
    })
  }
}

const { mode, port } = argumentsOf()
const server = new Server({
  transport: new WebSocketTransport({ perMessageDeflate: false }),
  greet: false,
})
server.define('game', GameRoom)
await server.listen(port, '127.0.0.1')
ready()
if (mode === 'broadcast') {
  runBroadcast((): void => {
    rooms[0]?.broadcast('m', payload)
  })
}
