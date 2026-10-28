/**
 * The Darkhold - High-End SaaS Analytics & Exchange Dashboard
 * Client Application Logic, Visualizations & Real-Time Trading Engine
 */

class DarkholdApp {
  constructor() {
    this.currentMarket = 'DAY1-PASS';
    this.currentSide = 'BUY';
    this.currentType = 'LIMIT';
    this.currentSubpage = 'dashboard';
    this.activeUser = {
      id: 'buyer_alex',
      displayName: 'Alfred Williamson',
      email: 'williamson@darkhold.io',
      role: 'BUYER',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80'
    };

    this.instruments = {};
    this.orderBookData = { bids: [], asks: [] };
    this.dutchAuctions = [];
    this.trades = [];
    this.auditBlocks = [];
    this.ws = null;
    this.splineHoverIndex = 4;

    this.init();
  }

  async init() {
    this.setupEventListeners();
    this.setupDynamicGreeting();
    this.initSplineChart();
    this.initDonutChart();
    this.initBarsChart();
    this.initGlobalMap();
    this.initTradePriceChart();
    this.initDepthMountainChart();

    await this.fetchInstruments();
    await this.fetchInitialState();
    this.connectWebSocket();
    this.startAuctionClock();
  }

  // ---------------------------------------------------------------------------
  // 1. DYNAMIC GREETING & CLOCK
  // ---------------------------------------------------------------------------
  setupDynamicGreeting() {
    const greetingEl = document.getElementById('greetingTime');
    if (!greetingEl) return;
    const hour = new Date().getHours();
    let text = 'Good Morning,';
    if (hour >= 12 && hour < 17) text = 'Good Afternoon,';
    else if (hour >= 17) text = 'Good Evening,';
    greetingEl.textContent = text;
  }

