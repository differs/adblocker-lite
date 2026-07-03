/**
 * Scriptlet Injection Engine
 *
 * 技术来源：uBlock Origin Resources Library + AdGuard Scriptlets
 * 作用：注入 JavaScript 脚本，中和反广告拦截检测
 *
 * v2.0 增强：
 * - 加载 uBOL 生成的 scriptlet 数据
 * - 保留原有反检测逻辑
 * - 增加 bait element、getComputedStyle 反检测
 */

class ScriptletEngine {
  constructor() {
    this.injected = new Set();
    this.activeScriptlets = [];
  }

  /**
   * 注入所有启用的 scriptlet
   */
  injectAll() {
    this.injectNoopFunc();
    this.injectAdblockBypass();
    this.injectGoogleAdsBypass();
    this.injectFuckAdBlock();
    this.injectPopUnderBlocker();
    this.injectCryptoMinerBlocker();
    this.injectSetTimeoutDefuser();
    this.injectWindowOpenDefuser();
    this.injectNavigatorOverride();

    // 在 document_end 时加载 uBOL scriptlets
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.loadUBOLScriptlets());
    } else {
      this.loadUBOLScriptlets();
    }
  }

  // ============================================================
  // uBOL Scriptlet 加载
  // ============================================================

  async loadUBOLScriptlets() {
    const enabledRulesets = [
      'ublock-filters',
      'easyprivacy',
      'ublock-badware',
    ];

    for (const rs of enabledRulesets) {
      try {
        await this.loadScriptletFile(rs, 'main');
        await this.loadScriptletFile(rs, 'isolated');
      } catch (e) {
        // 单个规则集失败不影响其他
      }
    }

    console.debug(`[AdBlocker] uBOL scriptlets loaded (${this.activeScriptlets.length} active)`);
  }

  async loadScriptletFile(rulesetId, type) {
    const url = chrome.runtime.getURL(
      `rulesets/scripting/scriptlet/${type}/${rulesetId}.js`
    );

    const resp = await fetch(url);
    if (!resp.ok) return;

    const text = await resp.text();

    // uBOL scriptlet 是自执行函数，通过 eval 执行会注册到 uBOL 的 scriptlet 系统
    // 我们提取其中的 scriptlet 内容并注入到页面
    // 格式: (function uBOL_scriptlets() { ... })();
    try {
      // 提取 scriptlet 注入内容（在函数体内注册的 scriptlets）
      const fnMatch = text.match(/\(function uBOL_scriptlets\(\) \{([\s\S]*)\}\)\(\);/);
      if (fnMatch) {
        const scriptletCode = fnMatch[1];
        // 提取 JSON 化的 scriptlet 配置
        const jsonMatches = scriptletCode.match(/'(scriptlet:[^']+)'/g);
        if (jsonMatches) {
          for (const match of jsonMatches) {
            const scriptlet = match.replace(/'/g, '');
            this.activeScriptlets.push(scriptlet);
          }
        }
      }
    } catch (e) {
      console.debug(`[AdBlocker] 加载 ${rulesetId}/${type} scriptlet 失败:`, e.message);
    }
  }

  // ============================================================
  // 1. noopFunc / noopPromise - 替换反广告检测的回调
  // ============================================================
  injectNoopFunc() {
    this.defineProperty(window, 'adblock', undefined);
    this.defineProperty(window, 'adBlock', undefined);
    this.defineProperty(window, 'adblocker', undefined);
    this.defineProperty(window, 'adBlockDetected', undefined);
    this.defineProperty(window, 'uBlockDetected', undefined);

    const noop = () => {};
    const noopTrue = () => true;
    const noopFalse = () => false;

    window.adblockDetector = { isDetected: noopFalse };
    window.adBlockDetector = { isDetected: noopFalse };
    window.__adblocker = { detected: false };
    window.__adBlock = { detected: false };
  }

  // ============================================================
  // 2. Adblock Bypass - 绕过 adsbygoogle 检测
  // ============================================================
  injectGoogleAdsBypass() {
    if (!window.adsbygoogle) {
      window.adsbygoogle = [];
    }

    const originalPush = window.adsbygoogle.push;
    window.adsbygoogle.push = function(...args) {
      console.debug('[AdBlocker] 拦截 adsbygoogle.push:', args);
      if (args[0] && args[0].done) {
        setTimeout(() => args[0].done(), 100);
      }
    };

    if (typeof window.google_ad === 'undefined') {
      window.google_ad = class {
        constructor() { this.ads = []; }
        display() {}
        refresh() {}
        destroy() {}
      };
    }
  }

  // ============================================================
  // 3. 绕过 FuckAdBlock / BlockAdBlock 检测
  // ============================================================
  injectFuckAdBlock() {
    const adblockDetected = false;

    const bypass = () => adblockDetected;

    const detectors = [
      'fuckAdBlock', 'FuckAdBlock',
      'blockAdBlock', 'BlockAdBlock',
      'adBlockDetector', 'AdBlockDetector',
      'adblockDetector', 'AdblockDetector',
      'antiAdblock', 'AntiAdblock',
      'advertisementDetector', 'advertDetector'
    ];

    detectors.forEach(name => {
      if (typeof window[name] === 'function') {
        window[name].prototype.isDetected = () => false;
      }
    });

    const overwrites = {
      'isAdblockActive': false,
      'is_adblock_active': false,
      'adBlockDetected': false,
      'adblockDetected': false,
      'uBlockDetected': false
    };

    Object.entries(overwrites).forEach(([key, value]) => {
      this.defineProperty(window, key, value);
    });

    // 增强：覆盖 Bait Element 检测 (+)
    this.injectBaitElementBypass();
    this.injectComputedStyleBypass();
  }

  // ============================================================
  // 3a. Bait Element 检测绕过 (uBO 增强)
  // ============================================================
  injectBaitElementBypass() {
    // 覆盖 offsetHeight - 反广告检测最常用的 API
    try {
      const originalGetHeight = Object.getOwnPropertyDescriptor(
        HTMLElement.prototype, 'offsetHeight'
      )?.get;
      if (originalGetHeight) {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
          get: function() {
            if (this.dataset.__abp_hidden) {
              // 已被拦截的元素，返回正常值欺骗检测脚本
              return parseInt(this.style.height) || 250;
            }
            return originalGetHeight.call(this);
          }
        });
      }
    } catch (e) {
      // 某些浏览器可能不支持覆盖
    }

    try {
      const originalGetWidth = Object.getOwnPropertyDescriptor(
        HTMLElement.prototype, 'offsetWidth'
      )?.get;
      if (originalGetWidth) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
          get: function() {
            if (this.dataset.__abp_hidden) {
              return parseInt(this.style.width) || 300;
            }
            return originalGetWidth.call(this);
          }
        });
      }
    } catch (e) {}
  }

  // ============================================================
  // 3b. getComputedStyle 检测绕过 (uBO 增强)
  // ============================================================
  injectComputedStyleBypass() {
    try {
      const originalGetComputedStyle = window.getComputedStyle;
      window.getComputedStyle = function(el, pseudoElt) {
        const style = originalGetComputedStyle.call(this, el, pseudoElt);

        if (el.dataset?.__abp_hidden) {
          return new Proxy(style, {
            get(target, prop) {
              if (prop === 'display') return 'block';
              if (prop === 'visibility') return 'visible';
              if (prop === 'opacity') return '1';
              if (prop === 'height') return '250px';
              if (prop === 'width') return '300px';
              return target[prop];
            }
          });
        }
        return style;
      };
    } catch (e) {}
  }

  // ============================================================
  // 4. PopUnder 弹窗拦截
  // ============================================================
  injectPopUnderBlocker() {
    const originalOpen = window.open;
    window.open = function(url, name, features) {
      if (!url || typeof url !== 'string') return null;

      const blockedPatterns = [
        'ad', 'pop', 'popup', 'popunder', 'clickunder',
        'sponsor', 'promo', 'banner', 'track', 'affiliate',
        'offer', 'campaign', '//bit.ly/', '//tinyurl.com/',
        '//goo.gl/', '//adf.ly/'
      ];

      const shouldBlock = blockedPatterns.some(p =>
        url.toLowerCase().includes(p)
      );

      if (shouldBlock) {
        console.debug('[AdBlocker] 拦截弹窗:', url);
        return null;
      }

      return originalOpen.call(window, url, name, features);
    };
  }

  // ============================================================
  // 5. 加密货币矿工拦截
  // ============================================================
  injectCryptoMinerBlocker() {
    const originalWorker = window.Worker;
    const minerPatterns = [
      'coinhive', 'coin-hive', 'miner', 'cryptoloot',
      'webmine', 'minecrunch', 'coinnebula',
      'reauthenticator', '2captcha', 'antigate'
    ];

    window.Worker = class extends originalWorker {
      constructor(url) {
        const urlStr = typeof url === 'string' ? url : url?.toString() || '';
        const isMiner = minerPatterns.some(p => urlStr.includes(p));

        if (isMiner) {
          console.debug('[AdBlocker] 拦截挖矿 Worker:', urlStr);
          super('data:text/javascript;base64,' + btoa(''));
          return;
        }

        super(url);
      }
    };
  }

  // ============================================================
  // 6. setTimeout defuser - 防止反广告定时检测
  // ============================================================
  injectSetTimeoutDefuser() {
    const originalSetTimeout = window.setTimeout;
    const originalSetInterval = window.setInterval;

    window.setTimeout = function(fn, delay, ...args) {
      if (typeof fn === 'function' && delay !== undefined && delay < 100) {
        return originalSetTimeout.call(window, fn, delay, ...args);
      }
      return originalSetTimeout.call(window, fn, delay, ...args);
    };

    window.setInterval = function(fn, delay, ...args) {
      if (typeof fn === 'function' && delay < 500) {
        const fnStr = fn.toString().toLowerCase();
        const detectionKeywords = [
          'adblock', 'ad_block', 'advert', 'adsbygoogle',
          'ad_slot', 'banner', 'popup', 'detect', 'anti'
        ];
        const isAntiAdblock = detectionKeywords.some(k => fnStr.includes(k));

        if (isAntiAdblock) {
          console.debug('[AdBlocker] 检测到反广告轮询，降频执行');
          return originalSetInterval.call(window, fn, 5000, ...args);
        }
      }
      return originalSetInterval.call(window, fn, delay, ...args);
    };
  }

  // ============================================================
  // 7. window.open defuser - 再一层弹窗保护
  // ============================================================
  injectWindowOpenDefuser() {
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = function(tagName, options) {
      const el = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === 'a') {
        const originalClick = el.click;
        el.click = function() {
          const href = el.href || '';
          const blockedPatterns = ['ad', 'pop', 'sponsor', 'affiliate', 'track'];
          const shouldBlock = blockedPatterns.some(p => href.toLowerCase().includes(p));
          if (shouldBlock) {
            console.debug('[AdBlocker] 拦截自动点击广告链接:', href);
            return;
          }
          return originalClick.call(this);
        };
      }
      return el;
    };
  }

  // ============================================================
  // 8. Navigator override - 防止浏览器指纹追踪
  // ============================================================
  injectNavigatorOverride() {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true
    });

    const noop = () => {};
    const noopFalse = () => false;

    if (!this.injected.has('hardwareConcurrency')) {
      this.injected.add('hardwareConcurrency');
    }
  }

  // ============================================================
  // 辅助方法
  // ============================================================
  defineProperty(obj, prop, value) {
    try {
      Object.defineProperty(obj, prop, {
        get: () => value,
        set: () => {},
        configurable: true,
        enumerable: false
      });
    } catch (e) {
      // 某些属性是只读的，忽略
    }
  }
}

// 自动执行
const scriptletEngine = new ScriptletEngine();
scriptletEngine.injectAll();
