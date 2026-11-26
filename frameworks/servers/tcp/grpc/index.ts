import {
  Server,
  ServerCredentials,
  type ServerDuplexStream,
  type ServiceDefinition,
} from '@grpc/grpc-js'

import { argumentsOf, ready } from '../../control.ts'

/**
 * Passes bytes through untouched
 * @param bytes the message
 * @returns The same bytes
 */
const identity = (bytes: Buffer): Buffer => bytes

/**
 * One bidirectional streaming method that echoes raw bytes
 */
export const ECHO_SERVICE: ServiceDefinition = {
  echo: {
    path: '/bench.Echo/Echo',
    requestStream: true,
    responseStream: true,
    requestSerialize: identity,
    requestDeserialize: identity,
    responseSerialize: identity,
    responseDeserialize: identity,
  },
}

const { port } = argumentsOf()
const server = new Server()
server.addService(ECHO_SERVICE, {
  /**
   * Writes every message back on the same stream
   * @param call the stream
   */
  echo: (call: ServerDuplexStream<Buffer, Buffer>): void => {
    call.on('data', (message: Buffer): void => {
      call.write(message)
    })
    call.on('end', (): void => {
      call.end()
    })
  },
})
server.bindAsync(
  `127.0.0.1:${String(port)}`,
  ServerCredentials.createInsecure(),
  (error: Error | null): void => {
    if (error !== null) throw error
    ready()
  },
)
