/**
 * Anti-Adblock Defense Injector
 *
 * 将反检测脚本注入到页面的主世界（main world）中执行，
 * 确保在网站脚本运行之前完成所有 API hook。
 *
 * Chrome MV3 中，content script 运行在 isolated world，
 * 无法直接修改页面中的 window、HTMLElement.prototype 等。
 * 必须通过 <script> 标签注入到主世界。
 *
 * 注入时机：document_start（在 content script 加载时立即注入）
 */

const DEFENSE_CODE = `

(function() {
  'use strict';

  // ============================================================
  // 防御引擎核心 - 运行在页面主世界
  // ============================================================

  const AD_BLOCKER_MARKER = '__adblocker_defended';
  if (window[AD_BLOCKER_MARKER]) return; // 防止重复注入
  window[AD_BLOCKER_MARKER] = true;

  // 诱饵元素检测模式
  const BAIT_PATTERNS = [
    'pub_300x250', 'pub_300x250m', 'pub_728x90',
    'text-ad', 'textAd', 'text_ad', 'text_ads',
    'adsbox', 'ad-container',
  ];

  const isBait = function(el) {
    if (!el || !el.className) return false;
    var cls = el.className.toLowerCase();
    for (var i = 0; i < BAIT_PATTERNS.length; i++) {
      if (cls.indexOf(BAIT_PATTERNS[i]) !== -1) return true;
    }
    return false;
  };

  // ============================================================
  // 防御 1: offsetHeight / offsetWidth / offsetParent
  // ============================================================
  try {
    var origOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype, 'offsetHeight'
    );
    if (origOffsetHeight && origOffsetHeight.get) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        get: function() {
          if (isBait(this) || this.dataset.__abp_hidden) {
            return 250;
          }
          return origOffsetHeight.get.call(this);
        },
        configurable: true
      });
    }
  } catch(e) {}

  try {
    var origOffsetWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype, 'offsetWidth'
    );
    if (origOffsetWidth && origOffsetWidth.get) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        get: function() {
          if (isBait(this) || this.dataset.__abp_hidden) {
            return 300;
          }
          return origOffsetWidth.get.call(this);
        },
        configurable: true
      });
    }
  } catch(e) {}

  try {
    var origOffsetParent = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype, 'offsetParent'
    );
    if (origOffsetParent && origOffsetParent.get) {
      Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
        get: function() {
          if (isBait(this) || this.dataset.__abp_hidden) {
            return document.body;
          }
          return origOffsetParent.get.call(this);
        },
        configurable: true
      });
    }
  } catch(e) {}

  // ============================================================
  // 防御 2: getComputedStyle
  // ============================================================
  try {
    var origGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = function(el, pseudoElt) {
      var style = origGetComputedStyle.call(this, el, pseudoElt);

      if (isBait(el) || (el.dataset && el.dataset.__abp_hidden)) {
        return new Proxy(style, {
          get: function(target, prop) {
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
  } catch(e) {}

  // ============================================================
  // 防御 3: getBoundingClientRect / getClientRects
  // ============================================================
  try {
    var origGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function() {
      if (isBait(this) || this.dataset.__abp_hidden) {
        return DOMRect.fromRect({ x: 0, y: 0, width: 300, height: 250 });
      }
      return origGetBoundingClientRect.call(this);
    };
  } catch(e) {}

  try {
    var origGetClientRects = Element.prototype.getClientRects;
    Element.prototype.getClientRects = function() {
      if (isBait(this) || this.dataset.__abp_hidden) {
        return [DOMRect.fromRect({ x: 0, y: 0, width: 300, height: 250 })];
      }
      return origGetClientRects.call(this);
    };
  } catch(e) {}

  // ============================================================
  // 防御 4: Canvas 指纹 (toDataURL + toBlob + getImageData + WebGL)
  // ============================================================
  try {
    var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function() {
      var dataURL = origToDataURL.apply(this, arguments);
      // 小 canvas 或透明 canvas → 加噪点破坏指纹
      if (this.width <= 256 && this.height <= 256) {
        try {
          var parts = dataURL.split(',');
          if (parts[1]) {
            var bytes = atob(parts[1]);
            if (bytes.length > 50) {
              var pos = Math.floor(Math.random() * bytes.length);
              bytes = bytes.substring(0, pos) +
                String.fromCharCode(bytes.charCodeAt(pos) ^ 1) +
                bytes.substring(pos + 1);
              return parts[0] + ',' + btoa(bytes);
            }
          }
        } catch(_) {}
      }
      return dataURL;
    };
  } catch(e) {}

  // toBlob -> 使用 toDataURL 加噪点后转回 Blob
  try {
    var origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
      if (this.width <= 256 && this.height <= 256) {
        // 小 canvas: 通过 toDataURL（已加噪点）再转 blob
        var noisyDataURL = this.toDataURL(type, quality);
        var parts = noisyDataURL.split(',');
        if (parts[1]) {
          var binary = atob(parts[1]);
          var array = new Uint8Array(binary.length);
          for (var i = 0; i < binary.length; i++) {
            array[i] = binary.charCodeAt(i);
          }
          callback(new Blob([array], { type: type || 'image/png' }));
          return;
        }
      }
      origToBlob.call(this, callback, type, quality);
    };
  } catch(e) {}

  // getImageData -> 像素加噪点
  try {
    var origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function() {
      var imageData = origGetImageData.apply(this, arguments);
      if (imageData && imageData.data) {
        // 每 20 个像素改一个字节 → 哈希变化但肉眼不可见
        for (var i = 0; i < imageData.data.length; i += 80) {
          imageData.data[i] = imageData.data[i] ^ 1;
        }
      }
      return imageData;
    };
  } catch(e) {}

  // WebGL 指纹: 统一显卡型号
  try {
    var origGetParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(pname) {
      if (pname === 37445) return 'Intel Inc.';
      if (pname === 37446) return 'Intel Iris OpenGL Engine';
      return origGetParam.call(this, pname);
    };
  } catch(e) {}

  try {
    var origReadPixels = WebGLRenderingContext.prototype.readPixels;
    WebGLRenderingContext.prototype.readPixels = function(x, y, w, h, format, type, pixels) {
      var result = origReadPixels.call(this, x, y, w, h, format, type, pixels);
      if (w <= 64 && h <= 64 && pixels && pixels.byteLength > 0) {
        var view = new Uint8Array(pixels);
        for (var i = 0; i < view.length; i += 100) {
          view[i] = view[i] ^ 1;
        }
      }
      return result;
    };
  } catch(e) {}

  // ============================================================
  // 防御 5: PerformanceObserver / Resource Timing
  // ============================================================
  try {
    var adUrlPatterns = [
      'doubleclick.net', 'googleadservices.com', 'googlesyndication.com',
      'google-analytics.com', 'googletagmanager.com',
      'facebook.com/tr', 'connect.facebook.net',
      'amazon-adsystem.com', 'taboola.com', 'outbrain.com',
      'criteo.com', 'adsrvr.org', 'adnxs.com',
      'scorecardresearch.com', 'quantserve.com',
    ];

    var isAdUrl = function(url) {
      for (var i = 0; i < adUrlPatterns.length; i++) {
        if (url.indexOf(adUrlPatterns[i]) !== -1) return true;
      }
      return false;
    };

    var origGetEntries = Performance.prototype.getEntriesByType;
    Performance.prototype.getEntriesByType = function(type) {
      var entries = origGetEntries.call(this, type);
      if (type !== 'resource') return entries;
      return entries.filter(function(entry) {
        if (!entry.name) return false;
        if (entry.duration === 0 && isAdUrl(entry.name)) return false;
        return true;
      });
    };

    var origGetEntriesAll = Performance.prototype.getEntries;
    Performance.prototype.getEntries = function() {
      return origGetEntriesAll.call(this).filter(function(entry) {
        if (entry.entryType !== 'resource') return true;
        if (!entry.name) return false;
        if (entry.duration === 0 && isAdUrl(entry.name)) return false;
        return true;
      });
    };

    // PerformanceObserver 回调过滤
    // 使用 class extends 保持 instanceof 正确
    var OrigPerformanceObserver = window.PerformanceObserver;
    if (OrigPerformanceObserver) {
      window.PerformanceObserver = (function(OrigPO) {
        function PatchedPerformanceObserver(callback) {
          var wrappedCallback = function(list, obs) {
            var patchedList = Object.create(list);
            patchedList.getEntries = function() {
              return list.getEntries().filter(function(entry) {
                if (entry.entryType !== 'resource') return true;
                if (!entry.name) return false;
                if (entry.duration === 0 && isAdUrl(entry.name)) return false;
                return true;
              });
            };
            return callback(patchedList, obs);
          };
          return new OrigPO(wrappedCallback);
        }
        PatchedPerformanceObserver.prototype = OrigPO.prototype;
        return PatchedPerformanceObserver;
      })(OrigPerformanceObserver);
    }
  } catch(e) {}

  // ============================================================
  // 防御 6: fetch 拦截 -> 广告请求被 block 时返回空响应
  // ============================================================
  try {
    var origFetch = window.fetch;
    window.fetch = function() {
      var args = arguments;
      var url = typeof args[0] === 'string' ? args[0] :
                args[0] instanceof Request ? args[0].url : '';
      return origFetch.apply(this, args).catch(function(err) {
        if (err.name === 'AbortError' || (err.message && (
            err.message.indexOf('ERR_BLOCKED') !== -1 ||
            err.message.indexOf('blocked') !== -1))) {
          if (isAdUrl(url)) {
            return new Response('', {
              status: 200,
              statusText: 'OK',
              headers: { 'Content-Type': 'text/plain' }
            });
          }
        }
        throw err;
      });
    };
  } catch(e) {}

  // ============================================================
  // 防御 7: IntersectionObserver
  // ============================================================
  // 注意：IntersectionObserver 的 callback 保存在构造函数闭包中，
  // 无法通过 this._callback 访问。正确的做法是替换整个构造函数。
  try {
    var OrigIntersectionObserver = window.IntersectionObserver;
    window.IntersectionObserver = function(callback, options) {
      var wrappedCallback = function(entries, observer) {
        var filtered = entries.map(function(entry) {
          var el = entry.target;
          if (isBait(el) || (el.dataset && el.dataset.__abp_hidden)) {
            return Object.assign({}, entry, {
              isIntersecting: true,
              intersectionRatio: 1
            });
          }
          return entry;
        });
        return callback(filtered, observer);
      };
      var instance = new OrigIntersectionObserver(wrappedCallback, options);
      return instance;
    };
    window.IntersectionObserver.prototype = OrigIntersectionObserver.prototype;
  } catch(e) {}

  // ============================================================
  // 防御 8: webdriver 隐藏
  // ============================================================
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: function() { return undefined; },
      configurable: true
    });
  } catch(e) {}

  // ============================================================
  // 防御 9: Trusted Types
  // ============================================================
  try {
    if (window.trustedTypes && trustedTypes.createPolicy) {
      trustedTypes.createPolicy('default', {
        createHTML: function(s) { return s; },
        createScript: function(s) { return s; },
        createScriptURL: function(s) { return s; }
      });
    }
  } catch(e) {}

})();
`.trim();

