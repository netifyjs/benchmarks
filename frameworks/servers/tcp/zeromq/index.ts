import { Router } from 'zeromq'

import { argumentsOf, ready } from '../../control.ts'

const { port } = argumentsOf()
const router = new Router()
await router.bind(`tcp://127.0.0.1:${String(port)}`)
ready()

for await (const [identity, message] of router) {
  if (identity === undefined || message === undefined) continue
  await router.send([identity, message])
}
