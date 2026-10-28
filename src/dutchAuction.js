/**
 * The Darkhold Exchange - Dutch Auction Liquidation Engine
 * 
 * Features:
 * - Dynamic price-decay curve over time (Linear or Exponential decay)
 * - Configurable reserve floor price (prevents decay below reserve)
 * - Slippage-protected acceptance: first valid bid wins instantly
 * - Atomic settlement upon auction conclusion
 */

export class DutchAuctionEngine {
  constructor(ledger) {
    this.ledger = ledger;
    // Active auctions: id -> { id, instrumentId, qty, startPrice, floorPrice, durationSec, curve, startedAt, sellerId, status, winner }
    this.auctions = new Map();
  }

  /**
   * Launch a new Dutch Auction
   */
  createAuction({ instrumentId, qty, startPrice, floorPrice, durationSec = 120, curve = 'LINEAR', sellerId }) {
    if (floorPrice >= startPrice) {
      throw new Error(`Floor price ($${floorPrice}) must be lower than start price ($${startPrice})`);
    }

    const id = `DA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const auction = {
      id,
      instrumentId,
      qty,
      startPrice: +startPrice.toFixed(2),
      floorPrice: +floorPrice.toFixed(2),
      durationSec,
      curve, // 'LINEAR' or 'EXPONENTIAL'
      startedAt: Date.now(),
      sellerId: sellerId || 'FESTIVAL-ORGANIZER',
      status: 'ACTIVE', // ACTIVE, COMPLETED, EXPIRED
      winner: null,
      finalPrice: null
    };

    this.auctions.set(id, auction);
    return auction;
  }

  /**
   * Calculate current price at elapsed time t
   */
  getCurrentPrice(auctionId) {
    const auction = this.auctions.get(auctionId);
    if (!auction) return null;
    if (auction.status === 'COMPLETED') return auction.finalPrice;
    if (auction.status === 'EXPIRED') return auction.floorPrice;

    const elapsedSec = (Date.now() - auction.startedAt) / 1000;
    const progress = Math.min(1.0, elapsedSec / auction.durationSec);

    let price;
    if (auction.curve === 'EXPONENTIAL') {
      // Exponential decay: drops faster initially, then stabilizes near floor
      const decayFactor = Math.exp(-3 * progress);
      price = auction.floorPrice + (auction.startPrice - auction.floorPrice) * decayFactor;
    } else {
      // Linear decay
      price = auction.startPrice - (auction.startPrice - auction.floorPrice) * progress;
    }

    price = Math.max(auction.floorPrice, +price.toFixed(2));

    // If duration expired and still active
    if (progress >= 1.0 && auction.status === 'ACTIVE') {
      // Remains available at reserve floor price
      price = auction.floorPrice;
    }

    return price;
  }

  /**
   * Accept / Snipe the Dutch Auction at current price
   * Includes slippage protection: buyer specifies maxAcceptablePrice
   */
  acceptAuction(auctionId, buyerId, maxAcceptablePrice) {
    const auction = this.auctions.get(auctionId);
    if (!auction) {
      return { success: false, reason: 'Auction not found' };
    }
    if (auction.status !== 'ACTIVE') {
      return { success: false, reason: `Auction is already ${auction.status}` };
    }

    const currentPrice = this.getCurrentPrice(auctionId);

    if (maxAcceptablePrice && currentPrice > maxAcceptablePrice) {
      return {
        success: false,
        reason: `SLIPPAGE EXCEEDED: Current price $${currentPrice} is higher than your maximum limit of $${maxAcceptablePrice}`
      };
    }

    // Verify buyer has sufficient funds in ledger
    const buyerAcc = this.ledger.getAccount(buyerId);
    const totalCost = +(currentPrice * auction.qty).toFixed(2);

    if (buyerAcc.cashAvailable < totalCost) {
      return {
        success: false,
        reason: `Insufficient funds. Available: $${buyerAcc.cashAvailable.toFixed(2)}, Required: $${totalCost.toFixed(2)}`
      };
    }

    // Mark auction as completed
    auction.status = 'COMPLETED';
    auction.winner = buyerId;
    auction.finalPrice = currentPrice;
    auction.completedAt = Date.now();

    // Settle through ledger
    const trade = {
      id: `TRD-DA-${Date.now()}`,
      instrumentId: auction.instrumentId,
      price: currentPrice,
      qty: auction.qty,
      buyerId,
      sellerId: auction.sellerId,
      timestamp: Date.now()
    };

    // Hold & settle atomically
    buyerAcc.cashAvailable -= totalCost;
    buyerAcc.cashHeld += totalCost;

    const settlement = this.ledger.settleTrade(trade);

    return {
      success: true,
      auction,
      settlement,
      executedPrice: currentPrice,
      totalCost
    };
  }

  getActiveAuctions() {
    return Array.from(this.auctions.values()).map(a => {
      const currentPrice = this.getCurrentPrice(a.id);
      const elapsedSec = (Date.now() - a.startedAt) / 1000;
      const progress = Math.min(100, Math.round((elapsedSec / a.durationSec) * 100));

      return {
        ...a,
        currentPrice,
        elapsedSec: Math.floor(elapsedSec),
        progressPercent: progress,
        remainingSec: Math.max(0, Math.floor(a.durationSec - elapsedSec))
      };
    });
  }
}
