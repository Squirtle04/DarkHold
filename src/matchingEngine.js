/**
 * The Darkhold Exchange - High-Performance In-Memory Matching Engine
 * Features:
 * - Deterministic FIFO Price-Time Priority
 * - Limit, Market, and Stop-Limit orders
 * - Sub-millisecond execution & zero lock contention
 * - Level 2 depth ladder & batched book deltas
 * - Snapshot & deterministic event replay
 */

import { OrderSide, OrderType, OrderStatus } from './types.js';

export class OrderBook {
  constructor(instrumentId) {
    this.instrumentId = instrumentId;
    // Bids sorted DESCENDING by price (best bid = highest price)
    this.bids = []; // Array of { price, orders: [order], totalQty }
    // Asks sorted ASCENDING by price (best ask = lowest price)
    this.asks = []; // Array of { price, orders: [order], totalQty }
    // O(1) order lookup by orderId
    this.orderMap = new Map();
    // Stop orders waiting to be triggered
    this.stopOrders = [];
    this.lastTradePrice = null;
    this.sequence = 0;
  }

  getBestBid() {
    return this.bids.length > 0 ? this.bids[0].price : null;
  }

  getBestAsk() {
    return this.asks.length > 0 ? this.asks[0].price : null;
  }

  /**
   * Process incoming order through FIFO matching
   */
  processOrder(order) {
    this.sequence++;
    order.seq = this.sequence;
    order.remainingQty = order.qty;
    order.filledQty = 0;
    order.createdAt = Date.now();
    order.status = OrderStatus.PENDING;

    // Handle Stop-Limit orders that haven't triggered yet
    if (order.type === OrderType.STOP_LIMIT && order.triggerPrice) {
      const isTriggered = this.checkStopTrigger(order);
      if (!isTriggered) {
        order.status = OrderStatus.ACCEPTED;
        this.stopOrders.push(order);
        this.orderMap.set(order.id, { order, isStop: true });
        return {
          accepted: order,
          trades: [],
          triggeredStops: [],
          bookDelta: this.getL2Snapshot()
        };
      }
    }

    order.status = OrderStatus.ACCEPTED;
    const trades = [];

    if (order.side === OrderSide.BUY) {
      this.matchBuy(order, trades);
    } else {
      this.matchSell(order, trades);
    }

    // Check if any stop orders were triggered by new trade prices
    const triggeredStops = [];
    if (trades.length > 0) {
      this.lastTradePrice = trades[trades.length - 1].price;
      this.evaluateStopOrders(trades[trades.length - 1].price, triggeredStops);
    }

    // If order still has remaining qty and is LIMIT, insert into resting book
    if (order.remainingQty > 0 && order.type !== OrderType.MARKET) {
      this.insertRestingOrder(order);
      order.status = order.filledQty > 0 ? OrderStatus.PARTIALLY_FILLED : OrderStatus.ACCEPTED;
    } else if (order.type === OrderType.MARKET && order.remainingQty > 0) {
      // Unfilled portion of market order expires/cancels
      order.status = order.filledQty > 0 ? OrderStatus.PARTIALLY_FILLED : OrderStatus.CANCELLED;
    }

    return {
      accepted: order,
      trades,
      triggeredStops,
      bookDelta: this.getL2Snapshot()
    };
  }

