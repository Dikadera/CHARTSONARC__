require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { CircleDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Performance
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://unpkg.com", "'unsafe-inline'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.binance.com", "https://data-api.binance.vision", "https://api1.binance.com", "https://api2.binance.com", "https://api.circle.com", "https://generativelanguage.googleapis.com", "https://rpc.testnet.arc.network"]
    }
  }
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Serve lightweight-charts from node_modules as fallback
app.use('/lib/lightweight-charts', express.static(path.join(__dirname, 'node_modules/lightweight-charts/dist')));

// Multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WEBP, GIF images allowed'));
  }
});

// Circle Client
let circleClient = null;
if (process.env.CIRCLE_API_KEY && process.env.CIRCLE_ENTITY_SECRET) {
  circleClient = new CircleDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET
  });
}

// User Database
const USERS_DB_PATH = path.join(__dirname, 'users_db.json');

function loadUsersDb() {
  try {
    if (fs.existsSync(USERS_DB_PATH)) {
      const data = fs.readFileSync(USERS_DB_PATH, 'utf8');
      const parsed = JSON.parse(data);
      const map = new Map();
      for (const [k, v] of Object.entries(parsed)) {
        map.set(k.toLowerCase(), v);
      }
      return map;
    }
  } catch (e) {
    console.error('Failed to load users DB:', e);
  }
  return new Map();
}

const usersDb = loadUsersDb();

function saveUsersDb() {
  try {
    const obj = Object.fromEntries(usersDb);
    fs.writeFileSync(USERS_DB_PATH, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save users DB:', e);
  }
}



// ─────────────────────────────────────────────────────────
// PAIRS DATABASE — curated list of 80+ crypto, stocks, forex
// ─────────────────────────────────────────────────────────
const PAIRS_DB = [
  // Crypto vs USDC
  { symbol: 'BTC/USDC', name: 'Bitcoin', type: 'crypto', basePrice: 68000, volatility: 0.015 },
  { symbol: 'ETH/USDC', name: 'Ethereum', type: 'crypto', basePrice: 3450, volatility: 0.02 },
  { symbol: 'SOL/USDC', name: 'Solana', type: 'crypto', basePrice: 145, volatility: 0.035 },
  { symbol: 'BNB/USDC', name: 'BNB', type: 'crypto', basePrice: 420, volatility: 0.025 },
  { symbol: 'ADA/USDC', name: 'Cardano', type: 'crypto', basePrice: 0.48, volatility: 0.04 },
  { symbol: 'XRP/USDC', name: 'Ripple', type: 'crypto', basePrice: 0.52, volatility: 0.03 },
  { symbol: 'DOGE/USDC', name: 'Dogecoin', type: 'crypto', basePrice: 0.15, volatility: 0.055 },
  { symbol: 'AVAX/USDC', name: 'Avalanche', type: 'crypto', basePrice: 38, volatility: 0.04 },
  { symbol: 'MATIC/USDC', name: 'Polygon', type: 'crypto', basePrice: 0.85, volatility: 0.045 },
  { symbol: 'DOT/USDC', name: 'Polkadot', type: 'crypto', basePrice: 7.5, volatility: 0.04 },
  { symbol: 'LINK/USDC', name: 'Chainlink', type: 'crypto', basePrice: 18, volatility: 0.035 },
  { symbol: 'UNI/USDC', name: 'Uniswap', type: 'crypto', basePrice: 9.5, volatility: 0.045 },
  { symbol: 'ATOM/USDC', name: 'Cosmos', type: 'crypto', basePrice: 10.5, volatility: 0.04 },
  { symbol: 'LTC/USDC', name: 'Litecoin', type: 'crypto', basePrice: 85, volatility: 0.03 },
  { symbol: 'NEAR/USDC', name: 'NEAR Protocol', type: 'crypto', basePrice: 5.8, volatility: 0.05 },
  { symbol: 'ARB/USDC', name: 'Arbitrum', type: 'crypto', basePrice: 1.1, volatility: 0.055 },
  { symbol: 'OP/USDC', name: 'Optimism', type: 'crypto', basePrice: 2.2, volatility: 0.05 },
  { symbol: 'SUI/USDC', name: 'Sui', type: 'crypto', basePrice: 1.8, volatility: 0.06 },
  { symbol: 'APT/USDC', name: 'Aptos', type: 'crypto', basePrice: 9.2, volatility: 0.05 },
  { symbol: 'INJ/USDC', name: 'Injective', type: 'crypto', basePrice: 28, volatility: 0.06 },
  { symbol: 'TIA/USDC', name: 'Celestia', type: 'crypto', basePrice: 8.5, volatility: 0.065 },
  { symbol: 'JUP/USDC', name: 'Jupiter', type: 'crypto', basePrice: 0.92, volatility: 0.07 },
  { symbol: 'WIF/USDC', name: 'dogwifhat', type: 'crypto', basePrice: 2.8, volatility: 0.09 },
  { symbol: 'PEPE/USDC', name: 'Pepe', type: 'crypto', basePrice: 0.0000125, volatility: 0.1 },
  { symbol: 'FET/USDC', name: 'Fetch.ai', type: 'crypto', basePrice: 2.1, volatility: 0.065 },
  { symbol: 'RENDER/USDC', name: 'Render', type: 'crypto', basePrice: 8.8, volatility: 0.06 },
  // Crypto vs BTC
  { symbol: 'ETH/BTC', name: 'Ethereum/Bitcoin', type: 'crypto', basePrice: 0.0508, volatility: 0.015 },
  { symbol: 'SOL/BTC', name: 'Solana/Bitcoin', type: 'crypto', basePrice: 0.00213, volatility: 0.025 },
  // Stocks
  { symbol: 'TSLA', name: 'Tesla', type: 'stock', basePrice: 178, volatility: 0.025 },
  { symbol: 'AAPL', name: 'Apple', type: 'stock', basePrice: 192, volatility: 0.015 },
  { symbol: 'NVDA', name: 'NVIDIA', type: 'stock', basePrice: 875, volatility: 0.03 },
  { symbol: 'MSFT', name: 'Microsoft', type: 'stock', basePrice: 415, volatility: 0.015 },
  { symbol: 'AMZN', name: 'Amazon', type: 'stock', basePrice: 183, volatility: 0.02 },
  { symbol: 'META', name: 'Meta', type: 'stock', basePrice: 503, volatility: 0.022 },
  { symbol: 'GOOGL', name: 'Alphabet', type: 'stock', basePrice: 171, volatility: 0.018 },
  { symbol: 'AMD', name: 'AMD', type: 'stock', basePrice: 168, volatility: 0.035 },
  { symbol: 'COIN', name: 'Coinbase', type: 'stock', basePrice: 225, volatility: 0.045 },
  { symbol: 'MSTR', name: 'MicroStrategy', type: 'stock', basePrice: 1580, volatility: 0.06 },
  // Forex
  { symbol: 'EUR/USD', name: 'Euro/US Dollar', type: 'forex', basePrice: 1.085, volatility: 0.005 },
  { symbol: 'GBP/USD', name: 'British Pound/Dollar', type: 'forex', basePrice: 1.265, volatility: 0.007 },
  { symbol: 'USD/JPY', name: 'Dollar/Japanese Yen', type: 'forex', basePrice: 149.5, volatility: 0.005 },
  { symbol: 'USD/CHF', name: 'Dollar/Swiss Franc', type: 'forex', basePrice: 0.896, volatility: 0.005 },
  { symbol: 'AUD/USD', name: 'Australian Dollar/Dollar', type: 'forex', basePrice: 0.645, volatility: 0.006 },
  // Commodities
  { symbol: 'XAU/USD', name: 'Gold/Dollar', type: 'commodity', basePrice: 2340, volatility: 0.008 },
  { symbol: 'XAG/USD', name: 'Silver/Dollar', type: 'commodity', basePrice: 29.5, volatility: 0.015 },
  { symbol: 'OIL/USD', name: 'Crude Oil/Dollar', type: 'commodity', basePrice: 82, volatility: 0.02 },
];

// ─────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────
function logApiCall(endpoint, method, requestBody, responseStatus, responseBody, isSimulated = false) {
  const log = {
    timestamp: new Date().toISOString(),
    endpoint,
    method,
    requestBody,
    responseStatus,
    responseBody,
    isSimulated
  };
  console.log(`[${log.timestamp}] ${method} ${endpoint} - Status: ${responseStatus} ${isSimulated ? '(SIMULATED)' : '(LIVE)'}`);
  return log;
}

// ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────
// API: BROWSER ERROR LOGGER
// ─────────────────────────────────────────────────────────
app.post('/api/log-error', (req, res) => {
  console.error('❌ BROWSER ERROR:', req.body.error);
  res.sendStatus(200);
});

// API: CONFIG STATUS
// ─────────────────────────────────────────────────────────
app.get('/api/config-status', (req, res) => {
  const isConfigured = !!(process.env.CIRCLE_API_KEY && process.env.CIRCLE_WALLET_ID && process.env.CIRCLE_ENTITY_SECRET);
  res.json({
    configured: isConfigured,
    hasGemini: !!process.env.GEMINI_API_KEY,
    mode: isConfigured ? 'LIVE (Circle Arc Web3 API)' : 'SIMULATOR (Local Sandboxed Arc)',
    details: {
      hasApiKey: !!process.env.CIRCLE_API_KEY,
      hasWalletId: !!process.env.CIRCLE_WALLET_ID,
      hasEntitySecret: !!process.env.CIRCLE_ENTITY_SECRET,
      destinationWalletId: process.env.CIRCLE_DESTINATION_WALLET_ID || '0xSimulatedMerchantWalletAddressArcL1',
      usdcTokenId: process.env.CIRCLE_USDC_TOKEN_ID || '0x5425890298aed601595a70AB815c96711a31Bc65'
    }
  });
});

// ─────────────────────────────────────────────────────────
// API: PAIR SEARCH
// ─────────────────────────────────────────────────────────
app.get('/api/pairs/search', (req, res) => {
  const q = (req.query.q || '').toUpperCase().trim();
  if (!q || q.length < 1) return res.json({ pairs: [] });

  const results = PAIRS_DB.filter(p =>
    p.symbol.toUpperCase().includes(q) ||
    p.name.toUpperCase().includes(q)
  ).slice(0, 10);

  res.json({ pairs: results });
});

// ====================== BINANCE LIVE CHART DATA ======================
app.get('/api/chart/:symbol', async (req, res) => {
  let { symbol } = req.params;
  symbol = symbol.replace('-', '/');
  const interval = (req.query.interval || '15m').toLowerCase();
  const limit = parseInt(req.query.limit) || 300;

  try {
    // Convert your symbol format to Binance format (BTC/USDC → BTCUSDT)
    let binanceSymbol = symbol.replace('/', '').toUpperCase();
    if (binanceSymbol.endsWith('USDC')) {
      binanceSymbol = binanceSymbol.replace('USDC', 'USDT');
    }

    const endpoints = [
      `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`,
      `https://data-api.binance.vision/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`,
      `https://api1.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`,
      `https://api2.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`
    ];

    let response = null;
    let errorLog = [];
    for (const endpoint of endpoints) {
      try {
        response = await axios.get(endpoint, { timeout: 3000 });
        if (response && response.data) {
          break;
        }
      } catch (err) {
        errorLog.push(`${endpoint}: ${err.message}`);
      }
    }

    if (!response || !response.data) {
      throw new Error(`All Binance endpoints failed: ` + errorLog.join(' | '));
    }

    const data = response.data;

    // Format data for Lightweight Charts
    const formattedData = data.map(candle => ({
      time: Math.floor(candle[0] / 1000), // convert ms to seconds
      open: parseFloat(candle[1]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3]),
      close: parseFloat(candle[4]),
      volume: parseFloat(candle[5])
    }));

    const currentPrice = formattedData[formattedData.length - 1]?.close;

    res.json({
      success: true,
      symbol: binanceSymbol,
      interval,
      data: formattedData,
      currentPrice: currentPrice,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Binance API Error:', error.message || error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch live data',
      message: error.message || String(error),
      fallback: true
    });
  }
});

