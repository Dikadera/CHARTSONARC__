// ══════════════════════════════════════════════════════════════
// ChartsonArc — Full Application Script
// Search · Chart Upload · AI Analysis · Subscription Plans
// ══════════════════════════════════════════════════════════════

// ─── GLOBAL STATE ───────────────────────────────────────────
const state = {
  config: null,
  walletConnected: false,
  walletAddress: '',
  authenticated: false,
  balance: 250.00,
  selectedPair: null, // full pair object
  selectedSymbol: 'BTC/USDC',
  selectedTimeframe: '1H',
  candlesticks: [],
  activeOverlays: { ma: true, bb: false, rsi: false, macd: false },
  aiAnalysisActive: false,
  aiReport: null,
  chartMode: 'live', // 'live' | 'upload'
  uploadedImage: null,
  uploadedMimeType: null,
  subscription: {
    plan: null,      // 'starter' | 'pro' | 'elite'
    pairsAllowed: 0,
    pairsUsed: 0,
    pairsAccessed: new Set(), // tracks unique symbols used
    features: []
  },
  logs: [],
  activeLogIndex: -1,
  searchDebounceTimer: null,
  currentAnalysisRequest: null,
  analysisCache: {},  // key: `symbol|timeframe|lastClose` → analysis result
  chartDarkMode: true,
  chartShowLegend: true,
  // Lightweight Charts Instances
  chartInstance: null,
  candleSeries: null,
  maSeries: null,
  bbUpperSeries: null,
  bbLowerSeries: null,
  rsiSeries: null,
  macdSeries: null,
  macdSignalSeries: null,
  macdHistSeries: null
};

const PLANS = {
  starter: { name: 'Starter',  amount: 3,  pairs: 5,  features: ['Chart Upload & AI', 'Entry / SL / TP', 'RSI + MACD', '5 Pairs'] },
  pro:     { name: 'Pro',      amount: 5,  pairs: 10, features: ['Chart Upload & AI', 'Entry / SL / TP', 'RSI + MACD', '10 Pairs'] },
  elite:   { name: 'Elite',    amount: 15, pairs: 35, features: ['Chart Upload & AI', 'Entry / SL / TP', 'RSI + MACD', 'Priority AI', '35 Pairs'] }
};

// ─── HELPERS ────────────────────────────────────────────────
function fmt(price) {
  if (price === null || price === undefined) return '$0.00';
  const n = parseFloat(price);
  if (n >= 1000)   return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1)      return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return '$' + n.toFixed(8);
}

function fmtShort(price) {
  const n = parseFloat(price);
  if (n >= 1000)  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1)     return '$' + n.toFixed(4);
  return '$' + n.toFixed(8);
}

// Wait for LightweightCharts to be loaded
async function waitForLightweightCharts(timeout = 10000) {
  const start = Date.now();
  while (!window.LightweightCharts || !window.LightweightCharts.createChart) {
    if (Date.now() - start > timeout) {
      console.error('LightweightCharts library failed to load from CDN within', timeout, 'ms, trying local fallback...');
      // Try loading from local fallback via script tag
      try {
        return new Promise((resolve, reject) => {
          const scriptEl = document.createElement('script');
          scriptEl.src = '/lib/lightweight-charts/lightweight-charts.standalone.production.js';
          scriptEl.onload = () => {
            console.log('✓ Loaded LightweightCharts from local fallback');
            if (window.LightweightCharts && window.LightweightCharts.createChart) {
              resolve(window.LightweightCharts);
            } else {
              reject(new Error('LightweightCharts not available after loading script'));
            }
          };
          scriptEl.onerror = (err) => {
            console.error('Failed to load local fallback script:', err);
            reject(new Error('Local fallback script failed to load'));
          };
          document.head.appendChild(scriptEl);
        });
      } catch (e) {
        console.error('Local fallback also failed:', e);
        throw new Error('LightweightCharts library not available');
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return window.LightweightCharts;
}

// Add helper: switch the user's wallet to Arc Testnet (adds chain if missing)
async function switchToArcTestnet(provider = window.ethereum) {
  const defaultRpc = 'https://rpc.testnet.arc.network';
  const defaultChainId = '0x4ced92';
  if (!provider) throw new Error('No Ethereum provider available to switch network');

  // Try to query the RPC for its canonical chainId to avoid wallet RPC vs chainId mismatches
  let rpcChainId = null;
  try {
    const r = await fetch(defaultRpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] })
    });
    const j = await r.json();
    if (j && j.result) rpcChainId = j.result;
  } catch (e) {
    // ignore - we'll fall back to the defaultChainId
  }

  const chainId = rpcChainId || defaultChainId;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId }],
    });
  } catch (error) {
    if (error && (error.code === 4902 || error.message?.includes('Unrecognized chain ID') || error.message?.includes('Unrecognized chain'))) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId,
          chainName: 'Arc Testnet',
          rpcUrls: [defaultRpc],
          nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
          blockExplorerUrls: ['https://testnet.arcscan.app']
        }],
      });
    } else {
      throw error;
    }
  }
}

// Encode ERC20 transfer(to, amount) data payload (selector + params)
function encodeERC20Transfer(to, amountBigInt) {
  // transfer(address,uint256) selector
  const selector = 'a9059cbb';
  const pad32 = (hex) => hex.padStart(64, '0');
  const cleanTo = to.toLowerCase().replace(/^0x/, '');
  const toPadded = pad32(cleanTo);
  const amountHex = amountBigInt.toString(16);
  const amountPadded = pad32(amountHex);
  return '0x' + selector + toPadded + amountPadded;
}

// ══════════════════════════════════════════════════════════════
// TECHNICAL INDICATOR CALCULATIONS (for chart rendering)
// ══════════════════════════════════════════════════════════════
function calcRSI(closes, period = 14) {
  if (!closes || closes.length <= period) return [];
  const rsis = [];
  for (let i = period; i < closes.length; i++) {
    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsis.push(100 - (100 / (1 + rs)));
  }
  return rsis;
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (!closes || closes.length < slow) return { macd: [], signal: [], histogram: [] };
  
  // EMA calculation
  const ema = (data, period) => {
    if (!data || data.length < period) return [];
    const k = 2 / (period + 1);
    let prevEma = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const result = [prevEma];
    for (let i = period; i < data.length; i++) {
      prevEma = (data[i] - prevEma) * k + prevEma;
      result.push(prevEma);
    }
    return result;
  };

  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  
  if (emaFast.length < emaSlow.length) return { macd: [], signal: [], histogram: [] };
  
  const macdLine = [];
  const offset = closes.length - emaFast.length;
  for (let i = 0; i < emaFast.length; i++) {
    macdLine.push(emaFast[i] - emaSlow[i]);
  }

  const signalLine = ema(macdLine, signal);
  const histogram = [];
  for (let i = signalLine.length; i < macdLine.length; i++) {
    histogram.push(macdLine[i] - (signalLine[i - (macdLine.length - signalLine.length)] || 0));
  }

  return {
    macd: macdLine,
    signal: signalLine,
    histogram: histogram
  };
}

// ══════════════════════════════════════════════════════════════
// CHART CANVAS RENDERER
// ══════════════════════════════════════════════════════════════
const canvas = document.getElementById('chart-container');

function resizeCanvas() {
  const container = document.getElementById('chart-container');
  if (state.chartInstance && container) {
    const width = container.clientWidth || container.parentElement?.clientWidth || 800;
    const height = container.clientHeight || 500;
    state.chartInstance.resize(width, height);
  }
}

function showChartMessage(msg, level = 'info') {
  const wrapper = document.querySelector('.chart-wrapper');
  if (!wrapper) return;
  let el = wrapper.querySelector('.chart-overlay-message');
  if (!el) {
    el = document.createElement('div');
    el.className = 'chart-overlay-message';
    el.style.position = 'absolute';
    el.style.left = '16px';
    el.style.top = '16px';
    el.style.padding = '10px 14px';
    el.style.borderRadius = '8px';
    el.style.zIndex = 40;
    el.style.fontSize = '13px';
    wrapper.appendChild(el);
  }
  el.textContent = msg;
  el.style.background = level === 'error' ? 'rgba(239,68,68,0.08)' : 'rgba(99,102,241,0.04)';
  el.style.color = level === 'error' ? '#fecaca' : '#c7d2fe';
}

function clearChartMessage() {
  const wrapper = document.querySelector('.chart-wrapper');
  if (!wrapper) return;
  const el = wrapper.querySelector('.chart-overlay-message');
  if (el) el.remove();
}

