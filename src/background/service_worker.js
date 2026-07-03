/**
 * AdBlocker Lite - Background Service Worker
 *
 * v2.0 增强：
 * - 适配 uBOL 6 个核心规则集
 * - 分层拦截统计（DNR / CSS / procedural / scriptlet / tracker）
 * - 使用 getMatchedRules() API 获取拦截统计
 */

const STORAGE_KEYS = {
  ALLOWLIST: 'allowlist',
  DYNAMIC_RULES: 'dynamic_rules',
  STATS: 'stats',
  LAYERED_STATS: 'layered_stats',
};

// 分层统计默认值
const DEFAULT_LAYERED_STATS = {
  dnr: 0,
  css_base: 0,
  css_generic: 0,
  css_specific: 0,
  procedural: 0,
  scriptlet: 0,
  tracker_params: 0,
  popup_blocked: 0,
  miner_blocked: 0,
  fetch_faked: 0,
  bait_spoofed: 0,
};

// ============================================================
// 初始化
// ============================================================
async function initialize() {
  // 总拦截统计
  const { stats } = await chrome.storage.local.get(STORAGE_KEYS.STATS);
  if (!stats) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.STATS]: { totalBlocked: 0, sessionBlocked: 0, startTime: Date.now() }
    });
  }

  // 白名单
  const { allowlist } = await chrome.storage.local.get(STORAGE_KEYS.ALLOWLIST);
  if (!allowlist) {
    await chrome.storage.local.set({ [STORAGE_KEYS.ALLOWLIST]: [] });
  }

  // 分层统计
  const { layered_stats } = await chrome.storage.local.get(STORAGE_KEYS.LAYERED_STATS);
  if (!layered_stats) {
    await chrome.storage.local.set({ [STORAGE_KEYS.LAYERED_STATS]: { ...DEFAULT_LAYERED_STATS } });
  }

  await refreshRulesetStats();

  // 创建定时器（必须在初始化内部，不要在模块顶层）
  try { chrome.alarms.create('refreshStats', { periodInMinutes: 5 }); } catch (_) {}
}

chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

// ============================================================
// 规则集统计
// ============================================================

async function refreshRulesetStats() {
  try {
    const enabledRulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
    const availableRules = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();

    await chrome.storage.local.set({
      [STORAGE_KEYS.DYNAMIC_RULES]: {
        enabledRulesets,
        availableRules,
        lastUpdated: Date.now(),
      }
    });
  } catch (_) {}
}

// ============================================================
// 分层拦截统计
// ============================================================

/** 累加一层统计 */
async function addLayerStats(category, count) {
  const { layered_stats } = await chrome.storage.local.get(STORAGE_KEYS.LAYERED_STATS);
  const stats = layered_stats || { ...DEFAULT_LAYERED_STATS };
  if (category in stats) {
    stats[category] = (stats[category] || 0) + count;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.LAYERED_STATS]: stats });
}

/** 获取 DNR 最近匹配规则数 */
async function fetchDNRBlockedCount() {
  try {
    const result = await chrome.declarativeNetRequest.getMatchedRules({
      minTimeStamp: Date.now() - 60 * 60 * 1000,
    });
    return result?.rulesMatchedInfo?.length || 0;
  } catch (_) {
    return 0;
  }
}

// ============================================================
// 消息处理
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_STATS':
      handleGetStats(sendResponse);
      return true;

    case 'GET_LAYERED_STATS':
      handleGetLayeredStats(sendResponse);
      return true;

    case 'REPORT_STATS':
      handleReportStats(message.stats, sendResponse);
      return true;

    case 'GET_ALLOWLIST':
      handleGetAllowlist(sendResponse);
      return true;

    case 'ADD_ALLOWLIST':
      handleAddAllowlist(message.domain, sendResponse);
      return true;

    case 'REMOVE_ALLOWLIST':
      handleRemoveAllowlist(message.domain, sendResponse);
      return true;

    case 'BLOCK_ELEMENT':
      handleBlockElement(message.selector, message.tabId, sendResponse);
      return true;

    case 'GET_BLOCKED_REQUESTS':
      handleGetBlockedRequests(sendResponse);
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
});

// ============================================================
// Handler 实现
// ============================================================

