/**
 * AdBlocker Lite - Background Service Worker
 *
 * v2.0 增强：
 * - 适配 uBOL 6 个核心规则集
 * - 修复 onRuleMatchedDebug 生产环境不可用问题
 * - 使用 getMatchedRules() API 获取拦截统计
 * - 增加规则集管理功能
 */

const STORAGE_KEYS = {
  BLOCKED_COUNTS: 'blocked_counts',
  ALLOWLIST: 'allowlist',
  DYNAMIC_RULES: 'dynamic_rules',
  STATS: 'stats'
};

// uBOL 默认启用的 6 个核心规则集
const ENABLED_RULESETS = [
  'ublock-filters',
  'easylist',
  'easyprivacy',
  'pgl',
  'ublock-badware',
  'urlhaus-full',
];

// ============================================================
// 初始化
// ============================================================
async function initialize() {
  // 从 storage 恢复状态
  const { stats } = await chrome.storage.local.get(STORAGE_KEYS.STATS);
  if (!stats) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.STATS]: {
        totalBlocked: 0,
        sessionBlocked: 0,
        startTime: Date.now()
      }
    });
  }

  const { allowlist } = await chrome.storage.local.get(STORAGE_KEYS.ALLOWLIST);
  if (!allowlist) {
    await chrome.storage.local.set({ [STORAGE_KEYS.ALLOWLIST]: [] });
  }

  // 获取初始规则集统计
  await refreshRulesetStats();
}

chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

// ============================================================
// 规则集统计（替代 onRuleMatchedDebug）
// ============================================================

/**
 * 刷新规则集统计信息
 * 使用 getEnabledRulesets() 替代废弃的 onRuleMatchedDebug
 */
async function refreshRulesetStats() {
  try {
    const enabledRulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
    const availableRules = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();

    // 缓存到 storage 供 popup 使用
    await chrome.storage.local.set({
      [STORAGE_KEYS.DYNAMIC_RULES]: {
        enabledRulesets,
        availableRules,
        lastUpdated: Date.now()
      }
    });
  } catch (e) {
    // 未打包模式下可能不可用
  }
}

/**
 * 获取最近的拦截统计
 * 使用 getMatchedRules() 替代 onRuleMatchedDebug（生产环境可用）
 */
async function getRecentBlockedCount() {
  try {
    // 获取最近 30 分钟的匹配规则
    const result = await chrome.declarativeNetRequest.getMatchedRules({
      minTimeStamp: Date.now() - 30 * 60 * 1000
    });
    return result?.rulesMatchedInfo?.length || 0;
  } catch (e) {
    // getMatchedRules 需要 declarativeNetRequestFeedback 权限
    return 0;
  }
}

// ============================================================
// 消息处理：PopUp 与 Content Script 通信
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_STATS':
      handleGetStats(sendResponse);
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
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.STATS,
      STORAGE_KEYS.ALLOWLIST
    ]);
    const stats = result[STORAGE_KEYS.STATS] || {
      totalBlocked: 0,
      sessionBlocked: 0,
      startTime: Date.now()
    };
    const allowlist = result[STORAGE_KEYS.ALLOWLIST] || [];

    // 计算运行时间
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);

    sendResponse({
      success: true,
      stats: {
        totalBlocked: stats.totalBlocked,
        sessionBlocked: stats.sessionBlocked,
        uptime,
        allowlistCount: allowlist.length
      }
    });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleGetAllowlist(sendResponse) {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ALLOWLIST);
    sendResponse({
      success: true,
      allowlist: result[STORAGE_KEYS.ALLOWLIST] || []
    });
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

      // 为该域名添加允许规则（高优先级覆盖拦截规则）
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
                           'webbundle', 'other']
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

    // 移除对应的动态规则
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const toRemove = rules
      .filter(r => r.condition.urlFilter === `||${domain}`)
      .map(r => r.id);

    if (toRemove.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: toRemove
      });
    }

    sendResponse({ success: true, allowlist });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleBlockElement(selector, tabId, sendResponse) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'HIDE_ELEMENT',
      selector
    });
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleGetBlockedRequests(sendResponse) {
  try {
    const enabledRulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
    const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();

    // 统计所有规则
    // 注意：getStaticRuleIds API 在 Chrome 中不可用。
    // 使用 getAvailableStaticRuleCount() 获取剩余可用配额，
    // 用 GUARANTEED_MINIMUM_STATIC_RULES - 可用配额 估算已用数量
    let totalRules = dynamicRules.length;
    try {
      const available = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();
      const guaranteed = chrome.declarativeNetRequest.GUARANTEED_MINIMUM_STATIC_RULES || 30000;
      totalRules += (guaranteed - available);
    } catch (e) {
      // 估算失败，至少显示动态规则数
    }

    sendResponse({
      success: true,
      rulesCount: totalRules,
      enabledRulesets: enabledRulesets,
      dynamicRulesCount: dynamicRules.length
    });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// ============================================================
// 定时刷新规则集统计
// ============================================================
chrome.alarms.create('refreshStats', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshStats') {
    refreshRulesetStats();
  }
});

// ============================================================
// 工具栏图标点击事件
// ============================================================
chrome.action.onClicked.addListener(async (tab) => {
  // popup 会自动打开，这里不需要额外逻辑
});