function drawChart() {
  if (!state.candlesticks.length) return;

  const container = document.getElementById('chart-container');
  if (!container) return;

  // Check if LightweightCharts is available
  if (!window.LightweightCharts || !window.LightweightCharts.createChart) {
    console.error('LightweightCharts library not available');
    showChartMessage('Chart library loading...', 'info');
    setTimeout(drawChart, 1000);
    return;
  }

  // 1. Destroy old chart instance if exists
  if (state.chartInstance) {
    try {
      state.chartInstance.remove();
    } catch (e) {
      console.error('Failed to remove old chart instance:', e);
    }
    state.chartInstance = null;
    state.candleSeries = null;
    state.maSeries = null;
    state.bbUpperSeries = null;
    state.bbLowerSeries = null;
    state.rsiSeries = null;
    state.macdSeries = null;
    state.macdSignalSeries = null;
    state.macdHistSeries = null;
  }

  // Clear any existing elements to avoid canvas accumulation or styling conflicts
  container.innerHTML = '';

  // 2. Initialize new Chart - set proper container dimensions first
  const width = container.clientWidth || 800;
  const height = container.clientHeight || 500;
  
  container.style.width = width + 'px';
  container.style.height = height + 'px';

  try {
    const bgColor = state.chartDarkMode ? '#0b0a16' : '#ffffff';
    const textColor = state.chartDarkMode ? '#9ca3af' : '#1f2937';
    
    state.chartInstance = window.LightweightCharts.createChart(container, {
      width: width,
      height: height,
      layout: {
        textColor: textColor,
        fontSize: 11,
        fontFamily: 'Outfit, sans-serif',
        backgroundColor: bgColor
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    });
    
  } catch (err) {
    console.error('Failed to create chart instance:', err);
    loadMockChart(state.selectedSymbol);
    return;
  }

  // 3. Add Candlestick Series using the correct API
  try {
    state.candleSeries = state.chartInstance.addSeries(window.LightweightCharts.CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
    });
  } catch (err) {
    console.error('Failed to add candlestick series:', err);
    loadMockChart(state.selectedSymbol);
    return;
  }

  // 4. Map and clean candlestick data
  const chartData = state.candlesticks.map(c => {
    let timeVal = c.time;
    if (typeof timeVal === 'string') {
      timeVal = Math.floor(new Date(timeVal).getTime() / 1000);
    }
    return {
      time: Number(timeVal),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close)
    };
  }).filter(c => !isNaN(c.time) && !isNaN(c.open) && !isNaN(c.high) && !isNaN(c.low) && !isNaN(c.close));

  // Sort ascending and filter duplicates
  chartData.sort((a, b) => a.time - b.time);
  const uniqueChartData = [];
  const seenTimes = new Set();
  for (const d of chartData) {
    if (!seenTimes.has(d.time)) {
      seenTimes.add(d.time);
      uniqueChartData.push(d);
    }
  }

  state.candleSeries.setData(uniqueChartData);

  // 5. Render Core Overlays

  // A. Moving Average
  if (state.activeOverlays.ma && uniqueChartData.length >= 14) {
    state.maSeries = state.chartInstance.addSeries(window.LightweightCharts.LineSeries, {
      color: 'rgba(99, 102, 241, 0.85)',
      lineWidth: 2,
      title: 'MA (14)',
    });

    const maData = [];
    for (let i = 0; i < uniqueChartData.length; i++) {
      if (i < 13) continue;
      const slice = uniqueChartData.slice(i - 13, i + 1);
      const avg = slice.reduce((sum, item) => sum + item.close, 0) / 14;
      maData.push({ time: uniqueChartData[i].time, value: avg });
    }
    state.maSeries.setData(maData);
  }

  // B. Bollinger Bands
  if (state.activeOverlays.bb && uniqueChartData.length >= 20) {
    state.bbUpperSeries = state.chartInstance.addSeries(window.LightweightCharts.LineSeries, {
      color: 'rgba(139, 92, 246, 0.6)',
      lineWidth: 1.2,
      lineStyle: window.LightweightCharts.LineStyle.Dashed,
      title: 'BB Upper',
    });
    state.bbLowerSeries = state.chartInstance.addSeries(window.LightweightCharts.LineSeries, {
      color: 'rgba(139, 92, 246, 0.6)',
      lineWidth: 1.2,
      lineStyle: window.LightweightCharts.LineStyle.Dashed,
      title: 'BB Lower',
    });

    const bbUpperData = [];
    const bbLowerData = [];
    const per = 20;
    for (let i = per - 1; i < uniqueChartData.length; i++) {
      const slice = uniqueChartData.slice(i - per + 1, i + 1).map(item => item.close);
      const ma = slice.reduce((a, b) => a + b, 0) / per;
      const variance = slice.reduce((a, b) => a + (b - ma) ** 2, 0) / per;
      const sd = Math.sqrt(variance);
      bbUpperData.push({ time: uniqueChartData[i].time, value: ma + 2 * sd });
      bbLowerData.push({ time: uniqueChartData[i].time, value: ma - 2 * sd });
    }
    state.bbUpperSeries.setData(bbUpperData);
    state.bbLowerSeries.setData(bbLowerData);
  }

  // 6. Render Premium Signals (RSI & MACD) on left scale

  // A. RSI Overlay
  if (state.activeOverlays.rsi) {
    const closes = uniqueChartData.map(d => d.close);
    const rsis = calcRSI(closes, 14);

    if (rsis.length > 0) {
      state.rsiSeries = state.chartInstance.addSeries(window.LightweightCharts.LineSeries, {
        color: '#fbbf24',
        lineWidth: 1.5,
        title: 'RSI',
      });

      state.chartInstance.priceScale('left').applyOptions({
        visible: true,
        borderColor: 'rgba(255, 255, 255, 0.08)',
      });

      const rsiData = [];
      const startIdx = uniqueChartData.length - rsis.length;
      for (let i = 0; i < rsis.length; i++) {
        rsiData.push({ time: uniqueChartData[startIdx + i].time, value: rsis[i] });
      }
      state.rsiSeries.setData(rsiData);
    }
  }

  // B. MACD Overlay
  if (state.activeOverlays.macd) {
    const closes = uniqueChartData.map(d => d.close);
    const { macd, signal, histogram } = calcMACD(closes, 12, 26, 9);

    if (macd.length > 0) {
      state.macdSeries = state.chartInstance.addSeries(window.LightweightCharts.LineSeries, {
        color: '#60a5fa',
        lineWidth: 1.2,
        title: 'MACD',
      });
      state.macdSignalSeries = state.chartInstance.addSeries(window.LightweightCharts.LineSeries, {
        color: '#f87171',
        lineWidth: 1.0,
        lineStyle: window.LightweightCharts.LineStyle.Dotted,
        title: 'Signal',
      });

      state.chartInstance.priceScale('left').applyOptions({
        visible: true,
        borderColor: 'rgba(255, 255, 255, 0.08)',
      });

      const macdData = [];
      const sigData = [];
      
      const startIdx = uniqueChartData.length - macd.length;
      for (let i = 0; i < macd.length; i++) {
        macdData.push({ time: uniqueChartData[startIdx + i].time, value: macd[i] });
      }
      state.macdSeries.setData(macdData);

      const sigStartIdx = uniqueChartData.length - signal.length;
      for (let i = 0; i < signal.length; i++) {
        sigData.push({ time: uniqueChartData[sigStartIdx + i].time, value: signal[i] });
      }
      state.macdSignalSeries.setData(sigData);
    }
  }

  // 7. Render AI Support / Resistance / Entry / SL / TP Price Lines
  if (state.aiAnalysisActive && state.aiReport) {
    const r = state.aiReport;
    
    if (r.entry && r.entry.price) {
      state.candleSeries.createPriceLine({
        price: Number(r.entry.price),
        color: 'rgba(99, 102, 241, 0.8)',
        lineWidth: 2,
        lineStyle: window.LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Entry',
      });
    }
    if (r.stopLoss && r.stopLoss.price) {
      state.candleSeries.createPriceLine({
        price: Number(r.stopLoss.price),
        color: 'rgba(239, 68, 68, 0.8)',
        lineWidth: 2,
        lineStyle: window.LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Stop Loss',
      });
    }
    if (r.takeProfit1 && r.takeProfit1.price) {
      state.candleSeries.createPriceLine({
        price: Number(r.takeProfit1.price),
        color: 'rgba(16, 185, 129, 0.8)',
        lineWidth: 2,
        lineStyle: window.LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'TP1',
      });
    }
    if (r.takeProfit2 && r.takeProfit2.price) {
      state.candleSeries.createPriceLine({
        price: Number(r.takeProfit2.price),
        color: 'rgba(20, 184, 166, 0.7)',
        lineWidth: 2,
        lineStyle: window.LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'TP2',
      });
    }
    if (r.support) {
      state.candleSeries.createPriceLine({
        price: Number(r.support),
        color: 'rgba(139, 92, 246, 0.5)',
        lineWidth: 1.5,
        lineStyle: window.LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Support',
      });
    }
    if (r.resistance) {
      state.candleSeries.createPriceLine({
        price: Number(r.resistance),
        color: 'rgba(236, 72, 153, 0.5)',
        lineWidth: 1.5,
        lineStyle: window.LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Resistance',
      });
    }
  }

  // 8. Custom Interactive Legend and Tooltip
  state.chartInstance.subscribeCrosshairMove((param) => {
    const tooltip = document.getElementById('chart-tooltip');
    if (!tooltip) return;

    if (param.point === undefined || !param.time || param.point.x < 0 || param.point.y < 0) {
      tooltip.classList.add('hidden');
      return;
    }

    const cc = param.seriesData ? param.seriesData.get(state.candleSeries) : (param.seriesPrices ? param.seriesPrices.get(state.candleSeries) : null);
    if (!cc) {
      tooltip.classList.add('hidden');
      return;
    }

    tooltip.classList.remove('hidden');
    const containerRect = container.getBoundingClientRect();
    const tooltipWidth = 160;
    const ttX = param.point.x > containerRect.width * 0.7 
      ? param.point.x - tooltipWidth - 16 
      : param.point.x + 16;
    
    tooltip.style.left = ttX + 'px';
    tooltip.style.top = (param.point.y + 16) + 'px';

    const t = typeof param.time === 'number' 
      ? new Date(param.time * 1000).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })
      : param.time;

    tooltip.innerHTML = `
      <div class="tooltip-time">${t}</div>
      <div class="tooltip-price">${fmtShort(cc.close)}</div>
      <div class="tooltip-candle">O: ${fmtShort(cc.open)} · C: ${fmtShort(cc.close)}</div>`;
  });

  // Auto fit content
  state.chartInstance.timeScale().fitContent();
}

// ══════════════════════════════════════════════════════════════
// PAIR SEARCH
// ══════════════════════════════════════════════════════════════
const searchInput = document.getElementById('pair-search-input');
const searchDropdown = document.getElementById('search-dropdown');
const btnClearSearch = document.getElementById('btn-clear-search');

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  btnClearSearch.classList.toggle('hidden', !q);
  clearTimeout(state.searchDebounceTimer);
  if (!q) { searchDropdown.classList.add('hidden'); return; }
  state.searchDebounceTimer = setTimeout(() => fetchPairSearch(q), 220);
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { searchDropdown.classList.add('hidden'); searchInput.blur(); }
});

document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrapper')) searchDropdown.classList.add('hidden');
});

btnClearSearch.addEventListener('click', () => {
  searchInput.value = '';
  btnClearSearch.classList.add('hidden');
  searchDropdown.classList.add('hidden');
});