app.get('/api/pair-data', async (req, res) => {
  const symbol = (req.query.symbol || '').toUpperCase().trim();
  const pair = PAIRS_DB.find(p => p.symbol.toUpperCase() === symbol);

  if (!pair) return res.status(404).json({ error: `Pair not found: ${symbol}` });

  const address = (req.query.address || '').toLowerCase().trim();
  let user = null;
  if (address) {
    user = usersDb.get(address);
    if (!user) {
      user = {
        walletAddress: address,
        plan: null,
        pairsAllowed: 0,
        pairsUsed: 0,
        pairsAccessed: [],
        transactions: []
      };
      usersDb.set(address, user);
      saveUsersDb();
    }
  }

  // Quota enforcement
  if (user && user.plan) {
    const symbolUpper = symbol.toUpperCase();
    const isAlreadyAccessed = user.pairsAccessed.includes(symbolUpper);
    if (!isAlreadyAccessed) {
      if (user.pairsAccessed.length >= user.pairsAllowed) {
        return res.status(403).json({
          error: `QUOTA_EXCEEDED`,
          message: `Live chart quota reached for your ${user.plan} plan. You’ve used all ${user.pairsAllowed} live lives. Buy more lives or upgrade your plan to keep scanning more pairs.`
        });
      } else {
        user.pairsAccessed.push(symbolUpper);
        user.pairsUsed = user.pairsAccessed.length;
        saveUsersDb();
      }
    }
  }

  const timeframe = req.query.tf || '1H';
  const tfHours = { '1H': 1, '4H': 4, '1D': 24, '1W': 168 };
  const intervalHours = tfHours[timeframe] || 1;

  if (pair.type === 'crypto') {
    try {
      const binanceSymbol = pair.symbol.replace('/', '').replace('USDC', 'USDT');
      const binanceIntervals = { '1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w' };
      const interval = binanceIntervals[timeframe] || '1h';

      const endpoints = [
        `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=60`,
        `https://data-api.binance.vision/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=60`,
        `https://api1.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=60`,
        `https://api2.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=60`
      ];

      let response = null;
      let errorLog = [];
      for (const endpoint of endpoints) {
        try {
          response = await axios.get(endpoint, { timeout: 3000 });
          if (response && response.data) {
            break;
          }
        } catch (err) {
          errorLog.push(`${endpoint}: ${err.message}`);
        }
      }

      if (!response || !response.data) {
        throw new Error(`All Binance endpoints failed: ` + errorLog.join(' | '));
      }

      const candles = response.data.map(k => {
        const time = new Date(k[0]);
        return {
          time: time.toISOString(),
          timeLabel: intervalHours >= 24
            ? time.toLocaleDateString([], { month: 'short', day: 'numeric' })
            : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4])
        };
      });

      return res.json({ pair, candles });
    } catch (err) {
      console.error(`Failed to fetch Binance klines for ${symbol}, falling back to mock data:`, err.message);
    }
  }

  // Fallback to high-fidelity mock data generator
  const candles = 60;
  let currentPrice = pair.basePrice * (0.98 + Math.random() * 0.04);
  const now = new Date();
  const data = [];

  for (let i = candles; i >= 0; i--) {
    const time = new Date(now.getTime() - i * intervalHours * 60 * 60 * 1000);
    const change = currentPrice * pair.volatility * (Math.random() - 0.47);
    const open = currentPrice;
    const close = currentPrice + change;
    const high = Math.max(open, close) + (Math.random() * currentPrice * pair.volatility * 0.4);
    const low = Math.min(open, close) - (Math.random() * currentPrice * pair.volatility * 0.4);

    data.push({
      time: time.toISOString(),
      timeLabel: intervalHours >= 24
        ? time.toLocaleDateString([], { month: 'short', day: 'numeric' })
        : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      open, high, low, close
    });
    currentPrice = close;
  }

  res.json({ pair, candles: data });
});

// ─────────────────────────────────────────────────────────
// API: AI CHART ANALYSIS (via Gemini Vision or Heuristic)
// ─────────────────────────────────────────────────────────
app.post('/api/ai/analyze-chart', upload.single('chart'), async (req, res) => {
  let pairSymbol = req.body.symbol || 'UNKNOWN';
  try {
    const hasGemini = !!process.env.GEMINI_API_KEY;
    let imageBase64 = req.body.imageBase64;
    let imageMimeType = req.body.mimeType || 'image/png';
    let candleData = null;

    // Handle multipart upload
    if (req.file) {
      imageBase64 = req.file.buffer.toString('base64');
      imageMimeType = req.file.mimetype;
    }

    // Parse candle data if provided
    if (req.body.candleData) {
      try { candleData = JSON.parse(req.body.candleData); } catch (e) {}
    }

    let livePrice = null;
    if (!candleData || candleData.length === 0) {
      try {
        livePrice = await getLatestLivePrice(pairSymbol);
      } catch (e) {
        console.error('Failed to fetch live price for AI analysis:', e.message);
      }
    }

    let analysis;
    const timeframe = req.body.timeframe || '1H';
    if (hasGemini && (imageBase64 || candleData)) {
      analysis = await analyzeWithGemini(imageBase64, imageMimeType, pairSymbol, candleData, livePrice);
    } else {
      analysis = generateHeuristicAnalysis(pairSymbol, candleData, timeframe, livePrice);
    }

    res.json({ success: true, analysis, engine: hasGemini ? 'gemini-vision' : 'heuristic' });

  } catch (err) {
    console.error('AI Analysis error:', err.message);
    // Fallback to heuristic with live price
    let fallbackPrice = null;
    try {
      fallbackPrice = await getLatestLivePrice(pairSymbol);
    } catch (e) {}
    const analysis = generateHeuristicAnalysis(pairSymbol, null, '1H', fallbackPrice);
    res.json({ success: true, analysis, engine: 'heuristic-fallback', warning: err.message });
  }
});

