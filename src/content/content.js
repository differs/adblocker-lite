/**
 * AdBlocker Lite - Main Content Script
 *
 * 多引擎集成架构（融合 uBlock Origin / AdGuard / Adblock Plus 技术）：
 *
 * v2.0 增强：
 * - 集成 uBOL 的 declarativeNetRequest 规则（18,000+ 条）
 * - 集成 uBOL 生成的 CSS 规则（generic + specific）
 * - 集成 uBOL scriptlet 数据
 * - 保留原有程序化广告检测
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │                    Content Script                        │
 * ├─────────────────────────────────────────────────────────┤
 * │  ① declarativeNetRequest (Chrome C++ 层) → 网络拦截     │
 * │  ② uBOL CSS Rules       → 20,000+ CSS 隐藏规则         │
 * │  ③ Cosmetic Engine      → 程序化广告检测 (尺寸/位置)    │
 * │  ④ Scriptlet Engine     → 反广告检测 JS 注入            │
 * │  ⑤ Anti-Adblock Engine  → 10 层反广告检测防御           │
 * │  ⑥ Tracker Stripper     → URL 追踪参数清理              │
 * │  ⑦ Element Picker       → 用户点击选择隐藏              │
 * │  ⑧ MutationObserver     → 动态广告监控                  │
 * └─────────────────────────────────────────────────────────┘
 */

// ============================================================
// 主引擎（简化版 - CSS 隐藏已由 uBOL CSS 引擎处理）
// ============================================================
class AdBlockerContent {
  constructor() {
    this.adElementsCount = 0;
    this.observer = null;
    this.cssHiddenCount = 0;

    // 加载顺序：
    // 1. Scriptlet 引擎已自动执行（document_start）
    // 2. Cosmetic 引擎已自动加载 uBOL CSS + 程序化检测
    // 3. MutationObserver 捕获动态广告
    this.observeDynamicAds();

    console.debug('[AdBlocker] 引擎 v2 已启动');
  }

  // ============================================================
  // MutationObserver - 动态广告监控（补充 uBOL CSS 覆盖不到的部分）
  // ============================================================
  observeDynamicAds() {
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // 检查新元素是否包含常见广告特征
              if (this.isAdElement(node)) {
                this.hideElement(node);
              }

              // 也检查后代
              const ads = node.querySelectorAll(
                'div[class*="ad-"], div[id*="ad-"], ' +
                'iframe[src*="doubleclick"], iframe[src*="googleads"], ' +
                '.adsbygoogle, [data-ad-client]'
              );
              for (const el of ads) {
                this.hideElement(el);
              }
            }
          }
        }

        if (mutation.type === 'attributes') {
          // 处理动态 class/id 重命名
          const el = mutation.target;
          if (this.isAdElement(el)) {
            this.hideElement(el);
          }
        }
      }
    });

    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'id', 'style']
    });
  }

  isAdElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html') return false;
    if (el.dataset.__abp_hidden) return false;

    const classStr = el.className?.toLowerCase() || '';
    const idStr = el.id?.toLowerCase() || '';

    // 只看那些可能含有广告的特定标签
    if (tag !== 'div' && tag !== 'iframe' && tag !== 'ins' && tag !== 'section') {
      return false;
    }

    return (
      classStr.includes('ad-') || idStr.includes('ad-') ||
      classStr.includes('ads-') || idStr.includes('ads-') ||
      classStr.includes('sponsor') || idStr.includes('sponsor') ||
      classStr.includes('advert') || idStr.includes('advert')
    );
  }

  hideElement(el) {
    if (el.dataset.__abp_hidden) return;
    el.style.setProperty('display', 'none', 'important');
    el.dataset.__abp_hidden = 'true';
    this.cssHiddenCount++;
    if (typeof statsCollector !== 'undefined') {
      statsCollector.increment('css_base');
    }
  }

  hideBySelector(selector) {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => this.hideElement(el));
      this.adElementsCount += elements.length;
      return elements.length;
    } catch (e) {
      return 0;
    }
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}

// ============================================================
// 初始化
// ============================================================
let adblocker = null;

function initialize() {
  // defense-injector.js 已自动注入主世界防御（在 document_start 时）
  // anti-adblock-engine.js 的 activateAll 在这里手动激活

  try {
    antiAdblockEngine.activateAll();
  } catch (e) {
    console.debug('[AdBlocker] AntiAdblock 引擎激活失败:', e.message);
  }

  // 启动主引擎
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      adblocker = new AdBlockerContent();
    });
  } else {
    adblocker = new AdBlockerContent();
  }
}

// ============================================================
// 主世界统计消息监听
// defense-injector.js 中的防御触发时通过 postMessage 回传
// ============================================================
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== '__ABP_STATS') return;
  if (typeof statsCollector !== 'undefined') {
    statsCollector.increment(event.data.category, event.data.count || 1);
  }
});

// 等 cosmetic-engine.js 和 scriptlet-engine.js 先完成初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initialize());
} else {
  setTimeout(initialize, 50);
}

// ============================================================
// 消息通信
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'HIDE_ELEMENT':
      if (adblocker && message.selector) {
        const count = adblocker.hideBySelector(message.selector);
        sendResponse({ success: true, hiddenCount: count });
      }
      return true;

    case 'GET_AD_COUNT':
      sendResponse({
        success: true,
        hiddenCount: adblocker?.adElementsCount || 0
      });
      return true;

    case 'ACTIVATE_PICKER':
      sendResponse({ success: true });
      return true;

    default:
      sendResponse({ success: false });
  }
});

window.addEventListener('beforeunload', () => {
  if (adblocker) {
    adblocker.destroy();
    adblocker = null;
  }
});