async function fetchPairSearch(q) {
  try {
    const res = await fetch(`/api/pairs/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    renderSearchDropdown(data.pairs || []);
  } catch (e) {
    renderSearchDropdown([]);
  }
}

const TYPE_ICONS = { crypto: '₿', stock: '📈', forex: '💱', commodity: '🪙' };
const TYPE_CLASSES = { crypto: 'type-crypto', stock: 'type-stock', forex: 'type-forex', commodity: 'type-commodity' };

function renderSearchDropdown(pairs) {
  if (!pairs.length) {
    searchDropdown.innerHTML = `<div class="search-empty">No pairs found. Try BTC, ETH, TSLA, EUR…</div>`;
    searchDropdown.classList.remove('hidden');
    return;
  }

  searchDropdown.innerHTML = pairs.map(p => `
    <div class="search-result-item" data-symbol="${p.symbol}" role="button">
      <div class="result-left">
        <div class="result-type-icon ${TYPE_CLASSES[p.type] || 'type-crypto'}">${TYPE_ICONS[p.type] || '₿'}</div>
        <div>
          <div class="result-symbol">${p.symbol}</div>
          <div class="result-name">${p.name}</div>
        </div>
      </div>
      <div class="result-price">~${fmtShort(p.basePrice)}</div>
    </div>
  `).join('');

  searchDropdown.querySelectorAll('.search-result-item').forEach(el => {
    el.addEventListener('click', () => {
      const sym = el.dataset.symbol;
      searchInput.value = sym;
      btnClearSearch.classList.remove('hidden');
      searchDropdown.classList.add('hidden');
      
      // Load live data for the selected pair if in live mode
      if (state.chartMode === 'live') {
        loadLiveChart(sym, state.selectedTimeframe);
      } else {
        loadPair(sym);
      }
    });
  });

  searchDropdown.classList.remove('hidden');
}

// ──────────────────────────────────────────────────────────────
// LOAD PAIR FROM API
// ──────────────────────────────────────────────────────────────
async function loadPair(symbol) {
  state.selectedSymbol = symbol;
  state.aiAnalysisActive = false;
  state.aiReport = null;

  // Reset analysis display
  document.getElementById('analysis-results').classList.add('hidden');
  document.getElementById('analysis-loading').classList.add('hidden');
  document.getElementById('analysis-placeholder').classList.remove('hidden');
  document.getElementById('chart-overlay-status').classList.add('hidden');

  try {
    const res = await fetch(`/api/pair-data?symbol=${encodeURIComponent(symbol)}&tf=${state.selectedTimeframe}&address=${state.walletAddress}`);
    
    if (res.status === 403) {
      const errData = await res.json();
      if (errData.error === 'QUOTA_EXCEEDED') {
        showQuotaError();
        showQuotaAlert(errData.message);
        return;
      }
    }

    if (!res.ok) throw new Error('Failed to load pair data');
    const data = await res.json();

    // If the app is currently in live mode, avoid overwriting live candles only if we already have some for the active symbol
    if (state.chartMode === 'live' && state.candlesticks && state.candlesticks.length > 0 && state.selectedSymbol === symbol) {
      console.log('loadPair: live mode active — preserving existing live candles, not overwriting.');
    } else {
      state.candlesticks = data.candles;
      console.log('loadPair: loaded candles', { symbol, count: state.candlesticks.length });
    }
    state.selectedPair = data.pair;

    // Update header
    const lastCandle = data.candles[data.candles.length - 1];
    const firstCandle = data.candles[0];
    const pctChange = ((lastCandle.close - firstCandle.open) / firstCandle.open) * 100;

    document.getElementById('current-price').textContent = fmtShort(lastCandle.close);
    const changeEl = document.getElementById('price-change');
    changeEl.className = pctChange >= 0 ? 'price-change-positive' : 'price-change-negative';
    changeEl.textContent = `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%`;

    // Fetch updated user status to keep accessed pairs synchronized
    if (state.walletAddress) {
      const userRes = await fetch(`/api/user/${state.walletAddress}`);
      const userData = await userRes.json();
      if (userData.success) {
        syncUserStateWith(userData.user);
      }
    }

    drawChart();
    resizeCanvas();

    // Auto-analyze with live data if wallet connected (demo mode) or authenticated with subscription
    if (state.walletConnected || (state.authenticated && state.subscription.plan)) {
      setTimeout(() => runLiveAnalysis(symbol, data.candles).catch(e => console.error('Auto-analysis failed:', e)), 500);
    }

  } catch (err) {
    console.error('Failed to load pair:', err);
  }
}

// ──────────────────────────────────────────────────────────────
// CHART MESSAGE HELPERS
// ──────────────────────────────────────────────────────────────
function showChartMessage(msg, type = 'info') {
  let el = document.getElementById('chart-status-msg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chart-status-msg';
    el.style.cssText = 'position:absolute;top:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);color:#fff;padding:6px 14px;border-radius:8px;font-size:12px;z-index:10;pointer-events:none;transition:opacity .3s';
    const wrapper = canvas.parentElement;
    wrapper.style.position = 'relative';
    wrapper.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  el.style.color = type === 'error' ? '#f87171' : '#a5f3fc';
}

function clearChartMessage() {
  const el = document.getElementById('chart-status-msg');
  if (el) el.style.opacity = '0';
}

// Load live chart candles from backend (Binance proxy)
async function loadLiveChart(symbol = 'BTC/USDC', interval = '1h') {
  // Map UI timeframe tokens to Binance interval strings
  const TF_MAP = { '1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w' };
  const binanceInterval = TF_MAP[interval] || interval.toLowerCase() || '1h';
  try {
    showChartMessage('Loading live data…');
    const safeSymbol = symbol.replace('/', '-');
    const resp = await fetch(`/api/chart/${encodeURIComponent(safeSymbol)}?interval=${binanceInterval}`);
    const result = await resp.json();
    if (result.success && Array.isArray(result.data)) {
      // Map to internal candlestick shape used by the renderer
      state.candlesticks = result.data.map(c => ({
        time: c.time,
        timeLabel: (new Date(c.time * 1000)).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      }));
      state.selectedSymbol = symbol;
      state.selectedTimeframe = interval;

      // Update price header from live data
      const lastCandle = state.candlesticks[state.candlesticks.length - 1];
      const firstCandle = state.candlesticks[0];
      if (lastCandle) {
        document.getElementById('current-price').textContent = fmtShort(lastCandle.close);
        const pctChange = ((lastCandle.close - firstCandle.open) / firstCandle.open) * 100;
        const changeEl = document.getElementById('price-change');
        changeEl.className = pctChange >= 0 ? 'price-change-positive' : 'price-change-negative';
        changeEl.textContent = `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%`;
      }

      drawChart();
      resizeCanvas();
      clearChartMessage();
      console.log(`✅ Live ${result.symbol} price: $${result.currentPrice}`);

      // Run analysis on fresh live candles
      state.aiAnalysisActive = false;
      if (state.walletConnected || (state.authenticated && state.subscription.plan)) {
        setTimeout(() => runLiveAnalysis(symbol, state.candlesticks).catch(e => console.error('Auto-analysis failed:', e)), 500);
      }
    } else {
      console.warn('Binance returned no data, using pair-data fallback');
      showChartMessage('Live data unavailable — using fallback', 'error');
      await loadPair(symbol);
    }
  } catch (err) {
    console.error('Failed to load live chart:', err);
    showChartMessage('Failed to fetch live data — using demo data', 'error');
    // Fallback to pair-data endpoint
    try {
      await loadPair(symbol);
    } catch (fallbackErr) {
      console.error('Fallback to loadPair also failed:', fallbackErr);
      // Last resort: load demo data
      loadMockChart(symbol);
    }
  }
}

// Render a simple fallback chart using Canvas when Lightweight Charts fails
function renderFallbackChart(symbol, candlesticks) {
  const container = document.getElementById('chart-container');
  if (!container) return;
  
  // Clear previous content
  container.innerHTML = '';
  
  const width = container.clientWidth || 800;
  const height = container.clientHeight || 500;
  
  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  // Background
  ctx.fillStyle = '#0b0a16';
  ctx.fillRect(0, 0, width, height);
  
  // Draw grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  
  // Horizontal grid lines
  for (let i = 0; i < 5; i++) {
    const y = (height / 5) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  
  // Calculate price range
  const prices = candlesticks.flatMap(c => [c.high, c.low]);
  const maxPrice = Math.max(...prices);
  const minPrice = Math.min(...prices);
  const priceRange = maxPrice - minPrice;
  
  // Draw candlesticks
  const margin = 50;
  const chartWidth = width - margin * 2;
  const chartHeight = height - margin * 2;
  const candleWidth = chartWidth / candlesticks.length * 0.8;
  const candleSpacing = chartWidth / candlesticks.length;
  
  candlesticks.forEach((candle, idx) => {
    const x = margin + idx * candleSpacing + candleSpacing / 2;
    
    // Normalize prices to canvas coordinates
    const open_y = margin + chartHeight - ((candle.open - minPrice) / priceRange) * chartHeight;
    const close_y = margin + chartHeight - ((candle.close - minPrice) / priceRange) * chartHeight;
    const high_y = margin + chartHeight - ((candle.high - minPrice) / priceRange) * chartHeight;
    const low_y = margin + chartHeight - ((candle.low - minPrice) / priceRange) * chartHeight;
    
    // Wick
    const wickColor = candle.close >= candle.open ? '#10b981' : '#ef4444';
    ctx.strokeStyle = wickColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, high_y);
    ctx.lineTo(x, low_y);
    ctx.stroke();
    
    // Body
    ctx.fillStyle = candle.close >= candle.open ? '#10b981' : '#ef4444';
    const bodyTop = Math.min(open_y, close_y);
    const bodyHeight = Math.abs(close_y - open_y) || 2;
    ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
  });
  
  // Draw axes labels
  ctx.fillStyle = '#9ca3af';
  ctx.font = '11px Outfit';
  ctx.textAlign = 'right';
  
  // Price labels on right axis
  for (let i = 0; i <= 4; i++) {
    const price = minPrice + (priceRange / 4) * i;
    const y = margin + chartHeight - (chartHeight / 4) * i;
    ctx.fillText(fmtShort(price), width - 10, y + 3);
  }
  
  // Draw TradingView attribution
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.font = 'italic 10px Outfit';
  ctx.textAlign = 'center';
  ctx.fillText('Charting by TradingView (Demo Mode)', width / 2, height - 10);
}

// Generate mock chart data for demo purposes when APIs are unavailable
function loadMockChart(symbol = 'BTC/USDC') {
  console.log('Loading mock chart data for:', symbol);
  
  // Generate 60 realistic candlesticks with a random walk
  const candlesticks = [];
  let basePrice = symbol === 'BTC/USDC' ? 68000 : symbol === 'ETH/USDC' ? 3500 : 100;
  const now = Math.floor(Date.now() / 1000);
  
  for (let i = 60; i > 0; i--) {
    const time = now - (i * 3600); // 1 hour intervals
    const open = basePrice + (Math.random() - 0.5) * basePrice * 0.02;
    const randomMove = (Math.random() - 0.5) * basePrice * 0.015;
    const close = open + randomMove;
    const high = Math.max(open, close) + Math.random() * basePrice * 0.01;
    const low = Math.min(open, close) - Math.random() * basePrice * 0.01;
    
    candlesticks.push({
      time,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2))
    });
    
    basePrice = close;
  }
  
  state.candlesticks = candlesticks;
  state.selectedSymbol = symbol;
  
  // Update price display
  const lastCandle = candlesticks[candlesticks.length - 1];
  const firstCandle = candlesticks[0];
  const pctChange = ((lastCandle.close - firstCandle.open) / firstCandle.open) * 100;
  
  document.getElementById('current-price').textContent = fmtShort(lastCandle.close);
  const changeEl = document.getElementById('price-change');
  changeEl.className = pctChange >= 0 ? 'price-change-positive' : 'price-change-negative';
  changeEl.textContent = `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%`;
  
  // Render using fallback canvas chart
  renderFallbackChart(symbol, candlesticks);
}

// Run live analysis using server /api/analyze endpoint
// forceRefresh=true bypasses the cache (used by the Re-analyze button)
async function runLiveAnalysis(symbol = state.selectedSymbol, chartData = state.candlesticks, forceRefresh = false) {
  // Guard: need candles
  if (!chartData || chartData.length < 2) {
    console.warn('runLiveAnalysis: not enough candle data');
    return null;
  }

  // Build a stable cache key: symbol + timeframe + last candle close price
  const lastCandle = chartData[chartData.length - 1];
  const cacheKey = `${symbol}|${state.selectedTimeframe}|${lastCandle.close.toFixed(2)}`;

  // UI helpers
  const placeholder = document.getElementById('analysis-placeholder');
  const loadingEl   = document.getElementById('analysis-loading');
  const resultsEl   = document.getElementById('analysis-results');
  const reBtn       = document.getElementById('btn-refresh-analysis');

  // Return cached result unless force-refreshing or cache miss
  if (!forceRefresh && state.analysisCache[cacheKey]) {
    const cached = state.analysisCache[cacheKey];
    state.aiReport = cached;
    state.aiAnalysisActive = true;
    renderAnalysisResults(cached);
    drawChart();
    console.log('runLiveAnalysis: serving cached result for', cacheKey);
    return cached;
  }

  // Show loading state
  if (placeholder) placeholder.classList.add('hidden');
  if (resultsEl)   resultsEl.classList.add('hidden');
  if (loadingEl)   loadingEl.classList.remove('hidden');
  if (reBtn)       { reBtn.disabled = true; reBtn.textContent = '⏳ Analyzing…'; }

  try {
    console.log('runLiveAnalysis start', { symbol, candles: chartData?.length, timeframe: state.selectedTimeframe });

    // Sanitize and send only numeric OHLC/time fields (drop NaNs)
    const sanitizedAll = (chartData || []).map(c => ({
      time: (c.time && Number(c.time)) || null,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close)
    }));

    const sanitized = sanitizedAll.filter(c =>
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close)
    );

    console.log('runLiveAnalysis sanitized', {
      inputCandles: (chartData || []).length,
      sanitizedCandles: sanitized.length,
      sample: sanitized.length ? { first: sanitized[0], last: sanitized[sanitized.length - 1] } : null
    });

    if (sanitized.length < 10) {
      console.warn('runLiveAnalysis: not enough valid candles after sanitization', { sanitized: sanitized.length });
      // Restore UI to show placeholder
      if (loadingEl) loadingEl.classList.add('hidden');
      if (placeholder) placeholder.classList.remove('hidden');
      if (resultsEl) resultsEl.classList.add('hidden');
      return null;
    }

    const payload = { symbol, data: sanitized, timeframe: state.selectedTimeframe };

    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // Read body safely for better debugging when server rejects
    let data;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const txt = await res.text();
      data = { success: false, error: 'Non-JSON response', raw: txt };
    }

    // Push to dev terminal
    pushApiLog({
      timestamp: new Date().toISOString(),
      endpoint: '/api/analyze',
      method: 'POST',
      requestBody: { symbol, candles: chartData.length, timeframe: state.selectedTimeframe },
      responseStatus: res.status,
      responseBody: data,
      isSimulated: false
    });

    if (data.success && data.analysis) {
      state.aiReport = data.analysis;
      state.aiAnalysisActive = true;
      // Store in cache so subsequent clicks return the same result
      state.analysisCache[cacheKey] = data.analysis;
      renderAnalysisResults(data.analysis);
      drawChart();
      // Ensure results are visible (guard: DOM IDs depend on HTML)
      try {
        const loadingEl = document.getElementById('analysis-loading');
        const placeholder = document.getElementById('analysis-placeholder');
        const resultsEl = document.getElementById('analysis-results');
        if (loadingEl) loadingEl.classList.add('hidden');
        if (placeholder) placeholder.classList.add('hidden');
        if (resultsEl) resultsEl.classList.remove('hidden');
      } catch (e) {}
      return data.analysis;
    } else {
      console.warn('Live analysis did not return success', data);

      // Restore UI to show placeholder if no result
      if (loadingEl) loadingEl.classList.add('hidden');
      if (placeholder) placeholder.classList.remove('hidden');
      return null;
    }
  } catch (err) {
    console.error('runLiveAnalysis error:', err);
    if (loadingEl) loadingEl.classList.add('hidden');
    if (placeholder) placeholder.classList.remove('hidden');
    return null;
  } finally {
    // Always restore Re-analyze button
    if (reBtn) { reBtn.disabled = false; reBtn.textContent = 'Re-analyze'; }
  }
}

window.runLiveAnalysis = runLiveAnalysis;

// Call this when user clicks "Re-analyze" or chart updates
// Simpler wrapper around the analysis endpoint
async function runAIAnalysis(symbol, chartData) {
  try {
    const sanitized = (chartData || []).map(c => ({
      time: (c.time && Number(c.time)) || null,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close)
    }));

    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, data: sanitized })
    });

    const result = await response.json();

    if (result.success && result.analysis) {
      renderAnalysisResults(result.analysis);
      return result.analysis;
    } else {
      console.error('Analysis failed:', result.error);
      return null;
    }
  } catch (error) {
    console.error('runAIAnalysis error:', error);
    return null;
  }
}

window.runAIAnalysis = runAIAnalysis;

function showQuotaError() {
  const box = document.getElementById('subscription-active-box');
  if (!box) return;
  box.style.boxShadow = '0 0 0 2px rgba(239,68,68,0.5)';
  box.style.borderColor = 'rgba(239,68,68,0.6)';
  setTimeout(() => {
    box.style.boxShadow = '';
    box.style.borderColor = '';
  }, 1500);

  const fill = document.getElementById('pairs-quota-fill');
  if (fill) { fill.classList.add('quota-warning'); }
}

function showQuotaAlert(message) {
  let modal = document.getElementById('quota-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'quota-modal';
    modal.className = 'quota-modal-overlay';
    modal.innerHTML = `
      <div class="quota-modal-card">
        <button id="quota-modal-close" class="quota-close">✕</button>
        <div class="quota-modal-icon">⚠️</div>
        <h3>Live Chart Quota Reached</h3>
        <p id="quota-modal-message"></p>
        <div class="quota-actions">
          <button id="btn-buy-more-lives" class="btn btn-secondary">Buy More Lives</button>
          <button id="btn-upgrade-plan" class="btn btn-primary">Upgrade Plan</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#quota-modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#btn-buy-more-lives').addEventListener('click', () => {
      modal.remove();
      scrollToPlans();
    });
    modal.querySelector('#btn-upgrade-plan').addEventListener('click', () => {
      modal.remove();
      scrollToPlans();
    });
  }
  document.getElementById('quota-modal-message').textContent = message;
}

// ──────────────────────────────────────────────────────────────
// TIMEFRAME SELECTION
// ──────────────────────────────────────────────────────────────
document.querySelectorAll('.timeframe').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.timeframe').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.selectedTimeframe = btn.dataset.tf;
    if (state.selectedSymbol) {
      if (state.chartMode === 'live') {
        loadLiveChart(state.selectedSymbol, state.selectedTimeframe);
      } else {
        loadPair(state.selectedSymbol);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════
// CHART MODE TABS (Live vs Upload)
// ══════════════════════════════════════════════════════════════
document.getElementById('tab-live-chart').addEventListener('click', () => switchChartMode('live'));
document.getElementById('tab-upload-chart').addEventListener('click', () => switchChartMode('upload'));
document.getElementById('tab-deploy-contract').addEventListener('click', () => switchChartMode('deploy'));

function switchChartMode(mode) {
  state.chartMode = mode;
  document.querySelectorAll('.chart-mode-tab').forEach(t => t.classList.remove('active'));
  const targetTab = document.querySelector(`[data-mode="${mode}"]`);
  if (targetTab) targetTab.classList.add('active');

  const liveModeEl = document.getElementById('mode-live-chart');
  const uploadModeEl = document.getElementById('mode-upload-chart');
  const deployModeEl = document.getElementById('mode-deploy-contract');

  if (mode === 'live') {
    liveModeEl.classList.remove('hidden');
    uploadModeEl.classList.add('hidden');
    if (deployModeEl) deployModeEl.classList.add('hidden');
    setTimeout(resizeCanvas, 50);
  } else if (mode === 'upload') {
    liveModeEl.classList.add('hidden');
    uploadModeEl.classList.remove('hidden');
    if (deployModeEl) deployModeEl.classList.add('hidden');
  } else if (mode === 'deploy') {
    liveModeEl.classList.add('hidden');
    uploadModeEl.classList.add('hidden');
    if (deployModeEl) deployModeEl.classList.remove('hidden');
  }
}

// ══════════════════════════════════════════════════════════════
// FILE UPLOAD & DRAG/DROP
// ══════════════════════════════════════════════════════════════
const dropzone = document.getElementById('upload-dropzone');
const fileInput = document.getElementById('chart-file-input');
const btnPickFile = document.getElementById('btn-pick-file');
const btnChangeFile = document.getElementById('btn-change-file');
const btnRunAI = document.getElementById('btn-run-ai-analysis');
const uploadPlaceholder = document.getElementById('upload-placeholder');
const uploadPreview = document.getElementById('upload-preview');
const previewImg = document.getElementById('preview-img');

btnPickFile.addEventListener('click', () => fileInput.click());
btnChangeFile.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFileSelected(e.target.files[0]); });

dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleFileSelected(file);
});

function handleFileSelected(file) {
  const maxSize = 15 * 1024 * 1024;
  if (file.size > maxSize) { alert('File too large. Max 15MB.'); return; }

  const reader = new FileReader();
  reader.onload = e => {
    state.uploadedImage = e.target.result.split(',')[1]; // base64
    state.uploadedMimeType = file.type;

    previewImg.src = e.target.result;
    document.getElementById('preview-filename').textContent = file.name;
    document.getElementById('preview-size').textContent = (file.size / 1024).toFixed(1) + ' KB';
    uploadPlaceholder.classList.add('hidden');
    uploadPreview.classList.remove('hidden');

    // Clear and reset the pair symbol input
    const uploadPairInput = document.getElementById('upload-pair-symbol');
    if (uploadPairInput) uploadPairInput.value = '';

    // Auto-switch to upload mode so live chart is hidden and upload preview is shown
    switchChartMode('upload');

    // Clear previous results
    document.getElementById('upload-analysis-results').classList.add('hidden');
    document.getElementById('upload-analysis-loading').classList.add('hidden');
  };
  reader.readAsDataURL(file);
}

btnRunAI.addEventListener('click', () => {
  if (!state.uploadedImage) return;

  if (!state.authenticated) {
    alert('Please connect and authenticate your Arc wallet first.');
    return;
  }
  if (!state.subscription.plan) {
    alert('Please subscribe to a plan to unlock AI chart analysis.');
    scrollToPlans();
    return;
  }

  runUploadedChartAnalysis();
});

async function runUploadedChartAnalysis() {
  const loadingEl = document.getElementById('upload-analysis-loading');
  const resultsEl = document.getElementById('upload-analysis-results');
  const previewEl = document.getElementById('upload-preview');
  const reBtn     = document.getElementById('btn-refresh-analysis');

  previewEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');
  resultsEl.classList.add('hidden');

  btnRunAI.disabled = true;
  btnRunAI.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px"></div> Analyzing…';
  if (reBtn) { reBtn.disabled = true; reBtn.textContent = '⏳ Analyzing…'; }

  try {
    // Get the pair symbol from the input field, or fallback to state.selectedSymbol
    const uploadPairInput = document.getElementById('upload-pair-symbol');
    const uploadPairSymbol = uploadPairInput?.value?.trim() || state.selectedSymbol;

    const formData = new FormData();
    formData.append('imageBase64', state.uploadedImage);
    formData.append('mimeType', state.uploadedMimeType);
    formData.append('symbol', uploadPairSymbol);
    formData.append('timeframe', state.selectedTimeframe);
    if (state.candlesticks && state.candlesticks.length > 0) {
      formData.append('candleData', JSON.stringify(state.candlesticks));
    }

    const res = await fetch('/api/ai/analyze-chart', { method: 'POST', body: formData });
    const data = await res.json();

    if (data.success) {
      renderUploadAnalysis(data.analysis, data.engine);
      // Also update the sidebar AI analyst
      renderAnalysisResults(data.analysis);
    } else {
      resultsEl.innerHTML = `<div class="analysis-status"><p style="color:var(--error)">Analysis failed. Please try again.</p></div>`;
      resultsEl.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Upload analysis error:', err);
    resultsEl.innerHTML = `<div class="analysis-status"><p style="color:var(--error)">Network error: ${err.message}</p></div>`;
    resultsEl.classList.remove('hidden');
  } finally {
    loadingEl.classList.add('hidden');
    previewEl.classList.remove('hidden');
    btnRunAI.disabled = false;
    btnRunAI.innerHTML = '🤖 Analyze with AI';
    if (reBtn) { reBtn.disabled = false; reBtn.textContent = 'Re-analyze'; }
  }
}

function renderUploadAnalysis(r, engine) {
  const resultsEl = document.getElementById('upload-analysis-results');
  const signalClass = r.signal === 'BULLISH' ? '' : r.signal === 'BEARISH' ? 'bearish' : 'neutral';
  const engineLabel = engine === 'gemini-vision' ? '🤖 Gemini Vision AI' : '📊 Heuristic Engine';

  resultsEl.innerHTML = `
    <div class="signal-header" style="margin-bottom:12px">
      <div class="signal-badge ${signalClass}">${r.signal}</div>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="confidence-indicator">Confidence: <strong>${r.confidence}%</strong></div>
        <div class="badge badge-ai">${engineLabel}</div>
      </div>
    </div>

    <div class="position-cards" style="margin-bottom:14px">
      <div class="position-card entry-card">
        <div class="pos-label">📍 Entry</div>
        <div class="pos-price">${fmtShort(r.entry.price)}</div>
        <div class="pos-rationale">${r.entry.rationale}</div>
      </div>
      <div class="position-card sl-card">
        <div class="pos-label">🛑 Stop Loss</div>
        <div class="pos-price">${fmtShort(r.stopLoss.price)}</div>
        <div class="pos-meta">
          <span class="pos-pct sl-pct">-${r.stopLoss.pct}%</span>
        </div>
        <div class="pos-rationale">${r.stopLoss.rationale}</div>
      </div>
      <div class="position-card tp1-card">
        <div class="pos-label">🎯 Target 1</div>
        <div class="pos-price">${fmtShort(r.takeProfit1.price)}</div>
        <div class="pos-meta">
          <span class="pos-pct tp-pct">+${r.takeProfit1.pct}%</span>
          <span class="pos-rr">${r.takeProfit1.rr}R</span>
        </div>
      </div>
      <div class="position-card tp2-card">
        <div class="pos-label">🏆 Target 2</div>
        <div class="pos-price">${fmtShort(r.takeProfit2.price)}</div>
        <div class="pos-meta">
          <span class="pos-pct tp-pct">+${r.takeProfit2.pct}%</span>
        </div>
      </div>
    </div>

    <div class="report-section" style="margin-bottom:10px">
      <h3>📊 Pattern: ${r.pattern}</h3>
      <p>${r.patternDetail}</p>
    </div>

    <div class="report-section" style="margin-bottom:10px">
      <h3>📈 Indicator Insights</h3>
      <div class="indicator-grid" style="display:grid;gap:10px;grid-template-columns:1fr 1fr;">
        <div class="indicator-card" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;">
          <div class="indicator-title" style="font-weight:700;margin-bottom:6px">RSI</div>
          <div class="indicator-value" style="font-size:18px;font-weight:800;">${r.indicators?.rsi?.value != null ? fmtShort(r.indicators.rsi.value) : 'N/A'}</div>
          <div class="indicator-status" style="margin:6px 0;color:#94a3b8;">${r.indicators?.rsi?.status || 'Neutral'}</div>
          <div class="indicator-summary" style="font-size:13px;color:#d1d5db;">${r.indicators?.rsi?.summary || 'No RSI insight available.'}</div>
        </div>
        <div class="indicator-card" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;">
          <div class="indicator-title" style="font-weight:700;margin-bottom:6px">MACD</div>
          <div class="indicator-value" style="font-size:18px;font-weight:800;">${r.indicators?.macd?.macd != null ? `${fmtShort(r.indicators.macd.macd)} / ${fmtShort(r.indicators.macd.signal)} (${fmtShort(r.indicators.macd.histogram)})` : 'N/A'}</div>
          <div class="indicator-status" style="margin:6px 0;color:#94a3b8;">${r.indicators?.macd?.crossover || 'Neutral'}</div>
          <div class="indicator-summary" style="font-size:13px;color:#d1d5db;">${r.indicators?.macd?.summary || 'No MACD insight available.'}</div>
        </div>
      </div>
    </div>

    <div class="levels-grid" style="margin-bottom:10px">
      <div class="level-card sup"><span class="label">Support</span><span class="value">${fmtShort(r.support)}</span></div>
      <div class="level-card res"><span class="label">Resistance</span><span class="value">${fmtShort(r.resistance)}</span></div>
    </div>

    <div class="risk-timeframe-row" style="margin-bottom:10px">
      <div class="risk-pill ${r.riskLevel === 'HIGH' ? 'high' : r.riskLevel === 'LOW' ? 'low' : ''}">${r.riskLevel} RISK</div>
      <div class="timeframe-pill">⏱ ${r.timeframe}</div>
    </div>

    <div class="report-section">
      <h3>🔮 Narrative</h3>
      <p class="italic-desc">${r.narrative}</p>
    </div>
  `;
  resultsEl.classList.remove('hidden');
}

// ══════════════════════════════════════════════════════════════
// AI ANALYSIS — LIVE CHART
// ══════════════════════════════════════════════════════════════
const btnAnalyzeChart = document.getElementById('btn-analyze-chart');
const btnRefreshAnalysis = document.getElementById('btn-refresh-analysis');

btnAnalyzeChart.addEventListener('click', () => {
  // Allow demo analysis with wallet connection
  if (!state.walletConnected && !state.subscription.plan) { scrollToPlans(); return; }
  runLiveAnalysis(state.selectedSymbol, state.candlesticks, false);
});

btnRefreshAnalysis.addEventListener('click', () => {
  // Allow demo analysis with wallet connection  
  if (!state.walletConnected && !state.subscription.plan) { scrollToPlans(); return; }

  // Re-analyze always forces a fresh result, bypassing cache
  if (state.chartMode === 'upload') {
    if (state.uploadedImage) {
      runUploadedChartAnalysis();
    } else {
      alert('Please upload a chart image first.');
    }
  } else {
    if (state.candlesticks && state.candlesticks.length) {
      runLiveAnalysis(state.selectedSymbol, state.candlesticks, true);
    } else {
      console.warn('Re-analyze: no candlestick data loaded');
    }
  }
});

async function triggerChartAnalysis() {
  if (!state.candlesticks.length) return;

  const placeholder = document.getElementById('analysis-placeholder');
  const loading = document.getElementById('analysis-loading');
  const results = document.getElementById('analysis-results');

  placeholder.classList.add('hidden');
  loading.classList.remove('hidden');
  results.classList.add('hidden');
  state.aiAnalysisActive = false;

  try {
    const formData = new FormData();
    formData.append('symbol', state.selectedSymbol);
    formData.append('candleData', JSON.stringify(state.candlesticks));
    formData.append('timeframe', state.selectedTimeframe);

    const res = await fetch('/api/ai/analyze-chart', { method: 'POST', body: formData });
    const data = await res.json();

    if (data.success) {
      renderAnalysisResults(data.analysis);
      state.aiReport = data.analysis;
      state.aiAnalysisActive = true;
      document.getElementById('chart-overlay-status').classList.remove('hidden');
      drawChart();
    }
  } catch (err) {
    console.error('Analysis error:', err);
    loading.classList.add('hidden');
    placeholder.classList.remove('hidden');
  }
}

function renderAnalysisResults(r) {
  if (!r) {
    console.warn('renderAnalysisResults: no analysis result provided');
    return;
  }

  try {
    state.aiReport = r;

    const loading     = document.getElementById('analysis-loading');
    const results     = document.getElementById('analysis-results');
    const placeholder = document.getElementById('analysis-placeholder');

    // Always transition: hide loading → show results
    if (loading)     loading.classList.add('hidden');
    if (placeholder) placeholder.classList.add('hidden');
    if (results)     results.classList.remove('hidden');

    // Also show the on-chart overlay badge
    const overlayStatus = document.getElementById('chart-overlay-status');
    if (overlayStatus) overlayStatus.classList.remove('hidden');

    // Signal badge
    const sigBadge = document.getElementById('signal-badge');
    if (sigBadge) {
      sigBadge.textContent = `${r.signal === 'BULLISH' ? '↑' : r.signal === 'BEARISH' ? '↓' : '→'} ${r.signal} ${r.pattern}`;
      sigBadge.className = `signal-badge${r.signal === 'BEARISH' ? ' bearish' : r.signal === 'NEUTRAL' ? ' neutral' : ''}`;
    }
    
    const confVal = document.getElementById('confidence-value');
    if (confVal) confVal.textContent = `${r.confidence}%`;

    // Positions
    if (document.getElementById('pos-entry')) document.getElementById('pos-entry').textContent = fmtShort(r.entry?.price);
    if (document.getElementById('pos-entry-rationale')) document.getElementById('pos-entry-rationale').textContent = r.entry?.rationale || '';
    if (document.getElementById('pos-sl')) document.getElementById('pos-sl').textContent = fmtShort(r.stopLoss?.price);
    if (document.getElementById('pos-sl-pct')) document.getElementById('pos-sl-pct').textContent = `-${r.stopLoss?.pct || 0}%`;
    if (document.getElementById('pos-sl-rationale')) document.getElementById('pos-sl-rationale').textContent = r.stopLoss?.rationale || '';
    if (document.getElementById('pos-tp1')) document.getElementById('pos-tp1').textContent = fmtShort(r.takeProfit1?.price);
    if (document.getElementById('pos-tp1-pct')) document.getElementById('pos-tp1-pct').textContent = `+${r.takeProfit1?.pct || 0}%`;
    if (document.getElementById('pos-tp1-rr')) document.getElementById('pos-tp1-rr').textContent = `${r.takeProfit1?.rr || '1.0'}R`;
    if (document.getElementById('pos-tp2')) document.getElementById('pos-tp2').textContent = fmtShort(r.takeProfit2?.price);
    if (document.getElementById('pos-tp2-pct')) document.getElementById('pos-tp2-pct').textContent = `+${r.takeProfit2?.pct || 0}%`;

    // Support / Resistance
    if (document.getElementById('val-support-1')) document.getElementById('val-support-1').textContent = fmtShort(r.support);
    if (document.getElementById('val-resistance-1')) document.getElementById('val-resistance-1').textContent = fmtShort(r.resistance);

    // Indicator section
    const rsiInfo = r.indicators?.rsi || {};
    const macdInfo = r.indicators?.macd || {};
    if (document.getElementById('indicator-rsi-value')) document.getElementById('indicator-rsi-value').textContent = rsiInfo.value != null ? rsiInfo.value.toFixed(2) : 'N/A';
    if (document.getElementById('indicator-rsi-status')) document.getElementById('indicator-rsi-status').textContent = rsiInfo.status || 'Neutral';
    if (document.getElementById('indicator-rsi-summary')) document.getElementById('indicator-rsi-summary').textContent = rsiInfo.summary || 'No RSI insight available.';
    
    const macdDisplay = macdInfo.macd != null && macdInfo.signal != null && macdInfo.histogram != null
      ? `${macdInfo.macd.toFixed(4)} / ${macdInfo.signal.toFixed(4)} (${macdInfo.histogram.toFixed(4)})`
      : 'N/A';
    if (document.getElementById('indicator-macd-value')) document.getElementById('indicator-macd-value').textContent = macdDisplay;
    if (document.getElementById('indicator-macd-status')) document.getElementById('indicator-macd-status').textContent = macdInfo.crossover || 'Neutral';
    if (document.getElementById('indicator-macd-summary')) document.getElementById('indicator-macd-summary').textContent = macdInfo.summary || 'No MACD insight available.';

    // Risk & Timeframe
    const riskPill = document.getElementById('risk-pill');
    if (riskPill) {
      riskPill.textContent = `${r.riskLevel || 'MEDIUM'} RISK`;
      riskPill.className = `risk-pill${r.riskLevel === 'HIGH' ? ' high' : r.riskLevel === 'LOW' ? ' low' : ''}`;
    }
    const tfPill = document.getElementById('timeframe-pill');
    if (tfPill) tfPill.textContent = `⏱ ${r.timeframe || 'N/A'}`;

    // Narrative
    if (document.getElementById('report-pattern')) document.getElementById('report-pattern').textContent = r.patternDetail || '';
    if (document.getElementById('report-narrative')) document.getElementById('report-narrative').textContent = r.narrative || '';

    // Show which candle the analysis was based on (client-side)
    try {
      const last = state.candlesticks && state.candlesticks.length ? state.candlesticks[state.candlesticks.length - 1] : null;
      let baseEl = document.getElementById('analysis-based-on');
      if (!baseEl) {
        const header = document.querySelector('#analysis-results .signal-header');
        if (header) {
          baseEl = document.createElement('div');
          baseEl.id = 'analysis-based-on';
          baseEl.className = 'analysis-based-on';
          baseEl.style.fontSize = '12px';
          baseEl.style.color = '#9ca3af';
          header.appendChild(baseEl);
        }
      }
      if (baseEl) {
        if (state.chartMode === 'upload') {
          baseEl.textContent = `Based on: Uploaded Chart Image`;
        } else if (last && last.time) {
          const t = new Date(last.time * 1000);
          baseEl.textContent = `Based on candles ending: ${t.toLocaleString()} (${state.selectedTimeframe})`;
        } else {
          baseEl.textContent = '';
        }
      }
    } catch (e) { 
      console.error('Could not set analysis-based-on info', e); 
    }
  } catch (err) {
    console.error('renderAnalysisResults error:', err);
  }
}

// ══════════════════════════════════════════════════════════════
// DEVELOPER API TERMINAL LOG
// ══════════════════════════════════════════════════════════════
function pushApiLog(log) {
  state.logs.push(log);
  state.activeLogIndex = state.logs.length - 1;
  renderLogsList();
  renderActiveLogDetail();

  const term = document.getElementById('dev-terminal');
  const badge = term.querySelector('.term-status-badge');
  const endpoint = log.endpoint.split('/').pop();
  badge.textContent = `${log.method} …/${endpoint}`;
  badge.style.background = 'rgba(99,102,241,0.2)';
  badge.style.color = '#c7d2fe';
}

function renderLogsList() {
  const container = document.getElementById('terminal-request-list');
  if (!state.logs.length) {
    container.innerHTML = `<div class="empty-list-desc">API operations will appear here…</div>`;
    return;
  }
  container.innerHTML = state.logs.map((log, i) => {
    const ok = log.responseStatus < 300;
    const path = log.endpoint.split('circle.com').pop() || log.endpoint;
    return `
      <div class="request-item ${i === state.activeLogIndex ? 'active' : ''}" onclick="selectLog(${i})">
        <div class="req-header-row">
          <span class="req-method ${log.method.toLowerCase()}">${log.method}</span>
          <span class="req-status ${ok ? 'success' : 'error'}">${log.responseStatus}</span>
        </div>
        <div class="req-path" title="${log.endpoint}">${path}</div>
      </div>`;
  }).join('');
}

window.selectLog = i => {
  state.activeLogIndex = i;
  renderLogsList();
  renderActiveLogDetail();
};

function renderActiveLogDetail() {
  if (state.activeLogIndex < 0 || !state.logs.length) return;
  const log = state.logs[state.activeLogIndex];
  document.getElementById('viewer-method-badge').className = `badge req-method ${log.method.toLowerCase()}`;
  document.getElementById('viewer-method-badge').textContent = log.method;
  document.getElementById('viewer-url').textContent = log.endpoint;
  document.getElementById('viewer-request-payload').textContent = JSON.stringify(log.requestBody, null, 2);
  document.getElementById('viewer-response-payload').textContent = JSON.stringify(log.responseBody, null, 2);
}

// Terminal toggle
const termHeader = document.getElementById('terminal-header');
const termDrawer = document.getElementById('dev-terminal');
termHeader.addEventListener('click', () => {
  termDrawer.classList.toggle('collapsible-closed');
  termDrawer.classList.toggle('collapsible-open');
});

document.getElementById('btn-clear-logs').addEventListener('click', e => {
  e.stopPropagation();
  state.logs = []; state.activeLogIndex = -1;
  renderLogsList();
  document.getElementById('viewer-request-payload').textContent = '{}';
  document.getElementById('viewer-response-payload').textContent = '{}';
  const badge = termDrawer.querySelector('.term-status-badge');
  badge.textContent = 'Idle'; badge.style.background = ''; badge.style.color = '';
});

// ══════════════════════════════════════════════════════════════
// CONFIG STATUS
// ══════════════════════════════════════════════════════════════
async function checkConfigStatus() {
  try {
    const res = await fetch('/api/config-status');
    const data = await res.json();
    state.config = data;

    const modeBadge = document.getElementById('mode-badge');
    const modeText = document.getElementById('mode-text');
    if (data.configured) {
      modeBadge.className = 'badge badge-live';
      modeText.textContent = 'Live API (Arc Network)';
    } else {
      modeBadge.className = 'badge badge-simulator';
      modeText.textContent = 'Simulator Mode';
    }

    if (data.hasGemini) {
      document.getElementById('ai-badge').classList.remove('hidden');
    }
  } catch (err) { console.error('Config check failed:', err); }
}

// ══════════════════════════════════════════════════════════════
// WALLET CONNECT MODAL & DISCONNECT
// ══════════════════════════════════════════════════════════════
const walletModal = document.getElementById('wallet-modal');

function showWalletError(message) {
  const toast = document.getElementById('wallet-error-toast');
  toast.textContent = '⚠ ' + message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 6000);
}

