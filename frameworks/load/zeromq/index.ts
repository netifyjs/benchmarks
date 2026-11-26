import { setTimeout as sleep } from 'node:timers/promises'

import { Dealer } from 'zeromq'

/**
 * Payload every client sends
 */
const PAYLOAD = new Uint8Array(64).fill(7)

/**
 * Messages each client keeps in flight
 */
const WINDOW = 32

const port = Number(process.argv[4])
const clients = Number(process.argv[5] ?? '16')
let received = 0

/**
 * Runs one dealer, sending one at a time as ZeroMQ requires
 * @returns Nothing, it runs until the process exits
 */
const run = async (): Promise<void> => {
  const dealer = new Dealer()
  dealer.connect(`tcp://127.0.0.1:${String(port)}`)
  let queued = WINDOW
  let sending = false

  const pump = async (): Promise<void> => {
    if (sending) return
    sending = true
    while (queued > 0) {
      queued -= 1
      await dealer.send(PAYLOAD)
    }

    sending = false
  }
  void pump()

  for await (const _message of dealer) {
    received += 1
    queued += 1
    void pump()
  }
}

for (let index = 0; index < clients; index++) void run()
await sleep(1000)
const start = received
await sleep(5000)
console.log(JSON.stringify({ value: ((received - start) / 5000) * 1000 }))
process.exit(0)
