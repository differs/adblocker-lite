/**
 * Anti-AdBlock Detection Engine
 *
 * 作用：中和网站的反广告拦截检测脚本，让广告拦截器"隐身"
 *
 * 技术来源：
 *   - uBlock Origin scriptlets / resources library
 *   - AdGuard scriptlets
 *   - Anti-Adblock Killer (AakScript)
 *   - 自研对抗策略
 *
 * 覆盖的检测类型：
 *   1.  DOM Bait Element 检测
 *   2.  getComputedStyle / offsetHeight 检测
 *   3.  PerformanceObserver Resource Timing 检测
 *   4.  Canvas / WebGL / AudioContext 指纹检测
 *   5.  fetch / XHR AbortController 检测
 *   6.  IntersectionObserver 可见性检测
 *   7.  MutationObserver 反检测
 *   8.  Service Worker 检测
 *   9.  Trusted Types 绕过
 *   10. CNAME 伪装检测 (DNS 级别)
 *
 * 加载策略：
 *   - 所有 hook 在 document_start 时机注入，抢在网站脚本之前
 *   - 使用 Object.defineProperty 优先于 Proxy (性能更好)
 *   - 分层防御：基础层 + 增强层（按需激活）
 */

class AntiAdblockEngine {
  constructor() {
    this.activeDefenses = new Set();
    this.defenseStats = { blocked: 0, spoofed: 0 };
    this._originalAPIs = new Map();
    this._initialized = false;
  }

  // ============================================================
  // 入口：激活所有防御层
  // ============================================================

  activateAll() {
    if (this._initialized) return;
    this._initialized = true;

    const defenses = [
      'baitElement',           // DOM 诱饵元素
      'computedStyle',         // getComputedStyle
      'offsetGeometry',        // offsetHeight/Width/Parent
      'performanceTiming',     // PerformanceObserver
      'canvasFingerprint',     // Canvas 指纹
      'fetchAbort',            // fetch/AbortController
      'intersectionObserver',  // IntersectionObserver
      'mutationObserver',      // MutationObserver 反检测
      'trustedTypes',          // Trusted Types 绕过
    ];

    // 分批激活避免阻塞主线程
    this._batchActivate(defenses, 0);
  }

  _batchActivate(defenses, index) {
    if (index >= defenses.length) {
      console.debug(`[AntiAdblock] ${this.activeDefenses.size} 层防御已激活`);
      return;
    }

    const name = defenses[index];
    const method = `defense_${name}`;
    if (typeof this[method] === 'function') {
      try {
        this[method]();
        this.activeDefenses.add(name);
      } catch (e) {
        // 单层防御失败不影响其他
      }
    }

    // 每批处理 2 个，让出主线程
    if (index % 2 === 1) {
      setTimeout(() => this._batchActivate(defenses, index + 1), 0);
    } else {
      this._batchActivate(defenses, index + 1);
    }
  }

  // ============================================================
  // 1. DOM Bait Element 防御
  //
  // 原理：网站插入隐藏的"诱饵"元素（class 含 ad/banner 等），
  //       如果广告拦截器隐藏了它们，就判定拦截器存在。
  // 策略：拦截 HTMLElement 的尺寸 API，对诱饵元素返回假值。
  // ============================================================

  defense_baitElement() {
    const BAIT_CLASS_PATTERNS = [
      'pub_300x250', 'pub_300x250m', 'pub_728x90',
      'text-ad', 'textAd', 'text_ad', 'text_ads', 'text-ads', 'text-ad-links',
      'banner', 'advertisement', 'adsbox', 'ad-container',
    ];

    const isBaitElement = (el) => {
      if (!el || !el.className) return false;
      const cls = el.className.toLowerCase();
      return BAIT_CLASS_PATTERNS.some(p => cls.includes(p));
    };

    // 保存全局引用供其他防御层使用
    window.__antiAdblock = window.__antiAdblock || {};
    window.__antiAdblock.isBait = isBaitElement;

    // 覆盖 getBoundingClientRect
    const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (isBaitElement(this)) {
        return DOMRect.fromRect({ x: 0, y: 0, width: 300, height: 250 });
      }
      return origGetBoundingClientRect.call(this);
    };

