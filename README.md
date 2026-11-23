# btc0511-b

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/prellxz-gm/btc0511-b/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/prellxz-gm/btc0511-b/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

ADX Momentum: a trend-following bot that trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain bars. It waits for a confirmed ADX(14) uptrend — ADX above 22 and rising, +DI above −DI + 5 and above 25, close above its EMA(60), 60-bar momentum above +15 bps, holding for 2 consecutive closes — buys once at full size, then only exits on a +8% take-profit or a −2.5% crash-guard stop. It never exits on a DI cross or an ADX dip: on 1-minute bars those flip constantly and every exit-and-re-enter cycle pays ~26 bps in fee, slippage and impact. Dev window (1,440 bars): net PnL +$29.98, 1 trade, max drawdown 1.98%.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
