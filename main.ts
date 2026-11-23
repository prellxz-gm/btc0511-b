// ADX Momentum — variant B for btc-race-24h-20261123-0511.
//
// Trend-following bot for the agent-fun/bars-replay/v1 protocol: the harness
// sends one hello, then one batch per 1-minute bar, and this bot answers every
// batch with exactly one reply carrying its orders (at most one buy or one
// sell per reply; a sell's proceeds never fund a buy of the same reply).
// Orders decided on a bar fill at the next bar's open, so every signal below
// is read off closes the bot has already seen.
//
// Idea: on 1-minute bars the directional indicators are noisy — +DI/-DI flip
// sign about 120 times over the 1,440-bar dev window — so this bot never
// exits on a DI cross and never exits because ADX dipped. It waits for a
// confirmed ADX uptrend, buys once at full size, and then only leaves on a
// wide crash-guard stop or a large take-profit; otherwise it rides the trend
// to the end of the window. That stickiness is the whole edge: the dev
// window's +3.6% move happens in one leg, and every exit-and-re-enter cycle
// around it pays ~26 bps of fee + slippage + impact per round trip.
//
// Entry — all five must hold on 2 consecutive closes:
//   * ADX(14) above 22 and rising (above its value 5 bars ago): the trend
//     is strong and strengthening, not a stale high reading.
//   * +DI(14) above -DI(14) + 5 and above 25: buyers clearly dominate.
//   * Close above its EMA(60): the price itself is above its hourly trend.
//   * 60-bar momentum above +15 bps: the last hour actually moved up.
//   A 60-bar cooldown after any sell keeps the bot from re-chasing a trend
//   it just stopped out of.
//
// Exit — the whole position, whichever comes first:
//   * Take-profit: position worth 8% over its cost.
//   * Stop-loss: position worth 2.5% under its cost. The dev window's worst
//     60-minute drop is -1.34%, so 2.5% sits outside ordinary chop and only
//     fires on a genuine reversal.
//   * Otherwise hold: no DI-cross exit, no ADX-level exit, no time exit.
//
// Indicators use Wilder's smoothing (the TA-Lib convention): the first
// 13 one-bar values are summed, then each next sum is the last less 1/14 of
// itself plus the newest value. +DI/-DI come from the smoothed +DM/-DM over
// the smoothed true range; DX = 100*|+DI - -DI| / (+DI + -DI); ADX(14) is
// the mean of the first 14 DX values, then Wilder-smoothed the same way.
// All arithmetic is float64 on the raw integer bar prices, deterministic:
// no clock, no environment, no randomness — the same hello and bars give
// the same orders on every run.

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const SPAN = 14; // Wilder span for ADX and both DIs (one shared smoothing set).
const ADX_MIN = 22; // entry needs ADX above this.
const ADX_LOOKBACK = 5; // ADX must be above its value this many bars ago.
const DI_SPREAD = 5; // +DI must clear -DI by at least this many points.
const PLUS_DI_MIN = 25; // +DI must itself be above this.
const EMA_SPAN = 60; // hourly trend filter on closes.
const MOM_BARS = 60; // momentum window in bars.
const MOM_MIN_BPS = 15; // 60-bar momentum must beat +15 bps.
const CONFIRM_BARS = 2; // consecutive closes the entry conditions must hold.
const COOLDOWN_BARS = 60; // bars to wait after a sell before re-entering.
const TAKE_PROFIT_BPS = 800; // exit when value is 8% over cost.
const STOP_LOSS_BPS = 250; // exit when value is 2.5% under cost.
const MAX_SLIPPAGE_BPS = 50; // 0.5% past the close the order was decided on.

interface Trend {
  started: boolean; // true once the first bar has been seen (no move yet).
  prevH: number;
  prevL: number;
  prevC: number;
  moves: number; // one-bar moves folded in so far.
  plusDm: number; // Wilder-smoothed +DM sum.
  minusDm: number; // Wilder-smoothed -DM sum.
  trueRange: number; // Wilder-smoothed TR sum.
  dxSeen: number; // DX values folded into the ADX seed.
  dxSum: number; // running sum of the first SPAN DX values.
  adx: number | null; // ADX(14) once seeded.
  adxHistory: number[]; // last ADX_LOOKBACK + 1 ADX values, oldest first.
  closes: number[]; // last MOM_BARS + 1 closes, oldest first.
  ema: number | null; // EMA(EMA_SPAN) of closes.
}

function newTrend(): Trend {
  return {
    started: false, prevH: 0, prevL: 0, prevC: 0, moves: 0,
    plusDm: 0, minusDm: 0, trueRange: 0,
    dxSeen: 0, dxSum: 0, adx: null, adxHistory: [], closes: [], ema: null,
  };
}