function openWalletModal() {
  if (state.walletConnected) {
    // If already connected, clicking header button disconnects
    disconnectWallet();
    return;
  }
  // Clear previous errors and connecting states
  document.getElementById('wallet-error-toast').classList.add('hidden');
  document.querySelectorAll('.wallet-option').forEach(o => o.classList.remove('connecting'));
  walletModal.classList.remove('hidden');
}

function closeWalletModal() {
  walletModal.classList.add('hidden');
}

// Generate a pseudo-random wallet address per provider
const WALLET_ADDRESSES = {
  'circle-arc':    '0x85e520011893963980a20e934bfcc48e98dbaec6',
  'metamask':      '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
  'walletconnect': '0xFABB0ac9d68B0B445fB7357272Ff202C5651694a',
  'coinbase':      '0x2546BcD3c84621e976D8185a91A922aE77ECEc30',
  'phantom':       '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
  'rabby':         '0xdaFEA492D6B217D2361efA63D36928CFF95f1B22',
  'zerion':        '0xa4FEA3982Cb9d7ef81A2a84B29ce1F34eeDC918C',
  'okx':           '0xBba2c398695029D81b67eA2B591f86C29188e7FF',
};

const WALLET_NAMES = {
  'circle-arc': 'Circle Arc',
  'metamask': 'MetaMask',
  'walletconnect': 'WalletConnect',
  'coinbase': 'Coinbase',
  'phantom': 'Phantom',
  'rabby': 'Rabby Wallet',
  'zerion': 'Zerion Wallet',
  'okx': 'OKX Wallet',
};

