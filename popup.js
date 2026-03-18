/** ----------------------------------------------------------------
 *  Ad Scanner – popup.js
 *  Injects scanAdsOnPage() into the active tab and renders results
 * ---------------------------------------------------------------- */

const scanBtn    = document.getElementById('scanBtn');
const scanIcon   = document.getElementById('scanIcon');
const statusText = document.getElementById('statusText');
const pageUrlEl  = document.getElementById('pageUrl');
const mainContent = document.getElementById('mainContent');

let lastScanTime = null;
let openSection  = null; // 'taboola' | 'adsense' | 'adx'

// ── Boot: show current tab URL ────────────────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (tab?.url) {
    try {
      const url = new URL(tab.url);
      pageUrlEl.textContent = url.hostname + (url.pathname !== '/' ? url.pathname : '');
    } catch {
      pageUrlEl.textContent = tab.url.slice(0, 50);
    }
  }
});

// ── Scan button click ─────────────────────────────────────────────
scanBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // Guard: can't inject into chrome:// pages
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
    showError('无法扫描此页面（浏览器内置页面不支持）');
    return;
  }

  setScanningState(true);
  mainContent.innerHTML = '';

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scanAdsOnPage,
      world: 'MAIN',
    });

    lastScanTime = new Date();
    setScanningState(false);
    renderResults(result);
  } catch (err) {
    setScanningState(false);
    showError('扫描失败：' + (err.message || '未知错误'));
  }
});

// ── UI State Helpers ──────────────────────────────────────────────
function setScanningState(scanning) {
  scanBtn.disabled = scanning;
  if (scanning) {
    scanIcon.classList.add('spinning');
    statusText.textContent = '正在扫描…';
    statusText.className = 'status-text scanning';
  } else {
    scanIcon.classList.remove('spinning');
    statusText.textContent = lastScanTime ? `上次扫描：${formatTime(lastScanTime)}` : '点击开始扫描广告';
    statusText.className = 'status-text';
  }
}

function showError(msg) {
  mainContent.innerHTML = `
    <div class="error-state">
      <p>${msg}</p>
    </div>`;
}

