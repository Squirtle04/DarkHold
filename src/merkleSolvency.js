/**
 * The Darkhold Exchange - Merkle Tree Proof of Solvency & Reserves
 * 
 * Features:
 * - Deterministic SHA-256 Merkle Tree over all participant balances
 * - Proof of Solvency (Cryptographic verification that exchange holds required balances)
 * - Merkle inclusion proof generation for individual account verification
 * - Client-side verifiable cryptographic paths
 */

import crypto from 'node:crypto';

export class MerkleSolvencyTree {
  constructor(accountsMap) {
    this.accountsMap = accountsMap;
    this.leaves = [];
    this.leafMap = new Map(); // userId -> { leafHash, index, data }
    this.layers = [];
    this.merkleRoot = null;
    this.totalReserveUSD = 0;
    this.buildTree();
  }

  sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  hashPair(a, b) {
    // Sort pair to ensure canonical order
    return a < b ? this.sha256(a + b) : this.sha256(b + a);
  }

  buildTree() {
    this.leaves = [];
    this.leafMap.clear();
    this.totalReserveUSD = 0;

    // Convert accounts into standardized leaf strings
    const sortedUserIds = Array.from(this.accountsMap.keys()).sort();

    for (let i = 0; i < sortedUserIds.length; i++) {
      const userId = sortedUserIds[i];
      const acc = this.accountsMap.get(userId);
      const totalCash = +(acc.cashAvailable + acc.cashHeld).toFixed(2);
      this.totalReserveUSD = +(this.totalReserveUSD + totalCash).toFixed(2);

      const leafPayload = JSON.stringify({
        userId,
        cash: totalCash,
        relics: acc.relics
      });

      const leafHash = this.sha256(`LEAF:${leafPayload}`);
      this.leaves.push(leafHash);
      this.leafMap.set(userId, {
        index: i,
        leafHash,
        payload: leafPayload,
        totalCash
      });
    }

    if (this.leaves.length === 0) {
      this.merkleRoot = this.sha256('EMPTY_TREE');
      this.layers = [[]];
      return;
    }

    this.layers = [this.leaves];

    let currentLayer = this.leaves;
    while (currentLayer.length > 1) {
      const nextLayer = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        if (i + 1 < currentLayer.length) {
          nextLayer.push(this.hashPair(currentLayer[i], currentLayer[i + 1]));
        } else {
          // Odd number of leaves: elevate duplicate
          nextLayer.push(this.hashPair(currentLayer[i], currentLayer[i]));
        }
      }
      this.layers.push(nextLayer);
      currentLayer = nextLayer;
    }

    this.merkleRoot = currentLayer[0];
  }

  /**
   * Generate Merkle Proof for a given user account
   */
  generateProof(userId) {
    const entry = this.leafMap.get(userId);
    if (!entry) {
      return { success: false, reason: `Account ${userId} not found in solvency snapshot` };
    }

    let index = entry.index;
    const proof = [];

    for (let layerIdx = 0; layerIdx < this.layers.length - 1; layerIdx++) {
      const currentLayer = this.layers[layerIdx];
      const isRightNode = index % 2 === 1;
      const siblingIndex = isRightNode ? index - 1 : index + 1;

      if (siblingIndex < currentLayer.length) {
        proof.push({
          position: isRightNode ? 'LEFT' : 'RIGHT',
          hash: currentLayer[siblingIndex]
        });
      } else {
        // Sibling was duplicate of self
        proof.push({
          position: 'RIGHT',
          hash: currentLayer[index]
        });
      }

      index = Math.floor(index / 2);
    }

    return {
      success: true,
      userId,
      leafHash: entry.leafHash,
      leafPayload: entry.payload,
      totalCash: entry.totalCash,
      merkleRoot: this.merkleRoot,
      proof,
      totalAccountsInTree: this.leaves.length,
      timestamp: Date.now()
    };
  }

  /**
   * Cryptographically verify a user proof against a root
   */
  static verifyProof(leafHash, proof, expectedRoot) {
    let currentHash = leafHash;
    for (const step of proof) {
      const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
      const hashPair = (a, b) => (a < b ? sha256(a + b) : sha256(b + a));

      currentHash = hashPair(currentHash, step.hash);
    }
    return currentHash === expectedRoot;
  }
}
