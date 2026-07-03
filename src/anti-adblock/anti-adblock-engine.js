/**
 * Anti-AdBlock Detection Engine - Isolated World 层
 *
 * 作用：在 content script 的 isolated world 中运行防御逻辑，
 *       与 defense-injector.js（主世界）协同工作。
 *
 * 主世界 vs 隔离世界分工：
 *   - defense-injector.js（主世界）：所有需要修改 window 全局变量、
 *     HTMLElement.prototype、fetch、getComputedStyle 等的防御。
 *   - 本引擎（隔离世界）：操作共享原生 prototype 且不依赖主世界
 *     全局变量的防御（MutationObserver、Performance.prototype）。
 */

class AntiAdblockEngine {
  constructor() {
    this.activeDefenses = new Set();
    this.defenseStats = { blocked: 0, spoofed: 0 };
    this._initialized = false;
  }

  /**
   * 激活所有防御层
   * 注意：baitElement/computedStyle/offsetGeometry/Canvas/
   * WebGL/fetch/IntersectionObserver/TrustedTypes 已在
   * defense-injector.js 中通过主世界注入完成。
   */
  activateAll() {
    if (this._initialized) return;
    this._initialized = true;

    const defenses = [
      'resourceTiming',     // Performance.prototype.getEntriesByType（共享 prototype）
      'mutationObserver',   // MutationObserver.prototype.disconnect（共享 prototype）
    ];

    defenses.forEach(name => {
      const method = `defense_${name}`;
      if (typeof this[method] === 'function') {
        try {
          this[method]();
          this.activeDefenses.add(name);
        } catch (e) {
          // 单层失败不影响其他
        }
      }
    });

    console.debug(`[AntiAdblock] ${this.activeDefenses.size} 层隔离世界防御已激活`);
  }

  // ============================================================
  // 防御 1: Resource Timing 过滤
  //
  // 原理：Performance.prototype.getEntriesByType 是共享的
  //       原生 prototype，从隔离世界覆盖会影响所有世界。
  // 策略：过滤被拦截广告资源的 timing 记录。
  // ============================================================

  defense_resourceTiming() {
    const AD_URL_PATTERNS = [
      'doubleclick.net', 'googleadservices.com', 'googlesyndication.com',
      'google-analytics.com', 'googletagmanager.com',
      'facebook.com/tr', 'connect.facebook.net',
      'amazon-adsystem.com', 'aax.amazon-adsystem.com',
      'taboola.com', 'outbrain.com', 'criteo.com', 'criteo.net',
      'adsrvr.org', 'adnxs.com', 'rubiconproject.com',
      'scorecardresearch.com', 'quantserve.com',
    ];

    const isAdUrl = (url) => AD_URL_PATTERNS.some(p => url.includes(p));

    // getEntriesByType - 共享原型，所有世界受影响
    const origGetEntries = Performance.prototype.getEntriesByType;
    Performance.prototype.getEntriesByType = function (type) {
      const entries = origGetEntries.call(this, type);
      if (type !== 'resource') return entries;

      return entries.filter(entry => {
        if (!entry.name) return false;
        if (entry.duration === 0 && isAdUrl(entry.name)) {
          return false;
        }
        return true;
      });
    };

    // getEntries - 共享原型
    const origGetEntriesAll = Performance.prototype.getEntries;
    Performance.prototype.getEntries = function () {
      const entries = origGetEntriesAll.call(this);
      return entries.filter(entry => {
        if (entry.entryType !== 'resource') return true;
        if (!entry.name) return false;
        if (entry.duration === 0 && isAdUrl(entry.name)) {
          return false;
        }
        return true;
      });
    };
  }

  // ============================================================
  // 防御 2: MutationObserver 反检测
  //
  // 原理：MutationObserver.prototype 是共享的，
  //       覆盖 disconnect 可以保护我们的 observer。
  // ============================================================

  defense_mutationObserver() {
    const origMutationObserver = window.MutationObserver;
    const ourObservers = new WeakSet();

    // 记录我们自己创建的 observer
    const origConstructor = origMutationObserver;
    window.MutationObserver = class extends origConstructor {
      constructor(callback) {
        super(callback);
        ourObservers.add(this);
      }
    };
    // 保持原型链完整
    window.MutationObserver.prototype = origConstructor.prototype;

    // 保护 disconnect：不允许第三方断开我们的 observer
    const origDisconnect = origConstructor.prototype.disconnect;
    origConstructor.prototype.disconnect = function () {
      if (ourObservers.has(this)) return;
      return origDisconnect.call(this);
    };
  }

  // ============================================================
  // 状态查询
  // ============================================================

  getActiveDefenses() {
    return Array.from(this.activeDefenses);
  }

  getStatus() {
    return {
      active: this.activeDefenses.size,
      defenses: Array.from(this.activeDefenses),
    };
  }
}

// 单例 - 随 content script 自动初始化
const antiAdblockEngine = new AntiAdblockEngine();
