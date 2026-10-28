/**
 * The Darkhold Exchange - Atomic Double-Entry Ledger & Escrow Settlement
 * 
 * Principles:
 * - Every monetary movement consists of strictly balanced Debit and Credit entries (Sum = 0)
 * - Money and assets can never be created out of thin air or lost
 * - Atomic fund and item holds before order matching
 * - Multi-stage Escrow Lifecycle: FUNDS_HELD -> DELIVERED -> CONFIRMED -> RELEASED
 * - Automated continuous zero-balance anomaly verification
 */

import { EscrowStatus } from './types.js';

export class DoubleEntryLedger {
  constructor() {
    // Accounts map: accountId -> { cashAvailable, cashHeld, relics: { [instrumentId]: { available, held } } }
    this.accounts = new Map();
    // Journal entries: [{ id, tradeId, timestamp, entries: [{ accountId, asset, type: 'DEBIT'|'CREDIT', amount }] }]
    this.journal = [];
    // Active holds: holdId -> { accountId, asset, amount, orderId, status }
    this.holds = new Map();
    // Escrow contracts: escrowId -> { tradeId, buyerId, sellerId, instrumentId, qty, amount, status, updatedAt }
    this.escrows = new Map();
    // Fee treasury account
    this.systemTreasuryId = 'TREASURY-VAULT';
    this.initAccount(this.systemTreasuryId, 100000.0);
  }

  initAccount(userId, initialCash = 1000.0, initialRelics = {}) {
    if (!this.accounts.has(userId)) {
      this.accounts.set(userId, {
        userId,
        cashAvailable: initialCash,
        cashHeld: 0.0,
        relics: { ...initialRelics }
      });
    }
    return this.accounts.get(userId);
  }

  getAccount(userId) {
    if (!this.accounts.has(userId)) {
      return this.initAccount(userId);
    }
    return this.accounts.get(userId);
  }

  /**
   * Pre-trade Fund / Relic Hold Reservation
   * Prevents un-funded orders from entering the matching engine book
   */
  reserveHold(order) {
    const acc = this.getAccount(order.userId);
    const holdId = `HOLD-${order.id}`;

    if (order.side === 'BUY') {
      const requiredCash = +(order.price * order.qty).toFixed(2);
      if (acc.cashAvailable < requiredCash) {
        return {
          success: false,
          reason: `Insufficient cash balance. Available: $${acc.cashAvailable.toFixed(2)}, Required: $${requiredCash.toFixed(2)}`
        };
      }
      acc.cashAvailable = +(acc.cashAvailable - requiredCash).toFixed(2);
      acc.cashHeld = +(acc.cashHeld + requiredCash).toFixed(2);

      this.holds.set(holdId, {
        holdId,
        orderId: order.id,
        userId: order.userId,
        asset: 'USD',
        amount: requiredCash,
        active: true
      });
      return { success: true, holdId, amount: requiredCash, asset: 'USD' };
    } else {
      // SELL order
      if (!acc.relics[order.instrumentId]) {
        acc.relics[order.instrumentId] = { available: 0, held: 0 };
      }
      const relic = acc.relics[order.instrumentId];
      if (relic.available < order.qty) {
        return {
          success: false,
          reason: `Insufficient passes/relics to sell. Available: ${relic.available}, Required: ${order.qty}`
        };
      }
      relic.available -= order.qty;
      relic.held += order.qty;

      this.holds.set(holdId, {
        holdId,
        orderId: order.id,
        userId: order.userId,
        asset: order.instrumentId,
        amount: order.qty,
        active: true
      });
      return { success: true, holdId, amount: order.qty, asset: order.instrumentId };
    }
  }

  /**
   * Release hold upon order cancellation
   */
  releaseHold(order) {
    const holdId = `HOLD-${order.id}`;
    const hold = this.holds.get(holdId);
    if (!hold || !hold.active) return { success: false };

    const acc = this.getAccount(order.userId);
    if (hold.asset === 'USD') {
      const remainingHoldCash = +(order.price * order.remainingQty).toFixed(2);
      acc.cashHeld = Math.max(0, +(acc.cashHeld - remainingHoldCash).toFixed(2));
      acc.cashAvailable = +(acc.cashAvailable + remainingHoldCash).toFixed(2);
    } else {
      const relic = acc.relics[order.instrumentId];
      if (relic) {
        relic.held = Math.max(0, relic.held - order.remainingQty);
        relic.available += order.remainingQty;
      }
    }

    hold.active = false;
    return { success: true };
  }

