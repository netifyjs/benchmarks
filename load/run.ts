import { LoadGenerator } from './index.ts'

const result = await new LoadGenerator({
  port: Number(Bun.argv[2]),
  connections: Number(Bun.argv[3] ?? '64'),
  window: 32,
  size: 64,
  duration: 5000,
  warmup: 1500,
}).run()

console.log(JSON.stringify(result))