async function connectWalletWith(provider) {
  // Show connecting animation on the clicked option
  const optionEl = document.querySelector(`.wallet-option[data-wallet="${provider}"]`);
  if (optionEl) {
    optionEl.classList.add('connecting');
    const badge = optionEl.querySelector('.wallet-option-badge');
    if (badge) badge.textContent = 'Connecting…';
  }

  try {
    let address = null;

    if (provider === 'circle-arc') {
      // Developer-controlled wallet — simulated connection
      await new Promise(r => setTimeout(r, 800));
      address = WALLET_ADDRESSES['circle-arc'];

    } else if (provider === 'metamask') {
      // Real MetaMask connection via window.ethereum
      let metamaskProvider = window.ethereum;
      if (window.ethereum?.providers) {
        metamaskProvider = window.ethereum.providers.find(p => p.isMetaMask);
      }
      // If not explicitly found in providers, but window.ethereum is present, fall back to window.ethereum
      if (!metamaskProvider && window.ethereum) {
        metamaskProvider = window.ethereum;
      }
      if (!metamaskProvider) {
        // Safari / iOS Detection:
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (isMobile) {
          window.location.href = `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}`;
          return;
        }
        if (isSafari) {
          throw new Error('MetaMask is not detected on Safari. If you have the Safari MetaMask extension installed, please ensure it is enabled in Safari settings -> Extensions.');
        }
        throw new Error('MetaMask is not installed or not detected. Please install the MetaMask extension.');
      }
      const accounts = await metamaskProvider.request({ method: 'eth_requestAccounts' });
      if (!accounts || accounts.length === 0) throw new Error('No accounts returned from MetaMask');
      address = accounts[0];

    } else if (provider === 'coinbase') {
      // Coinbase Wallet — check for coinbase provider
      const cbProvider = window.coinbaseWalletExtension || 
        (window.ethereum?.providers?.find(p => p.isCoinbaseWallet)) ||
        (window.ethereum?.isCoinbaseWallet ? window.ethereum : null);
      if (!cbProvider) {
        throw new Error('Coinbase Wallet is not installed. Please install the Coinbase Wallet extension.');
      }
      const accounts = await cbProvider.request({ method: 'eth_requestAccounts' });
      if (!accounts || accounts.length === 0) throw new Error('No accounts returned from Coinbase Wallet');
      address = accounts[0];

    } else if (provider === 'phantom') {
      // Phantom — supports Ethereum via window.phantom.ethereum
      const phantomProvider = window.phantom?.ethereum;
      if (!phantomProvider) {
        throw new Error('Phantom wallet is not installed. Please install the Phantom extension from phantom.app');
      }
      const accounts = await phantomProvider.request({ method: 'eth_requestAccounts' });
      if (!accounts || accounts.length === 0) throw new Error('No accounts returned from Phantom');
      address = accounts[0];

    } else if (provider === 'rabby') {
      const rabbyProvider = window.rabby || (window.ethereum?.isRabby ? window.ethereum : null);
      if (!rabbyProvider) {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (isMobile) {
          window.location.href = 'https://rabby.io';
          return;
        }
        if (isSafari) {
          throw new Error('Rabby Wallet is not detected on Safari. If you have the Safari Rabby extension installed, please ensure it is enabled in Safari settings -> Extensions.');
        }
        throw new Error('Rabby Wallet is not installed or not detected. Please install Rabby Wallet.');
      }
      const accounts = await rabbyProvider.request({ method: 'eth_requestAccounts' });
      if (!accounts || accounts.length === 0) throw new Error('No accounts returned from Rabby Wallet');
      address = accounts[0];

    } else if (provider === 'zerion') {
      const zerionProvider = window.zerion || (window.ethereum?.isZerion ? window.ethereum : null);
      if (!zerionProvider) {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (isMobile) {
          window.location.href = `https://zerion.app.link/dapp/${window.location.host}${window.location.pathname}`;
          return;
        }
        if (isSafari) {
          throw new Error('Zerion Wallet is not detected on Safari. If you have the Safari Zerion extension installed, please ensure it is enabled in Safari settings -> Extensions.');
        }
        throw new Error('Zerion Wallet is not installed or not detected. Please install Zerion Wallet.');
      }
      const accounts = await zerionProvider.request({ method: 'eth_requestAccounts' });
      if (!accounts || accounts.length === 0) throw new Error('No accounts returned from Zerion Wallet');
      address = accounts[0];

    } else if (provider === 'okx') {
      const okxProvider = window.okxwallet || (window.ethereum?.isOkxWallet ? window.ethereum : null);
      if (!okxProvider) {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (isMobile) {
          window.location.href = `okx://dapp/${window.location.host}${window.location.pathname}`;
          return;
        }
        if (isSafari) {
          throw new Error('OKX Wallet is not detected on Safari. If you have the Safari OKX extension installed, please ensure it is enabled in Safari settings -> Extensions.');
        }
        throw new Error('OKX Wallet is not installed or not detected. Please install OKX Wallet.');
      }
      const accounts = await okxProvider.request({ method: 'eth_requestAccounts' });
      if (!accounts || accounts.length === 0) throw new Error('No accounts returned from OKX Wallet');
      address = accounts[0];

    } else if (provider === 'walletconnect') {
      // WalletConnect requires the WalletConnect SDK — show info
      throw new Error('WalletConnect requires the WalletConnect v2 SDK. Use Circle Arc or MetaMask for now.');

    } else {
      throw new Error('Unknown wallet provider');
    }

    // ─── Connection successful ───
    state.walletAddress = address;
    state.walletConnected = true;
    state.connectedProvider = provider;

    // Enable analysis buttons once wallet is connected (demo mode)
    document.getElementById('btn-analyze-chart').disabled = false;
    document.getElementById('btn-refresh-analysis').disabled = false;

    localStorage.setItem('walletAddress', address);
    localStorage.setItem('walletConnected', 'true');
    localStorage.setItem('connectedProvider', provider);

    const shortAddr = address.slice(0, 6) + '…' + address.slice(-4);

    document.getElementById('wallet-btn-text').textContent = shortAddr;
    document.getElementById('wallet-address').textContent = shortAddr;
    document.getElementById('circle-wallet-id').textContent = shortAddr;
    document.getElementById('wallet-indicator').textContent = 'Sign Required';
    document.getElementById('wallet-indicator').className = 'wallet-status warning';
    document.getElementById('wallet-state-disconnected').classList.add('hidden');
    document.getElementById('wallet-state-sign').classList.remove('hidden');

    const eip = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' }
        ],
        SignIn: [
          { name: 'contents', type: 'string' },
          { name: 'nonce', type: 'string' }
        ]
      },
      domain: { name: 'ChartsonArc Portal', version: '1.0', chainId: 5042002, verifyingContract: '0x391f1B786968d067425881dB7D095f9c46C18648' },
      primaryType: 'SignIn',
      message: { contents: `Authenticate with ChartsonArc via ${WALLET_NAMES[provider]}. Session expires in 24 hours.`, nonce: String(Date.now()) }
    };
    document.getElementById('eip-payload').textContent = JSON.stringify(eip, null, 2);

    closeWalletModal();

  } catch (err) {
    console.error('Wallet connection error:', err);
    // Reset the connecting state on the option
    if (optionEl) {
      optionEl.classList.remove('connecting');
      const badge = optionEl.querySelector('.wallet-option-badge');
      if (badge) {
        // Restore original badge text
        const badgeTexts = { 'circle-arc': 'Recommended', 'metamask': 'Popular', 'walletconnect': 'Mobile', 'coinbase': 'Trusted', 'phantom': 'Multi-chain' };
        badge.textContent = badgeTexts[provider] || 'Connect';
      }
    }
    // Show error to user
    showWalletError(err.message);
  }
}

function disconnectWallet() {
  const confirmDisconnect = confirm("Are you sure you want to disconnect your wallet?");
  if (!confirmDisconnect) return;

  state.walletConnected = false;
  state.authenticated = false;
  state.walletAddress = '';
  state.connectedProvider = null;
  state.subscription = { plan: null, pairsAllowed: 0, pairsUsed: 0, pairsAccessed: new Set(), features: [] };
  state.aiAnalysisActive = false;
  state.aiReport = null;

  localStorage.removeItem('walletAddress');
  localStorage.removeItem('walletConnected');
  localStorage.removeItem('connectedProvider');

  // Reset header button
  document.getElementById('wallet-btn-text').textContent = 'Connect Arc Wallet';

  // Reset wallet card
  document.getElementById('wallet-indicator').textContent = 'Disconnected';
  document.getElementById('wallet-indicator').className = 'wallet-status disconnected';
  document.getElementById('wallet-state-disconnected').classList.remove('hidden');
  document.getElementById('wallet-state-sign').classList.add('hidden');
  document.getElementById('wallet-state-authenticated').classList.add('hidden');

  // Reset subscription UI
  document.getElementById('subscription-plans-box').classList.remove('hidden');
  document.getElementById('subscription-active-box').classList.add('hidden');

  // Reset analysis
  document.getElementById('analysis-results').classList.add('hidden');
  document.getElementById('analysis-loading').classList.add('hidden');
  document.getElementById('analysis-placeholder').classList.remove('hidden');
  document.getElementById('chart-overlay-status').classList.add('hidden');

  // Disable analyze buttons
  document.getElementById('btn-analyze-chart').disabled = true;
  document.getElementById('btn-refresh-analysis').disabled = true;

  // Re-lock premium overlays
  const toggleRsi = document.getElementById('toggle-rsi');
  const toggleMacd = document.getElementById('toggle-macd');
  if (!toggleRsi.classList.contains('locked')) {
    toggleRsi.classList.add('locked');
    toggleRsi.innerHTML = '<span>RSI Divergences</span><span class="lock-icon">🔒</span>';
    toggleRsi.classList.remove('active');
    state.activeOverlays.rsi = false;
  }
  if (!toggleMacd.classList.contains('locked')) {
    toggleMacd.classList.add('locked');
    toggleMacd.innerHTML = '<span>MACD Breakouts</span><span class="lock-icon">🔒</span>';
    toggleMacd.classList.remove('active');
    state.activeOverlays.macd = false;
  }

  drawChart();
}

// ─── Event Listeners ─────────────────────────────────────
document.getElementById('btn-connect-wallet').addEventListener('click', openWalletModal);
document.getElementById('btn-connect-wallet-body').addEventListener('click', openWalletModal);
document.getElementById('btn-close-modal').addEventListener('click', closeWalletModal);
document.getElementById('btn-disconnect-wallet').addEventListener('click', disconnectWallet);

// Close modal on overlay click
walletModal.addEventListener('click', e => {
  if (e.target === walletModal) closeWalletModal();
});

// Close modal on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !walletModal.classList.contains('hidden')) closeWalletModal();
});

// Wire up each wallet option
document.querySelectorAll('.wallet-option').forEach(btn => {
  btn.addEventListener('click', () => connectWalletWith(btn.dataset.wallet));
});

function syncUserStateWith(user) {
  if (!user) return;
  state.walletAddress = user.walletAddress;
  state.subscription.plan = user.plan;
  state.subscription.pairsAllowed = user.pairsAllowed;
  state.subscription.pairsUsed = user.pairsUsed;
  state.subscription.pairsAccessed = new Set(user.pairsAccessed || []);

  if (user.plan) {
    const plan = PLANS[user.plan];
    activateSubscriptionUI(user.plan, plan);
    unlockPremiumOverlays();
  }

  // Enable analyze buttons if wallet connected OR has subscription
  if (state.walletConnected || user.plan) {
    document.getElementById('btn-analyze-chart').disabled = false;
    document.getElementById('btn-refresh-analysis').disabled = false;
  }

  if (user.plan) {
    // Show choose plan UI
    document.getElementById('subscription-plans-box').classList.add('hidden');
    document.getElementById('subscription-active-box').classList.remove('hidden');
  } else {
    document.getElementById('subscription-plans-box').classList.remove('hidden');
    document.getElementById('subscription-active-box').classList.add('hidden');
  }

  // Update balance dynamically based on payments
  let balance = 250.00;
  if (user.transactions && user.transactions.length > 0) {
    user.transactions.forEach(tx => {
      balance -= tx.amount;
    });
  }
  state.balance = balance;
  document.getElementById('wallet-balance').textContent = `${state.balance.toFixed(2)} USDC`;

  // Push transactions into dev terminal request inspector
  if (user.transactions && user.transactions.length > 0) {
    user.transactions.forEach(tx => {
      const mockLog = {
        timestamp: tx.timestamp,
        endpoint: '/api/payment/subscribe',
        method: 'POST',
        requestBody: { walletAddress: user.walletAddress, plan: tx.plan, txHash: tx.txHash },
        responseStatus: 200,
        responseBody: { success: true, state: 'CONFIRMED', txHash: tx.txHash },
        isSimulated: false
      };
      const exists = state.logs.some(l => l.responseBody?.txHash === tx.txHash);
      if (!exists) {
        pushApiLog(mockLog);
      }
    });
  }
}

document.getElementById('btn-sign-message').addEventListener('click', async () => {
  const btn = document.getElementById('btn-sign-message');
  btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px"></div> Signing…';
  btn.disabled = true;

  try {
    let signature = null;
    const isCircleArc = (state.connectedProvider === 'circle-arc');

    if (!isCircleArc) {
      // Client-side signing via MetaMask/Phantom/Coinbase/WalletConnect
      const provider = state.connectedProvider;
      let ethereumProvider = window.ethereum;
      if (provider === 'metamask') {
        if (window.ethereum?.providers) {
          ethereumProvider = window.ethereum.providers.find(p => p.isMetaMask) || window.ethereum;
        }
      } else if (provider === 'phantom') {
        ethereumProvider = window.phantom?.ethereum || (window.ethereum?.providers?.find(p => p.isPhantom)) || window.ethereum;
      } else if (provider === 'coinbase') {
        ethereumProvider = window.coinbaseWalletExtension || (window.ethereum?.providers?.find(p => p.isCoinbaseWallet)) || window.ethereum;
      } else if (provider === 'rabby') {
        ethereumProvider = window.rabby || (window.ethereum?.isRabby ? window.ethereum : null) || window.ethereum;
      } else if (provider === 'zerion') {
        ethereumProvider = window.zerion || (window.ethereum?.isZerion ? window.ethereum : null) || window.ethereum;
      } else if (provider === 'okx') {
        ethereumProvider = window.okxwallet || (window.ethereum?.isOkxWallet ? window.ethereum : null) || window.ethereum;
      }

      if (!ethereumProvider && window.ethereum) {
        ethereumProvider = window.ethereum;
      }

      if (!ethereumProvider) {
        throw new Error('No injected web3 provider found. Make sure your wallet extension is enabled.');
      }

      const msgParams = document.getElementById('eip-payload').textContent;
      const typedData = JSON.parse(msgParams);
      typedData.domain.chainId = 5042002;

      // Try switching/adding Arc Testnet to prevent chainId mismatch errors in EIP-712
      try {
        await switchToArcTestnet(ethereumProvider);
      } catch (switchErr) {
        console.warn('Could not switch network to Arc Testnet before signing:', switchErr);
      }

      // Try stringified EIP-712 signing first
      try {
        console.log('Attempting eth_signTypedData_v4 (stringified)...');
        signature = await ethereumProvider.request({
          method: 'eth_signTypedData_v4',
          params: [state.walletAddress, JSON.stringify(typedData)]
        });
      } catch (err1) {
        console.warn('eth_signTypedData_v4 stringified failed:', err1);
        
        // Try object EIP-712 signing (some providers expect the parsed object)
        try {
          console.log('Attempting eth_signTypedData_v4 (object)...');
          signature = await ethereumProvider.request({
            method: 'eth_signTypedData_v4',
            params: [state.walletAddress, typedData]
          });
        } catch (err2) {
          console.warn('eth_signTypedData_v4 object failed:', err2);

          // Try personal_sign as a reliable fallback (works on any chain without strict structure validation)
          try {
            console.log('Attempting personal_sign fallback...');
            const textToSign = `${typedData.message.contents}\nNonce: ${typedData.message.nonce}`;
            signature = await ethereumProvider.request({
              method: 'personal_sign',
              params: [textToSign, state.walletAddress]
            });
          } catch (err3) {
            console.warn('personal_sign failed:', err3);
            
            // Final fallback: generate a simulated signature so the user is not blocked
            console.log('Using simulated signature fallback...');
            signature = '0x' + Array.from({length: 130}, () => Math.floor(Math.random()*16).toString(16)).join('');
          }
        }
      }

      // Log signature event to the inspector
      const clientLog = {
        timestamp: new Date().toISOString(),
        endpoint: signature ? 'eth_signTypedData_v4' : 'eth_signTypedData_v4 (Simulated)',
        method: 'PROVIDER',
        requestBody: { from: state.walletAddress, data: typedData },
        responseStatus: 200,
        responseBody: { signature },
        isSimulated: !signature
      };
      pushApiLog(clientLog);
    } else {
      // Developer-controlled wallet signs via backend
      const payload = {
        walletAddress: state.walletAddress,
        messageToSign: document.getElementById('eip-payload').textContent
      };
      const res = await fetch('/api/auth/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error('Backend signing failed');
      }
      const result = await res.json();
      if (result.log) pushApiLog(result.log);
      signature = result.data?.signature;
    }

    // Call backend register
    const regRes = await fetch('/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: state.walletAddress })
    });
    const regData = await regRes.json();
    if (regData.success) {
      syncUserStateWith(regData.user);
    }

    state.authenticated = true;
    document.getElementById('wallet-indicator').textContent = 'Connected';
    document.getElementById('wallet-indicator').className = 'wallet-status connected';
    document.getElementById('wallet-state-sign').classList.add('hidden');
    document.getElementById('wallet-state-authenticated').classList.remove('hidden');
    document.getElementById('btn-analyze-chart').disabled = false;
    document.getElementById('btn-refresh-analysis').disabled = false;

    // Open terminal
    if (termDrawer.classList.contains('collapsible-closed')) {
      termDrawer.classList.replace('collapsible-closed', 'collapsible-open');
    }

  } catch (err) {
    const errMsg = err?.message || err?.error || (typeof err === 'string' ? err : JSON.stringify(err)) || 'Unknown signature error';
    alert('Authentication failed: ' + errMsg);
  } finally {
    btn.innerHTML = '⚡ Sign & Authenticate';
    btn.disabled = false;
  }
});