// ============================================================
// Injector: 将防御脚本注入到页面主世界
// ============================================================

class DefenseInjector {
  constructor() {
    this._injected = false;
  }

  inject() {
    if (this._injected) return;
    this._injected = true;

    try {
      const script = document.createElement('script');
      script.textContent = DEFENSE_CODE;
      script.id = '__adblocker_defense';
      // 在 document_start 阶段尽早注入
      document.documentElement.appendChild(script);
      script.remove(); // 注入后立即清理
    } catch (e) {
      // 极早期可能 documentElement 还不存在，用 document.write 兜底
      try {
        document.write('<script id="__adblocker_defense">' +
          DEFENSE_CODE.replace(/<\/script>/g, '<\\/script>') +
          '<\\/script>');
      } catch (_) {}
    }

    console.debug('[DefenseInjector] 主世界防御脚本已注入');
  }
}

const defenseInjector = new DefenseInjector();

// === 自动执行：document_start 时立即注入主世界 ===
// 注意：content script 运行在 isolated world，此 inject() 方法
// 通过创建 <script> 元素将防御代码注入到页面的主世界。
// 必须在任何页面脚本执行之前完成。
if (document.documentElement) {
  defenseInjector.inject();
} else {
  // documentElement 尚未就绪（极早期），等 DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => defenseInjector.inject());
}
