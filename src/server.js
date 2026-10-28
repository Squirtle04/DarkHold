/**
 * The Darkhold Exchange - Main HTTP & WebSocket Server
 * Team: Nadaan Darinde (ID: 47)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OrderBook } from './matchingEngine.js';
import { DoubleEntryLedger } from './doubleEntryLedger.js';
import { MerkleSolvencyTree } from './merkleSolvency.js';
import { HashChainedLog } from './hashChainedLog.js';
import { AntiScalpCollar } from './antiScalpCollar.js';
import { DutchAuctionEngine } from './dutchAuction.js';
import { NativeWebSocketServer } from './wsServer.js';
import { ConcurrencyBenchmark } from './benchmark.js';
import { AuthService, UserRole } from './auth.js';
import { INSTRUMENTS, OrderSide, OrderType, EventType } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export class ExchangeServer {
  constructor(port = 3000) {
    this.port = port;

    // Core Domain Engines
    this.ledger = new DoubleEntryLedger();
    this.auditLog = new HashChainedLog();
    this.antiScalp = new AntiScalpCollar();
    this.auth = new AuthService(this.ledger, this.auditLog, this.antiScalp);
    this.dutchEngine = new DutchAuctionEngine(this.ledger);
    this.benchmarkRunner = new ConcurrencyBenchmark();

    // Order Books per instrument
    this.orderBooks = {
      'DAY1-PASS': new OrderBook('DAY1-PASS'),
      'VIP-RELIC': new OrderBook('VIP-RELIC'),
      'CHRONO-WRISTBAND': new OrderBook('CHRONO-WRISTBAND')
    };

    // Initialize mock participants & liquidity
    this.seedInitialState();

    // Rebuild Merkle Tree
    this.solvencyTree = new MerkleSolvencyTree(this.ledger.accounts);

    // Metrics
    this.metrics = {
      startTime: Date.now(),
      totalOrdersProcessed: 0,
      totalTradesExecuted: 0,
      rejectedOrders: 0,
      lastLatencyMs: 0
    };

    // Create HTTP Server
    this.httpServer = http.createServer((req, res) => this.handleHttpRequest(req, res));
    this.wsServer = new NativeWebSocketServer(this.httpServer);

    this.setupWebSocketHandlers();
    this.startBackgroundJobs();
  }

  seedInitialState() {
    // Dynamically register initial role archetypes through AuthService
    this.auth.register({
      email: 'buyer_alex@gmail.com',
      username: 'buyer_alex',
      password: 'password123',
      role: 'BUYER'
    });

    this.auth.register({
      email: 'seller_elena@gmail.com',
      username: 'seller_elena',
      password: 'password123',
      role: 'SELLER'
    });

    this.auth.register({
      email: 'trader_marcus@gmail.com',
      username: 'trader_marcus',
      password: 'password123',
      role: 'TRADER'
    });

    this.auth.register({
      email: 'collector_zane@gmail.com',
      username: 'collector_zane',
      password: 'password123',
      role: 'COLLECTOR'
    });

    this.auth.register({
      email: 'organizer@festival.io',
      username: 'organizer_official',
      password: 'password123',
      role: 'ORGANIZER'
    });

    // Seed market liquidity using registered seller and buyer accounts
    const initialBids = [
      { id: 'INIT-B1', userId: 'buyer_alex', instrumentId: 'DAY1-PASS', side: OrderSide.BUY, type: OrderType.LIMIT, price: 98.0, qty: 1 },
      { id: 'INIT-B2', userId: 'trader_marcus', instrumentId: 'DAY1-PASS', side: OrderSide.BUY, type: OrderType.LIMIT, price: 96.5, qty: 1 },
      { id: 'INIT-B3', userId: 'buyer_alex', instrumentId: 'DAY1-PASS', side: OrderSide.BUY, type: OrderType.LIMIT, price: 95.0, qty: 1 }
    ];

    const initialAsks = [
      { id: 'INIT-A1', userId: 'seller_elena', instrumentId: 'DAY1-PASS', side: OrderSide.SELL, type: OrderType.LIMIT, price: 105.0, qty: 1 },
      { id: 'INIT-A2', userId: 'organizer_official', instrumentId: 'DAY1-PASS', side: OrderSide.SELL, type: OrderType.LIMIT, price: 108.0, qty: 2 },
      { id: 'INIT-A3', userId: 'organizer_official', instrumentId: 'DAY1-PASS', side: OrderSide.SELL, type: OrderType.LIMIT, price: 115.0, qty: 3 }
    ];

    for (const o of initialBids) {
      this.ledger.reserveHold(o);
      this.orderBooks['DAY1-PASS'].processOrder(o);
      this.auditLog.append(EventType.ORDER_PLACED, o);
    }

    for (const o of initialAsks) {
      this.ledger.reserveHold(o);
      this.orderBooks['DAY1-PASS'].processOrder(o);
      this.auditLog.append(EventType.ORDER_PLACED, o);
    }

    // Seed Dutch Auction for unsold VIP Relics hosted by organizer
    this.dutchEngine.createAuction({
      instrumentId: 'VIP-RELIC',
      qty: 1,
      startPrice: 280.0,
      floorPrice: 120.0,
      durationSec: 180,
      curve: 'EXPONENTIAL',
      sellerId: 'organizer_official'
    });

    this.dutchEngine.createAuction({
      instrumentId: 'DAY1-PASS',
      qty: 2,
      startPrice: 110.0,
      floorPrice: 50.0,
      durationSec: 120,
      curve: 'LINEAR',
      sellerId: 'organizer_official'
    });
  }

  setupWebSocketHandlers() {
    this.wsServer.on('connection', (client) => {
      // Send initial welcome & snapshot
      client.send({
        type: 'SNAPSHOT',
        markets: Object.keys(this.orderBooks).map(id => this.orderBooks[id].getL2Snapshot()),
        auctions: this.dutchEngine.getActiveAuctions(),
        headHash: this.auditLog.getHead().headHash,
        solvencyRoot: this.solvencyTree.merkleRoot,
        totalReserveUSD: this.solvencyTree.totalReserveUSD
      });
    });

    this.wsServer.on('message', (client, msg) => {
      if (msg.action === 'SUBSCRIBE') {
        if (msg.market) client.subscriptions.add(msg.market);
      } else if (msg.action === 'PLACE_ORDER') {
        const result = this.handlePlaceOrder(msg.order, client.remoteAddress);
        client.send({ type: 'ORDER_RESPONSE', result });
      }
    });
  }

  startBackgroundJobs() {
    // 1. Broadcast Market Data & Dutch Auction ticks every 100ms
    setInterval(() => {
      if (this.wsServer.getClientCount() > 0) {
        const snapshots = Object.keys(this.orderBooks).map(id => this.orderBooks[id].getL2Snapshot());
        const auctions = this.dutchEngine.getActiveAuctions();

        this.wsServer.broadcast({
          type: 'TICK',
          snapshots,
          auctions,
          headHash: this.auditLog.getHead().headHash,
          timestamp: Date.now()
        });
      }
    }, 100);

    // 2. Continuous Zero-Sum Ledger Audit Job every 5 seconds
    setInterval(() => {
      const audit = this.ledger.verifyZeroSumAudit();
      if (!audit.isBalancedZeroSum) {
        console.error('🚨 AUDIT ANOMALY DETECTED:', audit.anomalies);
      }
    }, 5000);

    // 3. Periodic Merkle Tree Re-rooting every 10 seconds
    setInterval(() => {
      this.solvencyTree.buildTree();
    }, 10000);
  }

  handlePlaceOrder(orderData, clientIp = '127.0.0.1') {
    const startT = performance.now();
    this.metrics.totalOrdersProcessed++;

    const orderId = orderData.id || `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const instrumentId = orderData.instrumentId || 'DAY1-PASS';
    const book = this.orderBooks[instrumentId];

    if (!book) {
      this.metrics.rejectedOrders++;
      return { success: false, reason: `Invalid market: ${instrumentId}` };
    }

    const price = +orderData.price;
    const qty = +orderData.qty;
    const side = orderData.side;
    const type = orderData.type || OrderType.LIMIT;
    const userId = orderData.userId || 'alice_verified';

    // 1. Rate Limiting Check (Token Bucket)
    const rateCheck = this.antiScalp.checkRateLimit(userId, clientIp);
    if (!rateCheck.allowed) {
      this.metrics.rejectedOrders++;
      return { success: false, reason: rateCheck.reason };
    }

    // 2. Anti-Scalp Face-Value Price Collar Enforcement
    if (type !== OrderType.MARKET) {
      const collarCheck = this.antiScalp.validatePriceCollar(instrumentId, price);
      if (!collarCheck.valid) {
        this.metrics.rejectedOrders++;
        this.auditLog.append(EventType.ORDER_REJECTED, { orderId, reason: collarCheck.reason, price });
        return { success: false, reason: collarCheck.reason, maxAllowed: collarCheck.maxAllowedPrice };
      }
    }

    // 3. Per-Identity Quantity Accumulation Check
    if (side === OrderSide.BUY) {
      const acc = this.ledger.getAccount(userId);
      const currentHolding = acc.relics[instrumentId]?.available || 0;
      const invCheck = this.antiScalp.checkInventoryCap(userId, instrumentId, qty, currentHolding);
      if (!invCheck.allowed) {
        this.metrics.rejectedOrders++;
        return { success: false, reason: invCheck.reason };
      }
    }

    const fullOrder = {
      id: orderId,
      userId,
      instrumentId,
      side,
      type,
      price: type === OrderType.MARKET ? (side === OrderSide.BUY ? 999999 : 0.01) : price,
      qty,
      triggerPrice: orderData.triggerPrice ? +orderData.triggerPrice : null
    };

    // 4. Double-Entry Pre-trade Hold Reservation
    const holdResult = this.ledger.reserveHold(fullOrder);
    if (!holdResult.success) {
      this.metrics.rejectedOrders++;
      return { success: false, reason: holdResult.reason };
    }

    this.antiScalp.recordOrderPlacement(orderId);

    // 5. Matching Engine Processing
    const matchResult = book.processOrder(fullOrder);

    // 6. Atomic Double-Entry Settlement of all generated trades
    const executedTrades = [];
    for (const trade of matchResult.trades) {
      const settlement = this.ledger.settleTrade(trade);
      executedTrades.push({ trade, settlement });
      this.metrics.totalTradesExecuted++;

      // Append to Hash Chain
      this.auditLog.append(EventType.ORDER_MATCHED, trade);
      this.auditLog.append(EventType.LEDGER_SETTLED, settlement.journalEntry);
    }

    // Append Order Placement to Audit Log
    this.auditLog.append(EventType.ORDER_PLACED, fullOrder);

    // Refresh Solvency Tree after state change
    this.solvencyTree.buildTree();

    this.metrics.lastLatencyMs = +(performance.now() - startT).toFixed(3);

    // 7. WebSocket Push Notification & Book Delta
    const l2 = book.getL2Snapshot();
    this.wsServer.broadcast({
      type: 'BOOK_DELTA',
      instrumentId,
      l2,
      trades: matchResult.trades,
      headHash: this.auditLog.getHead().headHash
    });

    return {
      success: true,
      order: fullOrder,
      status: fullOrder.status,
      trades: matchResult.trades,
      latencyMs: this.metrics.lastLatencyMs,
      bookDelta: l2
    };
  }

  handleCancelOrder(orderId, instrumentId) {
    // 1. Anti-Spoofing Minimum Resting Time Verification
    const restingCheck = this.antiScalp.validateRestingTime(orderId);
    if (!restingCheck.allowed) {
      return { success: false, reason: restingCheck.reason };
    }

    const book = this.orderBooks[instrumentId];
    if (!book) return { success: false, reason: 'Market not found' };

    const result = book.cancelOrder(orderId);
    if (!result.success) {
      return { success: false, reason: result.reason };
    }

    // Release unexecuted hold in double-entry ledger
    this.ledger.releaseHold(result.order);

    // Log to hash chain
    this.auditLog.append(EventType.ORDER_CANCELLED, { orderId, instrumentId });

    // Broadcast update
    this.wsServer.broadcast({
      type: 'BOOK_DELTA',
      instrumentId,
      l2: book.getL2Snapshot()
    });

    return { success: true, order: result.order };
  }

  getUserOpenOrders(userId) {
    const orders = [];
    for (const [market, book] of Object.entries(this.orderBooks)) {
      for (const entry of book.orderMap.values()) {
        const o = entry.order;
        if (!userId || o.userId === userId) {
          orders.push({
            id: o.id,
            userId: o.userId,
            instrumentId: o.instrumentId || market,
            side: o.side,
            type: o.type,
            price: o.price,
            qty: o.qty,
            filledQty: o.filledQty,
            remainingQty: o.remainingQty,
            status: o.status,
            createdAt: o.createdAt
          });
        }
      }
    }
    return orders;
  }

  async handleHttpRequest(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    // CORS & Security headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Parse JSON body helper
    const readBody = () =>
      new Promise((resolve) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch {
            resolve({});
          }
        });
      });

    try {
      // REST API Routes
      if (pathname === '/api/orders' && method === 'GET') {
        const userId = parsedUrl.searchParams.get('userId');
        const orders = this.getUserOpenOrders(userId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(orders));
        return;
      }

      if (pathname === '/api/instruments' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(INSTRUMENTS));
        return;
      }

      if (pathname === '/api/orderbook' && method === 'GET') {
        const market = parsedUrl.searchParams.get('market') || 'DAY1-PASS';
        const book = this.orderBooks[market];
        if (!book) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Market not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(book.getL2Snapshot()));
        return;
      }

      if (pathname === '/api/orders' && method === 'POST') {
        const body = await readBody();
        const clientIp = req.socket.remoteAddress;
        const result = this.handlePlaceOrder(body, clientIp);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      if (pathname.startsWith('/api/orders/') && method === 'DELETE') {
        const orderId = pathname.replace('/api/orders/', '');
        const market = parsedUrl.searchParams.get('market') || 'DAY1-PASS';
        const result = this.handleCancelOrder(orderId, market);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      if (pathname === '/api/dutch-auctions' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.dutchEngine.getActiveAuctions()));
        return;
      }

      if (pathname === '/api/dutch-auctions' && method === 'POST') {
        const body = await readBody();
        const sellerId = body.sellerId || 'seller_1';
        try {
          const auction = this.dutchEngine.createAuction({
            instrumentId: body.instrumentId || 'DAY1-PASS',
            qty: Number(body.qty) || 1,
            startPrice: Number(body.startPrice) || 120,
            floorPrice: Number(body.floorPrice) || 70,
            durationSec: Number(body.durationSeconds) || 120,
            sellerId
          });
          this.auditLog.append(EventType.DUTCH_AUCTION_CREATED || 'DUTCH_AUCTION_CREATED', {
            auctionId: auction.id,
            instrumentId: auction.instrumentId,
            startPrice: auction.startPrice
          });
          this.wsServer.broadcast({
            type: 'AUCTION_UPDATE',
            auction
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, auction }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, reason: err.message }));
        }
        return;
      }

      if ((pathname === '/api/dutch-auctions/bid' || (pathname.startsWith('/api/dutch-auctions/') && pathname.endsWith('/snipe'))) && method === 'POST') {
        const body = await readBody();
        const pathParts = pathname.split('/');
        const auctionId = body.auctionId || (pathParts.length >= 4 ? pathParts[3] : null);
        const buyerId = body.buyerId || body.userId || 'buyer_alex';
        const maxPrice = Number(body.maxAcceptablePrice) || 999999;

        if (!auctionId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, reason: 'Auction ID is required' }));
          return;
        }

        const result = this.dutchEngine.acceptAuction(auctionId, buyerId, maxPrice);
        if (result.success) {
          this.auditLog.append(EventType.DUTCH_AUCTION_BID || 'DUTCH_AUCTION_BID', {
            auctionId,
            buyerId,
            price: result.executedPrice
          });
          this.wsServer.broadcast({
            type: 'DUTCH_AUCTION_SETTLED',
            auction: result.auction,
            trade: result.settlement
          });
          this.wsServer.broadcast({
            type: 'AUCTION_UPDATE',
            auction: result.auction
          });
        }
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      if (pathname === '/api/ledger' && method === 'GET') {
        const audit = this.ledger.verifyZeroSumAudit();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          audit,
          accounts: Object.fromEntries(this.ledger.accounts.entries()),
          recentJournal: this.ledger.journal.slice(-25).reverse(),
          escrows: Array.from(this.ledger.escrows.values()).slice(-10)
        }));
        return;
      }

      if ((pathname === '/api/solvency/proof' || pathname === '/api/merkle-proof') && method === 'GET') {
        const userId = parsedUrl.searchParams.get('userId') || 'buyer_alex';
        const proof = this.solvencyTree.generateProof(userId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(proof));
        return;
      }

      if (pathname === '/api/merkle-root' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ root: this.solvencyTree.merkleRoot }));
        return;
      }

      if ((pathname === '/api/audit/chain' || pathname === '/api/audit-log') && method === 'GET') {
        const head = this.auditLog.getHead();
        const recent = this.auditLog.getRecentEvents(25);
        const integrity = this.auditLog.verifyChainIntegrity();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.auditLog.events || []));
        return;
      }

      if ((pathname === '/api/audit/tamper' || pathname === '/api/tamper-simulate') && method === 'POST') {
        const body = await readBody();
        const seq = body.seq || 1;
        this.auditLog.simulateTamper(seq, { corrupt: true, message: 'Fraudulent injected ledger record' });
        const check = this.auditLog.verifyChainIntegrity();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, tamperedBlockIndex: seq, integrityCheck: check }));
        return;
      }

      if (pathname === '/api/benchmark/burst' && method === 'POST') {
        const body = await readBody();
        const count = body.orderCount || 1500;
        const market = body.market || 'DAY1-PASS';
        const results = await this.benchmarkRunner.runBurst(count, market);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(results));
        return;
      }

      if (pathname === '/api/benchmark/kill-and-replay' && method === 'POST') {
        const body = await readBody();
        const market = body.market || 'DAY1-PASS';
        const replay = this.benchmarkRunner.runKillAndReplayTest(market);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(replay));
        return;
      }

      // ==========================================
      // AUTHENTICATION & ROLE PROFILE ENDPOINTS
      // ==========================================
      if (pathname === '/api/auth/roles' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(UserRole));
        return;
      }

      if (pathname === '/api/auth/register' && method === 'POST') {
        const body = await readBody();
        const result = this.auth.register(body);
        if (result.success) {
          this.solvencyTree.buildTree();
        }
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      if (pathname === '/api/auth/login' && method === 'POST') {
        const body = await readBody();
        const result = this.auth.login(body);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      if (pathname === '/api/auth/gmail-auth' && method === 'POST') {
        const body = await readBody();
        const result = this.auth.gmailAuth(body);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      if (pathname === '/api/auth/complete-profile' && method === 'POST') {
        const body = await readBody();
        const authHeader = req.headers['authorization'] || '';
        const token = body.token || authHeader.replace('Bearer ', '').trim();
        const result = this.auth.completeProfile({ ...body, token });
        if (result.success) {
          this.solvencyTree.buildTree();
        }
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      if (pathname === '/api/auth/google-login' && method === 'POST') {
        const body = await readBody();
        const result = this.auth.googleLogin(body);
        if (result.success) {
          this.solvencyTree.buildTree();
        }
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      if (pathname === '/api/auth/me' && method === 'GET') {
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.replace('Bearer ', '').trim();
        const user = this.auth.getUserByToken(token);
        if (!user) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ authenticated: false, error: 'Unauthorized' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authenticated: true, user }));
        return;
      }

      if (pathname === '/api/auth/logout' && method === 'POST') {
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.replace('Bearer ', '').trim();
        this.auth.logout(token);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (pathname === '/api/users' && method === 'GET') {
        const userList = this.auth.getAllUsers();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(userList));
        return;
      }

      if (pathname === '/api/wallet/fund' && method === 'POST') {
        const body = await readBody();
        const userId = (body.userId || '').trim();
        const amount = Math.max(1, Number(body.amount) || 500);

        const acc = this.ledger.getAccount(userId);
        acc.cashAvailable = +(acc.cashAvailable + amount).toFixed(2);
        this.solvencyTree.buildTree();

        this.auditLog.append('WALLET_FUNDED', { userId, amount, newBalance: acc.cashAvailable });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, cashAvailable: acc.cashAvailable }));
        return;
      }

      if (pathname === '/api/wallet' && method === 'GET') {
        const userId = parsedUrl.searchParams.get('userId') || 'alice_verified';
        const acc = this.ledger.getAccount(userId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(acc));
        return;
      }

      if (pathname === '/api/stats' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ...this.metrics,
          uptimeSec: Math.floor((Date.now() - this.metrics.startTime) / 1000),
          activeWsClients: this.wsServer.getClientCount(),
          totalAuditLogEvents: this.auditLog.events.length,
          solvencyRoot: this.solvencyTree.merkleRoot,
          ledgerZeroSum: this.ledger.verifyZeroSumAudit().isBalancedZeroSum
        }));
        return;
      }

      // Static File Serving
      let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'application/javascript',
          '.json': 'application/json',
          '.png': 'image/png',
          '.svg': 'image/svg+xml'
        };
        const contentType = mimeTypes[ext] || 'text/plain';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (err) {
      console.error('Server error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  start() {
    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        console.log(`✨ The Darkhold Exchange running at http://localhost:${this.port}`);
        console.log(`⚡ WebSocket stream active at ws://localhost:${this.port}`);
        resolve(this.httpServer);
      });
    });
  }
}

// Start if executed directly
if (process.argv[1]?.includes('server.js')) {
  const server = new ExchangeServer(3000);
  server.start();
}