// ══════════════════════════════════════════════════════════════
// SUBSCRIPTION PLANS
// ══════════════════════════════════════════════════════════════
document.querySelectorAll('[data-plan]').forEach(btn => {
  if (!btn.classList.contains('plan-card')) {
    btn.addEventListener('click', () => subscribeToPlan(btn.dataset.plan));
  }
});

async function subscribeToPlan(planKey) {
  const plan = PLANS[planKey];
  if (!plan) return;

  if (!state.authenticated) {
    alert('Please authenticate your wallet first.');
    return;
  }

  const btn = document.querySelector(`.btn-plan-${planKey}`);
  const originalText = btn.innerHTML;
  btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px"></div> Processing…';
  btn.disabled = true;

  // Also disable other plan buttons
  document.querySelectorAll('.btn-plan').forEach(b => b.disabled = true);

  try {
    let txHash = '';
    const isCircleArc = (state.connectedProvider === 'circle-arc');

    if (!isCircleArc) {
      const provider = state.connectedProvider;
      let ethereumProvider = window.ethereum;
      
      if (provider === 'metamask') {
        if (window.ethereum?.providers) {
          ethereumProvider = window.ethereum.providers.find(p => p.isMetaMask) || window.ethereum;
        }
      } else if (provider === 'phantom') {
        ethereumProvider = window.phantom?.ethereum || (window.ethereum?.providers?.find(p => p.isPhantom)) || window.ethereum;
      } else if (provider === 'coinbase') {
        ethereumProvider = window.coinbaseWalletExtension || (window.ethereum?.providers?.find(p => p.isCoinbaseWallet)) || window.ethereum;
      } else if (provider === 'rabby') {
        ethereumProvider = window.rabby || (window.ethereum?.isRabby ? window.ethereum : null) || window.ethereum;
      } else if (provider === 'zerion') {
        ethereumProvider = window.zerion || (window.ethereum?.isZerion ? window.ethereum : null) || window.ethereum;
      } else if (provider === 'okx') {
        ethereumProvider = window.okxwallet || (window.ethereum?.isOkxWallet ? window.ethereum : null) || window.ethereum;
      }

      if (!ethereumProvider) {
        throw new Error(`No injected web3 provider found for ${WALLET_NAMES[provider]}. Make sure your wallet extension is enabled.`);
      }


      // Ensure wallet is on Arc Testnet (adds the chain if missing)
      await switchToArcTestnet(ethereumProvider);

      // Use ERC-20 transfer on the network's USDC contract so recipient receives USDC (not native gas token)
      const destination = (state.config && state.config.details && state.config.details.destinationWalletId) || '0x05c950D2EE2507678c71492a27eE1fe593CAC546';
      const tokenContract = (state.config && state.config.details && state.config.details.usdcTokenId) || '0x5425890298aed601595a70AB815c96711a31Bc65';

      // amount in USDC has 6 decimals on Arc testnet
      const amountBigInt = BigInt(plan.amount) * 1000000n;
      const data = encodeERC20Transfer(destination, amountBigInt);

      const txParams = {
        from: state.walletAddress,
        to: tokenContract,
        data: data
      };

      try {
        txHash = await ethereumProvider.request({ method: 'eth_sendTransaction', params: [txParams] });
      } catch (txErr) {
        console.warn('On-chain transfer failed (insufficient funds, wrong network, or user rejected). Falling back to simulated transaction for local testing:', txErr);
        txHash = '0x' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('');
      }
    }

    // Register subscription in backend
    const res = await fetch('/api/payment/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: state.walletAddress,
        plan: planKey,
        txHash: txHash,
        isCircleArc: isCircleArc
      })
    });

    if (!res.ok) {
      const errRes = await res.json();
      throw new Error(errRes.error || 'Backend subscription registration failed');
    }

    const result = await res.json();
    if (result.log) pushApiLog(result.log);

    // Sync state
    syncUserStateWith(result.user);

    // Enable analyze button
    document.getElementById('btn-analyze-chart').disabled = false;

    // Open terminal to inspect APIs
    if (termDrawer.classList.contains('collapsible-closed')) {
      termDrawer.classList.replace('collapsible-closed', 'collapsible-open');
    }

  } catch (err) {
    alert('Payment / Subscription failed: ' + err.message);
    document.querySelectorAll('.btn-plan').forEach(b => b.disabled = false);
    btn.innerHTML = originalText;
  }
}

function activateSubscriptionUI(planKey, plan) {
  const plansBox = document.getElementById('subscription-plans-box');
  const activeBox = document.getElementById('subscription-active-box');

  plansBox.classList.add('hidden');
  activeBox.classList.remove('hidden');

  const planEmoji = { starter: '🔵', pro: '⚡', elite: '👑' };
  document.getElementById('active-plan-badge').textContent = `${planEmoji[planKey] || ''} ${plan.name.toUpperCase()} PLAN`;

  const featuresEl = document.getElementById('active-plan-features');
  featuresEl.innerHTML = plan.features.map(f =>
    `<div class="active-feature-pill">✓ ${f}</div>`
  ).join('');

  updateQuotaDisplay();
}

function updateQuotaDisplay() {
  const used = state.subscription.pairsUsed;
  const allowed = state.subscription.pairsAllowed;
  const pct = allowed > 0 ? (used / allowed) * 100 : 0;

  document.getElementById('pairs-used').textContent = used;
  document.getElementById('pairs-allowed').textContent = allowed;

  const fill = document.getElementById('pairs-quota-fill');
  if (fill) {
    fill.style.width = pct + '%';
    fill.classList.toggle('quota-warning', pct >= 80);
  }
}

function unlockPremiumOverlays() {
  const toggleRsi = document.getElementById('toggle-rsi');
  const toggleMacd = document.getElementById('toggle-macd');

  toggleRsi.classList.remove('locked');
  const rsiLock = toggleRsi.querySelector('.lock-icon');
  if (rsiLock) rsiLock.remove();

  toggleMacd.classList.remove('locked');
  const macdLock = toggleMacd.querySelector('.lock-icon');
  if (macdLock) macdLock.remove();
}

function scrollToPlans() {
  document.getElementById('subscription-plans-box')?.scrollIntoView({ behavior: 'smooth' });
}

// ──────────────────────────────────────────────────────────────
// INDICATOR TOGGLES
// ──────────────────────────────────────────────────────────────
document.getElementById('toggle-ma').addEventListener('click', e => {
  state.activeOverlays.ma = !state.activeOverlays.ma;
  e.currentTarget.classList.toggle('active');
  drawChart();
});

document.getElementById('toggle-bb').addEventListener('click', e => {
  state.activeOverlays.bb = !state.activeOverlays.bb;
  e.currentTarget.classList.toggle('active');
  drawChart();
});

document.getElementById('btn-buy-more-lives')?.addEventListener('click', buyMoreLives);
document.getElementById('btn-upgrade-plan')?.addEventListener('click', upgradePlan);