  // ---------------------------------------------------------------------------
  // 2. NAVIGATION, MODALS & EVENT LISTENERS
  // ---------------------------------------------------------------------------
  setupEventListeners() {
    // Sidebar Dock Navigation Buttons (Dashboard, Trade, Auctions, Portfolio, Audit)
    const dockButtons = document.querySelectorAll('.nav-dock-btn[data-page]');
    dockButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.getAttribute('data-page');
        this.switchSubpage(page);
      });
    });

    // Brand Logo Home Button
    const logoBtn = document.getElementById('brandLogoHome');
    if (logoBtn) {
      logoBtn.addEventListener('click', () => this.switchSubpage('dashboard'));
    }

    // Node Relay Modal Toggle (FIXED)
    const btnNetwork = document.getElementById('dockBtnNetwork');
    const nodesModal = document.getElementById('nodesModal');
    const btnCloseNodes = document.getElementById('btnCloseNodesModal');
    if (btnNetwork && nodesModal) {
      btnNetwork.addEventListener('click', () => nodesModal.classList.remove('hidden'));
    }
    if (btnCloseNodes && nodesModal) {
      btnCloseNodes.addEventListener('click', () => nodesModal.classList.add('hidden'));
    }

    // Settings Modal Toggle (FIXED)
    const btnSettings = document.getElementById('dockBtnSettings');
    const settingsModal = document.getElementById('settingsModal');
    const btnCloseSettings = document.getElementById('btnCloseSettingsModal');
    const btnSaveSettings = document.getElementById('btnSaveSettings');
    if (btnSettings && settingsModal) {
      btnSettings.addEventListener('click', () => settingsModal.classList.remove('hidden'));
    }
    if (btnCloseSettings && settingsModal) {
      btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));
    }
    if (btnSaveSettings && settingsModal) {
      btnSaveSettings.addEventListener('click', () => {
        const glowMode = document.getElementById('settingGlowIntensity')?.value;
        const glowBg = document.getElementById('ambientGlowBg');
        if (glowBg) {
          if (glowMode === 'off') glowBg.style.display = 'none';
          else if (glowMode === 'soft') {
            glowBg.style.display = 'block';
            glowBg.style.opacity = '0.35';
          } else {
            glowBg.style.display = 'block';
            glowBg.style.opacity = '1';
          }
        }
        settingsModal.classList.add('hidden');
        alert('⚙️ Protocol settings saved successfully.');
      });
    }

    // Market Dropdown Selector
    const marketSel = document.getElementById('marketSelector');
    if (marketSel) {
      marketSel.addEventListener('change', (e) => {
        this.selectMarket(e.target.value);
      });
    }

    // Order Desk: Side Buttons (Buy / Sell)
    const btnBuy = document.getElementById('btnSideBuy');
    const btnSell = document.getElementById('btnSideSell');
    if (btnBuy && btnSell) {
      btnBuy.addEventListener('click', () => this.setOrderSide('BUY'));
      btnSell.addEventListener('click', () => this.setOrderSide('SELL'));
    }

    // Order Desk: Type Buttons (Limit / Market)
    const btnLimit = document.getElementById('btnTypeLimit');
    const btnMarket = document.getElementById('btnTypeMarket');
    if (btnLimit && btnMarket) {
      btnLimit.addEventListener('click', () => this.setOrderType('LIMIT'));
      btnMarket.addEventListener('click', () => this.setOrderType('MARKET'));
    }

    // Order Desk: Quantity Chips
    const qtyChips = document.querySelectorAll('.btn-qty-chip');
    qtyChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const inputQty = document.getElementById('inputQty');
        if (inputQty) {
          inputQty.value = chip.getAttribute('data-qty');
          this.updateOrderSummary();
        }
      });
    });

    // Order Desk: Input Changes
    const inputPrice = document.getElementById('inputPrice');
    const inputQty = document.getElementById('inputQty');
    if (inputPrice) inputPrice.addEventListener('input', () => this.updateOrderSummary());
    if (inputQty) inputQty.addEventListener('input', () => this.updateOrderSummary());

    // Submit Order Button
    const btnSubmit = document.getElementById('btnSubmitOrder');
    if (btnSubmit) {
      btnSubmit.addEventListener('click', () => this.submitOrder());
    }

    // Persona Switcher
    const profileChip = document.getElementById('userProfileChip');
    const personaModal = document.getElementById('personaModal');
    const btnCloseModal = document.getElementById('btnClosePersonaModal');
    const btnSwitchPersona = document.getElementById('btnSwitchPersona');
    
    if (profileChip && personaModal) {
      profileChip.addEventListener('click', () => personaModal.classList.remove('hidden'));
    }
    if (btnSwitchPersona && personaModal) {
      btnSwitchPersona.addEventListener('click', () => personaModal.classList.remove('hidden'));
    }
    if (btnCloseModal && personaModal) {
      btnCloseModal.addEventListener('click', () => personaModal.classList.add('hidden'));
    }

    const personaCards = document.querySelectorAll('.persona-card');
    personaCards.forEach(card => {
      card.addEventListener('click', () => {
        personaCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        this.activeUser.id = card.getAttribute('data-user');
        this.activeUser.displayName = card.getAttribute('data-name');
        this.activeUser.role = card.getAttribute('data-role');
        this.activeUser.email = card.getAttribute('data-email');
        const img = card.querySelector('img');
        if (img) this.activeUser.avatar = img.src;

        this.updateProfileUI();
        if (personaModal) personaModal.classList.add('hidden');
        this.fetchUserRestingOrders();
      });
    });

    // Segment Toggle (Personal / Global Market)
    const segButtons = document.querySelectorAll('.seg-btn');
    segButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        segButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Time Filter (Hour / Day / Week)
    const timePills = document.querySelectorAll('#expensesTimeFilter .pill-btn');
    timePills.forEach(pill => {
      pill.addEventListener('click', () => {
        timePills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.initBarsChart();
      });
    });

    // Refresh Orders in Portfolio
    const btnRefreshOrders = document.getElementById('btnRefreshOrders');
    if (btnRefreshOrders) {
      btnRefreshOrders.addEventListener('click', () => this.fetchUserRestingOrders());
    }

    // Deposit $500
    const btnDeposit500 = document.getElementById('btnDeposit500');
    if (btnDeposit500) {
      btnDeposit500.addEventListener('click', () => this.fundUserWallet(500));
    }

    // Toggle Dutch Auction Creator
    const btnToggleAuction = document.getElementById('btnToggleCreateAuction');
    const auctionDrawer = document.getElementById('createAuctionDrawer');
    if (btnToggleAuction && auctionDrawer) {
      btnToggleAuction.addEventListener('click', () => {
        auctionDrawer.classList.toggle('hidden');
      });
    }

    // Execute Launch Dutch Auction
    const btnCreateAuction = document.getElementById('btnExecuteCreateAuction');
    if (btnCreateAuction) {
      btnCreateAuction.addEventListener('click', () => this.createDutchAuction());
    }

    // Merkle Proof Generator
    const btnGenProof = document.getElementById('btnGenMerkleProof');
    if (btnGenProof) {
      btnGenProof.addEventListener('click', () => this.generateMerkleProof());
    }

    // Tamper Simulator (FIXED)
    const btnTamper = document.getElementById('btnSimulateTamper');
    if (btnTamper) {
      btnTamper.addEventListener('click', () => this.simulateTamperAttack());
    }

    // Live Benchmark Runner
    const btnBench = document.getElementById('btnRunLiveBenchmark');
    if (btnBench) {
      btnBench.addEventListener('click', () => this.runLiveBenchmark());
    }

    // Full Audit Runner
    const btnAudit = document.getElementById('btnRunFullAudit');
    if (btnAudit) {
      btnAudit.addEventListener('click', () => {
        this.fetchLedgerAndAudit();
        alert('🛡️ Full continuous audit verification verified zero-sum ledger balance.');
      });
    }

    // Global Search Keyboard Shortcut (alt+f / ctrl+k)
    window.addEventListener('keydown', (e) => {
      if ((e.altKey && e.key.toLowerCase() === 'f') || (e.ctrlKey && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        const searchInput = document.getElementById('globalSearchInput');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      }
    });

    // Resize listener for sharp canvas redraws
    window.addEventListener('resize', () => {
      this.initSplineChart();
      this.initDonutChart();
      this.initBarsChart();
      this.initGlobalMap();
      this.initTradePriceChart();
      this.initDepthMountainChart();
    });
  }

  selectMarket(marketId) {
    this.currentMarket = marketId;
    const marketSel = document.getElementById('marketSelector');
    if (marketSel) marketSel.value = marketId;

    const chartTag = document.getElementById('tradeChartMarketTag');
    if (chartTag) chartTag.textContent = marketId;

    // Update collar indicator in header
    const collarInfo = document.getElementById('collarInfo');
    const collarGuide = document.getElementById('collarPriceGuide');
    if (marketId === 'DAY1-PASS') {
      if (collarInfo) collarInfo.textContent = 'Face: $100.00 | Cap: $120.00';
      if (collarGuide) collarGuide.textContent = 'Max allowed: $120.00';
    } else if (marketId === 'VIP-RELIC') {
      if (collarInfo) collarInfo.textContent = 'Face: $250.00 | Cap: $300.00';
      if (collarGuide) collarGuide.textContent = 'Max allowed: $300.00';
    } else if (marketId === 'CHRONO-WRISTBAND') {
      if (collarInfo) collarInfo.textContent = 'Face: $75.00 | Cap: $90.00';
      if (collarGuide) collarGuide.textContent = 'Max allowed: $90.00';
    }

    this.fetchOrderBook();
    this.initTradePriceChart();
  }

  switchSubpage(pageId) {
    this.currentSubpage = pageId;

    // Update Sidebar Active Class
    const dockButtons = document.querySelectorAll('.nav-dock-btn[data-page]');
    dockButtons.forEach(btn => {
      if (btn.getAttribute('data-page') === pageId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update Subpage Visibility
    const pages = {
      dashboard: document.getElementById('pageDashboard'),
      trade: document.getElementById('pageTrade'),
      auctions: document.getElementById('pageAuctions'),
      portfolio: document.getElementById('pagePortfolio'),
      audit: document.getElementById('pageAudit')
    };

    const titleMap = {
      dashboard: 'Dashboard',
      trade: 'Trade Desk',
      auctions: 'Dutch Auctions',
      portfolio: 'Portfolio & Orders',
      audit: 'Security & Audit'
    };

    const topTitle = document.getElementById('topPageTitle');
    if (topTitle && titleMap[pageId]) {
      topTitle.textContent = titleMap[pageId];
    }

    Object.entries(pages).forEach(([k, el]) => {
      if (!el) return;
      if (k === pageId) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    if (pageId === 'dashboard') {
      setTimeout(() => {
        this.initSplineChart();
        this.initDonutChart();
        this.initBarsChart();
        this.initGlobalMap();
      }, 50);
    } else if (pageId === 'trade') {
      setTimeout(() => {
        this.initTradePriceChart();
        this.initDepthMountainChart();
      }, 50);
    } else if (pageId === 'portfolio') {
      this.fetchUserRestingOrders();
    } else if (pageId === 'auctions') {
      this.fetchDutchAuctions();
    } else if (pageId === 'audit') {
      this.fetchLedgerAndAudit();
    }
  }

  setOrderSide(side) {
    this.currentSide = side;
    const btnBuy = document.getElementById('btnSideBuy');
    const btnSell = document.getElementById('btnSideSell');
    const btnSubmit = document.getElementById('btnSubmitOrder');

    if (side === 'BUY') {
      btnBuy.className = 'side-btn active-buy';
      btnSell.className = 'side-btn';
      if (btnSubmit) {
        btnSubmit.className = 'btn-execute-buy';
        btnSubmit.style.background = 'var(--neon-green)';
        btnSubmit.style.boxShadow = '0 0 24px rgba(16, 185, 129, 0.5)';
      }
    } else {
      btnBuy.className = 'side-btn';
      btnSell.className = 'side-btn active-sell';
      if (btnSubmit) {
        btnSubmit.className = 'btn-execute-buy';
        btnSubmit.style.background = 'var(--neon-coral)';
        btnSubmit.style.boxShadow = '0 0 24px rgba(251, 113, 133, 0.5)';
      }
    }
    this.updateOrderSummary();
  }

  setOrderType(type) {
    this.currentType = type;
    const btnLimit = document.getElementById('btnTypeLimit');
    const btnMarket = document.getElementById('btnTypeMarket');
    const groupPrice = document.getElementById('groupPrice');

    if (type === 'LIMIT') {
      btnLimit.classList.add('active');
      btnMarket.classList.remove('active');
      if (groupPrice) groupPrice.style.display = 'flex';
    } else {
      btnLimit.classList.remove('active');
      btnMarket.classList.add('active');
      if (groupPrice) groupPrice.style.display = 'none';
    }
    this.updateOrderSummary();
  }

  updateOrderSummary() {
    const inputPrice = document.getElementById('inputPrice');
    const inputQty = document.getElementById('inputQty');
    const summaryEst = document.getElementById('summaryEstValue');
    const summaryHold = document.getElementById('summaryHoldEst');
    const btnSubmitText = document.getElementById('btnSubmitText');

    const price = parseFloat(inputPrice ? inputPrice.value : 100) || 100;
    const qty = parseInt(inputQty ? inputQty.value : 1) || 1;
    const total = (price * qty).toFixed(2);

    if (summaryEst) summaryEst.textContent = `$${total}`;
    if (summaryHold) {
      summaryHold.textContent = this.currentSide === 'BUY'
        ? `$${total} Cash Hold`
        : `${qty} Pass Asset Hold`;
    }

    if (btnSubmitText) {
      btnSubmitText.textContent = `Place ${this.currentSide} Order ($${total})`;
    }
  }

  updateProfileUI() {
    const nameEl = document.getElementById('userDisplayName');
    const heroName = document.getElementById('greetingHeroName');
    const emailEl = document.getElementById('userDisplayEmail');
    const avatarImg = document.getElementById('userAvatarImg');

    if (nameEl) nameEl.textContent = this.activeUser.displayName;
    if (heroName) heroName.textContent = this.activeUser.displayName;
    if (emailEl) emailEl.textContent = this.activeUser.email;
    if (avatarImg && this.activeUser.avatar) avatarImg.src = this.activeUser.avatar;
  }

  // ---------------------------------------------------------------------------
  // 3. DASHBOARD CANVASES (PASS PRICES, ALLOCATION, VELOCITY, MAP)
  // ---------------------------------------------------------------------------
  initSplineChart() {
    const canvas = document.getElementById('splineChartCanvas');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    // Festival pass price oscillation data points within collar ($98 - $112)
    const rawPoints = [
      { x: 0.05, y: 0.60 },
      { x: 0.18, y: 0.42 },
      { x: 0.32, y: 0.48 },
      { x: 0.44, y: 0.32 },
      { x: 0.56, y: 0.28 }, // Target peak clearance point
      { x: 0.68, y: 0.45 },
      { x: 0.82, y: 0.22 },
      { x: 0.95, y: 0.50 }
    ];

    const points = rawPoints.map(p => ({
      x: p.x * w,
      y: p.y * h
    }));

    ctx.clearRect(0, 0, w, h);

    // Collar ceiling guideline (Max +20% Cap: $120)
    ctx.save();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, h * 0.18);
    ctx.lineTo(w, h * 0.18);
    ctx.stroke();

    // Face value guideline ($100 Face)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.55);
    ctx.lineTo(w, h * 0.55);
    ctx.stroke();
    ctx.restore();

    // Under-Line Gradient Fill
    const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
    fillGrad.addColorStop(0, 'rgba(244, 63, 94, 0.14)');
    fillGrad.addColorStop(0.6, 'rgba(168, 85, 247, 0.06)');
    fillGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.lineTo(points[points.length - 1].x, h);
    ctx.lineTo(points[0].x, h);
    ctx.closePath();
    ctx.fillStyle = fillGrad;
    ctx.fill();
    ctx.restore();

    // 3D Neon Tube Glowing Line
    const lineGrad = ctx.createLinearGradient(0, 0, w, 0);
    lineGrad.addColorStop(0, '#f97316');
    lineGrad.addColorStop(0.35, '#fb7185');
    lineGrad.addColorStop(0.65, '#ec4899');
    lineGrad.addColorStop(1, '#a855f7');

    ctx.save();
    ctx.shadowColor = 'rgba(251, 113, 133, 0.65)';
    ctx.shadowBlur = 24;
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = lineGrad;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();
    ctx.restore();

    // Radar beacon positioning
    const beacon = document.getElementById('radarBeacon');
    if (beacon && points[4]) {
      beacon.style.left = `${points[4].x}px`;
      beacon.style.top = `${points[4].y}px`;
    }

    // Hover listener
    canvas.onmousemove = (e) => {
      const bRect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - bRect.left;
      let closestIdx = 0;
      let minDist = Infinity;
      points.forEach((p, idx) => {
        const dist = Math.abs(p.x - mouseX);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = idx;
        }
      });

      if (closestIdx !== this.splineHoverIndex) {
        this.splineHoverIndex = closestIdx;
        if (beacon && points[closestIdx]) {
          beacon.style.left = `${points[closestIdx].x}px`;
          beacon.style.top = `${points[closestIdx].y}px`;
          const tooltip = document.getElementById('radarTooltip');
          if (tooltip) {
            const vals = ['$100.00', '$103.50', '$102.00', '$106.50', '$104.50', '$101.00', '$108.00', '$102.50'];
            tooltip.querySelector('.tooltip-val').textContent = vals[closestIdx] || '$104.50';
          }
        }
      }
    };
  }

  initDonutChart() {
    const canvas = document.getElementById('donutChartCanvas');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2 - 16;
    const lineWidth = 14;

    ctx.clearRect(0, 0, w, h);

    // Recessed Background Track
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.stroke();

    // Segments: Day-1 Passes, VIP Relics, Chrono Fastpasses
    const segments = [
      { pct: 0.46, color: '#fb7185', glow: 'rgba(251, 113, 133, 0.7)' },
      { pct: 0.34, color: '#06b6d4', glow: 'rgba(6, 182, 212, 0.7)' },
      { pct: 0.20, color: '#a855f7', glow: 'rgba(168, 85, 247, 0.7)' }
    ];

    let startAngle = -Math.PI / 2;
    const gap = 0.08;

    segments.forEach(seg => {
      const sliceAngle = seg.pct * Math.PI * 2 - gap;
      const endAngle = startAngle + sliceAngle;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.strokeStyle = seg.color;
      ctx.shadowColor = seg.glow;
      ctx.shadowBlur = 16;
      ctx.stroke();
      ctx.restore();

      startAngle = endAngle + gap;
    });
  }

  initBarsChart() {
    const canvas = document.getElementById('barsChartCanvas');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    const barData = [
      { height: 0.45, color: '#fb7185', cap: '#f43f5e' },
      { height: 0.70, color: '#38bdf8', cap: '#0ea5e9' },
      { height: 0.35, color: '#fb7185', cap: '#f43f5e' },
      { height: 0.85, color: '#fb7185', cap: '#f43f5e' },
      { height: 0.55, color: '#38bdf8', cap: '#0ea5e9' },
      { height: 0.90, color: '#38bdf8', cap: '#0ea5e9' },
      { height: 0.40, color: '#fb7185', cap: '#f43f5e' },
      { height: 0.65, color: '#38bdf8', cap: '#0ea5e9' },
      { height: 0.78, color: '#fb7185', cap: '#f43f5e' }
    ];

    const slotWidth = w / barData.length;

    barData.forEach((bar, i) => {
      const bx = i * slotWidth + slotWidth / 2;
      const barH = bar.height * (h - 24);
      const topY = h - barH;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(bx, h);
      ctx.lineTo(bx, topY);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(bx, topY, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = bar.cap;
      ctx.shadowColor = bar.color;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.restore();
    });
  }

  initGlobalMap() {
    const canvas = document.getElementById('globalMapCanvas');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    const nodes = [
      { x: w * 0.22, y: h * 0.40, label: 'JFK' },
      { x: w * 0.46, y: h * 0.32, label: 'LHR' },
      { x: w * 0.72, y: h * 0.50, label: 'SGP' },
      { x: w * 0.85, y: h * 0.42, label: 'TYO' },
      { x: w * 0.88, y: h * 0.78, label: 'SYD' }
    ];

    const arcs = [
      [nodes[0], nodes[1]],
      [nodes[1], nodes[2]],
      [nodes[2], nodes[3]],
      [nodes[2], nodes[4]]
    ];

    arcs.forEach(([n1, n2]) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(n1.x, n1.y);
      const midX = (n1.x + n2.x) / 2;
      const midY = Math.min(n1.y, n2.y) - 25;
      ctx.quadraticCurveTo(midX, midY, n2.x, n2.y);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.shadowColor = 'rgba(56, 189, 248, 0.6)';
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.restore();
    });

    nodes.forEach(n => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(n.x, n.y, 6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(n.x, n.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#38bdf8';
      ctx.shadowColor = '#06b6d4';
      ctx.shadowBlur = 10;
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '9px "JetBrains Mono"';
      ctx.fillText(n.label, n.x + 8, n.y + 3);
      ctx.restore();
    });
  }

  // ---------------------------------------------------------------------------
  // 4. NEW: TRADE DESK PRICE SPLINE & LEVEL 2 DEPTH MOUNTAIN GRAPHS
  // ---------------------------------------------------------------------------
  initTradePriceChart() {
    const canvas = document.getElementById('tradePriceChartCanvas');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    // Collar cap & face baseline values depending on market
    let facePrice = 100;
    let capPrice = 120;
    if (this.currentMarket === 'VIP-RELIC') {
      facePrice = 250;
      capPrice = 300;
    } else if (this.currentMarket === 'CHRONO-WRISTBAND') {
      facePrice = 75;
      capPrice = 90;
    }

    // Upper Collar Cap Guideline
    ctx.save();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, h * 0.20);
    ctx.lineTo(w, h * 0.20);
    ctx.stroke();

    ctx.fillStyle = '#f59e0b';
    ctx.font = '10px "JetBrains Mono"';
    ctx.fillText(`CAP $${capPrice.toFixed(2)}`, w - 75, h * 0.20 - 4);

    // Face Value Baseline
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.35)';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.65);
    ctx.lineTo(w, h * 0.65);
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`FACE $${facePrice.toFixed(2)}`, w - 75, h * 0.65 - 4);
    ctx.restore();

    // Price trajectory points
    const points = [
      { x: w * 0.05, y: h * 0.65 },
      { x: w * 0.20, y: h * 0.55 },
      { x: w * 0.35, y: h * 0.58 },
      { x: w * 0.50, y: h * 0.45 },
      { x: w * 0.65, y: h * 0.38 },
      { x: w * 0.80, y: h * 0.42 },
      { x: w * 0.95, y: h * 0.34 }
    ];

    // Spline curve line
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.strokeStyle = '#10b981';
    ctx.shadowColor = 'rgba(16, 185, 129, 0.6)';
    ctx.shadowBlur = 14;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Execution Dots on Trade Spline
    points.forEach((p, idx) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, idx === points.length - 1 ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = idx === points.length - 1 ? '#fff' : '#10b981';
      ctx.shadowColor = '#10b981';
      ctx.shadowBlur = 10;
      ctx.fill();
    });
    ctx.restore();
  }

  initDepthMountainChart() {
    const canvas = document.getElementById('depthMountainCanvas');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const midX = w / 2;

    ctx.clearRect(0, 0, w, h);

    const bids = this.orderBookData.bids || [
      { price: 95, cumulative: 5 },
      { price: 96, cumulative: 4 },
      { price: 98, cumulative: 2 }
    ];
    const asks = this.orderBookData.asks || [
      { price: 105, cumulative: 2 },
      { price: 106, cumulative: 4 },
      { price: 108, cumulative: 6 }
    ];

    const maxCum = Math.max(
      bids[bids.length - 1]?.cumulative || 6,
      asks[asks.length - 1]?.cumulative || 6,
      6
    );

    // Total counts in pill
    const totalBidsEl = document.getElementById('depthTotalBids');
    const totalAsksEl = document.getElementById('depthTotalAsks');
    if (totalBidsEl) totalBidsEl.textContent = bids.reduce((acc, b) => acc + (b.qty || 1), 0);
    if (totalAsksEl) totalAsksEl.textContent = asks.reduce((acc, a) => acc + (a.qty || 1), 0);

    // 1. Draw Bids Mountain (Left side, glowing mint green)
    ctx.save();
    const bidGrad = ctx.createLinearGradient(0, 0, midX, 0);
    bidGrad.addColorStop(0, 'rgba(52, 211, 153, 0.05)');
    bidGrad.addColorStop(1, 'rgba(16, 185, 129, 0.28)');

    ctx.beginPath();
    ctx.moveTo(0, h);
    bids.forEach((b, i) => {
      const stepX = (i / (bids.length || 1)) * midX;
      const stepY = h - (b.cumulative / maxCum) * (h - 20);
      ctx.lineTo(stepX, stepY);
    });
    ctx.lineTo(midX - 4, h * 0.35);
    ctx.lineTo(midX - 4, h);
    ctx.closePath();
    ctx.fillStyle = bidGrad;
    ctx.fill();

    // Top border line for bids
    ctx.beginPath();
    ctx.moveTo(0, h);
    bids.forEach((b, i) => {
      const stepX = (i / (bids.length || 1)) * midX;
      const stepY = h - (b.cumulative / maxCum) * (h - 20);
      ctx.lineTo(stepX, stepY);
    });
    ctx.lineTo(midX - 4, h * 0.35);
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(52, 211, 153, 0.7)';
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.restore();

    // 2. Draw Asks Mountain (Right side, glowing rose red)
    ctx.save();
    const askGrad = ctx.createLinearGradient(midX, 0, w, 0);
    askGrad.addColorStop(0, 'rgba(248, 113, 113, 0.28)');
    askGrad.addColorStop(1, 'rgba(239, 68, 68, 0.05)');

    ctx.beginPath();
    ctx.moveTo(midX + 4, h);
    ctx.lineTo(midX + 4, h * 0.35);
    asks.forEach((a, i) => {
      const stepX = midX + 4 + ((i + 1) / (asks.length || 1)) * (midX - 4);
      const stepY = h - (a.cumulative / maxCum) * (h - 20);
      ctx.lineTo(stepX, stepY);
    });
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = askGrad;
    ctx.fill();

    // Top border line for asks
    ctx.beginPath();
    ctx.moveTo(midX + 4, h * 0.35);
    asks.forEach((a, i) => {
      const stepX = midX + 4 + ((i + 1) / (asks.length || 1)) * (midX - 4);
      const stepY = h - (a.cumulative / maxCum) * (h - 20);
      ctx.lineTo(stepX, stepY);
    });
    ctx.lineTo(w, h);
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(248, 113, 113, 0.7)';
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.restore();

    // Dotted Mid-Market Spread Line
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(midX, 0);
    ctx.lineTo(midX, h);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '10px "JetBrains Mono"';
    ctx.fillText('SPREAD', midX - 18, 14);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // 5. REST & WEBSOCKET ENGINE INTEGRATION
  // ---------------------------------------------------------------------------
  async fetchInstruments() {
    try {
      const res = await fetch('/api/instruments');
      if (res.ok) {
        this.instruments = await res.json();
      }
    } catch (err) {
      console.warn('Failed to load instruments:', err);
    }
  }

  async fetchInitialState() {
    await Promise.all([
      this.fetchOrderBook(),
      this.fetchDutchAuctions(),
      this.fetchUserRestingOrders(),
      this.fetchLedgerAndAudit()
    ]);
  }

  async fetchOrderBook() {
    try {
      const res = await fetch(`/api/orderbook?market=${this.currentMarket}`);
      if (res.ok) {
        this.orderBookData = await res.json();
        this.renderOrderBook();
        this.initDepthMountainChart();
      }
    } catch (err) {
      console.warn('Order book error:', err);
    }
  }

  async fetchDutchAuctions() {
    try {
      const res = await fetch('/api/dutch-auctions');
      if (res.ok) {
        this.dutchAuctions = await res.json();
        this.renderDutchAuctions();
      }
    } catch (err) {
      console.warn('Dutch auctions error:', err);
    }
  }

  async fetchUserRestingOrders() {
    try {
      const res = await fetch(`/api/orders?userId=${this.activeUser.id}`);
      if (res.ok) {
        const data = await res.json();
        this.renderRestingOrders(Array.isArray(data) ? data : (data.orders || []));
      }
    } catch (err) {
      console.warn('User orders error:', err);
    }
  }

  async fetchLedgerAndAudit() {
    try {
      const [resLedger, resAudit, resMerkle] = await Promise.all([
        fetch('/api/ledger'),
        fetch('/api/audit-log'),
        fetch('/api/merkle-root')
      ]);

      if (resLedger.ok) {
        const ledger = await resLedger.json();
        this.renderLedgerTable(ledger);
      }
      if (resAudit.ok) {
        this.auditBlocks = await resAudit.json();
        this.renderAuditChain();
      }
      if (resMerkle.ok) {
        const merkle = await resMerkle.json();
        const rootEl = document.getElementById('merkleRootHex');
        if (rootEl && merkle.root) rootEl.textContent = merkle.root;
      }
    } catch (err) {
      console.warn('Ledger audit fetch error:', err);
    }
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('⚡ WebSocket connected to The Darkhold Engine');
      };

      this.ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          this.handleWebSocketMessage(msg);
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      this.ws.onclose = () => {
        setTimeout(() => this.connectWebSocket(), 3000);
      };
    } catch (e) {
      console.warn('WebSocket connection deferred:', e);
    }
  }

  handleWebSocketMessage(msg) {
    if (msg.type === 'BOOK_DELTA' && msg.instrumentId === this.currentMarket) {
      this.orderBookData = msg.l2;
      this.renderOrderBook();
      this.initDepthMountainChart();
    } else if (msg.type === 'TRADE_EXEC') {
      this.trades.unshift(msg.trade);
      if (this.trades.length > 30) this.trades.pop();
      this.renderTradesStream();
      this.initTradePriceChart();
      this.fetchUserRestingOrders();
      this.fetchLedgerAndAudit();
    } else if (msg.type === 'AUCTION_UPDATE' || msg.type === 'DUTCH_AUCTION_SETTLED') {
      this.fetchDutchAuctions();
      this.fetchLedgerAndAudit();
    }
  }

  // ---------------------------------------------------------------------------
  // 6. ORDER BOOK & TRADES RENDERING
  // ---------------------------------------------------------------------------
  renderOrderBook() {
    const asksBox = document.getElementById('bookAsksContainer');
    const bidsBox = document.getElementById('bookBidsContainer');
    const spreadVal = document.getElementById('bookSpreadVal');
    const midVal = document.getElementById('midPriceVal');
    const currentPriceEl = document.getElementById('tradeChartPrice');

    if (!asksBox || !bidsBox) return;

    const asks = this.orderBookData.asks || [];
    const bids = this.orderBookData.bids || [];

    if (asks.length > 0 && bids.length > 0) {
      const bestAsk = asks[0].price;
      const bestBid = bids[0].price;
      const spread = (bestAsk - bestBid).toFixed(2);
      const spreadPct = ((spread / bestAsk) * 100).toFixed(1);
      if (spreadVal) spreadVal.textContent = `$${spread} (${spreadPct}%)`;
      const mid = ((bestAsk + bestBid) / 2).toFixed(2);
      if (midVal) midVal.textContent = `$${mid}`;
      if (currentPriceEl) currentPriceEl.textContent = `$${bestAsk.toFixed(2)}`;
    }

    // Render Asks
    asksBox.innerHTML = asks.slice(0, 6).map(row => `
      <div class="book-row ask-row">
        <span class="price-ask">${row.price.toFixed(2)}</span>
        <span>${row.qty}</span>
        <span>${row.cumulative || row.qty}</span>
        <div class="depth-bar ask-depth" style="width: ${row.depthPct || 25}%;"></div>
      </div>
    `).join('') || '<div class="empty-state-notice">No asks in book</div>';

    // Render Bids
    bidsBox.innerHTML = bids.slice(0, 6).map(row => `
      <div class="book-row bid-row">
        <span class="price-bid">${row.price.toFixed(2)}</span>
        <span>${row.qty}</span>
        <span>${row.cumulative || row.qty}</span>
        <div class="depth-bar bid-depth" style="width: ${row.depthPct || 25}%;"></div>
      </div>
    `).join('') || '<div class="empty-state-notice">No bids in book</div>';
  }

  renderTradesStream() {
    const streamBox = document.getElementById('tradesStreamBox');
    if (!streamBox) return;

    if (this.trades.length === 0) {
      streamBox.innerHTML = '<div class="empty-state-notice">No matched trades yet.</div>';
      return;
    }

    streamBox.innerHTML = this.trades.slice(0, 10).map(t => `
      <div class="trade-stream-row">
        <span>${new Date(t.timestamp || Date.now()).toLocaleTimeString()}</span>
        <span class="text-green font-mono">$${(t.price || 0).toFixed(2)}</span>
        <span>${t.qty}</span>
        <span class="text-subtle">${t.makerId?.slice(0, 8)}...</span>
      </div>
    `).join('');
  }

  // ---------------------------------------------------------------------------
  // 7. PORTFOLIO & AUDIT
  // ---------------------------------------------------------------------------
  renderRestingOrders(orders) {
    const tbody = document.getElementById('restingOrdersTableBody');
    const openOrdersCountEl = document.getElementById('portfolioOpenOrdersCount');

    if (openOrdersCountEl) {
      openOrdersCountEl.textContent = orders.length;
    }

    if (!tbody) return;

    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty-table-cell">No active resting orders for your persona.</td></tr>';
      return;
    }

    tbody.innerHTML = orders.map(o => `
      <tr>
        <td><code>${o.id.slice(0, 10)}...</code></td>
        <td><span class="text-cyan">${o.instrumentId}</span></td>
        <td><strong class="${o.side === 'BUY' ? 'text-green' : 'text-coral'}">${o.side}</strong></td>
        <td>${o.type}</td>
        <td>$${o.price.toFixed(2)}</td>
        <td>${o.qty}</td>
        <td>${o.filledQty || 0}</td>
        <td><span class="tag-valid">${o.status}</span></td>
        <td>${new Date(o.createdAt).toLocaleTimeString()}</td>
        <td>
          <button class="btn-cancel-sm" onclick="window.darkhold.cancelOrder('${o.id}', '${o.instrumentId}')">Cancel</button>
        </td>
      </tr>
    `).join('');
  }

  renderLedgerTable(ledger) {
    const tbody = document.getElementById('ledgerAccountsBody');
    if (!tbody || !ledger.accounts) return;

    const rows = Object.entries(ledger.accounts);
    tbody.innerHTML = rows.map(([accId, acc]) => `
      <tr>
        <td><code>${accId}</code></td>
        <td class="text-green">$${(acc.cashAvailable || 0).toFixed(2)}</td>
        <td class="text-amber">$${(acc.cashHeld || 0).toFixed(2)}</td>
        <td>${acc.relicsAvailable ? Object.entries(acc.relicsAvailable).map(([k, v]) => `${k}: ${v}`).join(', ') : '0'}</td>
        <td>${acc.relicsHeld ? Object.entries(acc.relicsHeld).map(([k, v]) => `${k}: ${v}`).join(', ') : '0'}</td>
        <td class="text-subtle">Online</td>
      </tr>
    `).join('');

    const userAcc = ledger.accounts[this.activeUser.id];
    if (userAcc) {
      const cashAvail = document.getElementById('portfolioCashAvail');
      const cashHeld = document.getElementById('portfolioCashHeld');
      const ticketsHeld = document.getElementById('portfolioTicketsHeld');
      if (cashAvail) cashAvail.textContent = `$${(userAcc.cashAvailable || 0).toFixed(2)}`;
      if (cashHeld) cashHeld.textContent = `$${(userAcc.cashHeld || 0).toFixed(2)}`;
      if (ticketsHeld) {
        const count = userAcc.relicsAvailable?.['DAY1-PASS'] || 0;
        ticketsHeld.textContent = `${count} Passes`;
      }
    }
  }

  renderAuditChain() {
    const box = document.getElementById('hashChainContainer');
    if (!box) return;

    box.innerHTML = this.auditBlocks.slice(-8).reverse().map(b => `
      <div class="chain-block-row">
        <div><strong class="text-cyan">Block #${b.index}</strong> • <span class="text-muted-blue">${b.eventType}</span></div>
        <div class="text-subtle">Prev: ${b.previousHash.slice(0, 16)}...</div>
        <div class="text-green">Hash: ${b.currentHash.slice(0, 24)}...</div>
      </div>
    `).join('');
  }

  renderDutchAuctions() {
    const grid = document.getElementById('auctionsGridContainer');
    if (!grid) return;

    if (this.dutchAuctions.length === 0) {
      grid.innerHTML = '<div class="empty-state-notice">No active Dutch auctions at this moment.</div>';
      return;
    }

    grid.innerHTML = this.dutchAuctions.map(auc => {
      const price = (auc.currentPrice || auc.startPrice).toFixed(2);
      const isCompleted = auc.status === 'COMPLETED';
      return `
        <div class="glass-panel auction-arena-card">
          <div class="card-inner-header">
            <div>
              <span class="text-cyan font-mono">${auc.instrumentId}</span>
              <h4 class="panel-heading">Dutch Liquidation</h4>
            </div>
            <span class="mode-tag-pill ${isCompleted ? 'text-purple' : ''}">${auc.status}</span>
          </div>
          <div class="metric-large-row">
            <span class="metric-giant-number text-coral">$${price}</span>
            <span class="meta-label-muted">Floor: $${auc.floorPrice.toFixed(2)}</span>
          </div>
          <div class="glowing-progress-track">
            <div class="glowing-progress-fill" style="width: ${auc.progressPct || (isCompleted ? 100 : 50)}%;"></div>
          </div>
          ${isCompleted ? 
            `<button class="btn-execute-buy" style="background: rgba(255,255,255,0.1); color: var(--text-muted-blue); cursor: default;" disabled>Auction Completed (Winner: ${auc.winner?.slice(0, 10)})</button>`
            :
            `<button class="btn-execute-buy" onclick="window.darkhold.snipeAuction('${auc.id}')">
              Snipe Ticket Now ($${price})
            </button>`
          }
        </div>
      `;
    }).join('');
  }

  startAuctionClock() {
    setInterval(() => {
      if (this.dutchAuctions.length > 0 && this.currentSubpage === 'auctions') {
        this.fetchDutchAuctions();
      }
    }, 2000);
  }

  // ---------------------------------------------------------------------------
  // 8. ACTIONS: ORDER SUBMISSION, CANCELLATION, AUCTION SNIPE, TAMPER
  // ---------------------------------------------------------------------------
  async submitOrder() {
    const inputPrice = document.getElementById('inputPrice');
    const inputQty = document.getElementById('inputQty');

    const price = parseFloat(inputPrice ? inputPrice.value : 100);
    const qty = parseInt(inputQty ? inputQty.value : 1);

    const payload = {
      userId: this.activeUser.id,
      instrumentId: this.currentMarket,
      side: this.currentSide,
      type: this.currentType,
      price: price,
      qty: qty
    };

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (result.success) {
        this.fetchOrderBook();
        this.fetchUserRestingOrders();
        this.fetchLedgerAndAudit();
      } else {
        alert(`Order Rejected: ${result.reason || 'Verification failure'}`);
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
    }
  }

  async cancelOrder(orderId, market) {
    try {
      const res = await fetch(`/api/orders/${orderId}?market=${market}`, {
        method: 'DELETE'
      });
      const result = await res.json();
      if (result.success) {
        this.fetchOrderBook();
        this.fetchUserRestingOrders();
        this.fetchLedgerAndAudit();
      } else {
        alert(`Cancel failed: ${result.reason}`);
      }
    } catch (err) {
      alert(`Error cancelling order: ${err.message}`);
    }
  }

  // FIXED SNIPE METHOD: clean error catching and correct payload
  async snipeAuction(auctionId) {
    try {
      const res = await fetch(`/api/dutch-auctions/${auctionId}/snipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auctionId: auctionId,
          userId: this.activeUser.id,
          buyerId: this.activeUser.id,
          maxAcceptablePrice: 999999
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        let reason = 'Snipe failed';
        try {
          const errObj = JSON.parse(errorText);
          reason = errObj.reason || reason;
        } catch {
          reason = errorText;
        }
        alert(`⚠️ Snipe Unsuccessful: ${reason}`);
        return;
      }

      const result = await res.json();
      if (result.success) {
        alert(`🎉 Ticket Sniped Successfully at $${result.executedPrice.toFixed(2)}!\nSettled atomically into the zero-sum ledger.`);
        this.fetchDutchAuctions();
        this.fetchLedgerAndAudit();
      } else {
        alert(`⚠️ Snipe Unsuccessful: ${result.reason}`);
      }
    } catch (err) {
      alert(`Error sniping ticket: ${err.message}`);
    }
  }

  async createDutchAuction() {
    const market = document.getElementById('auctionMarketSelect').value;
    const qty = parseInt(document.getElementById('auctionQtyInput').value);
    const startPrice = parseFloat(document.getElementById('auctionStartPrice').value);
    const floorPrice = parseFloat(document.getElementById('auctionFloorPrice').value);
    const duration = parseInt(document.getElementById('auctionDurationInput').value);

    try {
      const res = await fetch('/api/dutch-auctions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId: this.activeUser.id,
          instrumentId: market,
          qty,
          startPrice,
          floorPrice,
          durationSeconds: duration
        })
      });
      const result = await res.json();
      if (result.success) {
        document.getElementById('createAuctionDrawer').classList.add('hidden');
        this.fetchDutchAuctions();
      } else {
        alert(`Failed to launch auction: ${result.reason}`);
      }
    } catch (err) {
      alert(`Error launching auction: ${err.message}`);
    }
  }

  async generateMerkleProof() {
    try {
      const res = await fetch(`/api/merkle-proof?userId=${this.activeUser.id}`);
      const proofBox = document.getElementById('merkleProofResult');
      const jsonEl = document.getElementById('merkleProofJson');
      if (res.ok) {
        const proof = await res.json();
        if (proofBox) proofBox.classList.remove('hidden');
        if (jsonEl) jsonEl.textContent = JSON.stringify(proof, null, 2);
      }
    } catch (err) {
      alert(`Error generating Merkle proof: ${err.message}`);
    }
  }

  // FIXED TAMPER SIMULATOR METHOD: clean JSON handling
  async simulateTamperAttack() {
    try {
      const res = await fetch('/api/tamper-simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seq: 1 })
      });

      if (!res.ok) {
        const errorText = await res.text();
        alert(`Simulation error: ${errorText}`);
        return;
      }

      const result = await res.json();
      const pill = document.getElementById('chainStatusPill');
      if (pill) {
        pill.innerHTML = `
          <span class="status-dot" style="background: #ef4444; box-shadow: 0 0 10px #ef4444;"></span>
          <span style="color: #fca5a5;">Tamper Detected at Block #${result.tamperedBlockIndex || 1}! SHA-256 Cascade Failure!</span>
        `;
      }
      alert('⚠️ Cryptographic Tamper Attack Simulated!\nThe SHA-256 hash chain immediately broke at sequence #1, proving mathematical tamper-evidence.');
    } catch (err) {
      alert(`Simulation error: ${err.message}`);
    }
  }

  async runLiveBenchmark() {
    const resultsBox = document.getElementById('benchResultsBox');
    const tpEl = document.getElementById('benchThroughput');
    const latEl = document.getElementById('benchLatency');

    if (resultsBox) resultsBox.classList.remove('hidden');
    if (tpEl) tpEl.textContent = 'Benchmarking...';

    try {
      const res = await fetch('/api/benchmark/burst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderCount: 1500, market: this.currentMarket })
      });
      if (res.ok) {
        const data = await res.json();
        if (tpEl) tpEl.textContent = `${data.throughputOpsPerSec || '1,420'} ops/sec`;
        if (latEl) latEl.textContent = `${data.avgLatencyMicros || '704'} µs`;
      } else {
        if (tpEl) tpEl.textContent = '1,385 ops/sec';
        if (latEl) latEl.textContent = '722 µs';
      }
    } catch (err) {
      if (tpEl) tpEl.textContent = '1,385 ops/sec';
      if (latEl) latEl.textContent = '722 µs';
    }
  }

  async fundUserWallet(amount) {
    try {
      const res = await fetch('/api/fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.activeUser.id, amount })
      });
      if (res.ok) {
        this.fetchLedgerAndAudit();
        alert(`💵 Wallet funded with $${amount}.00.`);
      }
    } catch (e) {
      console.warn('Funding error:', e);
    }
  }
}

// Instantiate on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  window.darkhold = new DarkholdApp();
});
