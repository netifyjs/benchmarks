/**
 * What a load process reports
 */
type LoadReport = {
  /**
   * Echoes per second
   */
  readonly messagesPerSecond: number
}

const variants = (Bun.argv[2] ?? 'bun,native,netify').split(',')
const loads = Number(Bun.argv[3] ?? '4')

for (const variant of variants) {
  const port = 30000 + Math.floor(Math.random() * 1000)
  const server = Bun.spawn({
    cmd: [
      'bun',
      ...(Bun.env.BENCH_PROFILE === undefined
        ? []
        : ['--cpu-prof-md', `--cpu-prof-dir=${Bun.env.BENCH_PROFILE}`]),
      `${import.meta.dir}/server/index.ts`,
      variant,
      String(port),
      '8500',
    ],
    stdout: 'ignore',
    stderr: 'inherit',
  })
  await Bun.sleep(800)

  const reports = await Promise.all(
    Array.from({ length: loads }, async (): Promise<LoadReport> => {
      const child = Bun.spawn({
        cmd: ['bun', `${import.meta.dir}/load/index.ts`, String(port), '16'],
        stdout: 'pipe',
        stderr: 'inherit',
      })
      return JSON.parse(await new Response(child.stdout).text()) as LoadReport
    }),
  )
  await server.exited

  const total = reports.reduce(
    (sum: number, report: LoadReport): number => sum + report.messagesPerSecond,
    0,
  )
  console.log(`${variant}: ${Math.round(total).toLocaleString('en-GB')} msg/s`)
}
