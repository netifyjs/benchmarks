import {
  WorkerService,
} from '@netifyjs/netify'
import { burn } from '../burn/index.ts'

new WorkerService<Uint8Array, Uint8Array>((bytes: Uint8Array): Uint8Array =>
  burn(bytes, Number(Bun.env.BURN ?? '200')),
).listen()
