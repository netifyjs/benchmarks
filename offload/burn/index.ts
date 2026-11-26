/**
 * Spins the CPU for a while, standing in for physics or crypto work
 * @param bytes the message, echoed back once the time is up
 * @param micros how long to spin
 */
export const burn = (bytes: Uint8Array, micros: number): Uint8Array => {
  const end = performance.now() + micros / 1000
  let spins = 0

  while (performance.now() < end) spins += 1
  return spins >= 0 ? bytes : bytes
}