  matchBuy(buyOrder, trades) {
    while (buyOrder.remainingQty > 0 && this.asks.length > 0) {
      const bestAskLevel = this.asks[0];

      // Limit check: Cannot buy higher than limit price
      if (buyOrder.type === OrderType.LIMIT && bestAskLevel.price > buyOrder.price) {
        break; // Price no longer matches
      }

      const restingAsk = bestAskLevel.orders[0];
      const fillQty = Math.min(buyOrder.remainingQty, restingAsk.remainingQty);
      const executionPrice = restingAsk.price; // Passive price (price-time priority)

      buyOrder.remainingQty -= fillQty;
      buyOrder.filledQty += fillQty;
      restingAsk.remainingQty -= fillQty;
      restingAsk.filledQty += fillQty;
      bestAskLevel.totalQty -= fillQty;

      trades.push({
        id: `TRD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        instrumentId: this.instrumentId,
        price: executionPrice,
        qty: fillQty,
        total: +(executionPrice * fillQty).toFixed(2),
        buyerId: buyOrder.userId,
        sellerId: restingAsk.userId,
        buyOrderId: buyOrder.id,
        sellOrderId: restingAsk.id,
        timestamp: Date.now()
      });

      if (restingAsk.remainingQty === 0) {
        restingAsk.status = OrderStatus.FILLED;
        bestAskLevel.orders.shift();
        this.orderMap.delete(restingAsk.id);
      } else {
        restingAsk.status = OrderStatus.PARTIALLY_FILLED;
      }

      if (bestAskLevel.orders.length === 0) {
        this.asks.shift();
      }
    }

    if (buyOrder.remainingQty === 0) {
      buyOrder.status = OrderStatus.FILLED;
    }
  }

  matchSell(sellOrder, trades) {
    while (sellOrder.remainingQty > 0 && this.bids.length > 0) {
      const bestBidLevel = this.bids[0];

      // Limit check: Cannot sell lower than limit price
      if (sellOrder.type === OrderType.LIMIT && bestBidLevel.price < sellOrder.price) {
        break; // Price no longer matches
      }

      const restingBid = bestBidLevel.orders[0];
      const fillQty = Math.min(sellOrder.remainingQty, restingBid.remainingQty);
      const executionPrice = restingBid.price; // Passive price

      sellOrder.remainingQty -= fillQty;
      sellOrder.filledQty += fillQty;
      restingBid.remainingQty -= fillQty;
      restingBid.filledQty += fillQty;
      bestBidLevel.totalQty -= fillQty;

      trades.push({
        id: `TRD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        instrumentId: this.instrumentId,
        price: executionPrice,
        qty: fillQty,
        total: +(executionPrice * fillQty).toFixed(2),
        buyerId: restingBid.userId,
        sellerId: sellOrder.userId,
        buyOrderId: restingBid.id,
        sellOrderId: sellOrder.id,
        timestamp: Date.now()
      });

      if (restingBid.remainingQty === 0) {
        restingBid.status = OrderStatus.FILLED;
        bestBidLevel.orders.shift();
        this.orderMap.delete(restingBid.id);
      } else {
        restingBid.status = OrderStatus.PARTIALLY_FILLED;
      }

      if (bestBidLevel.orders.length === 0) {
        this.bids.shift();
      }
    }

    if (sellOrder.remainingQty === 0) {
      sellOrder.status = OrderStatus.FILLED;
    }
  }

  insertRestingOrder(order) {
    const list = order.side === OrderSide.BUY ? this.bids : this.asks;
    const isBuy = order.side === OrderSide.BUY;

    let levelIndex = list.findIndex(l => l.price === order.price);

    if (levelIndex === -1) {
      // Find insertion point
      // Bids: descending order (higher price first)
      // Asks: ascending order (lower price first)
      let insertAt = list.findIndex(l => isBuy ? l.price < order.price : l.price > order.price);
      if (insertAt === -1) insertAt = list.length;

      const newLevel = {
        price: order.price,
        orders: [order],
        totalQty: order.remainingQty
      };

      list.splice(insertAt, 0, newLevel);
      this.orderMap.set(order.id, { order, level: newLevel });
    } else {
      const level = list[levelIndex];
      level.orders.push(order);
      level.totalQty += order.remainingQty;
      this.orderMap.set(order.id, { order, level });
    }
  }

  cancelOrder(orderId) {
    const entry = this.orderMap.get(orderId);
    if (!entry) {
      return { success: false, reason: 'Order not found in active book' };
    }

    const { order, level, isStop } = entry;

    if (isStop) {
      this.stopOrders = this.stopOrders.filter(o => o.id !== orderId);
      this.orderMap.delete(orderId);
      order.status = OrderStatus.CANCELLED;
      return { success: true, order, bookDelta: this.getL2Snapshot() };
    }

    // Remove from level queue
    level.orders = level.orders.filter(o => o.id !== orderId);
    level.totalQty -= order.remainingQty;
    this.orderMap.delete(orderId);
    order.status = OrderStatus.CANCELLED;

    // Remove empty price levels
    if (level.orders.length === 0) {
      if (order.side === OrderSide.BUY) {
        this.bids = this.bids.filter(l => l.price !== level.price);
      } else {
        this.asks = this.asks.filter(l => l.price !== level.price);
      }
    }

    return {
      success: true,
      order,
      bookDelta: this.getL2Snapshot()
    };
  }