async function handleGetStats(sendResponse) {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEYS.STATS, STORAGE_KEYS.ALLOWLIST]);
    const stats = result[STORAGE_KEYS.STATS] || { totalBlocked: 0, sessionBlocked: 0, startTime: Date.now() };
    const allowlist = result[STORAGE_KEYS.ALLOWLIST] || [];
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);

    sendResponse({
      success: true,
      stats: {
        totalBlocked: stats.totalBlocked,
        sessionBlocked: stats.sessionBlocked,
        uptime,
        allowlistCount: allowlist.length,
      }
    });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleGetLayeredStats(sendResponse) {
  try {
    const { layered_stats } = await chrome.storage.local.get(STORAGE_KEYS.LAYERED_STATS);
    const layerStats = layered_stats || { ...DEFAULT_LAYERED_STATS };

    // 实时获取 DNR 拦截数
    const dnrCount = await fetchDNRBlockedCount();
    layerStats.dnr = dnrCount;

    // 计算总和
    const total = Object.values(layerStats).reduce((a, b) => a + b, 0);

    sendResponse({ success: true, layered: layerStats, total });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleReportStats(stats, sendResponse) {
  try {
    if (!stats) { sendResponse({ success: false }); return; }

    for (const [category, count] of Object.entries(stats)) {
      if (count > 0) {
        await addLayerStats(category, count);
      }
    }

    // 更新总拦截数
    const { stats: oldStats } = await chrome.storage.local.get(STORAGE_KEYS.STATS);
    const s = oldStats || { totalBlocked: 0, sessionBlocked: 0, startTime: Date.now() };
    const increment = Object.values(stats).reduce((a, b) => a + b, 0);
    s.totalBlocked += increment;
    s.sessionBlocked += increment;
    await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: s });

    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleGetAllowlist(sendResponse) {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ALLOWLIST);
    sendResponse({ success: true, allowlist: result[STORAGE_KEYS.ALLOWLIST] || [] });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleAddAllowlist(domain, sendResponse) {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ALLOWLIST);
    const allowlist = result[STORAGE_KEYS.ALLOWLIST] || [];

    if (!allowlist.includes(domain)) {
      allowlist.push(domain);
      await chrome.storage.local.set({ [STORAGE_KEYS.ALLOWLIST]: allowlist });

      const ruleId = 90000 + allowlist.length;
      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [{
          id: ruleId,
          priority: 100,
          action: { type: 'allow' },
          condition: {
            urlFilter: `||${domain}`,
            resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script',
                           'image', 'font', 'object', 'xmlhttprequest', 'ping',
                           'csp_report', 'media', 'websocket', 'webtransport',
                           'webbundle', 'other'],
          }
        }]
      });
    }

    sendResponse({ success: true, allowlist });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleRemoveAllowlist(domain, sendResponse) {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ALLOWLIST);
    let allowlist = result[STORAGE_KEYS.ALLOWLIST] || [];
    allowlist = allowlist.filter(d => d !== domain);
    await chrome.storage.local.set({ [STORAGE_KEYS.ALLOWLIST]: allowlist });

    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const toRemove = rules.filter(r => r.condition.urlFilter === `||${domain}`).map(r => r.id);
    if (toRemove.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove });
    }

    sendResponse({ success: true, allowlist });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleBlockElement(selector, tabId, sendResponse) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'HIDE_ELEMENT', selector });
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleGetBlockedRequests(sendResponse) {
  try {
    const enabledRulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
    const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();

    // 从 ruleset-details.json 读取精确的规则数量（构建时自动生成）
    // 避免使用 getAvailableStaticRuleCount() 的错误公式
    let staticRuleCount = 0;
    try {
      const url = chrome.runtime.getURL('rulesets/ruleset-details.json');
      const resp = await fetch(url);
      const details = await resp.json();
      for (const rs of details) {
        if (rs.enabled && rs.rules?.total) {
          staticRuleCount += rs.rules.total;
        }
      }
    } catch (_) {
      // fallback: 使用 DNR API 估算（可能不准确，但不至于负数）
      try {
        const available = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();
        const guaranteed = chrome.declarativeNetRequest.GUARANTEED_MINIMUM_STATIC_RULES || 30000;
        if (available <= guaranteed) {
          staticRuleCount = guaranteed - available;
        }
      } catch (_) {}
    }

    const totalRules = staticRuleCount + dynamicRules.length;

    sendResponse({
      success: true,
      rulesCount: totalRules,
      enabledRulesets,
      dynamicRulesCount: dynamicRules.length,
    });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// ============================================================
// 定时刷新
// ============================================================
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshStats') refreshRulesetStats();
});

chrome.action.onClicked.addListener(async (tab) => {});
