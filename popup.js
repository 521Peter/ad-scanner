/** ----------------------------------------------------------------
 *  Ad Scanner – popup.js
 *  Injects scanAdsOnPage() into the active tab and renders results
 * ---------------------------------------------------------------- */

const scanBtn = document.getElementById("scanBtn");
const scanIcon = document.getElementById("scanIcon");
const statusText = document.getElementById("statusText");
const pageUrlEl = document.getElementById("pageUrl");
const mainContent = document.getElementById("mainContent");

let lastScanTime = null;
let openSection = null; // 'taboola' | 'adsense' | 'adx'

// ── Boot: show current tab URL ────────────────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (tab?.url) {
    try {
      const url = new URL(tab.url);
      pageUrlEl.textContent =
        url.hostname + (url.pathname !== "/" ? url.pathname : "");
    } catch {
      pageUrlEl.textContent = tab.url.slice(0, 50);
    }
  }
});

// ── Scan button click ─────────────────────────────────────────────
scanBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // Guard: can't inject into chrome:// pages
  if (
    !tab.url ||
    tab.url.startsWith("chrome://") ||
    tab.url.startsWith("chrome-extension://") ||
    tab.url.startsWith("about:")
  ) {
    showError("无法扫描此页面（浏览器内置页面不支持）");
    return;
  }

  setScanningState(true);
  mainContent.innerHTML = "";

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scanAdsOnPage,
      world: "MAIN",
    });

    lastScanTime = new Date();
    setScanningState(false);
    renderResults(result);
  } catch (err) {
    setScanningState(false);
    showError("扫描失败：" + (err.message || "未知错误"));
  }
});

// ── UI State Helpers ──────────────────────────────────────────────
function setScanningState(scanning) {
  scanBtn.disabled = scanning;
  if (scanning) {
    scanIcon.classList.add("spinning");
    statusText.textContent = "正在扫描…";
    statusText.className = "status-text scanning";
  } else {
    scanIcon.classList.remove("spinning");
    statusText.textContent = lastScanTime
      ? `上次扫描：${formatTime(lastScanTime)}`
      : "点击开始扫描广告";
    statusText.className = "status-text";
  }
}

function showError(msg) {
  mainContent.innerHTML = `
    <div class="error-state">
      <p>${msg}</p>
    </div>`;
}

function formatTime(date) {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Render Results ────────────────────────────────────────────────
function renderResults(data) {
  if (!data) {
    showError("未获取到扫描数据");
    return;
  }

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

  // 计算各平台已展示广告数
  const tabFilledCount = (taboola.items || []).filter((it) => it.filled).length;
  const adsFilledCount = (adsense.items || []).filter((it) => it.filled).length;
  const adxFilledCount = (adx.items || []).filter((it) => it.filled).length;

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
          ${
            [
              taboola.count && "Taboola",
              adsense.count && "AdSense",
              adx.count && "AdX",
            ]
              .filter(Boolean)
              .join(" · ") || "—"
          }
        </div>
      </div>
    </div>

    <!-- Platform Cards -->
    <div class="platform-grid">
      ${makePlatformCard("taboola", "Taboola", taboola.count, tabFilledCount)}
      ${makePlatformCard("adsense", "AdSense", adsense.count, adsFilledCount)}
      ${makePlatformCard("adx", "AdX / GAM", adx.count, adxFilledCount)}
    </div>

    <!-- Detail Breakdowns -->
    ${makeBreakdown("taboola", taboola.items || [], taboola.count)}
    ${makeBreakdown("adsense", adsense.items || [], adsense.count)}
    ${makeBreakdown("adx", adx.items || [], adx.count)}

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
    animateCounter("totalCount", 0, total, 600);
    animateCounter("ringText", 0, total, 600);

    // Animate ring stroke
    const ring = document.getElementById("ringFill");
    if (ring) {
      const circumference = 2 * Math.PI * 18; // r=18 → ~113
      const filled =
        total >= 1 ? Math.min(circumference * 0.9, circumference) : 0;
      ring.style.strokeDashoffset = circumference - filled;
    }
  });

  // Attach card click handlers
  ["taboola", "adsense", "adx"].forEach((platform) => {
    const card = document.getElementById(`card-${platform}`);
    const section = document.getElementById(`breakdown-${platform}`);
    if (!card || !section) return;

    card.addEventListener("click", () => {
      const isOpen = section.classList.contains("open");

      // Close all
      document
        .querySelectorAll(".breakdown-section.open")
        .forEach((s) => s.classList.remove("open"));
      document
        .querySelectorAll(".platform-card.active")
        .forEach((c) => c.classList.remove("active"));

      if (!isOpen) {
        section.classList.add("open");
        card.classList.add("active");
        openSection = platform;
      } else {
        openSection = null;
      }
    });
  });
}

