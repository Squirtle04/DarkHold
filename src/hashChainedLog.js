/**
 * The Darkhold Exchange - Cryptographic Hash-Chained Audit Log
 * 
 * Guarantees:
 * - Every market event is cryptographically linked to the previous event via SHA-256
 * - Any alteration or back-dating of orders/trades invalidates subsequent hashes
 * - Published 'head' hash allows public, verifiable audit trail
 */

import crypto from 'node:crypto';

export class HashChainedLog {
  constructor() {
    this.events = [];
    this.genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';
    this.currentHead = this.genesisHash;
  }

  sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Append an event to the cryptographically linked chain
   */
  append(type, payload) {
    const seq = this.events.length + 1;
    const timestamp = Date.now();
    const prevHash = this.currentHead;

    const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const hash = this.sha256(`${prevHash}:${seq}:${timestamp}:${type}:${payloadString}`);

    const entry = {
      seq,
      timestamp,
      type,
      payload: JSON.parse(payloadString),
      payloadString,
      prevHash,
      hash
    };

    this.events.push(entry);
    this.currentHead = hash;

    return entry;
  }

  getHead() {
    return {
      totalEvents: this.events.length,
      headHash: this.currentHead,
      lastEvent: this.events.length > 0 ? this.events[this.events.length - 1] : null,
      genesisHash: this.genesisHash
    };
  }

  getRecentEvents(limit = 20) {
    return this.events.slice(-limit).reverse();
  }

  /**
   * Verify the entire chain's integrity from genesis to current head
   */
  verifyChainIntegrity() {
    let expectedPrevHash = this.genesisHash;

    for (let i = 0; i < this.events.length; i++) {
      const entry = this.events[i];

      // Check linkage to previous block
      if (entry.prevHash !== expectedPrevHash) {
        return {
          valid: false,
          error: `Broken hash chain link at sequence #${entry.seq}. Expected prevHash: ${expectedPrevHash}, found: ${entry.prevHash}`,
          brokenSeq: entry.seq
        };
      }

      // Recompute SHA-256
      const payloadString = entry.payloadString || (typeof entry.payload === 'string' ? entry.payload : JSON.stringify(entry.payload));
      const computedHash = this.sha256(`${entry.prevHash}:${entry.seq}:${entry.timestamp}:${entry.type}:${payloadString}`);

      if (computedHash !== entry.hash) {
        return {
          valid: false,
          error: `Hash mismatch at sequence #${entry.seq}. Recomputed: ${computedHash}, stored: ${entry.hash}`,
          brokenSeq: entry.seq
        };
      }

      expectedPrevHash = entry.hash;
    }

    return {
      valid: true,
      totalEventsVerified: this.events.length,
      headHash: this.currentHead,
      genesisHash: this.genesisHash
    };
  }

  /**
   * Demonstration tool: intentionally corrupt an event to test tamper-detection
   */
  simulateTamper(seq, fakePayload) {
    const target = this.events.find(e => e.seq === seq);
    if (!target) return { success: false, reason: 'Sequence not found' };

    target.payload = fakePayload;
    target.payloadString = typeof fakePayload === 'string' ? fakePayload : JSON.stringify(fakePayload);
    return {
      success: true,
      message: `Event #${seq} was modified. Chain verification will now detect tampering!`
    };
  }
}
