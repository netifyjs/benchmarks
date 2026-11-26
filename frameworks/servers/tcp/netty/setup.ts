import { mkdir } from 'node:fs/promises'

/**
 * Netty release the benchmark runs against
 */
const VERSION = '4.2.21.Final'

/**
 * Jars the echo server needs, with the native epoll build for x86_64 Linux
 */
const ARTIFACTS = [
  'netty-common',
  'netty-buffer',
  'netty-transport',
  'netty-codec-base',
  'netty-handler',
  'netty-resolver',
  'netty-transport-native-unix-common',
  'netty-transport-classes-epoll',
  'netty-transport-native-epoll:linux-x86_64',
]

const folder = `${import.meta.dir}/jars`
await mkdir(folder, { recursive: true })

for (const artifact of ARTIFACTS) {
  const [name = artifact, classifier] = artifact.split(':')
  const file = `${name}-${VERSION}${classifier === undefined ? '' : `-${classifier}`}.jar`
  const response = await fetch(
    `https://repo1.maven.org/maven2/io/netty/${name}/${VERSION}/${file}`,
  )
  if (!response.ok) throw new Error(`Download failed for ${file}`)

  await Bun.write(`${folder}/${file}`, response)
  console.log(file)
}