function makePlatformCard(platform, label, count, filledCount) {
  const subText = count === 0 ? "无" : `${filledCount}/${count} 已展示`;
  return `
    <div class="platform-card ${platform}" id="card-${platform}" role="button" tabindex="0" aria-label="${label} 广告详情">
      <div class="platform-name">${label}</div>
      <div class="platform-count">${count}</div>
      <div class="platform-sub">${subText}</div>
      <svg class="platform-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>`;
}

function makeBreakdown(platform, items, total) {
  if (total === 0) return "";

  const platformLabel =
    platform === "taboola"
      ? "Taboola"
      : platform === "adsense"
        ? "AdSense"
        : "AdX / GAM";

  const filledCount = items.filter((it) => it.filled).length;

  const itemRows = items
    .map(
      (item) => `
    <div class="ad-item">
      <span class="ad-status-dot ${item.filled ? "dot-filled" : "dot-empty"}"></span>
      <div class="ad-item-info">
        <span class="ad-item-index">#${item.index}</span>
        <span class="ad-item-type">${item.type}</span>
      </div>
      <span class="ad-item-size">
        ${item.width > 0 && item.height > 0 ? `${item.width}×${item.height}` : "—"}
      </span>
      <span class="ad-item-badge ${item.filled ? "badge-filled" : "badge-empty"}">
        ${item.filled ? "已展示" : "未展示"}
      </span>
    </div>`,
    )
    .join("");

  return `
    <div class="breakdown-section" id="breakdown-${platform}">
      <div class="breakdown-inner">
        <div class="breakdown-header">
          <div class="breakdown-title">${platformLabel} 广告明细</div>
          <div class="breakdown-filled-stat">${filledCount}/${total} 已展示</div>
        </div>
        <div class="ad-items-list">
          ${itemRows}
        </div>
      </div>
    </div>`;
}