// New endpoint: generic analysis taking chart candle array from client
app.post('/api/analyze', async (req, res) => {
  try {
    const { symbol, data, timeframe } = req.body;
    if (!data || !Array.isArray(data) || data.length < 10) {
      return res.status(400).json({ error: 'Not enough chart data. Provide at least 10 candles.' });
    }

    const recentData = data.slice(-200);
    const analysis = await getAIChartAnalysis(symbol || 'UNKNOWN', recentData, timeframe || '1H');

    return res.json({ success: true, analysis, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Analysis endpoint error:', err.message || err);
    // Still return a heuristic analysis rather than an error
    try {
      const { data, symbol, timeframe } = req.body;
      const livePrice = await getLatestLivePrice(symbol || 'UNKNOWN').catch(() => null);
      const analysis = generateHeuristicAnalysis(symbol || 'UNKNOWN', data ? data.slice(-50) : null, timeframe || '1H', livePrice);
      return res.json({ success: true, analysis, engine: 'heuristic-fallback', timestamp: new Date().toISOString() });
    } catch (e2) {
      return res.status(500).json({ error: 'AI analysis failed', details: err.message || String(err) });
    }
  }
});

// Circuit-breaker: once Gemini quota is hit, skip it for the rest of the session
let geminiDisabled = false;

// Helper that routes to Gemini vision (if configured) or heuristic analyzer
async function getAIChartAnalysis(symbol, candleData, timeframe = '1H') {
  const hasGemini = !!process.env.GEMINI_API_KEY && !geminiDisabled;
  if (hasGemini) {
    try {
      return await analyzeWithGemini(null, null, symbol, candleData);
    } catch (err) {
      const isQuota = err.message && (
        err.message.includes('429') ||
        err.message.includes('quota') ||
        err.message.includes('RESOURCE_EXHAUSTED') ||
        err.message.includes('404') ||
        err.message.includes('not found')
      );
      if (isQuota) {
        geminiDisabled = true;
        console.warn('⚠️  Gemini unavailable (quota/model error) — using heuristic engine for this session.');
      } else {
        console.error('Gemini analysis failed, using heuristic:', err.message || err);
      }
    }
  }
  // Deterministic heuristic — use candle data price so results never drift between calls
  const priceFromCandles = candleData && candleData.length ? candleData[candleData.length - 1].close : null;
  return generateHeuristicAnalysis(symbol, candleData, timeframe, priceFromCandles);
}

// ─────────────────────────────────────────────────────────
// GEMINI VISION ANALYSIS
// ─────────────────────────────────────────────────────────
async function analyzeWithGemini(imageBase64, mimeType, symbol, candleData, livePrice = null) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  let prompt = `You are a professional quantitative trading analyst and technical chart expert. Analyze this financial chart for ${symbol}.

Provide a detailed, structured analysis in the following EXACT JSON format (no markdown, pure JSON):
{
  "signal": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": <number 1-100>,
  "pattern": "<identified chart pattern, e.g. Head and Shoulders, Cup and Handle, Triangle>",
  "patternDetail": "<2-3 sentences describing the pattern and what it means>",
  "entry": {
    "price": <number>,
    "rationale": "<1 sentence explaining entry logic>"
  },
  "stopLoss": {
    "price": <number>,
    "rationale": "<1 sentence explaining SL placement logic>",
    "pct": <stop loss distance as percentage from entry>
  },
  "takeProfit1": {
    "price": <number>,
    "rationale": "<1 sentence>",
    "pct": <TP1 gain percentage from entry>,
    "rr": <reward-to-risk ratio>
  },
  "takeProfit2": {
    "price": <number>,
    "rationale": "<1 sentence>",
    "pct": <TP2 gain percentage from entry>
  },
  "support": <number>,
  "resistance": <number>,
  "indicators": {
    "rsi": {
      "value": <number>,
      "status": "Overbought" | "Oversold" | "Neutral",
      "signal": "Bullish" | "Bearish" | "Neutral",
      "summary": "<1 sentence describing RSI momentum and bias>"
    },
    "macd": {
      "macd": <number>,
      "signal": <number>,
      "histogram": <number>,
      "crossover": "Bullish" | "Bearish" | "Neutral",
      "summary": "<1 sentence describing MACD momentum and crossover>"
    }
  },
  "narrative": "<3-4 sentences of comprehensive market narrative and trade rationale>",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "timeframe": "<estimated trade duration e.g. 4-12 hours, 2-5 days>"
}

Be realistic with price levels. If this is a crypto chart, use typical crypto price ranges. ONLY return pure valid JSON, no other text.`;

  const parts = [];

  if (imageBase64) {
    parts.push({
      inlineData: { data: imageBase64, mimeType }
    });
  }

  if (candleData && candleData.length > 0) {
    const lastPrice  = candleData[candleData.length - 1].close;
    const firstPrice = candleData[0].open;
    const maxHigh    = Math.max(...candleData.map(c => c.high));
    const minLow     = Math.min(...candleData.map(c => c.low));
    const trendPct   = ((lastPrice - firstPrice) / firstPrice * 100).toFixed(2);
    const midPrice   = (maxHigh + minLow) / 2;
    const rangePct   = ((maxHigh - minLow) / midPrice * 100).toFixed(2);

    // Compute RSI(14) inline for Gemini context
    let rsiCtx = 'N/A';
    if (candleData.length > 14) {
      const cls = candleData.map(c => c.close);
      let g = 0, l = 0;
      for (let i = 1; i <= 14; i++) { const d = cls[i] - cls[i-1]; d >= 0 ? g += d : l -= d; }
      let ag = g/14, al = l/14;
      for (let i = 15; i < cls.length; i++) {
        const d = cls[i] - cls[i-1];
        ag = (ag * 13 + Math.max(0, d)) / 14;
        al = (al * 13 + Math.max(0, -d)) / 14;
      }
      rsiCtx = al === 0 ? '100' : (100 - 100 / (1 + ag/al)).toFixed(1);
    }

    // Recent candle summary (last 5)
    const last5 = candleData.slice(-5).map(c =>
      `O:${c.open.toFixed(4)} H:${c.high.toFixed(4)} L:${c.low.toFixed(4)} C:${c.close.toFixed(4)}`
    ).join(' | ');

    prompt += `\n\nCANDLE DATA CONTEXT (${candleData.length} candles, ${symbol}):\n` +
      `- Current price: ${lastPrice.toFixed(6)}\n` +
      `- Starting price: ${firstPrice.toFixed(6)}\n` +
      `- Trend: ${trendPct}% (${parseFloat(trendPct) > 0 ? 'UP' : 'DOWN'})\n` +
      `- Range high: ${maxHigh.toFixed(6)}, Range low: ${minLow.toFixed(6)} (${rangePct}% range)\n` +
      `- RSI(14): ${rsiCtx}\n` +
      `- Last 5 candles: ${last5}\n` +
      `\nIMPORTANT: Use EXACTLY these price levels as basis for all entry/SL/TP values. Do NOT invent prices outside the ${minLow.toFixed(6)}-${maxHigh.toFixed(6)} range unless justified by pattern projection.`;
  } else if (livePrice) {
    prompt += `\n\nLIVE PRICE CONTEXT: The current real-time market price for ${symbol} is ${livePrice.toFixed(6)}. Formulate all entry, stop loss, and take profit targets realistically around this price. Do not deviate by more than 10% without strong pattern justification.`;
  }

  parts.push({ text: prompt });

  const result = await model.generateContent({ contents: [{ role: 'user', parts }] });
  const text = result.response.text().trim();

  // Parse JSON from response (handle markdown code blocks if present)
  let jsonText = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonText = jsonMatch[1].trim();

  const parsed = JSON.parse(jsonText);
  return parsed;
}

// ─────────────────────────────────────────────────────────
// HEURISTIC ANALYSIS (fallback when no Gemini key)
// ─────────────────────────────────────────────────────────
function sma(values, period) {
  if (!values || values.length < period) return null;
  const out = [];
  for (let i = 0; i <= values.length - period; i++) {
    const slice = values.slice(i, i + period);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    out.push(avg);
  }
  return out;
}

function rsi(values, period = 14) {
  if (!values || values.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff; else losses += Math.abs(diff);
  }
  let avgGain = gains / period; let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss; return 100 - (100 / (1 + rs));
}

function atr(candles, period = 14) {
  if (!candles || candles.length <= period) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high, low = candles[i].low, prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function ema(values, period = 12) {
  if (!values || values.length < period) return null;
  const k = 2 / (period + 1);
  let prevEma = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result = Array(values.length).fill(null);
  result[period - 1] = prevEma;
  for (let i = period; i < values.length; i++) {
    prevEma = (values[i] - prevEma) * k + prevEma;
    result[i] = prevEma;
  }
  return result;
}

function detectPatternFromCandles(candles) {
  if (!candles || candles.length < 10) return { pattern: 'Insufficient Data', confidence: 30, detail: 'Not enough candle data to detect a reliable pattern.' };

  const n = candles.length;
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  // Linear regression slope (normalized by mean price)
  function linRegSlope(arr) {
    const len = arr.length;
    if (len < 3) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / len;
    if (mean === 0) return 0;
    const xMean = (len - 1) / 2;
    let num = 0, den = 0;
    for (let i = 0; i < len; i++) {
      num += (i - xMean) * (arr[i] - mean);
      den += (i - xMean) * (i - xMean);
    }
    return den === 0 ? 0 : (num / den) / mean;
  }

  // Find swing highs/lows (local extrema with window)
  function findSwings(data, win) {
    const sH = [], sL = [];
    for (let i = win; i < data.length - win; i++) {
      let hi = true, lo = true;
      for (let j = 1; j <= win; j++) {
        if (data[i] <= data[i - j] || data[i] <= data[i + j]) hi = false;
        if (data[i] >= data[i - j] || data[i] >= data[i + j]) lo = false;
      }
      if (hi) sH.push({ idx: i, val: data[i] });
      if (lo) sL.push({ idx: i, val: data[i] });
    }
    return { sH, sL };
  }

  const recent = candles.slice(-Math.min(60, n));
  const rCloses = recent.map(c => c.close);
  const rHighs  = recent.map(c => c.high);
  const rLows   = recent.map(c => c.low);

  const closeSlope = linRegSlope(rCloses);
  const highSlope  = linRegSlope(rHighs);
  const lowSlope   = linRegSlope(rLows);

  const maxH = Math.max(...rHighs);
  const minL = Math.min(...rLows);
  const midPrice = (maxH + minL) / 2;
  const rangePct = midPrice > 0 ? (maxH - minL) / midPrice : 0;
  const lastClose = closes[n - 1];
  const firstClose = rCloses[0];
  const trendPct = firstClose > 0 ? (lastClose - firstClose) / firstClose : 0;

  const { sH, sL } = findSwings(rCloses, 2);

  // Volatility contraction/expansion
  const half = Math.floor(recent.length / 2);
  const fH = recent.slice(0, half), sHf = recent.slice(half);
  const fRange = half ? (Math.max(...fH.map(c => c.high)) - Math.min(...fH.map(c => c.low))) : 0;
  const sRange = (recent.length - half) ? (Math.max(...sHf.map(c => c.high)) - Math.min(...sHf.map(c => c.low))) : 0;
  const contracting = fRange > 0 && sRange < fRange * 0.72;
  const expanding   = fRange > 0 && sRange > fRange * 1.3;

  // Candlestick pattern helpers
  const lc = candles[n - 1], pc = candles[n - 2];
  const lcBody = Math.abs(lc.close - lc.open);
  const lcRange = lc.high - lc.low;
  const isDoji   = lcRange > 0 && lcBody / lcRange < 0.12;
  const lBull    = lc.close > lc.open;
  const pBull    = pc.close > pc.open;
  const isBullEng = !pBull && lBull && lc.close > pc.open && lc.open < pc.close;
  const isBearEng = pBull && !lBull && lc.open > pc.close && lc.close < pc.open;
  const lLow  = Math.min(lc.open, lc.close) - lc.low;
  const uHigh = lc.high - Math.max(lc.open, lc.close);
  const isHammer = lcRange > 0 && lLow / lcRange > 0.6 && lcBody / lcRange < 0.3 && trendPct < -0.02;
  const isStar   = lcRange > 0 && uHigh / lcRange > 0.6 && lcBody / lcRange < 0.3 && trendPct > 0.02;

  const patterns = [];

  // Double Top
  if (sH.length >= 2) {
    const [h1, h2] = sH.slice(-2);
    if (Math.abs(h1.val - h2.val) < midPrice * 0.016 && h2.idx - h1.idx >= 4) {
      const neck = Math.min(...rLows.slice(h1.idx, h2.idx + 1));
      patterns.push({ pattern: 'Double Top', confidence: 73, detail: `Two swing highs near ${fmt(h1.val)} form strong resistance. Neckline support at ${fmt(neck)}. A break below neckline confirms bearish reversal targeting ${fmt(neck - (h1.val - neck))}.` });
    }
  }
  // Double Bottom
  if (sL.length >= 2) {
    const [l1, l2] = sL.slice(-2);
    if (Math.abs(l1.val - l2.val) < midPrice * 0.016 && l2.idx - l1.idx >= 4) {
      const neck = Math.max(...rHighs.slice(l1.idx, l2.idx + 1));
      patterns.push({ pattern: 'Double Bottom', confidence: 74, detail: `Two swing lows near ${fmt(l1.val)} form strong support. Neckline resistance at ${fmt(neck)}. A break above neckline confirms bullish reversal targeting ${fmt(neck + (neck - l1.val))}.` });
    }
  }
  // Head and Shoulders
  if (sH.length >= 3) {
    const [a, b, c] = sH.slice(-3);
    if (b.val > a.val && b.val > c.val && Math.abs(a.val - c.val) < midPrice * 0.025) {
      patterns.push({ pattern: 'Head and Shoulders', confidence: 77, detail: `Head at ${fmt(b.val)}, shoulders at ${fmt(a.val)} and ${fmt(c.val)}. Classic bearish reversal pattern — neckline break signals trend change.` });
    }
  }
  // Inverse Head and Shoulders
  if (sL.length >= 3) {
    const [a, b, c] = sL.slice(-3);
    if (b.val < a.val && b.val < c.val && Math.abs(a.val - c.val) < midPrice * 0.025) {
      patterns.push({ pattern: 'Inverse Head and Shoulders', confidence: 77, detail: `Head at ${fmt(b.val)}, shoulders at ${fmt(a.val)} and ${fmt(c.val)}. Classic bullish reversal — neckline breakout signals trend change.` });
    }
  }
  // Triangles (contracting volatility)
  if (contracting) {
    const flatH = Math.abs(highSlope) < 0.0004;
    const flatL = Math.abs(lowSlope)  < 0.0004;
    const risingL  = lowSlope  >  0.001;
    const fallingH = highSlope < -0.001;
    if (flatH && risingL)   patterns.push({ pattern: 'Ascending Triangle',   confidence: 71, detail: `Flat resistance near ${fmt(maxH)} with rising lows signals coiling buying pressure. Typically bullish — expect breakout above ${fmt(maxH)}.` });
    else if (flatL && fallingH) patterns.push({ pattern: 'Descending Triangle', confidence: 71, detail: `Flat support near ${fmt(minL)} with declining highs signals mounting selling pressure. Typically bearish — watch for breakdown below ${fmt(minL)}.` });
    else if (highSlope < -0.0003 && lowSlope > 0.0003) patterns.push({ pattern: 'Symmetrical Triangle', confidence: 66, detail: `Converging highs and lows reflect decreasing volatility and market indecision. Explosive breakout likely — direction confirmed by volume on breakout.` });
  }
  // Wedges
  if (contracting && Math.abs(trendPct) > 0.025) {
    if (highSlope > 0.0003 && lowSlope > 0.0003 && lowSlope > highSlope) patterns.push({ pattern: 'Rising Wedge',  confidence: 69, detail: `Narrowing bullish channel with steeper lows than highs. Bearish reversal pattern — buying momentum is weakening near resistance.` });
    if (highSlope < -0.0003 && lowSlope < -0.0003 && highSlope > lowSlope) patterns.push({ pattern: 'Falling Wedge', confidence: 69, detail: `Narrowing bearish channel with steeper highs than lows. Bullish reversal pattern — selling pressure is exhausting near support.` });
  }
  // Bull / Bear Flag
  if (recent.length >= 20) {
    const impulseLen = Math.floor(recent.length * 0.35);
    const imp = recent.slice(0, impulseLen);
    const flag = recent.slice(impulseLen);
    const impMove = imp.length > 1 ? (imp[imp.length-1].close - imp[0].close) / imp[0].close : 0;
    const flagSlope = linRegSlope(flag.map(c => c.close));
    const flagRange = flag.length ? (Math.max(...flag.map(c=>c.high)) - Math.min(...flag.map(c=>c.low))) / midPrice : 1;
    if (impMove > 0.045 && flagSlope < 0 && flagSlope > -0.006 && flagRange < 0.045)
      patterns.push({ pattern: 'Bull Flag', confidence: 72, detail: `Strong ${(impMove*100).toFixed(1)}% impulse followed by a shallow pullback channel. Bullish continuation — breakout above flag resistance targets ${fmt(lastClose * (1 + impMove * 0.618))}.` });
    if (impMove < -0.045 && flagSlope > 0 && flagSlope < 0.006 && flagRange < 0.045)
      patterns.push({ pattern: 'Bear Flag', confidence: 72, detail: `Strong ${(Math.abs(impMove)*100).toFixed(1)}% drop followed by a shallow bounce channel. Bearish continuation — breakdown below flag support targets ${fmt(lastClose * (1 + impMove * 0.618))}.` });
  }
  // Channels
  if (!contracting) {
    if (closeSlope > 0.003 && highSlope > 0.002 && lowSlope > 0.002)
      patterns.push({ pattern: 'Ascending Channel', confidence: 74, detail: `Price making higher highs and higher lows in a defined uptrend channel. Momentum is bullish — buy dips near lower channel boundary.` });
    if (closeSlope < -0.003 && highSlope < -0.002 && lowSlope < -0.002)
      patterns.push({ pattern: 'Descending Channel', confidence: 74, detail: `Price making lower highs and lower lows in a defined downtrend channel. Momentum is bearish — sell rallies near upper channel boundary.` });
  }
  // Broadening
  if (expanding && sH.length >= 2 && sL.length >= 2)
    patterns.push({ pattern: 'Broadening Formation', confidence: 59, detail: `Expanding highs and lows indicate increasing volatility and uncertainty. Unpredictable — wait for a decisive close above/below prior swings.` });
  // Range-bound
  if (rangePct < 0.025 && Math.abs(closeSlope) < 0.0008)
    patterns.push({ pattern: 'Range-Bound Consolidation', confidence: 57, detail: `Price oscillating in a tight ${(rangePct*100).toFixed(1)}% band between ${fmt(minL)} and ${fmt(maxH)}. Await a breakout with volume for directional bias.` });
  // Candlestick reversal patterns
  if (isBullEng) patterns.push({ pattern: 'Bullish Engulfing', confidence: 63, detail: `Last candle fully engulfs prior bearish candle at support, signaling a bullish reversal with strong buying conviction.` });
  if (isBearEng) patterns.push({ pattern: 'Bearish Engulfing', confidence: 63, detail: `Last candle fully engulfs prior bullish candle at resistance, signaling a bearish reversal with strong selling conviction.` });
  if (isHammer) patterns.push({ pattern: 'Hammer',         confidence: 61, detail: `Long lower wick after a decline indicates buyers defending a key level. Potential bullish reversal — confirm with next bullish candle.` });
  if (isStar)   patterns.push({ pattern: 'Shooting Star',  confidence: 61, detail: `Long upper wick after a rally indicates sellers rejecting higher prices. Potential bearish reversal — confirm with next bearish candle.` });
  if (isDoji && Math.abs(trendPct) > 0.02)
    patterns.push({ pattern: 'Doji Indecision', confidence: 55, detail: `Doji after a ${trendPct > 0 ? 'bullish' : 'bearish'} move signals market indecision. A reversal candle next would confirm a potential trend change.` });

  if (patterns.length === 0) {
    if (Math.abs(trendPct) < 0.01)
      return { pattern: 'Sideways Drift',    confidence: 46, detail: `No dominant pattern detected. Price drifting sideways with no conviction. Wait for a directional breakout before entering.` };
    if (trendPct > 0)
      return { pattern: 'General Uptrend',   confidence: 53, detail: `Price has gained ${(trendPct*100).toFixed(1)}% over the analysis window without a specific formation. Bullish momentum leans toward trend continuation.` };
    return   { pattern: 'General Downtrend', confidence: 53, detail: `Price has declined ${(Math.abs(trendPct)*100).toFixed(1)}% over the analysis window without a specific formation. Bearish momentum leans toward trend continuation.` };
  }

  patterns.sort((a, b) => b.confidence - a.confidence);
  return patterns[0];
}

function fmt(n) { return parseFloat(n.toFixed(n > 100 ? 2 : n > 1 ? 4 : 8)); }

async function getLatestLivePrice(symbol) {
  const pair = PAIRS_DB.find(p => p.symbol.toUpperCase() === (symbol || '').toUpperCase());
  if (!pair) return null;
  if (pair.type !== 'crypto') return pair.basePrice;

  let binanceSymbol = symbol.replace('/', '').toUpperCase();
  if (binanceSymbol.endsWith('USDC')) {
    binanceSymbol = binanceSymbol.replace('USDC', 'USDT');
  }

  const endpoints = [
    `https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`,
    `https://data-api.binance.vision/api/v3/ticker/price?symbol=${binanceSymbol}`,
    `https://api1.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`,
    `https://api2.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await axios.get(endpoint, { timeout: 2000 });
      if (response && response.data && response.data.price) {
        return parseFloat(response.data.price);
      }
    } catch (e) {
      // try next
    }
  }
  return pair.basePrice;
}

function generateHeuristicAnalysis(symbol, candleData, timeframe = '1H', livePrice = null) {
  try {
    const pair = PAIRS_DB.find(p => p.symbol.toUpperCase() === (symbol || '').toUpperCase());
    const closes = (candleData && candleData.length) ? candleData.map(c => c.close) : [];
    const highs  = (candleData && candleData.length) ? candleData.map(c => c.high)  : [];
    const lows   = (candleData && candleData.length) ? candleData.map(c => c.low)   : [];
    const last = candleData && candleData.length ? candleData[candleData.length - 1] : null;
    const currentPrice = last ? last.close : (livePrice || (pair ? pair.basePrice : 100));

    // ── Indicators ──────────────────────────────────────────────
    const sma9result = closes.length >= 9  ? sma(closes, 9) : null;
    const sma21result = closes.length >= 21 ? sma(closes, 21) : null;
    const sma50result = closes.length >= 50 ? sma(closes, 50) : null;
    
    const sma9  = sma9result ? sma9result.slice(-1)[0] : null;
    const sma21 = sma21result ? sma21result.slice(-1)[0] : null;
    const sma50 = sma50result ? sma50result.slice(-1)[0] : null;
    
    const rsiVal = closes.length > 14 ? rsi(closes, 14) : null;
    const atrVal = atr(candleData, 14) || (pair ? pair.volatility * currentPrice : currentPrice * 0.015);

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdValues = closes.map((_, i) =>
    (ema12 && ema26 && ema12[i] != null && ema26[i] != null) ? ema12[i] - ema26[i] : null
  ).filter(v => v !== null);
  const signalLine = ema(macdValues, 9);

  const lastMacd = macdValues.length ? macdValues[macdValues.length - 1] : null;
  const lastSig  = signalLine && signalLine.length ? signalLine[signalLine.length - 1] : null;
  const lastHist = (lastMacd != null && lastSig != null) ? lastMacd - lastSig : null;
  const prevMacd = macdValues.length > 1 ? macdValues[macdValues.length - 2] : null;
  const prevSig  = signalLine && signalLine.length > 1 ? signalLine[signalLine.length - 2] : null;

  let macdCrossover = 'Neutral';
  if (prevMacd != null && prevSig != null && lastMacd != null && lastSig != null) {
    if (prevMacd <= prevSig && lastMacd > lastSig)      macdCrossover = 'Bullish';
    else if (prevMacd >= prevSig && lastMacd < lastSig) macdCrossover = 'Bearish';
    else macdCrossover = lastHist > 0 ? 'Bullish' : lastHist < 0 ? 'Bearish' : 'Neutral';
  }

  const rsiStatus = rsiVal != null ? (rsiVal > 70 ? 'Overbought' : rsiVal < 30 ? 'Oversold' : 'Neutral') : 'Neutral';
  const rsiSignal = rsiVal != null ? (rsiVal > 70 ? 'Bearish'    : rsiVal < 30 ? 'Bullish'  : 'Neutral') : 'Neutral';
  const macdSignal = lastHist != null ? (lastHist > 0 ? 'Bullish' : lastHist < 0 ? 'Bearish' : 'Neutral') : 'Neutral';

  // ── Pattern Detection ────────────────────────────────────────
  const patt = detectPatternFromCandles(candleData);

  // ── Weighted Signal Voting (bull/bear score) ─────────────────
  let bullScore = 0, bearScore = 0;
  if (sma9 != null && sma21 != null) { sma9 > sma21 ? bullScore += 2 : bearScore += 2; }
  if (sma50 != null)                 { currentPrice > sma50 ? bullScore += 1 : bearScore += 1; }
  if (rsiSignal === 'Bullish')       bullScore += 2;
  if (rsiSignal === 'Bearish')       bearScore += 2;
  if (macdCrossover === 'Bullish')   bullScore += 3;
  if (macdCrossover === 'Bearish')   bearScore += 3;
  if (macdSignal === 'Bullish')      bullScore += 1;
  if (macdSignal === 'Bearish')      bearScore += 1;

  const bullishPatterns = ['Double Bottom','Inverse Head','Ascending Triangle','Falling Wedge','Bull Flag','Ascending Channel','Bullish Engulfing','Hammer','General Uptrend'];
  const bearishPatterns = ['Double Top','Head and Shoulders','Descending Triangle','Rising Wedge','Bear Flag','Descending Channel','Bearish Engulfing','Shooting Star','General Downtrend'];
  if (bullishPatterns.some(p => patt.pattern.includes(p))) bullScore += 2;
  if (bearishPatterns.some(p => patt.pattern.includes(p))) bearScore += 2;

  const totalScore = bullScore + bearScore;
  let signal = 'NEUTRAL';
  if (bullScore >= bearScore && bullScore > 0) signal = 'BULLISH';
  else if (bearScore > bullScore && bearScore > 0) signal = 'BEARISH';

  // ── Data-Driven Confidence (no arbitrary 98% clamp) ──────────
  let confidence = 42;
  if (totalScore > 0) {
    const ratio = Math.max(bullScore, bearScore) / totalScore;
    confidence += Math.round(ratio * 32);            // +0 to +32
  }
  confidence += Math.round(Math.max(0, (patt.confidence - 30) * 0.38)); // pattern bonus
  if (rsiVal != null && (rsiVal > 68 || rsiVal < 32)) confidence += 5;
  if (prevMacd != null && prevSig != null && lastMacd != null && lastSig != null) {
    if ((prevMacd <= prevSig && lastMacd > lastSig) || (prevMacd >= prevSig && lastMacd < lastSig)) confidence += 6;
  }
  if (signal === 'NEUTRAL') confidence = Math.max(28, confidence - 12);
  confidence = Math.min(91, Math.max(28, Math.round(confidence)));

  // ── Intelligent Trade Levels ──────────────────────────────────
  const recentHighs = highs.slice(-Math.min(25, highs.length));
  const recentLows  = lows.slice(-Math.min(25, lows.length));
  const swingHigh = recentHighs.length ? Math.max(...recentHighs) : currentPrice * 1.03;
  const swingLow  = recentLows.length  ? Math.min(...recentLows)  : currentPrice * 0.97;

  // ── Support & Resistance from actual swing data ───────────────
  const supportVal    = lows.length  >= 5 ? Math.min(...lows.slice(-Math.min(30, lows.length)))   : currentPrice * 0.97;
  const resistanceVal = highs.length >= 5 ? Math.max(...highs.slice(-Math.min(30, highs.length))) : currentPrice * 1.03;

  // ── Calculate Limit Order Entry Price ────────────────────────
  // For bullish: limit buy at support. For bearish: limit sell at resistance.
  // Increased tolerance to 2% to ensure limit orders don't collapse to market price in tight ranges.
  let limitEntry = currentPrice;
  const priceTolerance = 0.02; // 2% tolerance (increased from 0.5%)

  const isBull = signal === 'BULLISH';
  const isBear = signal === 'BEARISH';

  if (isBull) {
    limitEntry = supportVal;
    const priceDiff = Math.abs(limitEntry - currentPrice) / currentPrice;
    if (priceDiff < priceTolerance) {
      // Still offer a limit order 1.5% below market for better entry
      limitEntry = currentPrice * 0.985;
    }
  } else if (isBear) {
    limitEntry = resistanceVal;
    const priceDiff = Math.abs(limitEntry - currentPrice) / currentPrice;
    if (priceDiff < priceTolerance) {
      // Still offer a limit order 1.5% above market for better entry
      limitEntry = currentPrice * 1.015;
    }
  } else {
    // Even in NEUTRAL: offer a limit order slightly better than market
    if (bullScore >= bearScore) limitEntry = currentPrice * 0.985;  // slight dip for long
    else limitEntry = currentPrice * 1.015;  // slight pump for short
  }

  let entry = limitEntry;
  let sl, tp1, tp2;

  // ── Intelligent Stop Loss ────────────────────────────────────────
  const minBuffer = entry * 0.005; // 0.5% minimum buffer
  
  if (isBull) {
    // Long: SL below entry
    sl = swingLow ? Math.min(swingLow, entry - minBuffer) : entry - minBuffer;
    tp1 = Math.min(swingHigh, entry + atrVal * 2.5);
    tp2 = entry + (tp1 - entry) * 2.0;
  } else if (isBear) {
    // Short: SL above entry
    sl = swingHigh ? Math.max(swingHigh, entry + minBuffer) : entry + minBuffer;
    tp1 = Math.max(swingLow,  entry - atrVal * 2.5);
    tp2 = entry - (entry - tp1) * 2.0;
  } else {
    sl  = entry - atrVal * 1.5;
    tp1 = entry + atrVal * 2.5;
    tp2 = entry + atrVal * 5.0;
  }

  // Round SL to 2 decimals
  sl = Number(sl.toFixed(2));

  // Rich Narrative Summaries
  const rsiSummary = rsiVal != null
    ? `RSI: ${rsiVal.toFixed(1)} - ${rsiStatus.toLowerCase()}${rsiStatus === 'Overbought' ? ', suggesting a potential overbought condition' : rsiStatus === 'Oversold' ? ', suggesting a potential oversold condition' : ''}`
    : 'RSI: N/A';


  const macdSummary = lastHist != null
    ? `MACD (${lastMacd != null ? lastMacd.toFixed(5) : 'n/a'}) is ${lastMacd > lastSig ? 'above' : 'below'} its signal line (${lastSig != null ? lastSig.toFixed(5) : 'n/a'}); histogram is ${lastHist > 0 ? 'positive — bullish pressure is building' : 'negative — bearish pressure is building'}. ${macdCrossover !== 'Neutral' ? `A ${macdCrossover.toLowerCase()} crossover has recently occurred.` : 'No fresh crossover is in effect.'}`
    : 'MACD unavailable (insufficient data for EMA-26 calculation).';

  const signalStr = isBull ? 'longs' : isBear ? 'shorts' : 'a wait-and-see approach';
  const narrative = `${symbol} is displaying a ${patt.pattern} pattern on the ${timeframe} chart. ${patt.detail || ''} ${rsiSummary} ${macdSummary} The indicator voting model scores ${bullScore} bullish vs ${bearScore} bearish signals, pointing toward ${signalStr}${sma50 != null ? ` — price is ${currentPrice > sma50 ? 'above' : 'below'} the 50-period SMA (${fmt(sma50)}), ${currentPrice > sma50 ? 'confirming bullish bias' : 'adding bearish weight'}` : ''}.`;

  const orderType = entry === currentPrice ? 'MARKET' : (isBull ? 'LIMIT' : isBear ? 'LIMIT' : 'LIMIT');
  const orderTypeStr = orderType === 'MARKET' ? 'Market order' : `Limit order at ${fmt(entry)}`;

  const entryRationale = isBull
    ? `${orderTypeStr} — Long entry with ${sma9 && sma21 && sma9 > sma21 ? 'SMA9>SMA21 alignment, ' : ''}${macdCrossover === 'Bullish' ? 'active MACD bullish crossover, ' : ''}${rsiVal && rsiVal < 65 ? 'RSI with upside room.' : 'indicator support.'}`
    : isBear
    ? `${orderTypeStr} — Short entry with ${sma9 && sma21 && sma9 < sma21 ? 'SMA9<SMA21 alignment, ' : ''}${macdCrossover === 'Bearish' ? 'active MACD bearish crossover, ' : ''}${rsiVal && rsiVal > 35 ? 'RSI with downside room.' : 'indicator support.'}`
    : `Price at ${fmt(entry)} in neutral territory — await a breakout with volume before entering.`;

  const slRationale = isBull
    ? `Stop below recent swing low (${fmt(swingLow)}) + 1.5x ATR buffer — position invalidated on break.`
    : isBear
    ? `Stop above recent swing high (${fmt(swingHigh)}) + 1.5x ATR buffer — position invalidated on break.`
    : `ATR-based stop at ${fmt(sl)} to limit neutral trade exposure.`;

  const tp1Rationale = isBull ? `First target near swing high resistance at ${fmt(swingHigh)}.`
    : isBear ? `First target near swing low support at ${fmt(swingLow)}.`
    : `Conservative first target at 2.5x ATR.`;

  const rrRatio = sl !== entry ? parseFloat((Math.abs(tp1 - entry) / Math.abs(entry - sl)).toFixed(2)) : 1;
  const slPct  = parseFloat(((Math.abs(entry - sl)  / entry) * 100).toFixed(2));
  const tp1Pct = parseFloat(((Math.abs(tp1 - entry) / entry) * 100).toFixed(2));
  const tp2Pct = parseFloat(((Math.abs(tp2 - entry) / entry) * 100).toFixed(2));

  const tfDuration = { '15m': '1-4 hours', '1H': '4-24 hours', '4H': '1-3 days', '1D': '3-14 days', '1W': '2-6 weeks' };

  return {
    signal,
    confidence,
    pattern: patt.pattern,
    patternDetail: patt.detail || `${patt.pattern} detected with ${patt.confidence}% confidence. SMA9: ${sma9 ? fmt(sma9) : 'n/a'}, SMA21: ${sma21 ? fmt(sma21) : 'n/a'}${sma50 ? `, SMA50: ${fmt(sma50)}` : ''}.`,
    indicators: {
      rsi:  { value: rsiVal  != null ? parseFloat(rsiVal.toFixed(2))    : null, status: rsiStatus,    signal: rsiSignal,    summary: rsiSummary  },
      macd: { macd: lastMacd != null ? parseFloat(lastMacd.toFixed(6))  : null,
              signal: lastSig  != null ? parseFloat(lastSig.toFixed(6)) : null,
              histogram: lastHist != null ? parseFloat(lastHist.toFixed(6)) : null,
              crossover: macdCrossover, summary: macdSummary }
    },
    entry:       { price: parseFloat(entry.toFixed(2)), rationale: entryRationale },
    stopLoss:    { price: parseFloat(sl.toFixed(2)),    rationale: slRationale,  pct: slPct  },
    takeProfit1: { price: parseFloat(tp1.toFixed(2)),   rationale: tp1Rationale, pct: tp1Pct, rr: rrRatio },
    takeProfit2: { price: parseFloat(tp2.toFixed(2)),   rationale: `Extended projection — 2x the TP1 move for maximum capture.`, pct: tp2Pct },
    support:     parseFloat(supportVal.toFixed(2)),
    resistance:  parseFloat(resistanceVal.toFixed(2)),
    narrative,
    riskLevel: atrVal / currentPrice > 0.04 ? 'HIGH' : atrVal / currentPrice > 0.015 ? 'MEDIUM' : 'LOW',
    timeframe: tfDuration[timeframe] || timeframe
  };
  } catch (err) {
    console.error('generateHeuristicAnalysis error:', err.message || err, { symbol, candleLength: candleData ? candleData.length : 0, timeframe });
    // Return minimal analysis on error
    return {
      signal: 'NEUTRAL',
      confidence: 28,
      pattern: 'Error',
      patternDetail: 'Analysis failed',
      indicators: { rsi: { value: null, status: 'N/A', signal: 'Neutral', summary: 'N/A' }, macd: { macd: null, signal: null, histogram: null, crossover: 'Neutral', summary: 'N/A' } },
      entry: { price: 0, rationale: 'N/A' },
      stopLoss: { price: 0, rationale: 'N/A', pct: 0 },
      takeProfit1: { price: 0, rationale: 'N/A', pct: 0, rr: 1 },
      takeProfit2: { price: 0, rationale: 'N/A', pct: 0 },
      support: 0,
      resistance: 0,
      narrative: 'Analysis error',
      riskLevel: 'MEDIUM',
      timeframe: timeframe || '1H'
    };
  }
}

app.post('/api/auth/sign', async (req, res) => {
  const { walletAddress, messageToSign } = req.body;
  const isConfigured = !!(process.env.CIRCLE_API_KEY && process.env.CIRCLE_WALLET_ID && process.env.CIRCLE_ENTITY_SECRET);

  let typedData = typeof messageToSign === 'string' ? JSON.parse(messageToSign) : messageToSign;
  if (isConfigured && typedData && typedData.domain) {
    typedData.domain.chainId = 5042002;
  }

  const requestPayload = { walletAddress, blockchain: 'ARC-TESTNET', eip712Domain: typedData?.domain };

  if (!isConfigured) {
    const sig = '0x' + Array.from({length: 130}, () => Math.floor(Math.random()*16).toString(16)).join('');
    const simulatedResponse = { success: true, walletAddress, signature: sig, verified: true, timestamp: new Date().toISOString() };
    const log = logApiCall('/v1/w3s/developer/sign/typedData', 'POST', requestPayload, 200, simulatedResponse, true);
    return res.json({ mode: 'SIMULATOR', log, data: simulatedResponse });
  }

  try {
    let ciphertext = process.env.CIRCLE_ENTITY_SECRET_CIPHERTEXT;
    if (circleClient) ciphertext = await circleClient.generateEntitySecretCiphertext();

    const response = await axios.post('https://api.circle.com/v1/w3s/developer/sign/typedData', {
      entitySecretCiphertext: ciphertext,
      walletId: process.env.CIRCLE_WALLET_ID,
      data: JSON.stringify(typedData)
    }, { headers: { 'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}`, 'Content-Type': 'application/json' } });

    const log = logApiCall('https://api.circle.com/v1/w3s/developer/sign/typedData', 'POST', requestPayload, response.status, response.data, false);
    res.json({ mode: 'LIVE', log, data: response.data });
  } catch (error) {
    const errorResponse = error.response ? error.response.data : { message: error.message };
    const log = logApiCall('https://api.circle.com/v1/w3s/developer/sign/typedData', 'POST', requestPayload, error.response?.status || 500, errorResponse, false);
    res.status(error.response?.status || 500).json({ mode: 'LIVE', log, error: errorResponse });
  }
});