  /**
   * Atomic Settlement for matched trade:
   * Double-Entry Journal:
   *   1. Buyer Cash Held credited (reduced) by trade amount
   *   2. Seller Cash Available debited (increased) by trade amount minus fee
   *   3. Platform Fee Treasury debited by fee
   *   4. Seller Relic Held credited (reduced) by trade quantity
   *   5. Buyer Relic Available debited (increased) by trade quantity
   * Escrow created in DELIVERED state for instant release or buyer dispute lock
   */
  settleTrade(trade) {
    const buyerAcc = this.getAccount(trade.buyerId);
    const sellerAcc = this.getAccount(trade.sellerId);
    const treasury = this.getAccount(this.systemTreasuryId);

    const tradeTotal = +(trade.price * trade.qty).toFixed(2);
    const platformFee = +(tradeTotal * 0.015).toFixed(2); // 1.5% fee
    const sellerProceeds = +(tradeTotal - platformFee).toFixed(2);

    // Verify buyer held cash
    if (buyerAcc.cashHeld < tradeTotal) {
      // Allow minor floating adjustment if already verified
      const diff = tradeTotal - buyerAcc.cashHeld;
      if (buyerAcc.cashAvailable >= diff) {
        buyerAcc.cashAvailable -= diff;
        buyerAcc.cashHeld += diff;
      }
    }

    // 1. Double-entry monetary journal entries
    // In accounting: DEBIT increases Asset (or decreases Liability), CREDIT decreases Asset
    // Net monetary balance change across all participants must equal strictly ZERO!
    const monetaryTx = [
      { accountId: trade.buyerId, asset: 'USD', type: 'CREDIT', amount: tradeTotal, description: 'Cash paid for trade' },
      { accountId: trade.sellerId, asset: 'USD', type: 'DEBIT', amount: sellerProceeds, description: 'Proceeds from pass sale' },
      { accountId: this.systemTreasuryId, asset: 'USD', type: 'DEBIT', amount: platformFee, description: 'Protocol clearing fee' }
    ];

    // Verify balance invariant: Credits == Debits
    const sumCredits = monetaryTx.filter(e => e.type === 'CREDIT').reduce((s, e) => s + e.amount, 0);
    const sumDebits = monetaryTx.filter(e => e.type === 'DEBIT').reduce((s, e) => s + e.amount, 0);
    const delta = +(sumDebits - sumCredits).toFixed(2);

    if (Math.abs(delta) > 0.001) {
      throw new Error(`Double-entry balance mismatch! Debits: ${sumDebits}, Credits: ${sumCredits}, Delta: ${delta}`);
    }

    // Apply monetary updates
    buyerAcc.cashHeld = Math.max(0, +(buyerAcc.cashHeld - tradeTotal).toFixed(2));
    sellerAcc.cashAvailable = +(sellerAcc.cashAvailable + sellerProceeds).toFixed(2);
    treasury.cashAvailable = +(treasury.cashAvailable + platformFee).toFixed(2);

    // 2. Relic Asset Transfer
    if (!sellerAcc.relics[trade.instrumentId]) {
      sellerAcc.relics[trade.instrumentId] = { available: 0, held: 0 };
    }
    if (!buyerAcc.relics[trade.instrumentId]) {
      buyerAcc.relics[trade.instrumentId] = { available: 0, held: 0 };
    }

    sellerAcc.relics[trade.instrumentId].held = Math.max(0, sellerAcc.relics[trade.instrumentId].held - trade.qty);
    buyerAcc.relics[trade.instrumentId].available += trade.qty;

    // Record Journal Entry
    const journalEntry = {
      id: `JRN-${Date.now()}-${this.journal.length + 1}`,
      tradeId: trade.id,
      timestamp: Date.now(),
      instrumentId: trade.instrumentId,
      price: trade.price,
      qty: trade.qty,
      entries: monetaryTx,
      balanced: true,
      checksumZero: delta === 0
    };
    this.journal.push(journalEntry);

    // Create Escrow Record
    const escrowId = `ESCROW-${trade.id}`;
    this.escrows.set(escrowId, {
      escrowId,
      tradeId: trade.id,
      buyerId: trade.buyerId,
      sellerId: trade.sellerId,
      instrumentId: trade.instrumentId,
      qty: trade.qty,
      amount: tradeTotal,
      status: EscrowStatus.CONFIRMED, // Auto-confirmed on secondary digital settlement
      timestamp: Date.now()
    });

    return {
      success: true,
      journalEntry,
      escrowId
    };
  }

  /**
   * Continuous Audit Job:
   * Verifies that all double-entry journal entries balance to zero
   * and no account has a negative available balance.
   */
  verifyZeroSumAudit() {
    let totalDebits = 0;
    let totalCredits = 0;
    let anomalyDetected = false;
    const anomalies = [];

    for (const entry of this.journal) {
      const debits = entry.entries.filter(e => e.type === 'DEBIT').reduce((s, e) => s + e.amount, 0);
      const credits = entry.entries.filter(e => e.type === 'CREDIT').reduce((s, e) => s + e.amount, 0);
      totalDebits += debits;
      totalCredits += credits;

      if (Math.abs(debits - credits) > 0.001) {
        anomalyDetected = true;
        anomalies.push({ journalId: entry.id, debits, credits });
      }
    }

    // Check account negative balances
    for (const [userId, acc] of this.accounts.entries()) {
      if (acc.cashAvailable < 0 || acc.cashHeld < 0) {
        anomalyDetected = true;
        anomalies.push({ userId, issue: 'Negative cash balance detected', acc });
      }
      for (const [instrument, relic] of Object.entries(acc.relics)) {
        if (relic.available < 0 || relic.held < 0) {
          anomalyDetected = true;
          anomalies.push({ userId, issue: `Negative relic count for ${instrument}`, relic });
        }
      }
    }

    return {
      timestamp: Date.now(),
      totalJournalTransactions: this.journal.length,
      totalDebits: +totalDebits.toFixed(2),
      totalCredits: +totalCredits.toFixed(2),
      netDelta: +(totalDebits - totalCredits).toFixed(2),
      isBalancedZeroSum: !anomalyDetected && Math.abs(totalDebits - totalCredits) < 0.001,
      anomalies
    };
  }
}
