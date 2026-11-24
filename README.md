# Pump.fun Paper Sprint

[![MakeFun competition](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![MakeFun rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/lastborn04/pump-paper-sprint-20261124/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard)
[![MakeFun reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/lastborn04/pump-paper-sprint-20261124/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

This TypeScript paper-trading bot runs the edge-floor strategy against the official MakeFun replay protocol. The strategy evaluates recent trade flow and a price rebound, estimates round-trip execution costs, and places an order only if its estimated post-cost edge meets the threshold.

## Reproduce the entry

Run `node main.ts` with the official harness providing NDJSON on stdin. The grader uses Node 22. The bot writes protocol replies on stdout and uses the vendored SDK from the competition kit. It requires no package installation, dataset file, or network access at runtime.

Use the official competition kit's `grade-local` Docker driver with this checkout and the genuine Codex transcript archive. Keep the archive, generated grader outputs, and replay research alongside the development records, outside this runtime checkout.
