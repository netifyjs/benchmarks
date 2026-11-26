import { connect } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { createInterface } from 'node:readline'

/**
 * What a bench server needs from the runner
 */
export type ServerArguments = {
  /**
   * echo or broadcast
   */
  readonly mode: string

  /**
   * Port to listen on
   */
  readonly port: number
}

/**
 * Payload every framework sends, 64 bytes
 */
export const payload: Uint8Array = new Uint8Array(64).fill(7)

/**
 * Reads the mode and port from the command line
 * @returns The arguments
 */
export const argumentsOf = (): ServerArguments => ({
  mode: process.argv[2] ?? 'echo',
  port: Number(process.argv[3] ?? '0'),
})

/**
 * Waits for go on stdin, broadcasts for three seconds, then says done and exits
 * @param broadcast sends one message to the whole room
 */
export const runBroadcast = (broadcast: () => void): void => {
  const lines = createInterface({ input: process.stdin })
  lines.on('line', (line: string): void => {
    if (line.trim() !== 'go') return

    const end = performance.now() + 3000
    let sent = 0
    const loop = (): void => {
      for (let index = 0; index < 20; index++) broadcast()
      sent += 20
      if (performance.now() < end) {
        setImmediate(loop)
        return
      }

      console.log(`done ${String(sent)}`)
      setTimeout((): void => {
        process.exit(0)
      }, 1500)
    }
    loop()
  })
}

/**
 * Tells the runner the server is listening
 */
export const ready = (): void => {
  console.log('ready')
}

/**
 * Processes the server should run, 1 unless BENCH_CORES says otherwise
 */
export const cores: number = Number(process.env.BENCH_CORES ?? '1')

/**
 * Waits until the port takes connections, then a moment more for the other workers
 * @param port the port
 */
export const whenListening = async (port: number): Promise<void> => {
  for (;;) {
    const open = await new Promise<boolean>((resolve): void => {
      const probe = connect(port, '127.0.0.1')
      probe.once('connect', (): void => {
        probe.destroy()
        resolve(true)
      })
      probe.once('error', (): void => {
        resolve(false)
      })
    })
    if (open) break
    await sleep(50)
  }

  await sleep(1000)
}
