# Netify benchmarks

The benchmarks behind the numbers on [netifyjs.dev](https://netifyjs.dev/scaling/performance), for [Netify](https://github.com/netifyjs/netify).

## Setup

Clone Netify next to this repo and link it.

```sh
cd netify
bun link

cd ../benchmarks
bun install
```

You'll need `node` on your path too. ZeroMQ and uWebSockets.js won't load in Bun, so their servers run on Node 24.

## Running

`bun run frameworks` is the big one. It puts Netify up against ZeroMQ, gRPC, Moleculer, NestJS, Colyseus and Socket.IO, and writes the medians to `frameworks/results.json`. The docs site reads that file when it builds.

```sh
BENCH_LOADS=6 bun run frameworks
BENCH_LOADS=6 bun run frameworks tcp,websocket
```

The rest test one thing each:

- `echo` is TCP echo on raw Bun, Netify and Netify with framing
- `micro` covers buffers, codecs and the pipeline
- `cluster` runs the TCP server over several processes or threads
- `mmo` is 5000 players in zones ticking at 20 Hz
- `mmo:gateway` is the same game with one world process and gateways holding the sockets
- `reliable` and `reliable:scale` are reliable UDP, in one process and across many peers
- `websocket` compares bare Bun, the native server and the JavaScript codec
- `offload` is `OffloadHandler` with 200 µs of work per message
- `chaos` has bots walking between shards and checking their state after every handoff, while random shards get killed

Most take arguments.

```sh
bun run echo raw,netify,framed 64
bun run cluster framed 4 8 processes
bun run mmo 5000 4
bun run mmo:gateway 5000 4
CHAOS_REGION=1 CHAOS_CROSS=0.9 bun run chaos 4 2000 1000
```

[Performance](https://netifyjs.dev/scaling/performance#running-the-benchmarks) lists every argument and env var.

## Licence

[MIT](https://github.com/netifyjs/netify/blob/main/LICENSE)
