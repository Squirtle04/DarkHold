# The Darkhold Exchange

> **High-Frequency Secondary Marketplace & Limit Order Book for Festival Passes & Relics**  
> **Webster 2026 • Team 47: Nadaan Darinde**  
> *Members: Adarsh Pandey (20253017), Krishna Agarwal (20253144), Aditya Negi (20253022)*

---

## 🏛️ Executive Summary & Architecture

The Darkhold Exchange eliminates predatory scalping and bot swarms on limited-edition festival passes and secondary relics using a production-grade financial market infrastructure:

1. **In-Memory Limit Order Book**: Single-threaded deterministic FIFO price-time priority supporting **Limit, Market, and Stop-Limit** orders with microsecond matching and zero lock contention.
2. **Server-Side Anti-Scalping Price Collars**: Maximum secondary resale cap tied to primary issuance face value:  
   $$\text{Max Price} = \text{Face Value} \times (1 + \text{Cap}\%)$$
   Strictly enforced on the server.
3. **Atomic Double-Entry Settlement**: Every trade records balanced debits and credits ($\sum D = \sum C$). Zero-balance anomaly detection runs continuously. Pre-trade holds reserve funds/relics before orders enter the book.
4. **Cryptographic Proof of Solvency**: Deterministic SHA-256 Merkle Tree over all account balances with on-demand Merkle inclusion proofs.
5. **Tamper-Evident Hash-Chained Audit Log**: Every event links to the previous block via SHA-256 (`hash = SHA256(prevHash + seq + timestamp + payload)`). Published head hash allows independent order verification.
6. **Dutch Auction Liquidation Engine**: Dynamic price decay with linear/exponential curves, configurable reserve price floors, and slippage protection.
7. **High-Concurrency Stress Resilience**: In-memory architecture benchmarked at **16,000+ orders/second** (exceeding the 1,000+ orders/sec target by 16x) with deterministic **Kill-and-Replay** crash recovery.

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)

### Running the Platform
1. **Launch the Server & Web Terminal:**
   ```bash
   npm start
   # Server listens at http://localhost:3000
   ```
2. **Open the Trading Terminal in your browser:**
   ```text
   http://localhost:3000
   ```

### Running Tests & Benchmarks
- **Run the automated 27-point verification suite:**
  ```bash
  npm test
  ```
- **Run the high-concurrency stress benchmark & kill-and-replay recovery test:**
  ```bash
  npm run bench
  ```

---

## 📊 Comparison Table: Original vs Implemented Action Plan

| Pillar / Component | Original Plan | Implemented Action Plan (Enhanced) |
|---|---|---|
| **Matching Engine** | FIFO price-time priority, Limit & Market orders | **FIFO price-time priority + Limit, Market, & Stop-Limit** with passive price matching & microsecond execution |
| **Market Depth & L2 Ladder** | WebSocket depth ladder & snapshots | **Batched WebSocket deltas (50–100ms) + Canvas depth curves + automatic gap detection** |
| **Anti-Scalping Defense** | Face value price caps | **Server-side dynamic price collars + token bucket velocity rate limiting + per-identity inventory limits + anti-spoofing minimum resting time (300ms)** |
| **Trade Settlement** | Double-entry ledger | **Atomic double-entry ledger ($\sum D = \sum C$) + pre-trade balance holds + multi-stage escrow lifecycle (`FUNDS_HELD` → `DELIVERED` → `CONFIRMED` → `RELEASED`)** |
| **Audit & Transparency** | Event log hash head | **Append-only SHA-256 hash chain with interactive tamper-detection validator + live head publication** |
| **Solvency Proof** | Cryptographic balance reconciliation | **Full SHA-256 Merkle Tree Proof of Solvency with client-verifiable sibling paths** |
| **Dutch Auction Engine** | Price decays over time | **Configurable reserve floor price (prevents zero-decay) + Linear/Exponential decay curves + slippage-protected instant snipe** |
| **Concurrency Resilience** | 1,000+ orders/sec target | **Achieved 16,281 orders/sec throughput (p50: 37µs, p99: 356µs) + byte-for-byte deterministic kill-and-replay crash recovery** |
| **Identity & Bot Resistance** | Turnstile challenge | **Turnstile bot challenge simulation + bot confidence scoring + wallet velocity throttling** |
