import { Client } from '@colyseus/sdk'
import { Client as GrpcClient, credentials } from '@grpc/grpc-js'
import { ServiceBroker } from 'moleculer'
import { ClientProxyFactory, Transport } from '@nestjs/microservices'
import { io } from 'socket.io-client'

/**
 * One open client, whatever library it uses
 */
type Connection = {
  /**
   * Sends one 64 byte message
   */
  readonly send: () => void

  /**
   * Called for every message that comes back
   */
  readonly onMessage: (callback: () => void) => void
}

/**
 * Payload every client sends
 */
const PAYLOAD = new Uint8Array(64).fill(7)

const protocol = Bun.argv[2] ?? 'raw'
const mode = Bun.argv[3] ?? 'echo'
const port = Number(Bun.argv[4])
const clients = Number(Bun.argv[5] ?? '16')

/**
 * Messages each echo client keeps in flight, 16 for HTTP like TechEmpower, BENCH_WINDOW overrides it
 */
const WINDOW = Number(
  Bun.env.BENCH_WINDOW ?? (protocol === 'http' ? '16' : '32'),
)

/**
 * Opens a plain WebSocket
 * @returns The connection
 */
const raw = (): Promise<Connection> => {
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/`)
  socket.binaryType = 'arraybuffer'

  return new Promise<Connection>((resolve, reject): void => {
    socket.onerror = (): void => {
      reject(new Error('Connection failed'))
    }
    socket.onopen = (): void => {
      resolve({
        send: (): void => {
          socket.send(PAYLOAD)
        },
        onMessage: (callback: () => void): void => {
          socket.onmessage = callback
        },
      })
    }
  })
}

/**
 * Opens a Socket.IO client over WebSocket
 * @returns The connection
 */
const socketio = (): Promise<Connection> => {
  const socket = io(`http://127.0.0.1:${String(port)}`, {
    transports: ['websocket'],
    forceNew: true,
  })

  return new Promise<Connection>((resolve): void => {
    socket.on('connect', (): void => {
      resolve({
        send: (): void => {
          socket.emit('m', PAYLOAD)
        },
        onMessage: (callback: () => void): void => {
          socket.on('m', callback)
        },
      })
    })
  })
}

/**
 * Joins the Colyseus game room
 * @returns The connection
 */
const colyseus = async (): Promise<Connection> => {
  const client = new Client(`http://127.0.0.1:${String(port)}`)
  const room = await client.joinOrCreate('game')

  return {
    send: (): void => {
      room.send('m', PAYLOAD)
    },
    onMessage: (callback: () => void): void => {
      room.onMessage('m', callback)
    },
  }
}

/**
 * The payload with a 4 byte length in front
 */
const FRAMED = ((): Uint8Array => {
  const bytes = new Uint8Array(4 + PAYLOAD.length)
  new DataView(bytes.buffer).setUint32(0, PAYLOAD.length)
  bytes.set(PAYLOAD, 4)
  return bytes
})()

/**
 * Builds count framed payloads back to back
 * @param count how many
 * @returns The bytes
 */
const batchOf = (count: number): Uint8Array => {
  const bytes = new Uint8Array(FRAMED.length * count)
  for (let index = 0; index < count; index++)
    bytes.set(FRAMED, index * FRAMED.length)
  return bytes
}

/**
 * Batches for every count up to the window, built once
 */
const FRAMED_BATCHES: Uint8Array[] = Array.from(
  { length: 65 },
  (_: unknown, count: number): Uint8Array => batchOf(count),
)

/**
 * The payload as text, for frameworks that speak JSON
 */
const TEXT = 'x'.repeat(64)

/**
 * Opens a TCP connection that speaks 4 byte length framing
 * @returns The connection
 */
const tcp = async (): Promise<Connection> => {
  let callback: () => void = (): void => undefined
  let pending = new Uint8Array(0)
  let batching = false
  let queued = 0

  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port,
    socket: {
      data: (_socket: unknown, chunk: Uint8Array): void => {
        let bytes = chunk
        if (pending.length > 0) {
          bytes = new Uint8Array(pending.length + chunk.length)
          bytes.set(pending)
          bytes.set(chunk, pending.length)
        }

        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        )
        let offset = 0
        let frames = 0
        while (bytes.length - offset >= 4) {
          const size = view.getUint32(offset)
          if (bytes.length - offset - 4 < size) break
          offset += 4 + size
          frames += 1
        }

        pending = bytes.slice(offset)
        batching = true
        for (let index = 0; index < frames; index++) callback()
        batching = false
        if (queued > 0) {
          socket.write(FRAMED_BATCHES[queued] ?? batchOf(queued))
          queued = 0
        }
      },
    },
  })
  socket.setNoDelay(true)

  return {
    send: (): void => {
      if (batching) queued += 1
      else socket.write(FRAMED)
    },
    onMessage: (next: () => void): void => {
      callback = next
    },
  }
}