function foldWilder(t: Trend, plus: number, minus: number, range: number): void {
  t.moves += 1;
  if (t.moves < SPAN) {
    t.plusDm += plus;
    t.minusDm += minus;
    t.trueRange += range;
    return;
  }
  t.plusDm = t.plusDm - t.plusDm / SPAN + plus;
  t.minusDm = t.minusDm - t.minusDm / SPAN + minus;
  t.trueRange = t.trueRange - t.trueRange / SPAN + range;
}

/** Fold one bar in and return [adx, +DI, -DI] once all three exist. */
function pushBar(t: Trend, bar: Bar): [number, number, number] | null {
  const h = Number(bar.h);
  const l = Number(bar.l);
  const c = Number(bar.c);
  if (t.started) {
    const up = h - t.prevH;
    const down = t.prevL - l;
    const plus = up > 0 && up > down ? up : 0;
    const minus = down > 0 && down > up ? down : 0;
    let range = h - l;
    const toPrevCloseHi = h - t.prevC < 0 ? t.prevC - h : h - t.prevC;
    const toPrevCloseLo = l - t.prevC < 0 ? t.prevC - l : l - t.prevC;
    if (toPrevCloseHi > range) range = toPrevCloseHi;
    if (toPrevCloseLo > range) range = toPrevCloseLo;
    foldWilder(t, plus, minus, range);
  }
  t.started = true;
  t.prevH = h;
  t.prevL = l;
  t.prevC = c;
  t.closes.push(c);
  if (t.closes.length > MOM_BARS + 1) t.closes.shift();
  const k = 2 / (EMA_SPAN + 1);
  t.ema = t.ema === null ? c : c * k + t.ema * (1 - k);

  if (t.moves < SPAN || t.trueRange === 0) return null;
  const plusDi = (100 * t.plusDm) / t.trueRange;
  const minusDi = (100 * t.minusDm) / t.trueRange;
  const sum = plusDi + minusDi;
  if (sum === 0) return null;
  const dx = (100 * (plusDi - minusDi < 0 ? minusDi - plusDi : plusDi - minusDi)) / sum;
  if (t.adx === null) {
    t.dxSum += dx;
    t.dxSeen += 1;
    if (t.dxSeen === SPAN) t.adx = t.dxSum / SPAN;
  } else {
    t.adx = (t.adx * (SPAN - 1) + dx) / SPAN;
  }
  if (t.adx === null) return null;
  t.adxHistory.push(t.adx);
  if (t.adxHistory.length > ADX_LOOKBACK + 1) t.adxHistory.shift();
  return [t.adx, plusDi, minusDi];
}

const trend = newTrend();
let confirm = 0; // consecutive closes with the full entry signal.
let lastSellSeq = -1000000; // batch seq of the last sell decision.

await runBars({
  onBatch(state: BarsState, batch) {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined || state.warmingUp) return [];
    const ind = pushBar(trend, bar);
    const held = state.positions.get(SYMBOL);
    const { fees } = state.hello;

    if (held !== undefined) {
      const value = state.value(SYMBOL, held.qty);
      const take = value * BPS >= held.cost * (BPS + BigInt(TAKE_PROFIT_BPS));
      const stop = value * BPS <= held.cost * (BPS - BigInt(STOP_LOSS_BPS));
      if (take || stop) {
        confirm = 0;
        lastSellSeq = state.seq;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    // Flat: look for the confirmed ADX uptrend.
    if (ind === null) return [];
    const [adx, plusDi, minusDi] = ind;
    const adxAgo = trend.adxHistory.length > ADX_LOOKBACK ? trend.adxHistory[0]! : null;
    const momOk =
      trend.closes.length > MOM_BARS &&
      (trend.closes[trend.closes.length - 1]! - trend.closes[0]!) * 10000 >
        trend.closes[0]! * MOM_MIN_BPS;
    const rising = adxAgo !== null && adx > adxAgo;
    const signal =
      adx > ADX_MIN &&
      rising &&
      plusDi > minusDi + DI_SPREAD &&
      plusDi > PLUS_DI_MIN &&
      trend.ema !== null &&
      Number(bar.c) > trend.ema &&
      momOk;
    confirm = signal ? confirm + 1 : 0;
    if (confirm < CONFIRM_BARS) return [];
    if (state.seq - lastSellSeq < COOLDOWN_BARS) return [];
    confirm = 0;

    let size = state.cash;
    const room = state.weightRoom(SYMBOL);
    if (size > room) size = room;
    if (size < BigInt(fees.min_notional_quote_units)) return [];
    const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: size, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