// ─────────────────────────────────────────────────────────
// API: PAYMENT TRANSFER (Subscription Plans)
// ─────────────────────────────────────────────────────────
app.post('/api/payment/transfer', async (req, res) => {
  const { amount, plan } = req.body;
  const isConfigured = !!(process.env.CIRCLE_API_KEY && process.env.CIRCLE_WALLET_ID && process.env.CIRCLE_ENTITY_SECRET);

  const destinationWallet = process.env.CIRCLE_DESTINATION_WALLET_ID || '0xSimulatedMerchantWalletAddressArcL1';
  const idempotencyKey = uuidv4();

  const requestPayload = {
    idempotencyKey,
    plan: plan || 'unknown',
    sourceWalletId: process.env.CIRCLE_WALLET_ID || 'simulated-src-wallet-id',
    destinationAddress: destinationWallet,
    amount: [amount.toString()],
    feeLevel: 'LOW',
    tokenId: process.env.CIRCLE_USDC_TOKEN_ID || 'usdc-token-id-arc'
  };

  if (!isConfigured) {
    const mockTxHash = '0x' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('');
    const simulatedResponse = {
      success: true,
      transactionId: uuidv4(),
      txHash: mockTxHash,
      state: 'CONFIRMED',
      amount,
      plan,
      token: 'USDC',
      gasFee: '0.00',
      recipient: destinationWallet,
      blockTimeMs: 400,
      timestamp: new Date().toISOString()
    };
    const log = logApiCall('/v1/w3s/developer/transactions/transfer', 'POST', requestPayload, 201, simulatedResponse, true);
    return res.json({ mode: 'SIMULATOR', log, data: simulatedResponse });
  }

  try {
    let ciphertext = process.env.CIRCLE_ENTITY_SECRET_CIPHERTEXT;
    if (circleClient) ciphertext = await circleClient.generateEntitySecretCiphertext();

    const response = await axios.post('https://api.circle.com/v1/w3s/developer/transactions/transfer', {
      idempotencyKey,
      entitySecretCiphertext: ciphertext,
      walletId: process.env.CIRCLE_WALLET_ID,
      destinationAddress: destinationWallet,
      amounts: [amount.toString()],
      tokenId: process.env.CIRCLE_USDC_TOKEN_ID || 'usdc-token-id-sandbox',
      feeLevel: 'LOW'
    }, { headers: { 'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}`, 'Content-Type': 'application/json' } });

    const log = logApiCall('https://api.circle.com/v1/w3s/developer/transactions/transfer', 'POST', requestPayload, response.status, response.data, false);
    res.json({ mode: 'LIVE', log, data: response.data });
  } catch (error) {
    const errorResponse = error.response ? error.response.data : { message: error.message };
    const log = logApiCall('https://api.circle.com/v1/w3s/developer/transactions/transfer', 'POST', requestPayload, error.response?.status || 500, errorResponse, false);
    res.status(error.response?.status || 500).json({ mode: 'LIVE', log, error: errorResponse });
  }
});

// ─────────────────────────────────────────────────────────
// API: USER REGISTRATION & STATUS
// ─────────────────────────────────────────────────────────
app.post('/api/user/register', (req, res) => {
  const address = (req.body.walletAddress || '').toLowerCase().trim();
  if (!address) {
    return res.status(400).json({ error: 'walletAddress is required' });
  }

  let user = usersDb.get(address);
  if (!user) {
    user = {
      walletAddress: address,
      plan: null,
      pairsAllowed: 0,
      pairsUsed: 0,
      pairsAccessed: [],
      transactions: []
    };
    usersDb.set(address, user);
    saveUsersDb();
  }

  res.json({ success: true, user });
});

app.get('/api/user/:address', (req, res) => {
  const address = (req.params.address || '').toLowerCase().trim();
  if (!address) {
    return res.status(400).json({ error: 'walletAddress is required' });
  }

  let user = usersDb.get(address);
  if (!user) {
    user = {
      walletAddress: address,
      plan: null,
      pairsAllowed: 0,
      pairsUsed: 0,
      pairsAccessed: [],
      transactions: []
    };
    usersDb.set(address, user);
    saveUsersDb();
  }

  res.json({ success: true, user });
});

// ─────────────────────────────────────────────────────────
// API: SUBSCRIBE & PAYMENT SETTLEMENT
// Supports both MetaMask on-chain and Circle Arc backend
// ─────────────────────────────────────────────────────────
app.post('/api/payment/subscribe', async (req, res) => {
  const { walletAddress, plan, txHash, isCircleArc } = req.body;
  const address = (walletAddress || '').toLowerCase().trim();

  if (!address || !plan) {
    return res.status(400).json({ error: 'walletAddress and plan are required' });
  }

  const PLANS = {
    starter: { name: 'Starter', amount: 3, pairs: 5 },
    pro:     { name: 'Pro',     amount: 5, pairs: 10 },
    elite:   { name: 'Elite',   amount: 15, pairs: 35 }
  };

  const selectedPlan = PLANS[plan];
  if (!selectedPlan) {
    return res.status(400).json({ error: 'Invalid plan' });
  }

  const isConfigured = !!(process.env.CIRCLE_API_KEY && process.env.CIRCLE_WALLET_ID && process.env.CIRCLE_ENTITY_SECRET);
  let finalTxHash = txHash || '';

  let user = usersDb.get(address);
  if (!user) {
    user = {
      walletAddress: address,
      plan: null,
      pairsAllowed: 0,
      pairsUsed: 0,
      pairsAccessed: [],
      transactions: []
    };
    usersDb.set(address, user);
  }

  const requestPayload = {
    walletAddress: address,
    plan,
    isCircleArc: !!isCircleArc,
    txHash: finalTxHash,
    amount: selectedPlan.amount
  };

  if (isCircleArc) {
    // Circle Arc Developer Controlled Wallets Transfer
    const destinationWallet = process.env.CIRCLE_DESTINATION_WALLET_ID || '0x05c950D2EE2507678c71492a27eE1fe593CAC546';
    const idempotencyKey = uuidv4();

    const circlePayload = {
      idempotencyKey,
      sourceWalletId: process.env.CIRCLE_WALLET_ID || 'simulated-src-wallet-id',
      destinationAddress: destinationWallet,
      amount: [selectedPlan.amount.toString()],
      feeLevel: 'LOW',
      tokenId: process.env.CIRCLE_USDC_TOKEN_ID || '0x5425890298aed601595a70AB815c96711a31Bc65'
    };

    if (!isConfigured) {
      // Simulator transfer
      finalTxHash = '0x' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('');
      const simulatedResponse = {
        success: true,
        transactionId: uuidv4(),
        txHash: finalTxHash,
        state: 'CONFIRMED',
        amount: selectedPlan.amount,
        plan,
        token: 'USDC',
        recipient: destinationWallet,
        timestamp: new Date().toISOString()
      };
      const log = logApiCall('/v1/w3s/developer/transactions/transfer', 'POST', circlePayload, 201, simulatedResponse, true);

      user.plan = plan;
      user.pairsAllowed = selectedPlan.pairs;
      user.transactions.push({
        txHash: finalTxHash,
        plan,
        amount: selectedPlan.amount,
        timestamp: new Date().toISOString()
      });
      saveUsersDb();

      return res.json({ success: true, user, txHash: finalTxHash, log });
    }

    try {
      let ciphertext = process.env.CIRCLE_ENTITY_SECRET_CIPHERTEXT;
      if (circleClient) ciphertext = await circleClient.generateEntitySecretCiphertext();

      const response = await axios.post('https://api.circle.com/v1/w3s/developer/transactions/transfer', {
        idempotencyKey,
        entitySecretCiphertext: ciphertext,
        walletId: process.env.CIRCLE_WALLET_ID,
        destinationAddress: destinationWallet,
        amounts: [selectedPlan.amount.toString()],
        tokenId: process.env.CIRCLE_USDC_TOKEN_ID || '0x5425890298aed601595a70AB815c96711a31Bc65',
        feeLevel: 'LOW'
      }, { headers: { 'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}`, 'Content-Type': 'application/json' } });

      const liveResponse = response.data;
      finalTxHash = liveResponse.data?.txHash || liveResponse.data?.id || '';

      const log = logApiCall('https://api.circle.com/v1/w3s/developer/transactions/transfer', 'POST', circlePayload, response.status, liveResponse, false);

      user.plan = plan;
      user.pairsAllowed = selectedPlan.pairs;
      user.transactions.push({
        txHash: finalTxHash,
        plan,
        amount: selectedPlan.amount,
        timestamp: new Date().toISOString()
      });
      saveUsersDb();

      return res.json({ success: true, user, txHash: finalTxHash, log });

    } catch (error) {
      const errorResponse = error.response ? error.response.data : { message: error.message };
      const log = logApiCall('https://api.circle.com/v1/w3s/developer/transactions/transfer', 'POST', circlePayload, error.response?.status || 500, errorResponse, false);
      return res.status(error.response?.status || 500).json({ error: 'Circle API transfer failed', details: errorResponse, log });
    }
  } else {
    // MetaMask or other browser wallet completed the transfer on-chain
    user.plan = plan;
    user.pairsAllowed = selectedPlan.pairs;
    user.transactions.push({
      txHash: finalTxHash,
      plan,
      amount: selectedPlan.amount,
      timestamp: new Date().toISOString()
    });
    saveUsersDb();

    const log = {
      timestamp: new Date().toISOString(),
      endpoint: '/api/payment/subscribe',
      method: 'POST',
      requestBody: requestPayload,
      responseStatus: 200,
      responseBody: { success: true, user, txHash: finalTxHash },
      isSimulated: false
    };
    logApiCall('/api/payment/subscribe', 'POST', requestPayload, 200, { success: true, user, txHash: finalTxHash }, false);

    return res.json({ success: true, user, txHash: finalTxHash, log });
  }
});

// ─────────────────────────────────────────────────────────
// API: ADD CREDITS / SCAN LIVES
// Purchase 5 extra scan lives for 1 USDC
// ─────────────────────────────────────────────────────────
app.post('/api/payment/add-credits', async (req, res) => {
  const { walletAddress, txHash, isCircleArc } = req.body;
  const address = (walletAddress || '').toLowerCase().trim();

  if (!address) {
    return res.status(400).json({ error: 'walletAddress is required' });
  }

  let user = usersDb.get(address);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const creditCost = 1; // 1 USDC
  const creditAmount = 5; // 5 extra pairs
  const isConfigured = !!(process.env.CIRCLE_API_KEY && process.env.CIRCLE_WALLET_ID && process.env.CIRCLE_ENTITY_SECRET);
  let finalTxHash = txHash || '';

  const requestPayload = {
    walletAddress: address,
    amount: creditCost,
    txHash: finalTxHash,
    isCircleArc: !!isCircleArc
  };

  if (isCircleArc) {
    const destinationWallet = process.env.CIRCLE_DESTINATION_WALLET_ID || '0x05c950D2EE2507678c71492a27eE1fe593CAC546';
    const idempotencyKey = uuidv4();
    const circlePayload = {
      idempotencyKey,
      sourceWalletId: process.env.CIRCLE_WALLET_ID || 'simulated-src-wallet-id',
      destinationAddress: destinationWallet,
      amount: [creditCost.toString()],
      feeLevel: 'LOW',
      tokenId: process.env.CIRCLE_USDC_TOKEN_ID || '0x5425890298aed601595a70AB815c96711a31Bc65'
    };

    if (!isConfigured) {
      finalTxHash = '0x' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('');
      const simulatedResponse = {
        success: true,
        transactionId: uuidv4(),
        txHash: finalTxHash,
        state: 'CONFIRMED',
        amount: creditCost,
        token: 'USDC',
        recipient: destinationWallet,
        timestamp: new Date().toISOString()
      };
      const log = logApiCall('/v1/w3s/developer/transactions/transfer', 'POST', circlePayload, 201, simulatedResponse, true);

      user.pairsAllowed += creditAmount;
      user.transactions.push({
        txHash: finalTxHash,
        plan: 'add-credits',
        amount: creditCost,
        timestamp: new Date().toISOString()
      });
      saveUsersDb();

      return res.json({ success: true, user, txHash: finalTxHash, log });
    }

    try {
      let ciphertext = process.env.CIRCLE_ENTITY_SECRET_CIPHERTEXT;
      if (circleClient) ciphertext = await circleClient.generateEntitySecretCiphertext();

      const response = await axios.post('https://api.circle.com/v1/w3s/developer/transactions/transfer', {
        idempotencyKey,
        entitySecretCiphertext: ciphertext,
        walletId: process.env.CIRCLE_WALLET_ID,
        destinationAddress: destinationWallet,
        amounts: [creditCost.toString()],
        tokenId: process.env.CIRCLE_USDC_TOKEN_ID || '0x5425890298aed601595a70AB815c96711a31Bc65',
        feeLevel: 'LOW'
      }, { headers: { 'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}`, 'Content-Type': 'application/json' } });

      const liveResponse = response.data;
      finalTxHash = liveResponse.data?.txHash || liveResponse.data?.id || '';

      const log = logApiCall('https://api.circle.com/v1/w3s/developer/transactions/transfer', 'POST', circlePayload, response.status, liveResponse, false);

      user.pairsAllowed += creditAmount;
      user.transactions.push({
        txHash: finalTxHash,
        plan: 'add-credits',
        amount: creditCost,
        timestamp: new Date().toISOString()
      });
      saveUsersDb();

      return res.json({ success: true, user, txHash: finalTxHash, log });

    } catch (error) {
      const errorResponse = error.response ? error.response.data : { message: error.message };
      const log = logApiCall('https://api.circle.com/v1/w3s/developer/transactions/transfer', 'POST', circlePayload, error.response?.status || 500, errorResponse, false);
      return res.status(error.response?.status || 500).json({ error: 'Circle API transfer failed', details: errorResponse, log });
    }
  } else {
    user.pairsAllowed += creditAmount;
    user.transactions.push({
      txHash: finalTxHash,
      plan: 'add-credits',
      amount: creditCost,
      timestamp: new Date().toISOString()
    });
    saveUsersDb();

    const log = {
      timestamp: new Date().toISOString(),
      endpoint: '/api/payment/add-credits',
      method: 'POST',
      requestBody: requestPayload,
      responseStatus: 200,
      responseBody: { success: true, user, txHash: finalTxHash },
      isSimulated: false
    };
    logApiCall('/api/payment/add-credits', 'POST', requestPayload, 200, { success: true, user, txHash: finalTxHash }, false);

    return res.json({ success: true, user, txHash: finalTxHash, log });
  }
});

// Catch-all SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(` 🌀 ChartsonArc v2.0 running on http://localhost:${PORT}`);
  console.log(` Circle API : ${process.env.CIRCLE_API_KEY ? '✅ LIVE' : '🔄 SIMULATOR'}`);
  console.log(` Gemini AI  : ${process.env.GEMINI_API_KEY ? '✅ ENABLED' : '🧠 HEURISTIC MODE'}`);
  console.log(` Security   : Helmet + Compression Enabled`);
  console.log(`================================================================`);
});