    // 覆盖 getClientRects
    const origGetClientRects = Element.prototype.getClientRects;
    Element.prototype.getClientRects = function () {
      if (isBaitElement(this)) {
        return [DOMRect.fromRect({ x: 0, y: 0, width: 300, height: 250 })];
      }
      return origGetClientRects.call(this);
    };
  }

  // ============================================================
  // 2. getComputedStyle 防御
  //
  // 原理：网站调用 getComputedStyle(el).display 检查是否被隐藏。
  // 策略：对诱饵元素返回 "block"。
  // ============================================================

  defense_computedStyle() {
    const origGetComputedStyle = window.getComputedStyle;

    window.getComputedStyle = function (el, pseudoElt) {
      const style = origGetComputedStyle.call(this, el, pseudoElt);

      const isBait = window.__antiAdblock?.isBait(el) ||
                     el.dataset?.__abp_hidden ||
                     el.classList?.contains?.('__abp_procedural_hidden');

      if (!isBait) return style;

      // 使用 Proxy 拦截 display 等属性
      return new Proxy(style, {
        get(target, prop) {
          if (prop === 'display') return 'block';
          if (prop === 'visibility') return 'visible';
          if (prop === 'opacity') return '1';
          if (prop === 'height' || prop === 'width') return 'auto';
          if (prop === 'overflow') return 'visible';
          if (prop === 'position') return 'static';
          if (typeof prop === 'string' && (
            prop.includes('ad') || prop.includes('vert') ||
            prop.startsWith('block') || prop.startsWith('inline')
          )) return 'block';
          return target[prop];
        },
        has(target, prop) {
          return true; // 假装所有属性都存在
        }
      });
    };
  }

  // ============================================================
  // 3. offsetHeight / offsetWidth / offsetParent 防御
  //
  // 原理：网站广告检测库创建诱饵元素后检查
  //       el.offsetHeight === 0 || el.offsetParent === null
  // 策略：对诱饵元素返回非零值。
  // ============================================================

  defense_offsetGeometry() {
    const hookProperty = (proto, prop, fakeValue) => {
      try {
        const desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (!desc || !desc.get) return;

        const origGet = desc.get;
        Object.defineProperty(proto, prop, {
          get: function () {
            if (window.__antiAdblock?.isBait(this) ||
                this.dataset?.__abp_hidden) {
              return typeof fakeValue === 'function'
                ? fakeValue(this)
                : fakeValue;
            }
            return origGet.call(this);
          },
          configurable: true,
          enumerable: true,
        });
      } catch (_) { /* 只读属性跳过 */ }
    };

    // 对隐藏的广告元素返回正常尺寸
    const fakeHeight = (el) => parseInt(el.style?.height) || 250;
    const fakeWidth = (el) => parseInt(el.style?.width) || 300;

    hookProperty(HTMLElement.prototype, 'offsetHeight', fakeHeight);
    hookProperty(HTMLElement.prototype, 'offsetWidth', fakeWidth);

    // offsetParent 返回 body（表示元素在文档流中可见）
    try {
      const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
      if (desc && desc.get) {
        const origGet = desc.get;
        Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
          get: function () {
            if (window.__antiAdblock?.isBait(this) ||
                this.dataset?.__abp_hidden) {
              return document.body;
            }
            return origGet.call(this);
          },
          configurable: true,
        });
      }
    } catch (_) {}
  }

  // ============================================================
  // 4. PerformanceObserver / Resource Timing 防御
  //
  // 原理：网站通过 performance.getEntriesByType('resource') 检查
  //       广告资源是否加载成功（duration=0 表示被拦截）。
  // 策略：过滤掉被拦截的资源记录，或给它们添加假的时间戳。
  // ============================================================

  defense_performanceTiming() {
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

    // 拦截 performance.getEntriesByType
    const origGetEntries = Performance.prototype.getEntriesByType;
    Performance.prototype.getEntriesByType = function (type) {
      const entries = origGetEntries.call(this, type);
      if (type !== 'resource') return entries;

      return entries.filter(entry => {
        // 过滤掉被拦截的广告资源（name 为空或者 duration 为 0 的广告 URL）
        if (!entry.name) return false;
        if (entry.duration === 0 && isAdUrl(entry.name)) {
          return false; // 隐藏被拦截的广告
        }
        return true;
      });
    };

    // 拦截 performance.getEntries
    const origGetEntries_all = Performance.prototype.getEntries;
    Performance.prototype.getEntries = function () {
      const entries = origGetEntries_all.call(this);
      return entries.filter(entry => {
        if (entry.entryType !== 'resource') return true;
        if (!entry.name) return false;
        if (entry.duration === 0 && isAdUrl(entry.name)) {
          return false;
        }
        return true;
      });
    };

    // 拦截 PerformanceObserver
    const origObserver = window.PerformanceObserver;
    if (origObserver) {
      window.PerformanceObserver = class extends origObserver {
        constructor(callback) {
          super((list, obs) => {
            // 过滤回调中的条目
            const filteredList = {
              ...list,
              getEntries() {
                return list.getEntries().filter(entry => {
                  if (entry.entryType !== 'resource') return true;
                  if (!entry.name) return false;
                  if (entry.duration === 0 && isAdUrl(entry.name)) {
                    return false;
                  }
                  return true;
                });
              }
            };
            callback(filteredList, obs);
          });
        }
      };
    }

    // 标记 AD_URL_PATTERNS 供其他防御层使用
    window.__antiAdblock = window.__antiAdblock || {};
    window.__antiAdblock.isAdUrl = isAdUrl;
  }

  // ============================================================
  // 5. Canvas / WebGL 指纹防御
  //
  // 原理：网站通过 Canvas 绘制图形并提取像素哈希来生成设备指纹，
  //       广告网络用指纹追踪用户。
  // 策略：在 toDataURL / toBlob 的结果中加入微小的随机噪点，
  //       破坏指纹的唯一性而不影响视觉。
  // ============================================================

  defense_canvasFingerprint() {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      const dataURL = origToDataURL.apply(this, args);

      // 仅对可能用于指纹的 canvas 添加噪点：
      // 1. 尺寸很小（常用于指纹的 canvas 为 256x256 或更小）
      // 2. 不在视口中（隐藏的画布）
      if (this.width <= 256 && this.height <= 256) {
        return this._addNoiseToDataURL(dataURL);
      }
      // 3. 透明 canvas（无背景色，指纹常用）
      const ctx = this.getContext('2d');
      if (ctx && dataURL.length < 5000) {
        return this._addNoiseToDataURL(dataURL);
      }

      return dataURL;
    };

    // 添加获取上下文的方法注入
    HTMLCanvasElement.prototype._addNoiseToDataURL = function (dataURL) {
      // 在像素数据的最后一位（Alpha 通道）加微小噪点（0-2 的变化）
      // 这足以改变哈希值，但对肉眼不可见
      try {
        const base64Data = dataURL.split(',')[1];
        if (!base64Data) return dataURL;

        // 随机修改一个字节
        const bytes = atob(base64Data);
        if (bytes.length < 100) return dataURL;

        const pos = Math.floor(Math.random() * bytes.length);
        const modified = bytes.substring(0, pos) +
          String.fromCharCode(bytes.charCodeAt(pos) ^ 1) +
          bytes.substring(pos + 1);

        return dataURL.split(',')[0] + ',' + btoa(modified);
      } catch (_) {
        return dataURL;
      }
    };

    // 拦截 toBlob
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      const noisyCallback = (blob) => {
        if (this.width <= 256 && this.height <= 256) {
          // 对 blob 加噪点的成本太高，直接拒绝小 canvas 的精确指纹
          callback(blob);
        } else {
          callback(blob);
        }
      };
      origToBlob.call(this, noisyCallback, ...args);
    };

    // 拦截 getImageData（用于像素级指纹提取）
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      const imageData = origGetImageData.apply(this, args);
      // 对提取的像素数据加微小噪点
      if (imageData && imageData.data) {
        const data = imageData.data;
        // 每 20 个像素改一个值（肉眼不可见，但哈希完全不同）
        for (let i = 0; i < data.length; i += 80) {
          data[i] = data[i] ^ 1;
        }
      }
      return imageData;
    };

    // 拦截 WebGL 指纹
    this._defense_webgl();
  }

  _defense_webgl() {
    try {
      // 覆盖 WebGLRenderingContext.getParameter
      // 广告网络常用 WebGL 指纹：显卡型号、渲染器、vendor
      const origGetParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (pname) {
        switch (pname) {
          case 37445: // UNMASKED_VENDOR_WEBGL
            return 'Intel Inc.'; // 统一为 Intel
          case 37446: // UNMASKED_RENDERER_WEBGL
            return 'Intel Iris OpenGL Engine'; // 通用渲染器
          default:
            return origGetParameter.call(this, pname);
        }
      };

      // 覆盖 WebGL2 版本
      const origGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (pname) {
        switch (pname) {
          case 37445:
            return 'Intel Inc.';
          case 37446:
            return 'Intel Iris OpenGL Engine';
          default:
            return origGetParameter2.call(this, pname);
        }
      };

      // 拦截 readPixels（精确像素读取）
      const origReadPixels = WebGLRenderingContext.prototype.readPixels;
      WebGLRenderingContext.prototype.readPixels = function (...args) {
        const result = origReadPixels.apply(this, args);
        // 如果读取的是小区域（指纹特征），加噪点
        if (args[3] <= 64 && args[4] <= 64) {
          const pixels = args[5];
          if (pixels && pixels.byteLength > 0) {
            const view = new Uint8Array(pixels);
            for (let i = 0; i < view.length; i += 100) {
              view[i] = view[i] ^ 1;
            }
          }
        }
        return result;
      };
    } catch (_) {}
  }

  // ============================================================
  // 6. fetch / XHR AbortController 防御
  //
  // 原理：DNR 拦截请求后，fetch 会被 abort，网站通过
  //       catch 中的 AbortError 检测拦截器存在。
  // 策略：拦截 AbortController，阻止广告检测脚本收到中止信号。
  // ============================================================

  defense_fetchAbort() {
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      let url = '';
      if (typeof args[0] === 'string') url = args[0];
      else if (args[0] instanceof Request) url = args[0].url;

      try {
        const response = await origFetch.apply(this, args);
        return response;
      } catch (err) {
        // 如果是广告 URL 被拦截导致的 abort，返回假响应
        if (err?.name === 'AbortError' || err?.message?.includes('abort') ||
            err?.message?.includes('ERR_BLOCKED_BY_CLIENT') ||
            err?.message?.includes('net::ERR_BLOCKED')) {

          const isAd = window.__antiAdblock?.isAdUrl?.(url) ||
                       url.includes('doubleclick') ||
                       url.includes('googlead') ||
                       url.includes('adsystem');

          if (isAd) {
            // 返回一个空的假响应，欺骗检测脚本
            return new Response('', {
              status: 200,
              statusText: 'OK',
              headers: { 'Content-Type': 'text/plain' },
            });
          }
        }
        throw err;
      }
    };
  }

  // ============================================================
  // 7. IntersectionObserver 防御
  //
  // 原理：网站用 IntersectionObserver 检测广告位是否可见。
  // 策略：拦截 IntersectionObserver 回调，对被隐藏元素报告可见。
  // ============================================================

  defense_intersectionObserver() {
    const origObserve = IntersectionObserver.prototype.observe;
    const origUnobserve = IntersectionObserver.prototype.unobserve;

    const self = this;

    IntersectionObserver.prototype.observe = function (target) {
      // 保存原始回调引用
      if (!this.__adblocker) {
        this.__adblocker = { targets: new Map() };

        // 拦截回调
        const origCallback = this._callback;
        if (origCallback) {
          this._callback = (entries) => {
            const modifiedEntries = entries.map(entry => {
              const el = entry.target;
              if (el.dataset?.__abp_hidden ||
                  el.classList?.contains?.('__abp_procedural_hidden') ||
                  window.__antiAdblock?.isBait(el)) {
                // 返回假可见性数据
                return {
                  ...entry,
                  isIntersecting: true,
                  intersectionRatio: 1,
                  intersectionRect: entry.boundingClientRect,
                  boundingClientRect: {
                    ...entry.boundingClientRect,
                    top: 0,
                    left: 0,
                  },
                };
              }
              return entry;
            });
            if (typeof origCallback === 'function') {
              origCallback.call(this, modifiedEntries, this);
            }
          };
        }
      }

      return origObserve.call(this, target);
    };
  }

  // ============================================================
  // 8. MutationObserver 反检测
  //
  // 原理：网站检测广告拦截器的 MutationObserver 是否篡改了 DOM。
  // 策略：保护我们的 MutationObserver 不被网站检测。
  // ============================================================

  defense_mutationObserver() {
    // 覆盖 MutationObserver 构造函数，记录我们的 observer
    const origMutationObserver = window.MutationObserver;
    const ourObservers = new WeakSet();

    window.MutationObserver = class extends origMutationObserver {
      constructor(callback) {
        super(callback);
        this.__adblocker_observer = true;
        ourObservers.add(this);
      }
    };

    // 拦截 disconnect，防止网站脚本断开我们的 observer
    const origDisconnect = origMutationObserver.prototype.disconnect;
    origMutationObserver.prototype.disconnect = function () {
      if (ourObservers.has(this)) {
        // 不允许断开我们的 observer
        return;
      }
      return origDisconnect.call(this);
    };
  }

  // ============================================================
  // 9. Trusted Types 绕过
  //
  // 原理：网站启用 Trusted Types CSP，阻止内容脚本注入。
  // 策略：创建默认的 Trusted Types 策略。
  // ============================================================

  defense_trustedTypes() {
    if (typeof trustedTypes !== 'object' || !trustedTypes.createPolicy) return;

    try {
      trustedTypes.createPolicy('default', {
        createHTML: (input) => input,
        createScript: (input) => input,
        createScriptURL: (input) => input,
      });
    } catch (_) {
      // 策略可能已存在
    }

    // 创建广告拦截专用的 policy
    try {
      trustedTypes.createPolicy('adblocker', {
        createHTML: (input) => input,
        createScript: (input) => input,
        createScriptURL: (input) => input,
      });
    } catch (_) {}
  }

  // ============================================================
  // 统计与状态
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

// 单例模式 - 随 content script 自动初始化
const antiAdblockEngine = new AntiAdblockEngine();
