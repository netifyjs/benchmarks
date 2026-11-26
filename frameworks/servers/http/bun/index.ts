import { argumentsOf, cores, ready, whenListening } from '../../control.ts'

const { port } = argumentsOf()
if (cores > 1 && Bun.env.BENCH_CHILD === undefined) {
  const children = Array.from({ length: cores }, () =>
    Bun.spawn({
      cmd: ['bun', Bun.main, ...process.argv.slice(2)],
      env: { ...Bun.env, BENCH_CHILD: '1' },
      stdout: 'ignore',
      stderr: 'inherit',
    }),
  )
  process.on('SIGTERM', (): void => {
    for (const child of children) child.kill()
    process.exit(0)
  })
  await whenListening(port)
  ready()
} else {
  Bun.serve({
    hostname: '127.0.0.1',
    port,
    reusePort: cores > 1,
    /**
     * Answers every request with plain text
     * @returns The response
     */
    fetch: (): Response =>
      new Response('Hello, World!', {
        headers: { 'Content-Type': 'text/plain' },
      }),
  })
  if (cores === 1) ready()
}