/**
 * Opens a NestJS TCP client
 * @returns The connection
 */
const nestjs = async (): Promise<Connection> => {
  const client = ClientProxyFactory.create({
    transport: Transport.TCP,
    options: { host: '127.0.0.1', port },
  })
  await client.connect()
  let callback: () => void = (): void => undefined

  return {
    send: (): void => {
      client.send<string, string>('m', TEXT).subscribe({
        next: (): void => {
          callback()
        },
      })
    },
    onMessage: (next: () => void): void => {
      callback = next
    },
  }
}

/**
 * Passes bytes through untouched
 * @param bytes the message
 * @returns The same bytes
 */
const identity = (bytes: Buffer): Buffer => bytes

/**
 * The payload as a Buffer, which gRPC wants
 */
const BUFFER = Buffer.from(PAYLOAD)

/**
 * Opens a gRPC client with its own connection and one echo stream
 * @returns The connection
 */
const grpc = async (): Promise<Connection> => {
  const client = new GrpcClient(
    `127.0.0.1:${String(port)}`,
    credentials.createInsecure(),
    { 'grpc.use_local_subchannel_pool': 1 },
  )
  await new Promise<void>((resolve, reject): void => {
    client.waitForReady(Date.now() + 5000, (error?: Error): void => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
  const stream = client.makeBidiStreamRequest<Buffer, Buffer>(
    '/bench.Echo/Echo',
    identity,
    identity,
  )
  let callback: () => void = (): void => undefined
  stream.on('data', (): void => {
    callback()
  })

  return {
    send: (): void => {
      stream.write(BUFFER)
    },
    onMessage: (next: () => void): void => {
      callback = next
    },
  }
}

/**
 * The one Moleculer broker this process shares between its callers
 */
let broker: Promise<ServiceBroker> | null = null

/**
 * Starts this process's broker and waits for the echo service
 * @returns The broker
 */
const startBroker = async (): Promise<ServiceBroker> => {
  const started = new ServiceBroker({
    nodeID: `load-${String(process.pid)}`,
    logger: false,
    transporter: {
      type: 'TCP',
      options: {
        udpDiscovery: false,
        port: 0,
        urls: `127.0.0.1:${String(port)}/server`,
      },
    },
  })
  await started.start()
  await started.waitForServices('echo', 10_000)
  return started
}

/**
 * Opens a Moleculer caller on the shared broker
 * @returns The connection
 */
const moleculer = async (): Promise<Connection> => {
  broker ??= startBroker()
  const shared = await broker
  let callback: () => void = (): void => undefined

  return {
    send: (): void => {
      void shared.call('echo.echo', { data: TEXT }).then((): void => {
        callback()
      })
    },
    onMessage: (next: () => void): void => {
      callback = next
    },
  }
}

/**
 * One keep-alive GET, as raw bytes
 */
const HTTP_REQUEST = new TextEncoder().encode(
  'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: */*\r\n\r\n',
)

/**
 * Many requests back to back, for pipelining
 * @param count how many
 * @returns The bytes
 */
const httpBatchOf = (count: number): Uint8Array => {
  const bytes = new Uint8Array(HTTP_REQUEST.length * count)
  for (let index = 0; index < count; index++)
    bytes.set(HTTP_REQUEST, index * HTTP_REQUEST.length)
  return bytes
}

/**
 * Pipelined batches for every count up to the window, built once
 */
const HTTP_BATCHES: Uint8Array[] = Array.from(
  { length: 65 },
  (_: unknown, count: number): Uint8Array => httpBatchOf(count),
)

/**
 * Finds where a response ends, or -1 if it isn't all here
 * @param text the buffered bytes as latin1
 * @param from where the response starts
 * @returns The end offset, or -1
 */
const responseEnd = (text: string, from: number): number => {
  const head = text.indexOf('\r\n\r\n', from)
  if (head < 0) return -1
  const headers = text.slice(from, head).toLowerCase()
  const at = headers.indexOf('content-length:')
  const length =
    at < 0
      ? 0
      : Number.parseInt(
          headers.slice(at + 15, headers.indexOf('\r\n', at) >>> 0),
          10,
        )
  const end = head + 4 + length
  return end <= text.length ? end : -1
}

/**
 * Opens a keep-alive HTTP/1.1 connection that pipelines requests
 * @returns The connection
 */
const http = async (): Promise<Connection> => {
  let callback: () => void = (): void => undefined
  let pending = ''
  let batching = false
  let queued = 0

  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port,
    socket: {
      data: (_socket: unknown, chunk: Uint8Array): void => {
        const text = pending + Buffer.from(chunk).toString('latin1')
        let offset = 0
        let responses = 0
        for (;;) {
          const end = responseEnd(text, offset)
          if (end < 0) break
          offset = end
          responses += 1
        }

        pending = text.slice(offset)
        batching = true
        for (let index = 0; index < responses; index++) callback()
        batching = false
        if (queued > 0) {
          socket.write(HTTP_BATCHES[queued] ?? httpBatchOf(queued))
          queued = 0
        }
      },
    },
  })
  socket.setNoDelay(true)

  return {
    send: (): void => {
      if (batching) queued += 1
      else socket.write(HTTP_REQUEST)
    },
    onMessage: (next: () => void): void => {
      callback = next
    },
  }
}

/**
 * UDP sockets opened so far, spread over the server's ports
 */
let udpCount = 0

/**
 * Ports the server listens on, one per core
 */
const cores = Number(process.env.BENCH_CORES ?? '1')

/**
 * Opens a UDP socket aimed at the server
 * @returns The connection
 */
const udp = async (): Promise<Connection> => {
  const target = port + (udpCount++ % cores)
  let callback: () => void = (): void => undefined
  const socket = await Bun.udpSocket({
    hostname: '127.0.0.1',
    socket: {
      data: (): void => {
        callback()
      },
    },
  })

  return {
    send: (): void => {
      socket.send(PAYLOAD, target, '127.0.0.1')
    },
    onMessage: (next: () => void): void => {
      callback = next
    },
  }
}

/**
 * Picks the driver for this protocol
 * @returns A function that opens one connection
 */
const driver = (): (() => Promise<Connection>) => {
  if (protocol === 'socketio') return socketio
  if (protocol === 'colyseus') return colyseus
  if (protocol === 'tcp') return tcp
  if (protocol === 'nestjs') return nestjs
  if (protocol === 'udp') return udp
  if (protocol === 'http') return http
  if (protocol === 'grpc') return grpc
  if (protocol === 'moleculer') return moleculer

  return raw
}

const open = driver()
const connections: Connection[] = []
for (let start = 0; start < clients; start += 50) {
  const batch = Array.from(
    { length: Math.min(50, clients - start) },
    (): Promise<Connection> => open(),
  )
  connections.push(...(await Promise.all(batch)))
}

let received = 0
if (mode === 'echo') {
  const heard = connections.map((): number => 0)
  connections.forEach((connection: Connection, index: number): void => {
    connection.onMessage((): void => {
      received += 1
      heard[index] = (heard[index] ?? 0) + 1
      connection.send()
    })
    for (let sent = 0; sent < WINDOW; sent++) connection.send()
  })
  if (protocol === 'udp') {
    let last = connections.map((): number => 0)
    setInterval((): void => {
      connections.forEach((connection: Connection, index: number): void => {
        if ((heard[index] ?? 0) !== last[index]) return
        for (let sent = 0; sent < WINDOW; sent++) connection.send()
      })
      last = [...heard]
    }, 20)
  }

  await Bun.sleep(Number(process.env['BENCH_WARMUP'] ?? '1000'))
  const start = received
  await Bun.sleep(5000)
  console.log(JSON.stringify({ value: ((received - start) / 5000) * 1000 }))
  process.exit(0)
}

for (const connection of connections) {
  connection.onMessage((): void => {
    received += 1
  })
}

console.log('connected')
for await (const line of console) {
  if (line.trim() !== 'report') continue
  console.log(JSON.stringify({ value: received }))
  process.exit(0)
}