function formatTime(date) {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Render Results ────────────────────────────────────────────────
function renderResults(data) {
  if (!data) { showError('未获取到扫描数据'); return; }

  const { taboola, adsense, adx, total } = data;

  if (total === 0) {
    mainContent.innerHTML = `
      <div class="divider"></div>
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 12h8M12 8v8"/>
        </svg>
        <div class="empty-title">未检测到广告</div>
        <div class="empty-sub">该页面没有发现 Taboola、AdSense 或 AdX 广告</div>
      </div>`;
    return;
  }

  // Build HTML
  const html = `
    <div class="divider"></div>

    <!-- Total Banner -->
    <div class="total-banner">
      <div class="total-ring">
        <svg viewBox="0 0 44 44">
          <circle class="total-ring-bg" cx="22" cy="22" r="18"/>
          <circle class="total-ring-fill" id="ringFill" cx="22" cy="22" r="18"/>
        </svg>
        <div class="total-ring-text" id="ringText">0</div>
      </div>
      <div class="total-info">
        <div class="total-label">总广告数</div>
        <div class="total-count" id="totalCount">0</div>
        <div class="total-sub">
          ${[taboola.count && 'Taboola', adsense.count && 'AdSense', adx.count && 'AdX']
            .filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
    </div>

    <!-- Platform Cards -->
    <div class="platform-grid">
      ${makePlatformCard('taboola', 'Taboola', taboola.count, taboola.types)}
      ${makePlatformCard('adsense', 'AdSense', adsense.count, adsense.types)}
      ${makePlatformCard('adx', 'AdX / GAM', adx.count, adx.types)}
    </div>

    <!-- Detail Breakdowns -->
    ${makeBreakdown('taboola', taboola.types, taboola.count)}
    ${makeBreakdown('adsense', adsense.types, adsense.count)}
    ${makeBreakdown('adx', adx.types, adx.count)}

    <!-- Footer -->
    <div class="footer">
      <div class="footer-time">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        ${formatTime(lastScanTime)}
      </div>
      <div class="footer-dot"></div>
    </div>
  `;

  mainContent.innerHTML = html;

  // Animate ring & counters after render
  requestAnimationFrame(() => {
    animateCounter('totalCount', 0, total, 600);
    animateCounter('ringText',   0, total, 600);

    // Animate ring stroke
    const ring = document.getElementById('ringFill');
    if (ring) {
      const circumference = 2 * Math.PI * 18; // r=18 → ~113
      const filled = total >= 1 ? Math.min(circumference * 0.9, circumference) : 0;
      ring.style.strokeDashoffset = circumference - filled;
    }

    // Animate type bars
    animateAllBars();
  });

  // Attach card click handlers
  ['taboola', 'adsense', 'adx'].forEach(platform => {
    const card    = document.getElementById(`card-${platform}`);
    const section = document.getElementById(`breakdown-${platform}`);
    if (!card || !section) return;

    card.addEventListener('click', () => {
      const isOpen = section.classList.contains('open');

      // Close all
      document.querySelectorAll('.breakdown-section.open').forEach(s => s.classList.remove('open'));
      document.querySelectorAll('.platform-card.active').forEach(c => c.classList.remove('active'));

      if (!isOpen) {
        section.classList.add('open');
        card.classList.add('active');
        openSection = platform;
        // Re-animate bars in this section
        setTimeout(() => animateBarsIn(platform), 30);
      } else {
        openSection = null;
      }
    });
  });
}

function makePlatformCard(platform, label, count, types) {
  const topType = getTopType(types);
  return `
    <div class="platform-card ${platform}" id="card-${platform}" role="button" tabindex="0" aria-label="${label} 广告详情">
      <div class="platform-name">${label}</div>
      <div class="platform-count">${count}</div>
      <div class="platform-sub">${topType || (count === 0 ? '无' : '—')}</div>
      <svg class="platform-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>`;
}

function makeBreakdown(platform, types, total) {
  if (total === 0) return '';
  const entries = Object.entries(types).sort((a, b) => b[1] - a[1]);
  const rows = entries.map(([name, count]) => `
    <div class="type-row">
      <span class="type-name">${name}</span>
      <div class="type-bar-wrap">
        <div class="type-bar ${platform}-color" data-target="${(count / total * 100).toFixed(0)}" style="width:0"></div>
      </div>
      <span class="type-count" style="color:var(--${platform})">${count}</span>
    </div>`).join('');

  return `
    <div class="breakdown-section" id="breakdown-${platform}">
      <div class="breakdown-inner">
        <div class="breakdown-title">${platform === 'taboola' ? 'Taboola' : platform === 'adsense' ? 'AdSense' : 'AdX / GAM'} 广告类型明细</div>
        ${rows}
      </div>
    </div>`;
}

function getTopType(types) {
  if (!types || !Object.keys(types).length) return '';
  return Object.entries(types).sort((a, b) => b[1] - a[1])[0][0];
}

// ── Animations ────────────────────────────────────────────────────
function animateCounter(id, from, to, duration) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function animateAllBars() {
  document.querySelectorAll('.type-bar').forEach(bar => {
    const target = bar.dataset.target;
    setTimeout(() => { bar.style.width = target + '%'; }, 100);
  });
}

function animateBarsIn(platform) {
  const section = document.getElementById(`breakdown-${platform}`);
  if (!section) return;
  section.querySelectorAll('.type-bar').forEach(bar => {
    bar.style.width = '0';
    const target = bar.dataset.target;
    requestAnimationFrame(() => {
      setTimeout(() => { bar.style.width = target + '%'; }, 50);
    });
  });
}

// ── Page Scan Function (injected into tab) ────────────────────────
/**
 * This function runs in the context of the scanned page (world: MAIN).
 * It has access to the page's DOM and window globals (googletag, _taboola, etc.).
 */
function scanAdsOnPage() {
  const results = {
    taboola: { count: 0, types: {} },
    adsense: { count: 0, types: {} },
    adx:     { count: 0, types: {} },
    total:   0,
  };

  // ── TABOOLA ──────────────────────────────────────────────────────
  const taboolaSet = new Set();

  const tabSelectors = [
    '[id*="taboola"]',
    '[class*="taboola"]',
    '._taboola',
    '.tbl-feed-module',
    '[id^="tbl_"]',
    '[data-widget-id][class*="tab"]',
  ];

  tabSelectors.forEach(sel => {
    try {
      document.querySelectorAll(sel).forEach(el => {
        if (el.tagName !== 'SCRIPT' && el.tagName !== 'NOSCRIPT' && el.tagName !== 'META') {
          taboolaSet.add(el);
        }
      });
    } catch (_) {}
  });

  // Deduplicate: keep only top-level Taboola containers
  const taboolaFiltered = [...taboolaSet].filter(el => {
    return ![...taboolaSet].some(parent => parent !== el && parent.contains(el));
  });

  taboolaFiltered.forEach(el => {
    let type = 'Native';
    const id  = (el.id || '').toLowerCase();
    const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();

    if (id.includes('video') || cls.includes('video')) {
      type = 'Video';
    } else if (id.includes('below') || id.includes('mid') || cls.includes('mid')) {
      type = 'Mid-Article';
    } else if (el.querySelectorAll('[class*="item"], [class*="card"], [class*="thumb"]').length >= 3) {
      type = 'Feed Native';
    }

    results.taboola.count++;
    results.taboola.types[type] = (results.taboola.types[type] || 0) + 1;
  });

  // Fallback: parse window._taboola command queue
  if (results.taboola.count === 0) {
    try {
      if (Array.isArray(window._taboola)) {
        const modes = window._taboola.filter(cmd => cmd && cmd.mode && cmd.container);
        modes.forEach(cmd => {
          const mode  = (cmd.mode || '').toLowerCase();
          const type  = mode.includes('video') ? 'Video'
                      : mode.includes('thumbnails') ? 'Thumbnail'
                      : 'Native';
          results.taboola.count++;
          results.taboola.types[type] = (results.taboola.types[type] || 0) + 1;
        });
      }
    } catch (_) {}
  }

  // ── ADSENSE ───────────────────────────────────────────────────────
  const counted = new Set();

  document.querySelectorAll('ins.adsbygoogle').forEach(el => {
    counted.add(el);
    const fmt = (el.getAttribute('data-ad-format') || '').toLowerCase();
    const fwr = el.getAttribute('data-full-width-responsive');
    const w   = parseInt(el.style.width)   || parseInt(el.getAttribute('width'))  || 0;
    const h   = parseInt(el.style.height)  || parseInt(el.getAttribute('height')) || 0;

    let type = 'Banner';
    if (fmt === 'fluid' || fmt.includes('native') || fmt === 'in-article') {
      type = 'In-Feed Native';
    } else if (fmt === 'auto' || fwr === 'true') {
      type = 'Responsive';
    } else if (fmt === 'rectangle' || (w === 300 && h === 250) || (w === 336 && h === 280)) {
      type = 'Rectangle';
    } else if (fmt === 'horizontal' || h === 90 || h === 60) {
      type = 'Leaderboard';
    } else if (fmt === 'vertical' || w === 160 || w === 120) {
      type = 'Skyscraper';
    } else if (h === 50 || (w === 320 && h === 50)) {
      type = 'Mobile Banner';
    } else if (w === 300 && h === 600) {
      type = 'Half Page';
    }

    results.adsense.count++;
    results.adsense.types[type] = (results.adsense.types[type] || 0) + 1;
  });

  // Rendered AdSense iframes not inside <ins>
  document.querySelectorAll('iframe[id^="aswift_"]').forEach(iframe => {
    if (!iframe.closest('ins.adsbygoogle')) {
      results.adsense.count++;
      results.adsense.types['Banner'] = (results.adsense.types['Banner'] || 0) + 1;
    }
  });

  // ── ADX / GOOGLE AD MANAGER ───────────────────────────────────────
  const gptSet = new Set();

  document.querySelectorAll('[id^="div-gpt-ad"]').forEach(el => {
    gptSet.add(el);
    let type = 'Banner';
    const id  = el.id || '';

    // Try to extract size from div ID (e.g. div-gpt-ad-728x90-0)
    const sizeMatch = id.match(/[_-](\d{2,4})x(\d{2,4})/);
    if (sizeMatch) {
      const w = parseInt(sizeMatch[1]);
      const h = parseInt(sizeMatch[2]);
      if (w === 1 && h === 1) return;
      if (w >= 640 && h >= 400) type = 'Interstitial';
      else if (h === 90 || h === 60 || w >= 728) type = 'Leaderboard';
      else if (w === 300 && h === 600) type = 'Half Page';
      else if (w === 300 || (w >= 250 && h >= 200)) type = 'Rectangle';
      else if (w === 160 || w === 120) type = 'Skyscraper';
      else if (h <= 60) type = 'Mobile Banner';
    } else {
      // Fall back to rendered iframe dimensions
      const iframe = el.querySelector('iframe[id^="google_ads_iframe"]');
      if (iframe) {
        const fw = iframe.width  || iframe.style.width;
        const fh = iframe.height || iframe.style.height;
        if (parseInt(fw) >= 728) type = 'Leaderboard';
        else if (parseInt(fw) === 300) type = 'Rectangle';
      }
    }

    results.adx.count++;
    results.adx.types[type] = (results.adx.types[type] || 0) + 1;
  });

  // Rendered GAM iframes outside GPT divs
  document.querySelectorAll('iframe[name^="google_ads_iframe_"]').forEach(iframe => {
    if (!iframe.closest('[id^="div-gpt-ad"]')) {
      results.adx.count++;
      results.adx.types['Banner'] = (results.adx.types['Banner'] || 0) + 1;
    }
  });

  // DFP iframes via doubleclick.net
  document.querySelectorAll(
    'iframe[src*="doubleclick.net"], iframe[src*="pubads.g.doubleclick.net"], iframe[src*="securepubads"]'
  ).forEach(iframe => {
    if (!iframe.closest('[id^="div-gpt-ad"]') && !iframe.name?.startsWith('google_ads_iframe_')) {
      results.adx.count++;
      results.adx.types['Banner'] = (results.adx.types['Banner'] || 0) + 1;
    }
  });

  // Fallback: query googletag slots if no DOM elements found yet
  if (results.adx.count === 0) {
    try {
      if (window.googletag && typeof googletag.pubads === 'function') {
        const slots = googletag.pubads().getSlots();
        slots.forEach(slot => {
          let type = 'Banner';
          try {
            const sizes = slot.getSizes(window.innerWidth, window.innerHeight);
            if (Array.isArray(sizes) && sizes.length > 0 && sizes[0].getWidth) {
              const w = sizes[0].getWidth();
              const h = sizes[0].getHeight();
              if (w >= 728) type = 'Leaderboard';
              else if (w === 300 && h === 600) type = 'Half Page';
              else if (w === 300) type = 'Rectangle';
            }
          } catch (_) {}
          results.adx.count++;
          results.adx.types[type] = (results.adx.types[type] || 0) + 1;
        });
      }
    } catch (_) {}
  }

  results.total = results.taboola.count + results.adsense.count + results.adx.count;
  return results;
}
