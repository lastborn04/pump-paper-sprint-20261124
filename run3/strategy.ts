import type { Bot, OrderInput } from '../vendor/makefun-bot.ts';

export const variants = {
  'edge-floor': { minimumReserve: 4, minimumFlow: 0.25, minimumVolume: 0.65, netEdge: 0.025 },
  'deep-pools': { minimumReserve: 15, minimumFlow: 0.25, minimumVolume: 0.65, netEdge: 0.025 },
  'deep-confirmed': { minimumReserve: 15, minimumFlow: 0.50, minimumVolume: 1.2, netEdge: 0.025 },
} as const;

export type Variant = keyof typeof variants;
type Trade = { slot: number; price: number; signedSol: number; feeBps: number };
const SOL = 1e9;

export function createRun3(variant: Variant): Bot {
  const tape = new Map<string, Trade[]>();
  const entered = new Map<string, number>();
  const attempted = new Set<string>();
  const config = variants[variant];
  let peak = 0;
  let halted = false;

  return {
    onBatch(state, batch) {
      const changed = new Set<string>();
      const fallbackFee = state.hello.fees.protocol_bps_fallback + state.hello.fees.creator_bps_fallback;
      for (const event of batch.events) {
        if (event.event === 'CompleteEvent') tape.delete(event.mint);
        if (event.event !== 'TradeEvent') continue;
        const price = Number(event.virtual_quote_reserves) / Number(event.virtual_token_reserves);
        if (!Number.isFinite(price) || price <= 0) continue;
        const history = tape.get(event.mint) ?? [];
        const protocolFee = Number(event.fee_basis_points);
        history.push({
          slot: batch.slot, price, signedSol: (event.is_buy ? 1 : -1) * Number(event.sol_amount) / SOL,
          feeBps: protocolFee > 0 ? protocolFee + Number(event.creator_fee_basis_points) : fallbackFee,
        });
        if (history.length > 24) history.shift();
        tape.set(event.mint, history);
        changed.add(event.mint);
      }

      for (const fill of batch.fills) {
        if (fill.side === 'buy' && fill.status === 'filled') entered.set(fill.mint, fill.slot);
        if (!state.positions.has(fill.mint)) entered.delete(fill.mint);
      }

      const fee = Number(state.txFeeLamports());
      const pending = new Set([...state.pending.values()].map(p => p.order.mint));
      let equity = Number(state.cash);
      let exposure = 0;
      const roi = new Map<string, number>();
      for (const [mint, position] of state.positions) {
        const curve = state.curves.get(mint);
        if (!curve) continue;
        const gross = curve.virtual_quote_reserves * position.token_amount /
          (curve.virtual_token_reserves + position.token_amount);
        const available = gross < curve.real_quote_reserves ? gross : curve.real_quote_reserves;
        const rate = (tape.get(mint)?.at(-1)?.feeBps ?? fallbackFee) / 10_000;
        const net = Math.max(0, Number(available) * (1 - rate) - fee);
        const cost = Number(position.cost_lamports) + fee;
        equity += net;
        exposure += Math.max(cost, net);
        roi.set(mint, net / cost - 1);
      }
      for (const { order } of state.pending.values()) {
        if (order.side === 'buy') exposure += Number(order.quote_lamports);
      }
      peak = Math.max(peak, equity);
      halted ||= equity < 0.95 * peak;
      const orders: OrderInput[] = [];
      const maxOrders = state.hello.caps.max_orders_per_batch;
      for (const [mint, position] of state.positions) {
        if (pending.has(mint) || state.curves.get(mint)?.complete) continue;
        const entry = entered.get(mint);
        const change = roi.get(mint) ?? 0;
        if (halted || change < -0.075 || change >= 0.065 || (entry !== undefined && batch.slot - entry >= 72)) {
          orders.push({ side: 'sell', mint, token_amount: position.token_amount, max_slippage_bps: 1_200 });
          if (orders.length === maxOrders) return orders;
        }
      }
      if (halted) return orders;

      let slots = Math.min(2, state.hello.caps.max_open_positions) - state.committedPositionCount();
      let cash = Number(state.freeCashLamports()) - orders.length * fee;
      const candidates: { mint: string; edge: number; desired: number }[] = [];
      for (const mint of changed) {
        if (attempted.has(mint) || pending.has(mint) || state.positions.has(mint)) continue;
        const curve = state.curves.get(mint);
        const history = tape.get(mint)?.filter(t => batch.slot - t.slot <= 100);
        if (!curve || curve.complete || curve.real_quote_reserves < BigInt(config.minimumReserve) * BigInt(SOL) ||
            !history || history.length < 10 || batch.slot - history[0].slot < 4) continue;

        const latest = history.at(-1)!;
        const recent = history.slice(-5);
        const volume = recent.reduce((total, t) => total + Math.abs(t.signedSol), 0);
        const flow = recent.reduce((total, t) => total + t.signedSol, 0);
        const low = Math.min(...recent.map(t => t.price));
        const prior = history.slice(0, -5);
        const anchor = prior.reduce((sum, t) => sum + t.price, 0) / prior.length;
        const rebound = Math.log(latest.price / low);
        const drift = Math.log(latest.price / history[0].price);
        const sigma = Math.sqrt(prior.slice(1).reduce((sum, t, i) =>
          sum + Math.log(t.price / prior[i].price) ** 2, 0) / (prior.length - 1));
        if (drift > -0.09 || rebound < 0.025 || rebound > 0.095 ||
            volume < config.minimumVolume || flow / volume < config.minimumFlow ||
            recent.slice(-3).filter(t => t.signedSol > 0).length < 2) continue;
        const desired = Math.floor(Math.min(0.12 * SOL, 0.7 * Number(state.maxBuyLamports(mint)),
          equity * 0.001 / Math.max(0.075, 3 * sigma)));
        if (desired < 12_000_000) continue;
        const curveFees = 2 * Math.max(latest.feeBps, fallbackFee) / 10_000;
        const success = 1 - state.hello.fees.failed_tx_bps / 10_000;
        const networkFees = 2 * fee / (desired * success);
        const impact = 2 * desired / Number(curve.virtual_quote_reserves);
        const latencyBuffer = Math.max(0.01, Math.min(0.04, 0.5 * sigma));
        const cost = curveFees + networkFees + impact + latencyBuffer;
        const edge = 0.5 * Math.log(anchor / latest.price) - cost;
        if (edge >= config.netEdge) candidates.push({ mint, edge, desired });
      }

      candidates.sort((a, b) => b.edge - a.edge || (a.mint < b.mint ? -1 : 1));
      for (const { mint, desired } of candidates) {
        if (slots <= 0 || orders.length >= maxOrders) break;
        if (desired > Math.min(cash - fee, equity * 0.05 - exposure)) continue;
        orders.push({ side: 'buy', mint, quote_lamports: desired, max_slippage_bps: 350 });
        attempted.add(mint);
        cash -= desired + fee;
        exposure += desired;
        slots--;
      }
      return orders;
    },
  };
}