function getTopType(types) {
  if (!types || !Object.keys(types).length) return "";
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

// ── Page Scan Function (injected into tab) ────────────────────────
/**
 * This function runs in the context of the scanned page (world: MAIN).
 * It has access to the page's DOM and window globals (googletag, _taboola, etc.).
 */
function scanAdsOnPage() {
  const results = {
    taboola: { count: 0, types: {}, items: [] },
    adsense: { count: 0, types: {}, items: [] },
    adx: { count: 0, types: {}, items: [] },
    total: 0,
  };

  // ── TABOOLA ──────────────────────────────────────────────────────
  // 使用 [data-item-thumb] 选择器查找所有 Taboola 广告缩略图项
  const taboolaThumbEls = document.querySelectorAll(
    `[data-item-thumb][data-item-syndicated="true"]`,
  );

  taboolaThumbEls.forEach((el, i) => {
    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    const visible = w > 0 && h > 0;

    // 判断是否已填充：有尺寸且图片已加载
    const img = el.querySelector("img");
    const filled = visible && (!img || (img.complete && img.naturalWidth > 0));

    const type = el.querySelector("video") ? "Video" : "Native";

    results.taboola.items.push({
      index: i + 1,
      type,
      width: w,
      height: h,
      filled,
      visible,
    });
    results.taboola.count++;
    results.taboola.types[type] = (results.taboola.types[type] || 0) + 1;
  });

  // Fallback: parse window._taboola command queue
  if (results.taboola.count === 0) {
    try {
      if (Array.isArray(window._taboola)) {
        const modes = window._taboola.filter(
          (cmd) => cmd && cmd.mode && cmd.container,
        );
        modes.forEach((cmd, i) => {
          const mode = (cmd.mode || "").toLowerCase();
          const type = mode.includes("video")
            ? "Video"
            : mode.includes("thumbnails")
              ? "Thumbnail"
              : "Native";
          results.taboola.items.push({
            index: i + 1,
            type,
            width: 0,
            height: 0,
            filled: false,
            visible: false,
          });
          results.taboola.count++;
          results.taboola.types[type] = (results.taboola.types[type] || 0) + 1;
        });
      }
    } catch (_) {}
  }

  // ── ADSENSE ───────────────────────────────────────────────────────
  document.querySelectorAll("ins.adsbygoogle").forEach((el, i) => {
    const fmt = (el.getAttribute("data-ad-format") || "").toLowerCase();
    const fwr = el.getAttribute("data-full-width-responsive");
    const adStatus = el.getAttribute("data-ad-status");

    const rect = el.getBoundingClientRect();
    const w =
      Math.round(rect.width) ||
      parseInt(el.style.width) ||
      parseInt(el.getAttribute("width")) ||
      0;
    const h =
      Math.round(rect.height) ||
      parseInt(el.style.height) ||
      parseInt(el.getAttribute("height")) ||
      0;
    const visible = w > 0 && h > 0;
    // data-ad-status="filled" 表示 Google 已填充广告
    const filled = adStatus === "filled" || (visible && adStatus == null);

    let type = "Banner";
    if (fmt === "fluid" || fmt.includes("native") || fmt === "in-article") {
      type = "In-Feed Native";
    } else if (fmt === "auto" || fwr === "true") {
      type = "Responsive";
    } else if (
      fmt === "rectangle" ||
      (w === 300 && h === 250) ||
      (w === 336 && h === 280)
    ) {
      type = "Rectangle";
    } else if (fmt === "horizontal" || h === 90 || h === 60) {
      type = "Leaderboard";
    } else if (fmt === "vertical" || w === 160 || w === 120) {
      type = "Skyscraper";
    } else if (h === 50 || (w === 320 && h === 50)) {
      type = "Mobile Banner";
    } else if (w === 300 && h === 600) {
      type = "Half Page";
    }

    results.adsense.items.push({
      index: i + 1,
      type,
      width: w,
      height: h,
      filled,
      visible,
    });
    results.adsense.count++;
    results.adsense.types[type] = (results.adsense.types[type] || 0) + 1;
  });

  // Rendered AdSense iframes not inside <ins>
  document.querySelectorAll('iframe[id^="aswift_"]').forEach((iframe) => {
    if (!iframe.closest("ins.adsbygoogle")) {
      const w = parseInt(iframe.width) || iframe.offsetWidth || 0;
      const h = parseInt(iframe.height) || iframe.offsetHeight || 0;
      const filled = w > 0 && h > 0;
      const idx = results.adsense.items.length + 1;
      results.adsense.items.push({
        index: idx,
        type: "Banner",
        width: w,
        height: h,
        filled,
        visible: filled,
      });
      results.adsense.count++;
      results.adsense.types["Banner"] =
        (results.adsense.types["Banner"] || 0) + 1;
    }
  });

  // ── ADX / GOOGLE AD MANAGER ───────────────────────────────────────
  document.querySelectorAll('[id^="div-gpt-ad"]').forEach((el, i) => {
    let type = "Banner";
    const id = el.id || "";
    let declaredW = 0,
      declaredH = 0;

    // 从 div ID 提取声明尺寸（如 div-gpt-ad-728x90-0）
    const sizeMatch = id.match(/[_-](\d{2,4})x(\d{2,4})/);
    if (sizeMatch) {
      declaredW = parseInt(sizeMatch[1]);
      declaredH = parseInt(sizeMatch[2]);
      if (declaredW === 1 && declaredH === 1) return;
      if (declaredW >= 640 && declaredH >= 400) type = "Interstitial";
      else if (declaredH === 90 || declaredH === 60 || declaredW >= 728)
        type = "Leaderboard";
      else if (declaredW === 300 && declaredH === 600) type = "Half Page";
      else if (declaredW === 300 || (declaredW >= 250 && declaredH >= 200))
        type = "Rectangle";
      else if (declaredW === 160 || declaredW === 120) type = "Skyscraper";
      else if (declaredH <= 60) type = "Mobile Banner";
    }

    // 从已渲染的 iframe 获取实际尺寸
    const iframe = el.querySelector('iframe[id^="google_ads_iframe"]');
    const iframeW = iframe
      ? parseInt(iframe.width) || iframe.offsetWidth || 0
      : 0;
    const iframeH = iframe
      ? parseInt(iframe.height) || iframe.offsetHeight || 0
      : 0;

    if (!sizeMatch && iframe) {
      if (iframeW >= 728) type = "Leaderboard";
      else if (iframeW === 300) type = "Rectangle";
    }

    const rect = el.getBoundingClientRect();
    const w = iframeW || declaredW || Math.round(rect.width);
    const h = iframeH || declaredH || Math.round(rect.height);
    // iframe 存在且有尺寸 → 广告已填充
    const filled = iframeW > 0 && iframeH > 0;
    const visible = Math.round(rect.width) > 0 && Math.round(rect.height) > 0;

    results.adx.items.push({
      index: i + 1,
      type,
      width: w,
      height: h,
      filled,
      visible,
    });
    results.adx.count++;
    results.adx.types[type] = (results.adx.types[type] || 0) + 1;
  });

  // Rendered GAM iframes outside GPT divs
  document
    .querySelectorAll('iframe[name^="google_ads_iframe_"]')
    .forEach((iframe) => {
      if (!iframe.closest('[id^="div-gpt-ad"]')) {
        const w = parseInt(iframe.width) || iframe.offsetWidth || 0;
        const h = parseInt(iframe.height) || iframe.offsetHeight || 0;
        const filled = w > 0 && h > 0;
        const idx = results.adx.items.length + 1;
        results.adx.items.push({
          index: idx,
          type: "Banner",
          width: w,
          height: h,
          filled,
          visible: filled,
        });
        results.adx.count++;
        results.adx.types["Banner"] = (results.adx.types["Banner"] || 0) + 1;
      }
    });

  // DFP iframes via doubleclick.net
  document
    .querySelectorAll(
      'iframe[src*="doubleclick.net"], iframe[src*="pubads.g.doubleclick.net"], iframe[src*="securepubads"]',
    )
    .forEach((iframe) => {
      if (
        !iframe.closest('[id^="div-gpt-ad"]') &&
        !iframe.name?.startsWith("google_ads_iframe_")
      ) {
        const w = parseInt(iframe.width) || iframe.offsetWidth || 0;
        const h = parseInt(iframe.height) || iframe.offsetHeight || 0;
        const filled = w > 0 && h > 0;
        const idx = results.adx.items.length + 1;
        results.adx.items.push({
          index: idx,
          type: "Banner",
          width: w,
          height: h,
          filled,
          visible: filled,
        });
        results.adx.count++;
        results.adx.types["Banner"] = (results.adx.types["Banner"] || 0) + 1;
      }
    });

  // Fallback: query googletag slots if no DOM elements found yet
  if (results.adx.count === 0) {
    try {
      if (window.googletag && typeof googletag.pubads === "function") {
        const slots = googletag.pubads().getSlots();
        slots.forEach((slot, i) => {
          let type = "Banner";
          let sw = 0,
            sh = 0;
          try {
            const sizes = slot.getSizes(window.innerWidth, window.innerHeight);
            if (Array.isArray(sizes) && sizes.length > 0 && sizes[0].getWidth) {
              sw = sizes[0].getWidth();
              sh = sizes[0].getHeight();
              if (sw >= 728) type = "Leaderboard";
              else if (sw === 300 && sh === 600) type = "Half Page";
              else if (sw === 300) type = "Rectangle";
            }
          } catch (_) {}
          results.adx.items.push({
            index: i + 1,
            type,
            width: sw,
            height: sh,
            filled: false,
            visible: false,
          });
          results.adx.count++;
          results.adx.types[type] = (results.adx.types[type] || 0) + 1;
        });
      }
    } catch (_) {}
  }

  results.total =
    results.taboola.count + results.adsense.count + results.adx.count;
  return results;
}