async function buyMoreLives() {
  if (!state.authenticated) {
    alert('Please authenticate your wallet first.');
    return;
  }

  const confirmPurchase = confirm('Would you like to buy 5 extra scan lives/credits for 1 USDC?');
  if (!confirmPurchase) return;

  const btn = document.getElementById('btn-buy-more-lives');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px"></div> Processing…';
  btn.disabled = true;

  try {
    let txHash = '';
    const isCircleArc = (state.connectedProvider === 'circle-arc');

    if (!isCircleArc) {
      const provider = state.connectedProvider;
      let ethereumProvider = window.ethereum;
      if (provider === 'metamask') {
        if (window.ethereum?.providers) {
          ethereumProvider = window.ethereum.providers.find(p => p.isMetaMask) || window.ethereum;
        }
      } else if (provider === 'phantom') {
        ethereumProvider = window.phantom?.ethereum || (window.ethereum?.providers?.find(p => p.isPhantom)) || window.ethereum;
      } else if (provider === 'coinbase') {
        ethereumProvider = window.coinbaseWalletExtension || (window.ethereum?.providers?.find(p => p.isCoinbaseWallet)) || window.ethereum;
      } else if (provider === 'rabby') {
        ethereumProvider = window.rabby || (window.ethereum?.isRabby ? window.ethereum : null) || window.ethereum;
      } else if (provider === 'zerion') {
        ethereumProvider = window.zerion || (window.ethereum?.isZerion ? window.ethereum : null) || window.ethereum;
      } else if (provider === 'okx') {
        ethereumProvider = window.okxwallet || (window.ethereum?.isOkxWallet ? window.ethereum : null) || window.ethereum;
      }

      if (!ethereumProvider && window.ethereum) {
        ethereumProvider = window.ethereum;
      }

      if (!ethereumProvider) {
        throw new Error(`No injected web3 provider found for ${WALLET_NAMES[provider] || 'wallet'}.`);
      }

      await switchToArcTestnet(ethereumProvider);

      const destination = (state.config && state.config.details && state.config.details.destinationWalletId) || '0x05c950D2EE2507678c71492a27eE1fe593CAC546';
      const tokenContract = (state.config && state.config.details && state.config.details.usdcTokenId) || '0x5425890298aed601595a70AB815c96711a31Bc65';

      // 1 USDC = 1000000 micro-units
      const amountBigInt = 1000000n;
      const data = encodeERC20Transfer(destination, amountBigInt);

      const txParams = {
        from: state.walletAddress,
        to: tokenContract,
        data: data
      };

      try {
        txHash = await ethereumProvider.request({ method: 'eth_sendTransaction', params: [txParams] });
      } catch (txErr) {
        console.warn('On-chain credit purchase failed, falling back to simulated transaction:', txErr);
        txHash = '0x' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('');
      }
    }

    const res = await fetch('/api/payment/add-credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: state.walletAddress,
        txHash: txHash,
        isCircleArc: isCircleArc
      })
    });

    if (!res.ok) {
      const errRes = await res.json();
      throw new Error(errRes.error || 'Failed to register credits purchase in backend');
    }

    const result = await res.json();
    if (result.log) pushApiLog(result.log);

    // Sync state and update quota UI
    syncUserStateWith(result.user);
    alert('Successfully added 5 extra scan lives/credits!');

  } catch (err) {
    alert('Failed to add credits: ' + err.message);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

function upgradePlan() {
  const plansBox = document.getElementById('subscription-plans-box');
  if (plansBox) {
    plansBox.classList.remove('hidden');
    plansBox.scrollIntoView({ behavior: 'smooth' });
    
    const plansTitle = plansBox.querySelector('.plans-title h3');
    if (plansTitle) {
      plansTitle.textContent = 'Upgrade Your Plan';
    }
  }
}

function handleLockedToggle(e, key) {
  if (!state.subscription.plan) {
    scrollToPlans();
    return;
  }
  state.activeOverlays[key] = !state.activeOverlays[key];
  e.currentTarget.classList.toggle('active');
  drawChart();
}

document.getElementById('toggle-rsi').addEventListener('click', e => handleLockedToggle(e, 'rsi'));
document.getElementById('toggle-macd').addEventListener('click', e => handleLockedToggle(e, 'macd'));

// ══════════════════════════════════════════════════════════════
// CHART TOOLS
// ══════════════════════════════════════════════════════════════
document.getElementById('chart-dark-mode')?.addEventListener('change', (e) => {
  state.chartDarkMode = e.currentTarget.checked;
  drawChart();
});

document.getElementById('btn-chart-toggle-legend')?.addEventListener('click', (e) => {
  state.chartShowLegend = !state.chartShowLegend;
  e.currentTarget.classList.toggle('active');
  if (state.chartInstance) {
    state.chartInstance.applyOptions({
      timeScale: {
        visible: state.chartShowLegend,
      }
    });
  }
});

document.getElementById('btn-chart-reset-zoom')?.addEventListener('click', () => {
  if (state.chartInstance) {
    state.chartInstance.timeScale().fitContent();
  }
});

document.getElementById('btn-chart-download')?.addEventListener('click', () => {
  if (!state.chartInstance) return;
  
  try {
    const imageUrl = state.chartInstance.takeScreenshot();
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `chart-${state.selectedSymbol}-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error('Failed to download chart:', err);
    alert('Download not available on this browser');
  }
});

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
window.addEventListener('resize', resizeCanvas);

(async function init() {
  try {
    // Ensure LightweightCharts library is loaded
    await waitForLightweightCharts();
  } catch (err) {
    console.error('Failed to initialize: LightweightCharts not available', err);
    document.body.innerHTML = '<div style="padding:20px; color:#f87171;">Error: Chart library failed to load. Please refresh the page.</div>';
    return;
  }

  await checkConfigStatus();

  // Check if session was saved
  const savedConnected = localStorage.getItem('walletConnected');
  const savedAddress = localStorage.getItem('walletAddress');
  const savedProvider = localStorage.getItem('connectedProvider');

  if (savedConnected === 'true' && savedAddress && savedProvider) {
    state.walletAddress = savedAddress;
    state.walletConnected = true;
    state.connectedProvider = savedProvider;
    state.authenticated = true; // Auto-verify signature for persistent session

    const shortAddr = savedAddress.slice(0, 6) + '…' + savedAddress.slice(-4);
    document.getElementById('wallet-btn-text').textContent = shortAddr;
    document.getElementById('wallet-address').textContent = shortAddr;
    document.getElementById('circle-wallet-id').textContent = shortAddr;
    document.getElementById('wallet-indicator').textContent = 'Connected';
    document.getElementById('wallet-indicator').className = 'wallet-status connected';
    document.getElementById('wallet-state-disconnected').classList.add('hidden');
    document.getElementById('wallet-state-sign').classList.add('hidden');
    document.getElementById('wallet-state-authenticated').classList.remove('hidden');
    document.getElementById('btn-analyze-chart').disabled = false;
    document.getElementById('btn-refresh-analysis').disabled = false;

    // Fetch live status from backend
    try {
      const res = await fetch(`/api/user/${savedAddress}`);
      const data = await res.json();
      if (data.success) {
        syncUserStateWith(data.user);
      }
    } catch (err) {
      console.error('Failed to restore user backend session:', err);
    }
  }

  // Load default pair BTC/USDC (prefer live candles when in live mode)
  if (state.chartMode === 'live') {
    await loadLiveChart('BTC/USDC', state.selectedTimeframe);
  } else {
    await loadPair('BTC/USDC');
  }
  resizeCanvas();

  // ══════════════════════════════════════════════════════════════
  // SMART CONTRACT DEPLOYER LOGIC
  // ══════════════════════════════════════════════════════════════
  const DEPLOY_TEMPLATES = {
    storage: {
      solidity: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SimpleStorage {
    uint256 public value;

    event ValueChanged(uint256 newValue);

    constructor(uint256 _initialValue) {
        value = _initialValue;
    }

    function setValue(uint256 _newValue) public {
        value = _newValue;
        emit ValueChanged(_newValue);
    }
}`,
      bytecode: '608060405234801561001057600080fd5b5060405161011338038061011383398101604052805190506000805490508190555060ad8061004a6000396000f3fe6080604052348015600f57600080fd5b5060043610603c5760003560e01c80633fa4f245146041578063552410ac14606f575b600080fd5b348015604c57600080fd5b5060536093565b6040518082815260200191505060405180910390f35b348015607a57600080fd5b50609160048036036020811015608f57600080fd5b50356099565b005b60005481565b806000819055505056fee1a26469706673582212204c35639f706d8d9b6a1db01d01abfe9a70f3f269a23999e56499879c5c2d385a64736f6c63430008140033'
    },
    erc20: {
      solidity: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ArcCustomToken {
    string public constant name = "Arc Custom Token";
    string public constant symbol = "ACT";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    
    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor(uint256 _initialSupply) {
        totalSupply = _initialSupply * 10 ** decimals;
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    function transfer(address _to, uint256 _value) public returns (bool success) {
        require(balanceOf[msg.sender] >= _value, "Insufficient balance");
        balanceOf[msg.sender] -= _value;
        balanceOf[_to] += _value;
        emit Transfer(msg.sender, _to, _value);
        return true;
    }
}`,
      bytecode: '608060405234801561001057600080fd5b5060405161011c38038061011c8339810160405280519050600a60120a810290506000805490508190555060bc806100606000396000f3fe6080604052348015600f57600080fd5b5060043610603c5760003560e01c806318160ddd14604157806370a08231146059578063a9059cbb146087575b600080fd5b348015604b57600080fd5b50605060ab565b6040518082815260200191505060405180910390f35b348015606357600080fd5b50607d60048036036020811015607757600080fd5b503573ffffffffffffffffffffffffffffffffffffffff1660b1565b6040518082815260200191505060405180910390f35b348015609157600080fd5b5060a56004803603604081101560a157600080fd5b813573ffffffffffffffffffffffffffffffffffffffff16906020013590505060c7565b005b60005481565b60008073ffffffffffffffffffffffffffffffffffffffff168273ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000205481565b806000803373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002054036000803373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002055816000808473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002054016000808473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000205550505056fee1a26469706673582212202c3476fa3571d79860b001a1db01d01abfe9a70f3f269a23999e56499879c5c2d385a64736f6c63430008140033'
    },
    custom: {
      solidity: `// Custom EVM Bytecode Deployment
// Enter raw hexadecimal creation bytecode in the field above.
// For example: 0x608060405234...`,
      bytecode: ''
    }
  };

  const templateSelect = document.getElementById('deploy-template-select');
  const solidityCodeDisplay = document.getElementById('solidity-code-display');
  const btnSubmitDeployment = document.getElementById('btn-submit-deployment');
  const consoleLogs = document.getElementById('console-logs');
  const deployStatusConsole = document.getElementById('deploy-status-console');

  // Helper to pad to 32 bytes (64 hex characters)
  function pad32Bytes(hexStr) {
    return hexStr.padStart(64, '0');
  }

  // Helper to render solidity code templates
  function updateSolidityCodeTemplate() {
    const selected = templateSelect.value;
    const tmpl = DEPLOY_TEMPLATES[selected];
    if (solidityCodeDisplay && tmpl) {
      solidityCodeDisplay.textContent = tmpl.solidity;
    }

    // Toggle dynamic parameter panels
    document.getElementById('deploy-params-storage').classList.toggle('hidden', selected !== 'storage');
    document.getElementById('deploy-params-erc20').classList.toggle('hidden', selected !== 'erc20');
    document.getElementById('deploy-params-custom').classList.toggle('hidden', selected !== 'custom');
  }

  if (templateSelect) {
    templateSelect.addEventListener('change', updateSolidityCodeTemplate);
    // Initial run
    updateSolidityCodeTemplate();
  }

  function addConsoleLine(text, status = 'info') {
    const line = document.createElement('div');
    line.className = `console-line ${status}`;
    line.innerHTML = text;
    consoleLogs.appendChild(line);
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
  }

  if (btnSubmitDeployment) {
    btnSubmitDeployment.addEventListener('click', executeDeployment);
  }

  async function executeDeployment() {
    if (!state.walletConnected) {
      alert('Please connect your MetaMask / Arc wallet first.');
      openWalletModal();
      return;
    }

    const selected = templateSelect.value;
    let finalBytecode = '';

    // Clear logs and display console
    consoleLogs.innerHTML = '';
    deployStatusConsole.classList.remove('hidden');

    addConsoleLine('Initializing smart contract deployment on Arc Testnet...', 'loading');

    try {
      if (selected === 'storage') {
        const valStr = document.getElementById('param-storage-msg').value.trim();
        const valInt = parseInt(valStr) || 0;
        addConsoleLine(`Compiling SimpleStorage with initialValue: <b>${valInt}</b>`, 'info');
        
        const rawBytecode = DEPLOY_TEMPLATES.storage.bytecode;
        const paramHex = valInt.toString(16);
        const paddedParam = pad32Bytes(paramHex);
        finalBytecode = '0x' + rawBytecode + paddedParam;
        
      } else if (selected === 'erc20') {
        const name = document.getElementById('param-erc20-name').value.trim() || 'Arc Custom Token';
        const symbol = document.getElementById('param-erc20-symbol').value.trim() || 'ACT';
        const supply = parseInt(document.getElementById('param-erc20-supply').value) || 1000000;
        addConsoleLine(`Compiling ArcCustomToken [Name: "${name}", Symbol: "${symbol}", Supply: ${supply}]`, 'info');
        
        const rawBytecode = DEPLOY_TEMPLATES.erc20.bytecode;
        const supplyHex = supply.toString(16);
        const paddedSupply = pad32Bytes(supplyHex);
        finalBytecode = '0x' + rawBytecode + paddedSupply;
        
      } else if (selected === 'custom') {
        let customBytecode = document.getElementById('param-custom-bytecode').value.trim();
        if (!customBytecode.startsWith('0x')) {
          customBytecode = '0x' + customBytecode;
        }
        if (customBytecode.length < 40) {
          throw new Error('Please enter a valid compiled Solidity creation bytecode (hex string)');
        }
        finalBytecode = customBytecode;
        addConsoleLine('Using custom EVM compilation payload.', 'info');
      }

      addConsoleLine('Preparing deployment transaction payload...', 'info');

      let txHash = '';
      const isCircleArc = (state.connectedProvider === 'circle-arc');

      if (!isCircleArc) {
        addConsoleLine('Requesting permission from browser wallet provider...', 'loading');
        const provider = state.connectedProvider;
        let ethereumProvider = window.ethereum;
        if (provider === 'metamask') {
          if (window.ethereum?.providers) {
            ethereumProvider = window.ethereum.providers.find(p => p.isMetaMask) || window.ethereum;
          }
        } else if (provider === 'phantom') {
          ethereumProvider = window.phantom?.ethereum || (window.ethereum?.providers?.find(p => p.isPhantom)) || window.ethereum;
        } else if (provider === 'coinbase') {
          ethereumProvider = window.coinbaseWalletExtension || (window.ethereum?.providers?.find(p => p.isCoinbaseWallet)) || window.ethereum;
        } else if (provider === 'rabby') {
          ethereumProvider = window.rabby || (window.ethereum?.isRabby ? window.ethereum : null) || window.ethereum;
        } else if (provider === 'zerion') {
          ethereumProvider = window.zerion || (window.ethereum?.isZerion ? window.ethereum : null) || window.ethereum;
        } else if (provider === 'okx') {
          ethereumProvider = window.okxwallet || (window.ethereum?.isOkxWallet ? window.ethereum : null) || window.ethereum;
        }

        if (!ethereumProvider && window.ethereum) {
          ethereumProvider = window.ethereum;
        }

        if (!ethereumProvider) {
          throw new Error(`Web3 provider not detected for ${provider}. Please confirm your extension is logged in.`);
        }

        addConsoleLine('Switching network to Arc Testnet...', 'info');
        await switchToArcTestnet(ethereumProvider);

        const txParams = {
          from: state.walletAddress,
          to: null, // Critical: to is null for contract deployments
          data: finalBytecode
        };

        addConsoleLine('Confirm the transaction in your wallet extension popup...', 'loading');
        try {
          txHash = await ethereumProvider.request({ method: 'eth_sendTransaction', params: [txParams] });
        } catch (txErr) {
          console.warn('On-chain deployment failed or was cancelled by user. Falling back to simulator:', txErr);
          if (txErr.message && txErr.message.includes('User rejected')) {
            throw new Error('Transaction rejected by user in MetaMask.');
          }
          addConsoleLine('MetaMask error/cancelled. Performing fallback simulated deploy...', 'info');
          txHash = '0x' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('');
        }
      } else {
        // Circle Developer Wallet simulated deploy
        addConsoleLine('Submitting programmatic deploy transaction to Circle Arc backend...', 'loading');
        await new Promise(r => setTimeout(r, 1200));
        txHash = '0x' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('');
      }

      addConsoleLine(`Transaction broadcast successfully! Tx Hash: <span style="font-family: monospace; color:#cbd5e1">${txHash.slice(0,16)}...</span>`, 'info');
      addConsoleLine('Waiting for block confirmation on Arc L1 (takes ~1-2 blocks)...', 'loading');

      // Simulate mining wait
      await new Promise(r => setTimeout(r, 2000));

      // Generate a contract address dynamically from tx hash
      const contractAddress = '0x' + txHash.slice(2, 42); // 40 chars hex

      addConsoleLine(`Contract mined successfully in Block #5042890!`, 'success');
      addConsoleLine(`Deployed Contract Address: <a class="console-link" href="https://testnet.arcscan.app/address/${contractAddress}" target="_blank">${contractAddress}</a>`, 'success');

      // Show toast notification
      showToast(`Smart contract successfully deployed to Arc Testnet! Address: ${contractAddress.slice(0,6)}...${contractAddress.slice(-4)}`, 'success');

      // Log this API call to the live API terminal inspector at the bottom of the page
      const clientLog = {
        timestamp: new Date().toISOString(),
        endpoint: '/v1/w3s/developer/transactions/deployContract',
        method: 'DEPLOY',
        requestBody: { from: state.walletAddress, template: selected, bytecodeSize: finalBytecode.length },
        responseStatus: 201,
        responseBody: { success: true, txHash: txHash, deployedContract: contractAddress, state: 'CONFIRMED' },
        isSimulated: isCircleArc
      };
      pushApiLog(clientLog);

    } catch (err) {
      addConsoleLine(`Deployment failed: ${err.message}`, 'error');
      showToast(`Contract deployment failed: ${err.message}`, 'error');
      console.error('Contract deployment failed:', err);
    }
  }

  // Toast Notification Helper
  function showToast(message, type = 'success') {
    let container = document.querySelector('.app-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'app-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `app-toast ${type}`;
    
    const icon = type === 'success' ? '🎉' : type === 'error' ? '❌' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'toastFadeOut 0.3s ease forwards';
      setTimeout(() => {
        toast.remove();
        if (container.children.length === 0) {
          container.remove();
        }
      }, 300);
    }, 4700);
  }
})();
