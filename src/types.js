/**
 * The Darkhold Exchange - Domain Types & Constants
 * Team: Nadaan Darinde (Team ID: 47)
 */

export const OrderSide = {
  BUY: 'BUY',
  SELL: 'SELL'
};

export const OrderType = {
  LIMIT: 'LIMIT',
  MARKET: 'MARKET',
  STOP_LIMIT: 'STOP_LIMIT'
};

export const OrderStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  PARTIALLY_FILLED: 'PARTIALLY_FILLED',
  FILLED: 'FILLED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED'
};

export const EscrowStatus = {
  FUNDS_HELD: 'FUNDS_HELD',
  DELIVERED: 'DELIVERED',
  CONFIRMED: 'CONFIRMED',
  RELEASED: 'RELEASED',
  REFUNDED: 'REFUNDED'
};

export const EventType = {
  ORDER_PLACED: 'ORDER_PLACED',
  ORDER_ACCEPTED: 'ORDER_ACCEPTED',
  ORDER_MATCHED: 'ORDER_MATCHED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_REJECTED: 'ORDER_REJECTED',
  STOP_TRIGGERED: 'STOP_TRIGGERED',
  LEDGER_SETTLED: 'LEDGER_SETTLED',
  DUTCH_AUCTION_STARTED: 'DUTCH_AUCTION_STARTED',
  DUTCH_AUCTION_BID: 'DUTCH_AUCTION_BID',
  DUTCH_AUCTION_ENDED: 'DUTCH_AUCTION_ENDED'
};

// Initial instrument catalog with face value and anti-scalp cap percentage
export const INSTRUMENTS = {
  'DAY1-PASS': {
    id: 'DAY1-PASS',
    name: 'Day-1 Neon Nocturne Festival Pass',
    category: 'Ticket',
    faceValue: 100.0, // Face value $100
    capPercent: 0.20, // Strict 20% max markup ($120.00 max)
    minPrice: 10.0,
    tickSize: 0.50,
    minQty: 1,
    maxQty: 4 // Max 4 per wallet to curb bulk scalping
  },
  'VIP-RELIC': {
    id: 'VIP-RELIC',
    name: 'Arcane VIP Relic & Backstage Amulet',
    category: 'Relic',
    faceValue: 250.0, // Face value $250
    capPercent: 0.20, // Strict 20% max markup ($300.00 max)
    minPrice: 25.0,
    tickSize: 1.0,
    minQty: 1,
    maxQty: 2
  },
  'CHRONO-WRISTBAND': {
    id: 'CHRONO-WRISTBAND',
    name: 'Chrono-Gate Fastpass Wristband',
    category: 'Pass',
    faceValue: 60.0, // Face value $60
    capPercent: 0.15, // 15% max markup ($69.00 max)
    minPrice: 5.0,
    tickSize: 0.25,
    minQty: 1,
    maxQty: 6
  }
};
