import 'reflect-metadata'

import { Controller, Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import {
  MessagePattern,
  Transport,
  type MicroserviceOptions,
} from '@nestjs/microservices'

import { argumentsOf, ready } from '../../control.ts'

/**
 * Answers every message with what it was sent
 * @class
 */
class EchoController {
  /**
   * Echoes the payload
   * @param data what the client sent
   * @returns The same data
   */
  public echo(data: string): string {
    return data
  }
}

/**
 * The application module
 * @class
 */
class AppModule {}

const echo = Object.getOwnPropertyDescriptor(EchoController.prototype, 'echo')
if (echo === undefined) throw new Error('Handler is missing')
MessagePattern('m')(EchoController.prototype, 'echo', echo)
Controller()(EchoController)
Module({ controllers: [EchoController] })(AppModule)

const { port } = argumentsOf()
const app = await NestFactory.createMicroservice<MicroserviceOptions>(
  AppModule,
  {
    transport: Transport.TCP,
    options: { host: '127.0.0.1', port },
    logger: false,
  },
)
await app.listen()
ready()
