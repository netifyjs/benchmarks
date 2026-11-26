import { ServiceBroker, type Context } from 'moleculer'

import { argumentsOf, ready } from '../../control.ts'

const { port } = argumentsOf()
const broker = new ServiceBroker({
  nodeID: 'server',
  logger: false,
  transporter: {
    type: 'TCP',
    options: { udpDiscovery: false, port },
  },
})
broker.createService({
  name: 'echo',
  actions: {
    /**
     * Returns what it was sent
     * @param context the call
     * @returns The same payload
     */
    echo: (context: Context<{ readonly data: string }>): string =>
      context.params.data,
  },
})
await broker.start()
ready()
