/**
 * The Darkhold Exchange - Automated Verification Test Suite
 * Team: Nadaan Darinde (ID 47)
 */

import { OrderBook } from '../src/matchingEngine.js';
import { DoubleEntryLedger } from '../src/doubleEntryLedger.js';
import { MerkleSolvencyTree } from '../src/merkleSolvency.js';
import { HashChainedLog } from '../src/hashChainedLog.js';
import { AntiScalpCollar } from '../src/antiScalpCollar.js';
import { DutchAuctionEngine } from '../src/dutchAuction.js';
import { OrderSide, OrderType, OrderStatus } from '../src/types.js';
import { AuthService } from '../src/auth.js';
import { runPropertyBasedTests } from './propertyBased.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition, testName) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${testName}`);
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log('\n🔮 Running The Darkhold Exchange Verification Suite...\n');

  // ==========================================
  // 1. IN-MEMORY MATCHING ENGINE & FIFO PRIORITY
  // ==========================================
  console.log('--- 1. Matching Engine & Price-Time FIFO ---');
  const book = new OrderBook('DAY1-PASS');

  // Place Ask (Sell) @ $100
  const ask1 = { id: 'A1', userId: 'seller_1', instrumentId: 'DAY1-PASS', side: OrderSide.SELL, type: OrderType.LIMIT, price: 100.0, qty: 2 };
  const r1 = book.processOrder(ask1);
  assert(r1.accepted.status === OrderStatus.ACCEPTED, 'Ask order placed and accepted');
  assert(book.getBestAsk() === 100.0, 'Best ask is $100.00');

  // Place Ask2 (Sell) @ $100 (FIFO priority behind A1)
  const ask2 = { id: 'A2', userId: 'seller_2', instrumentId: 'DAY1-PASS', side: OrderSide.SELL, type: OrderType.LIMIT, price: 100.0, qty: 1 };
  book.processOrder(ask2);

  // Place Buy (Bid) @ $100 for 1 qty -> must match A1 (FIFO)
  const buy1 = { id: 'B1', userId: 'buyer_1', instrumentId: 'DAY1-PASS', side: OrderSide.BUY, type: OrderType.LIMIT, price: 100.0, qty: 1 };
  const r2 = book.processOrder(buy1);
  assert(r2.trades.length === 1, 'Trade executed on crossing limit order');
  assert(r2.trades[0].sellerId === 'seller_1', 'Matched seller_1 first due to FIFO arrival priority');
  assert(r2.trades[0].price === 100.0, 'Trade executed at passive resting price $100');

  // Market Order Buy
  const marketBuy = { id: 'MB1', userId: 'buyer_2', instrumentId: 'DAY1-PASS', side: OrderSide.BUY, type: OrderType.MARKET, price: 0, qty: 1 };
  const r3 = book.processOrder(marketBuy);
  assert(r3.trades.length === 1 && r3.trades[0].sellerId === 'seller_1', 'Market order sweeps remaining A1');

  // Cancellation
  const cancelRes = book.cancelOrder('A2');
  assert(cancelRes.success === true, 'Cancellation succeeds for resting order');
  assert(book.getBestAsk() === null, 'Order book ask side is now empty');

  // ==========================================
  // 2. ANTI-SCALPING FACE-VALUE PRICE COLLARS
  // ==========================================
  console.log('\n--- 2. Anti-Scalping Price Collars ---');
  const collar = new AntiScalpCollar();

  // DAY1-PASS: Face Value $100, Cap 20% -> Max price = $120
  const legalPrice = collar.validatePriceCollar('DAY1-PASS', 115.0);
  assert(legalPrice.valid === true, 'Price $115 is within allowed 20% collar ($120 max)');

  const scalpedPrice = collar.validatePriceCollar('DAY1-PASS', 145.0);
  assert(scalpedPrice.valid === false, 'Scalped price $145 is REJECTED (exceeds $120 cap)');

  // Token Bucket Velocity Rate Limiter
  let burstAllowed = true;
  for (let i = 0; i < 35; i++) {
    const res = collar.checkRateLimit('bot_spammer');
    if (!res.allowed) {
      burstAllowed = false;
      break;
    }
  }
  assert(burstAllowed === false, 'Rate limiter throttles excessive bot order burst');

  // Anti-Spoofing Minimum Resting Time
  collar.recordOrderPlacement('ORD-FAST');
  const earlyCancel = collar.validateRestingTime('ORD-FAST');
  assert(earlyCancel.allowed === false, 'Immediate cancel (<300ms) blocked by anti-spoofing rule');

  // ==========================================
  // 3. ATOMIC DOUBLE-ENTRY SETTLEMENT
  // ==========================================
  console.log('\n--- 3. Atomic Double-Entry Settlement & Solvency ---');
  const ledger = new DoubleEntryLedger();
  ledger.initAccount('alice', 500.0, { 'DAY1-PASS': { available: 0, held: 0 } });
  ledger.initAccount('bob', 100.0, { 'DAY1-PASS': { available: 2, held: 0 } });

  // Pre-trade hold
  const buyOrder = { id: 'ORD-B10', userId: 'alice', instrumentId: 'DAY1-PASS', side: 'BUY', price: 100.0, qty: 1 };
  const holdBuy = ledger.reserveHold(buyOrder);
  assert(holdBuy.success === true, 'Buy order cash hold reserved');
  assert(ledger.getAccount('alice').cashHeld === 100.0, 'Alice cash held is $100.00');
  assert(ledger.getAccount('alice').cashAvailable === 400.0, 'Alice cash available reduced to $400.00');

  const sellOrder = { id: 'ORD-S10', userId: 'bob', instrumentId: 'DAY1-PASS', side: 'SELL', price: 100.0, qty: 1 };
  const holdSell = ledger.reserveHold(sellOrder);
  assert(holdSell.success === true, 'Sell order pass hold reserved');

  // Settle trade
  const trade = {
    id: 'TRD-TEST-1',
    instrumentId: 'DAY1-PASS',
    price: 100.0,
    qty: 1,
    buyerId: 'alice',
    sellerId: 'bob'
  };
  const settleRes = settleResCheck(ledger, trade);
  assert(settleRes.success === true, 'Trade settled atomically into journal');

  // Zero-Sum Ledger Check
  const audit = ledger.verifyZeroSumAudit();
  assert(audit.isBalancedZeroSum === true, 'Continuous audit: Total debits == Total credits (Net Delta = $0.00)');
  assert(ledger.getAccount('alice').relics['DAY1-PASS'].available === 1, 'Alice received 1 pass ownership');

  // ==========================================
  // 4. CRYPTOGRAPHIC HASH-CHAINED AUDIT LOG
  // ==========================================
  console.log('\n--- 4. Cryptographic Hash-Chained Audit Log ---');
  const hashLog = new HashChainedLog();
  hashLog.append('ORDER_PLACED', { id: 'O1', price: 100 });
  hashLog.append('ORDER_MATCHED', { tradeId: 'T1', amount: 100 });
  hashLog.append('LEDGER_SETTLED', { journalId: 'J1', checksum: 0 });

  const integrity1 = hashLog.verifyChainIntegrity();
  assert(integrity1.valid === true, 'Cryptographic hash chain verified valid from Genesis to Head');

  // Simulate malicious record tampering
  hashLog.simulateTamper(2, { tradeId: 'T1', amount: 999999 }); // Tampered!
  const integrity2 = hashLog.verifyChainIntegrity();
  assert(integrity2.valid === false, 'Tampered block detected immediately by SHA-256 cascade failure');

  // ==========================================
  // 5. MERKLE TREE PROOF OF SOLVENCY
  // ==========================================
  console.log('\n--- 5. Merkle Tree Proof of Solvency ---');
  const tree = new MerkleSolvencyTree(ledger.accounts);
  assert(tree.merkleRoot !== null && tree.merkleRoot.length === 64, 'Computed 256-bit Merkle Root');

  const proof = tree.generateProof('alice');
  assert(proof.success === true, 'Generated Merkle inclusion proof for Alice');

  const isVerified = MerkleSolvencyTree.verifyProof(proof.leafHash, proof.proof, proof.merkleRoot);
  assert(isVerified === true, 'Cryptographically verified Alice balance inclusion in Merkle root');

  // ==========================================
  // 6. DUTCH AUCTION LIQUIDATION ENGINE
  // ==========================================
  console.log('\n--- 6. Dutch Auction Liquidation Engine ---');
  const dutch = new DutchAuctionEngine(ledger);
  const auction = dutch.createAuction({
    instrumentId: 'VIP-RELIC',
    qty: 1,
    startPrice: 200.0,
    floorPrice: 50.0,
    durationSec: 60,
    curve: 'LINEAR',
    sellerId: 'festival_organizer'
  });

  const priceNow = dutch.getCurrentPrice(auction.id);
  assert(priceNow <= 200.0 && priceNow >= 50.0, 'Dutch auction price decaying within [Floor, Start]');

  // Bob snipes the auction
  ledger.initAccount('bob_sniper', 1000.0);
  const snipe = dutch.acceptAuction(auction.id, 'bob_sniper', 200.0);
  assert(snipe.success === true, 'Dutch auction sniped and settled atomically');
  assert(dutch.auctions.get(auction.id).status === 'COMPLETED', 'Auction marked COMPLETED');

  // ==========================================
  // 7. GENERATIVE PROPERTY-BASED TESTING (500 RANDOM ORDERS)
  // ==========================================
  console.log('\n--- 7. Generative Property-Based Invariant Verification ---');
  const pbt = runPropertyBasedTests(500);
  assert(pbt.invariants.relicConservation === true, 'Property: Relic quantity conservation invariant holds over 500 random orders');
  assert(pbt.invariants.zeroSumMonetaryBalance === true, 'Property: Double-entry zero-sum invariant holds over 500 random orders');
  assert(pbt.invariants.nonCrossingBook === true, 'Property: Non-crossing book invariant (Best Bid < Best Ask) holds');
  assert(pbt.invariants.nonNegativeBalances === true, 'Property: Non-negative balance invariant holds across all random accounts');
  assert(pbt.invariants.cryptographicHashChainValid === true, 'Property: SHA-256 hash-chain integrity verified for entire random sequence');

  // ==========================================
  // 8. TWO-STEP ONBOARDING (GMAIL FIRST -> PROFILE & ROLES)
  // ==========================================
  console.log('\n--- 8. Two-Step Onboarding (Gmail Auth -> Profile & Role Setup) ---');
  const authLedger = new DoubleEntryLedger();
  const authLog = new HashChainedLog();
  const authAntiScalp = new AntiScalpCollar();
  const auth = new AuthService(authLedger, authLog, authAntiScalp);

  // Step 1: Real Gmail Authentication first
  const step1Res = auth.gmailAuth({ email: 'fan.cyberpunk@gmail.com' });
  assert(step1Res.success === true, 'Step 1: Gmail authentication succeeds');
  assert(step1Res.profileCompleted === false, 'Step 1: profileCompleted is false before role selection');
  assert(typeof step1Res.token === 'string' && step1Res.token.startsWith('SES-'), 'Step 1: Session token generated for onboarding flow');

  // Verify initial wallet has $0 before role selection
  const preAccount = authLedger.getAccount(step1Res.suggestedUsername);
  assert(preAccount && preAccount.cashAvailable === 0, 'Step 1: Account initialized with zero balance prior to role selection');

  // Step 2: Build Profile and choose Role (e.g. SELLER)
  const step2Res = auth.completeProfile({
    token: step1Res.token,
    role: 'SELLER',
    username: 'neon_reseller'
  });
  assert(step2Res.success === true, 'Step 2: Profile setup completed successfully');
  assert(step2Res.user.role === 'SELLER', 'Step 2: Role assigned as SELLER');
  assert(step2Res.user.username === 'neon_reseller', 'Step 2: Custom handle saved');

  // Verify ledger provisioned dynamically with Seller perks ($500 cash + 3 Day1 + 1 VIP)
  const sellerAcc = authLedger.getAccount('neon_reseller');
  assert(sellerAcc.cashAvailable === 500, 'Step 2: Seller provisioned with $500 initial cash wallet');
  assert(sellerAcc.relics['DAY1-PASS'] && sellerAcc.relics['DAY1-PASS'].available === 3, 'Step 2: Seller provisioned with 3 DAY1-PASS tickets');
  assert(sellerAcc.relics['VIP-RELIC'] && sellerAcc.relics['VIP-RELIC'].available === 1, 'Step 2: Seller provisioned with 1 VIP-RELIC pass');

  // Subsequent login with the same Gmail account returns profileCompleted: true immediately
  const returnLogin = auth.gmailAuth({ email: 'fan.cyberpunk@gmail.com' });
  assert(returnLogin.success === true && returnLogin.profileCompleted === true, 'Returning Gmail user has profileCompleted === true');
  assert(returnLogin.user.username === 'neon_reseller' && returnLogin.user.role === 'SELLER', 'Returning user retains role and identity');

  // Final Summary
  console.log(`\n🎉 Verification Completed: ${passedTests}/${totalTests} tests passed.\n`);
}

function settleResCheck(ledger, trade) {
  try {
    return ledger.settleTrade(trade);
  } catch (e) {
    return { success: false, error: e.message };
  }
}

runTests();
