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
  if (window[AD_BLOCKER_MARKER]) return;
  window[AD_BLOCKER_MARKER] = true;

  // ---- 诱饵元素检测模式 ----
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
    var _oh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    if (_oh && _oh.get) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      get: function() { return (isBait(this) || this.dataset.__abp_hidden) ? 250 : _oh.get.call(this); },
      configurable: true
    });
  } catch(e) {}

  try {
    var _ow = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    if (_ow && _ow.get) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      get: function() { return (isBait(this) || this.dataset.__abp_hidden) ? 300 : _ow.get.call(this); },
      configurable: true
    });
  } catch(e) {}

  try {
    var _op = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    if (_op && _op.get) Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      get: function() { return (isBait(this) || this.dataset.__abp_hidden) ? document.body : _op.get.call(this); },
      configurable: true
    });
  } catch(e) {}

  // ============================================================
  // 防御 2: getComputedStyle
  // ============================================================
  try {
    var _gcs = window.getComputedStyle;
    window.getComputedStyle = function(el, pe) {
      var s = _gcs.call(this, el, pe);
      if (isBait(el) || (el.dataset && el.dataset.__abp_hidden)) {
        return new Proxy(s, { get: function(t, p) {
          if (p === 'display') return 'block';
          if (p === 'visibility') return 'visible';
          if (p === 'opacity') return '1';
          if (p === 'height') return '250px';
          if (p === 'width') return '300px';
          return t[p];
        }});
      }
      return s;
    };
  } catch(e) {}

  // ============================================================
  // 防御 3: getBoundingClientRect / getClientRects
  // ============================================================
  try {
    var _gbr = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function() {
      return (isBait(this) || this.dataset.__abp_hidden)
        ? DOMRect.fromRect({ x:0, y:0, width:300, height:250 })
        : _gbr.call(this);
    };
  } catch(e) {}

  try {
    var _gcr = Element.prototype.getClientRects;
    Element.prototype.getClientRects = function() {
      return (isBait(this) || this.dataset.__abp_hidden)
        ? [DOMRect.fromRect({ x:0, y:0, width:300, height:250 })]
        : _gcr.call(this);
    };
  } catch(e) {}

  // ============================================================
  // 防御 4: Canvas 指纹 (toDataURL + toBlob + getImageData + WebGL)
  // ============================================================
  try {
    var _tdu = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function() {
      var r = _tdu.apply(this, arguments);
      if (this.width <= 256 && this.height <= 256) {
        try {
          var p = r.split(',');
          if (p[1]) {
            var b = atob(p[1]);
            if (b.length > 50) {
              var pos = Math.floor(Math.random() * b.length);
              b = b.substring(0, pos) + String.fromCharCode(b.charCodeAt(pos) ^ 1) + b.substring(pos + 1);
              return p[0] + ',' + btoa(b);
            }
          }
        } catch(_) {}
      }
      return r;
    };
  } catch(e) {}

  try {
    var _tb = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(cb, type, q) {
      if (this.width <= 256 && this.height <= 256) {
        var nd = this.toDataURL(type, q);
        var p = nd.split(',');
        if (p[1]) {
          var bin = atob(p[1]);
          var arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          cb(new Blob([arr], { type: type || 'image/png' }));
          return;
        }
      }
      _tb.call(this, cb, type, q);
    };
  } catch(e) {}

  try {
    var _gid = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function() {
      var id = _gid.apply(this, arguments);
      if (id && id.data) for (var i = 0; i < id.data.length; i += 80) id.data[i] = id.data[i] ^ 1;
      return id;
    };
  } catch(e) {}

  try {
    var _wgp = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(p) {
      if (p === 37445) return 'Intel Inc.';
      if (p === 37446) return 'Intel Iris OpenGL Engine';
      return _wgp.call(this, p);
    };
  } catch(e) {}

  try {
    var _wrp = WebGLRenderingContext.prototype.readPixels;
    WebGLRenderingContext.prototype.readPixels = function(x, y, w, h, fmt, type, pixels) {
      var r = _wrp.call(this, x, y, w, h, fmt, type, pixels);
      if (w <= 64 && h <= 64 && pixels && pixels.byteLength > 0) {
        var v = new Uint8Array(pixels);
        for (var i = 0; i < v.length; i += 100) v[i] = v[i] ^ 1;
      }
      return r;
    };
  } catch(e) {}

  // ============================================================
  // 防御 5: PerformanceObserver / Resource Timing
  // ============================================================
  try {
    var _adUrls = [
      'doubleclick.net', 'googleadservices.com', 'googlesyndication.com',
      'google-analytics.com', 'googletagmanager.com',
      'facebook.com/tr', 'connect.facebook.net',
      'amazon-adsystem.com', 'taboola.com', 'outbrain.com',
      'criteo.com', 'adsrvr.org', 'adnxs.com',
      'scorecardresearch.com', 'quantserve.com',
    ];
    var _isAdUrl = function(url) {
      for (var i = 0; i < _adUrls.length; i++) { if (url.indexOf(_adUrls[i]) !== -1) return true; }
      return false;
    };

    var _getE = Performance.prototype.getEntriesByType;
    Performance.prototype.getEntriesByType = function(type) {
      var e = _getE.call(this, type);
      if (type !== 'resource') return e;
      return e.filter(function(entry) { return entry.name && !(entry.duration === 0 && _isAdUrl(entry.name)); });
    };

    var _getEA = Performance.prototype.getEntries;
    Performance.prototype.getEntries = function() {
      return _getEA.call(this).filter(function(entry) {
        return entry.entryType !== 'resource' || (entry.name && !(entry.duration === 0 && _isAdUrl(entry.name)));
      });
    };

    var _OrigPO = window.PerformanceObserver;
    if (_OrigPO) {
      window.PerformanceObserver = (function(PO) {
        function PatchPO(cb) {
          return new PO(function(list, obs) {
            var pl = Object.create(list);
            pl.getEntries = function() { return list.getEntries().filter(function(e) {
              return e.entryType !== 'resource' || (e.name && !(e.duration === 0 && _isAdUrl(e.name)));
            });};
            return cb(pl, obs);
          });
        }
        PatchPO.prototype = PO.prototype;
        return PatchPO;
      })(_OrigPO);
    }
  } catch(e) {}

  // ============================================================
  // 防御 6: fetch 拦截
  // ============================================================
  try {
    var _fetch = window.fetch;
    window.fetch = function() {
      var args = arguments;
      var url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : '');
      return _fetch.apply(this, args).catch(function(err) {
        if (err.name === 'AbortError' || (err.message && (err.message.indexOf('ERR_BLOCKED') !== -1 || err.message.indexOf('blocked') !== -1))) {
          if (_isAdUrl(url)) return new Response('', { status: 200, statusText: 'OK', headers: { 'Content-Type': 'text/plain' } });
        }
        throw err;
      });
    };
  } catch(e) {}

  // ============================================================
  // 防御 7: IntersectionObserver
  // ============================================================
  try {
    var _OrigIO = window.IntersectionObserver;
    window.IntersectionObserver = function(cb, opts) {
      var wcb = function(entries, obs) {
        return cb(entries.map(function(entry) {
          var el = entry.target;
          return (isBait(el) || (el.dataset && el.dataset.__abp_hidden))
            ? Object.assign({}, entry, { isIntersecting: true, intersectionRatio: 1 })
            : entry;
        }), obs);
      };
      var inst = new _OrigIO(wcb, opts);
      return inst;
    };
    window.IntersectionObserver.prototype = _OrigIO.prototype;
  } catch(e) {}

  // ============================================================
  // 防御 8: navigator.webdriver
  // ============================================================
  try { Object.defineProperty(navigator, 'webdriver', { get: function() { return undefined; }, configurable: true }); } catch(e) {}

  // ============================================================
  // 防御 9: Trusted Types
  // ============================================================
  try { if (window.trustedTypes && trustedTypes.createPolicy) { trustedTypes.createPolicy('default', { createHTML: function(s) { return s; }, createScript: function(s) { return s; }, createScriptURL: function(s) { return s; } }); } } catch(e) {}

  // ============================================================
  // 防御 10: Scriptlet - 反广告检测变量覆盖
  // ============================================================

  // 10a: noopFunc - 替换反广告检测的回调
  var _noopFalse = function() { return false; };
  var _noopTrue = function() { return true; };

  try { Object.defineProperty(window, 'adblock', { get: function() { return undefined; }, set: function(){}, configurable: true }); } catch(e) {}
  try { Object.defineProperty(window, 'adBlock', { get: function() { return undefined; }, set: function(){}, configurable: true }); } catch(e) {}
  try { Object.defineProperty(window, 'adblocker', { get: function() { return undefined; }, set: function(){}, configurable: true }); } catch(e) {}
  try { Object.defineProperty(window, 'adBlockDetected', { get: function() { return undefined; }, set: function(){}, configurable: true }); } catch(e) {}
  try { Object.defineProperty(window, 'uBlockDetected', { get: function() { return undefined; }, set: function(){}, configurable: true }); } catch(e) {}

  try { window.adblockDetector = { isDetected: _noopFalse }; } catch(e) {}
  try { window.adBlockDetector = { isDetected: _noopFalse }; } catch(e) {}
  try { window.__adblocker = { detected: false }; } catch(e) {}
  try { window.__adBlock = { detected: false }; } catch(e) {}

  // 10b: Google Ads bypass
  try {
    if (!window.adsbygoogle) { window.adsbygoogle = []; }
    var _origPush = window.adsbygoogle.push;
    window.adsbygoogle.push = function() {
      if (arguments[0] && arguments[0].done) { setTimeout(function() { arguments[0].done(); }, 100); }
    };
    if (typeof window.google_ad === 'undefined') {
      window.google_ad = function() { this.ads = []; };
      window.google_ad.prototype.display = function() {};
      window.google_ad.prototype.refresh = function() {};
      window.google_ad.prototype.destroy = function() {};
    }
  } catch(e) {}

  // 10c: FuckAdBlock / BlockAdBlock 绕过
  try {
    var _detectors = [
      'fuckAdBlock', 'FuckAdBlock', 'blockAdBlock', 'BlockAdBlock',
      'adBlockDetector', 'AdBlockDetector', 'adblockDetector', 'AdblockDetector',
      'antiAdblock', 'AntiAdblock', 'advertisementDetector', 'advertDetector'
    ];
    for (var d = 0; d < _detectors.length; d++) {
      if (typeof window[_detectors[d]] === 'function') {
        try { window[_detectors[d]].prototype.isDetected = _noopFalse; } catch(_) {}
      }
    }

    var _overwrites = { 'isAdblockActive': false, 'is_adblock_active': false, 'adBlockDetected': false, 'adblockDetected': false, 'uBlockDetected': false };
    for (var k in _overwrites) {
      if (_overwrites.hasOwnProperty(k)) {
        try { Object.defineProperty(window, k, { get: function() { return false; }, set: function(){}, configurable: true }); } catch(_) {}
      }
    }
  } catch(e) {}

  // 10d: PopUnder 弹窗拦截
  try {
    var _open = window.open;
    window.open = function(url, name, features) {
      if (!url || typeof url !== 'string') return null;
      var _bp = ['ad', 'pop', 'popup', 'popunder', 'clickunder', 'sponsor', 'promo', 'banner', 'track', 'affiliate', 'offer', 'campaign', '//bit.ly/', '//tinyurl.com/', '//goo.gl/', '//adf.ly/'];
      for (var i = 0; i < _bp.length; i++) { if (url.toLowerCase().indexOf(_bp[i]) !== -1) { return null; } }
      return _open.call(window, url, name, features);
    };
  } catch(e) {}

  // 10e: 加密货币矿工拦截
  try {
    var _Worker = window.Worker;
    var _minerP = ['coinhive', 'coin-hive', 'miner', 'cryptoloot', 'webmine', 'minecrunch', 'coinnebula', 'reauthenticator', '2captcha', 'antigate'];
    window.Worker = function(url) {
      var us = typeof url === 'string' ? url : (url ? url.toString() : '');
      for (var i = 0; i < _minerP.length; i++) { if (us.indexOf(_minerP[i]) !== -1) { return new _Worker('data:text/javascript;base64,' + btoa('')); } }
      return new _Worker(url);
    };
    window.Worker.prototype = _Worker.prototype;
  } catch(e) {}

  // 10f: setTimeout defuser - 反广告轮询降频
  try {
    var _st = window.setTimeout;
    window.setTimeout = function(fn, delay) {
      return _st.call(window, fn, delay);
    };

    var _si = window.setInterval;
    var _dk = ['adblock', 'ad_block', 'advert', 'adsbygoogle', 'ad_slot', 'banner', 'popup', 'detect', 'anti'];
    window.setInterval = function(fn, delay) {
      if (typeof fn === 'function' && delay < 500) {
        var fns = fn.toString().toLowerCase();
        for (var i = 0; i < _dk.length; i++) { if (fns.indexOf(_dk[i]) !== -1) { return _si.call(window, fn, 5000); } }
      }
      return _si.call(window, fn, delay);
    };
  } catch(e) {}

  // 10g: 自动点击广告链接拦截
  try {
    var _ce = document.createElement.bind(document);
    document.createElement = function(tagName, opts) {
      var el = _ce(tagName, opts);
      if (tagName.toLowerCase() === 'a') {
        var _oc = el.click;
        el.click = function() {
          var href = el.href || '';
          var _bp2 = ['ad', 'pop', 'sponsor', 'affiliate', 'track'];
          for (var i = 0; i < _bp2.length; i++) { if (href.toLowerCase().indexOf(_bp2[i]) !== -1) return; }
          return _oc.call(this);
        };
      }
      return el;
    };
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

    let script = null;
    try {
      script = document.createElement('script');
      script.textContent = DEFENSE_CODE;
      script.id = '__adblocker_defense';
      // document_start 阶段 document.documentElement 一定存在
      document.documentElement.appendChild(script);
    } catch (e) {
      console.error('[DefenseInjector] 注入失败:', e.message);
      // 不使用 document.write 兜底——它会清空页面
      return;
    } finally {
      if (script && script.parentNode) {
        script.remove();
      }
    }

    console.debug('[DefenseInjector] 主世界防御脚本已注入');
  }
}

const defenseInjector = new DefenseInjector();

// === 自动执行：document_start 时立即注入主世界 ===
// 大部分情况下 document.documentElement 在 document_start 已存在。
// about:blank/srcdoc iframe 中可能为 null，此时等 DOMContentLoaded。
if (document.documentElement) {
  defenseInjector.inject();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    defenseInjector.inject();
  }, { once: true });
}
