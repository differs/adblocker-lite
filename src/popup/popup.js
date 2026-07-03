/**
 * AdBlocker Lite - Popup UI Logic
 */

// ============================================================
// DOM 引用
// ============================================================
const elements = {
  totalBlocked: document.getElementById('totalBlocked'),
  sessionBlocked: document.getElementById('sessionBlocked'),
  uptime: document.getElementById('uptime'),
  rulesCount: document.getElementById('rulesCount'),
  status: document.getElementById('status'),
  pageUrl: document.getElementById('pageUrl'),
  blockedItems: document.getElementById('blockedItems'),
  allowlistItems: document.getElementById('allowlistItems'),
  allowlistInput: document.getElementById('allowlistInput'),
  btnWhitelist: document.getElementById('btnWhitelist'),
  btnAddAllowlist: document.getElementById('btnAddAllowlist'),
  tabs: document.querySelectorAll('.tab'),
  tabContents: document.querySelectorAll('.tab-content'),
  // 分层统计
  layerItems: document.getElementById('layerItems'),
  statsTotal: document.getElementById('statsTotal'),
  statsRefresh: document.getElementById('statsRefresh'),
};

// 分层统计的显示配置
const LAYER_CONFIG = {
  dnr:              { label: 'DNR 网络请求拦截', icon: '🔌', color: '#4A90D9' },
  css_base:         { label: '基础 CSS 隐藏',    icon: '🎨', color: '#52C41A' },
  css_generic:      { label: 'uBOL 通用 CSS',    icon: '🎨', color: '#52C41A' },
  css_specific:     { label: 'uBOL 站点 CSS',    icon: '🎨', color: '#52C41A' },
  procedural:       { label: '程序化广告检测',    icon: '🔍', color: '#722ED1' },
  scriptlet:        { label: '反检测 Scriptlet', icon: '🛡️', color: '#FA8C16' },
  tracker_params:   { label: 'URL 追踪参数清理', icon: '🔗', color: '#13C2C2' },
  popup_blocked:    { label: '弹窗拦截',         icon: '🚫', color: '#FF4D4F' },
  miner_blocked:    { label: '挖矿脚本拦截',     icon: '⛏️', color: '#FF4D4F' },
  fetch_faked:      { label: '广告请求假响应',   icon: '📡', color: '#EB2F96' },
  bait_spoofed:     { label: '诱饵元素欺骗',     icon: '🎯', color: '#FA8C16' },
};

// ============================================================
// Tab 切换
// ============================================================
elements.tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    elements.tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const tabName = tab.dataset.tab;
    elements.tabContents.forEach(tc => tc.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
  });
});

// ============================================================
// 加载数据
// ============================================================
async function loadStats() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
  if (response.success) {
    const { stats } = response;
    elements.totalBlocked.textContent = stats.totalBlocked.toLocaleString();
    elements.sessionBlocked.textContent = stats.sessionBlocked.toLocaleString();
    elements.uptime.textContent = formatUptime(stats.uptime);
  }
}

async function loadAllowlist() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_ALLOWLIST' });
  if (response.success) {
    renderAllowlist(response.allowlist);
  }
}

async function loadCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      const url = new URL(tab.url);
      elements.pageUrl.textContent = url.hostname;
      elements.pageUrl.title = tab.url;
    }
  } catch (e) {
    elements.pageUrl.textContent = '无法获取';
  }
}

async function loadBlockedRequests() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_BLOCKED_REQUESTS' });
  if (response.success) {
    elements.rulesCount.textContent = (response.rulesCount || 0).toLocaleString();
  }
}

// ============================================================
// 分层统计
// ============================================================

async function loadLayeredStats() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_LAYERED_STATS' });
  if (!response.success) return;

  const { layered, total } = response;
  elements.statsTotal.textContent = total.toLocaleString();

  // 过滤掉计数为 0 且没有 CSS 规则计数时隐藏空层
  const hasCss = (layered.css_generic || 0) > 0 || (layered.css_specific || 0) > 0;
  const entries = Object.entries(LAYER_CONFIG).filter(([key]) => {
    if (key.startsWith('css_')) return hasCss;
    return (layered[key] || 0) > 0;
  });

  if (entries.length === 0) {
    elements.layerItems.innerHTML = '<div class="empty-state">暂无拦截数据<br><span style="font-size:12px;color:#999">访问一个含广告的页面试试</span></div>';
    return;
  }

  elements.layerItems.innerHTML = entries.map(([key, cfg]) => {
    const count = layered[key] || 0;
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
    return `
      <div class="layer-item">
        <div class="layer-header">
          <span class="layer-icon">${cfg.icon}</span>
          <span class="layer-label">${cfg.label}</span>
          <span class="layer-count">${count.toLocaleString()}</span>
        </div>
        <div class="layer-bar-bg">
          <div class="layer-bar-fill" style="width:${pct}%;background:${cfg.color}"></div>
        </div>
        <div class="layer-pct">${pct}%</div>
      </div>
    `;
  }).join('');
}

// ============================================================
// 渲染白名单
// ============================================================
function renderAllowlist(allowlist) {
  if (allowlist.length === 0) {
    elements.allowlistItems.innerHTML = '<div class="empty-state">暂无白名单</div>';
    return;
  }

  elements.allowlistItems.innerHTML = allowlist.map(domain => `
    <div class="allowlist-item">
      <span class="domain">${domain}</span>
      <button class="remove-btn" data-domain="${domain}">移除</button>
    </div>
  `).join('');

  elements.allowlistItems.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      const response = await chrome.runtime.sendMessage({ type: 'REMOVE_ALLOWLIST', domain });
      if (response.success) loadAllowlist();
    });
  });
}

// ============================================================
// 工具函数
// ============================================================
function formatUptime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// ============================================================
// 事件绑定
// ============================================================

// 添加白名单（当前页面）
elements.btnWhitelist.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    const url = new URL(tab.url);
    const domain = url.hostname;
    const response = await chrome.runtime.sendMessage({ type: 'ADD_ALLOWLIST', domain });
    if (response.success) {
      loadAllowlist();
      document.querySelector('[data-tab="allowlist"]').click();
    }
  }
});

// 添加白名单（输入框）
elements.btnAddAllowlist.addEventListener('click', async () => {
  const domain = elements.allowlistInput.value.trim();
  if (!domain) return;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
    elements.allowlistInput.style.borderColor = '#FF4D4F';
    setTimeout(() => { elements.allowlistInput.style.borderColor = ''; }, 1500);
    return;
  }
  const response = await chrome.runtime.sendMessage({ type: 'ADD_ALLOWLIST', domain });
  if (response.success) {
    elements.allowlistInput.value = '';
    loadAllowlist();
  }
});

elements.allowlistInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') elements.btnAddAllowlist.click();
});

// 刷新分层统计
if (elements.statsRefresh) {
  elements.statsRefresh.addEventListener('click', loadLayeredStats);
}

// ============================================================
// 定时刷新
// ============================================================
setInterval(loadStats, 2000);

// ============================================================
// 初始化
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadAllowlist();
  loadBlockedRequests();
  loadCurrentPage();
  loadLayeredStats();
});