  checkStopTrigger(order) {
    if (!this.lastTradePrice) return false;
    if (order.side === OrderSide.BUY) {
      return this.lastTradePrice >= order.triggerPrice;
    } else {
      return this.lastTradePrice <= order.triggerPrice;
    }
  }

  evaluateStopOrders(currentPrice, triggeredStops) {
    const remaining = [];
    for (const stopOrder of this.stopOrders) {
      let triggered = false;
      if (stopOrder.side === OrderSide.BUY && currentPrice >= stopOrder.triggerPrice) {
        triggered = true;
      } else if (stopOrder.side === OrderSide.SELL && currentPrice <= stopOrder.triggerPrice) {
        triggered = true;
      }

      if (triggered) {
        this.orderMap.delete(stopOrder.id);
        stopOrder.type = OrderType.LIMIT;
        triggeredStops.push(stopOrder);
        // Process as active order
        this.processOrder(stopOrder);
      } else {
        remaining.push(stopOrder);
      }
    }
    this.stopOrders = remaining;
  }

  /**
   * Return Level 2 Depth Snapshot (top 15 bids, top 15 asks)
   */
  getL2Snapshot(depth = 15) {
    let cumBidQty = 0;
    const bidLadder = this.bids.slice(0, depth).map(l => {
      cumBidQty += l.totalQty;
      return {
        price: l.price,
        qty: l.totalQty,
        orderCount: l.orders.length,
        cumulative: cumBidQty
      };
    });

    let cumAskQty = 0;
    const askLadder = this.asks.slice(0, depth).map(l => {
      cumAskQty += l.totalQty;
      return {
        price: l.price,
        qty: l.totalQty,
        orderCount: l.orders.length,
        cumulative: cumAskQty
      };
    });

    const maxCum = Math.max(cumBidQty, cumAskQty, 1);

    return {
      instrumentId: this.instrumentId,
      sequence: this.sequence,
      lastTradePrice: this.lastTradePrice,
      bestBid: this.getBestBid(),
      bestAsk: this.getBestAsk(),
      spread: this.getBestAsk() && this.getBestBid() 
        ? +(this.getBestAsk() - this.getBestBid()).toFixed(2) 
        : null,
      bids: bidLadder.map(b => ({ ...b, depthPct: Math.round((b.cumulative / maxCum) * 100) })),
      asks: askLadder.map(a => ({ ...a, depthPct: Math.round((a.cumulative / maxCum) * 100) })),
      timestamp: Date.now()
    };
  }

  /**
   * Export complete book state for snapshots
   */
  exportState() {
    return {
      instrumentId: this.instrumentId,
      sequence: this.sequence,
      lastTradePrice: this.lastTradePrice,
      bids: this.bids.map(l => ({
        price: l.price,
        orders: l.orders.map(o => ({ ...o }))
      })),
      asks: this.asks.map(l => ({
        price: l.price,
        orders: l.orders.map(o => ({ ...o }))
      }))
    };
  }

  /**
   * Reset and deterministic replay from events
   */
  replayFromEvents(events) {
    this.bids = [];
    this.asks = [];
    this.orderMap.clear();
    this.stopOrders = [];
    this.lastTradePrice = null;
    this.sequence = 0;

    for (const evt of events) {
      if (evt.type === 'ORDER_PLACED' && evt.order.instrumentId === this.instrumentId) {
        this.processOrder({ ...evt.order });
      } else if (evt.type === 'ORDER_CANCELLED' && evt.order.instrumentId === this.instrumentId) {
        this.cancelOrder(evt.order.id);
      }
    }
  }
}
