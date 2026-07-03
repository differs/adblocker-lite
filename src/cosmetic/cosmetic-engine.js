/**
 * Procedural Cosmetic Filter Engine
 *
 * 技术来源：uBlock Origin Procedural Cosmetic Filters + AdGuard Extended CSS
 * 作用：基于元素计算属性（尺寸、位置、内容特征）来隐藏广告
 *
 * v2.0 增强：
 * - 加载 uBOL 生成的 CSS 规则（generic + specific）
 * - 保留程序化广告检测
 * - CSS 性能优化（StyleSheet 批量注入）
 */

class CosmeticFilterEngine {
  constructor() {
    this.styleSheet = null;
    this.styleElement = null;
    this.proceduralHides = 0;
    this.observer = null;
    this.genericCSSLoaded = false;

    // 初始化：先注入基础样式，再异步加载 uBOL 规则
    this.injectBaseStyles();
    this.loadUBOLCSS().catch(() => {
      // fallback: 即使 uBOL 加载失败也不影响基础功能
    });
    this.scanProceduralAds();
    this.observeDOM();

    console.debug('[AdBlocker] CosmeticEngine v2 已启动');
  }

  // ============================================================
  // uBOL 生成的 CSS 规则加载
  // ============================================================

  async loadUBOLCSS() {
    const enabledRulesets = [
      'ublock-filters',
      'easylist',
      'easyprivacy',
      'ublock-badware',
    ];

    let cssBuffer = '';

    for (const rs of enabledRulesets) {
      try {
        // 加载 generic CSS（通用隐藏规则）
        const genericCSS = await this.loadGenericCSS(rs);
        if (genericCSS) cssBuffer += genericCSS + '\n';

        // 加载 specific CSS（站点特定规则）
        const specificCSS = await this.loadSpecificCSS(rs);
        if (specificCSS) cssBuffer += specificCSS + '\n';
      } catch (e) {
        // 单个规则集失败不影响其他
        console.debug(`[AdBlocker] 加载 ${rs} CSS 失败:`, e.message);
      }
    }

    if (cssBuffer) {
      this.appendCSS(cssBuffer);
      this.genericCSSLoaded = true;
      console.debug(`[AdBlocker] uBOL CSS 已注入 (${cssBuffer.length} bytes)`);
    }
  }

  /**
   * 加载 generic CSS 文件
   * uBOL 的 generic/*.js 是自执行函数，只需提取 selectors 即可
   */
  async loadGenericCSS(rulesetId) {
    const url = chrome.runtime.getURL(
      `rulesets/scripting/generic/${rulesetId}.js`
    );

    const resp = await fetch(url);
    if (!resp.ok) return '';

    const text = await resp.text();

    // 解析 uBOL 格式的 CSS 数据
    // 格式: const lowlyGeneric = new Map(...); const highlyGeneric = "..."; const exceptions = [...];
    const cssSelectors = [];

    // 提取 lowlyGeneric: 提取所有 selector 字符串
    // 格式: [数字,"selector"] 或 [数字,'selector']
    const selectorMatches = text.match(/\[\d+,("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\]/g);
    if (selectorMatches) {
      for (const match of selectorMatches) {
        try {
          // 提取引号内的内容
          const inner = match.slice(match.indexOf(',') + 1).trim();
          const quote = inner[0];
          // 找到匹配的结束引号
          let selector = '';
          let i = 1;
          while (i < inner.length - 1) {
            if (inner[i] === '\\') { selector += inner[i] + (inner[i+1] || ''); i += 2; }
            else if (inner[i] === quote) break;
            else { selector += inner[i]; i++; }
          }
          // 有些选择器包含 :not(#style_important) 标记
          const clean = selector.replace(/:not\(#style_important\)$/, '').trim();
          if (clean) cssSelectors.push(clean);
        } catch (_) {}
      }
    }

    // 提取 highlyGeneric (高度通用的 CSS 选择器)
    // 格式: const highlyGeneric = /* 数字 */ "选择器1,\n选择器2,...";
    const highMatch = text.match(/const highlyGeneric\s*=\s*\/\*\s*\d+\s*\*\/\s*"([\s\S]*?)";\s*\n/);
    if (highMatch) {
      const selectors = highMatch[1]
        .replace(/\\\n/g, '')      // 移除换行转义
        .split(/,\n?/)               // 按逗号分割
        .map(s => s.trim().replace(/^"|"$/g, ''))
        .filter(s => s && s !== '""');
      cssSelectors.push(...selectors);
    }

    if (cssSelectors.length === 0) return '';

    return `/* ${rulesetId} generic */\n${
      cssSelectors.map(s => `${s} { display: none !important; }`).join('\n')
    }`;
  }

  /**
   * 加载 specific CSS 文件（站点特定规则）
   */
  async loadSpecificCSS(rulesetId) {
    const url = chrome.runtime.getURL(
      `rulesets/scripting/specific/${rulesetId}.json`
    );

    const resp = await fetch(url);
    if (!resp.ok) return '';

    const data = await resp.json();

    // 格式: {"rulesetId":"...","selectors":{...},"hostnames":{...}}
    if (!data || !data.selectors || !data.hostnames) return '';

    const currentHost = location.hostname;
    const currentHostParts = currentHost.split('.').reverse();
    let cssBuffer = '';

    // hostnames 格式: { hash: ["host1","host2"] } 或 { hash: "host1" }
    // 只加载匹配当前站点的 selector
    for (const [hash, selectorText] of Object.entries(data.selectors)) {
      if (typeof selectorText !== 'string') continue;

      const hosts = data.hostnames[hash];
      if (!hosts) continue;

      // 检查当前站点是否匹配
      const hostList = Array.isArray(hosts) ? hosts : [hosts];
      let matches = false;
      for (const h of hostList) {
        if (h === currentHost || h === '*') { matches = true; break; }
        // 支持 *.example.com 通配
        if (h.startsWith('*.')) {
          const suffix = h.slice(1); // .example.com
          if (currentHost.endsWith(suffix)) { matches = true; break; }
        }
      }
      if (!matches) continue;

      cssBuffer += `${selectorText} { display: none !important; }\n`;
    }

    if (!cssBuffer) return '';
    return `/* ${rulesetId} specific */\n${cssBuffer}`;
  }

  // ============================================================
  // 基础 CSS 注入（原有逻辑 + uBOL 增强）
  // ============================================================

  injectBaseStyles() {
    this.styleElement = document.createElement('style');
    this.styleElement.id = '__adblocker-cosmetic';
    this.styleElement.textContent = this.generateBaseCSS();
    document.documentElement.appendChild(this.styleElement);
  }

  generateBaseCSS() {
    return `
      /* =========================================
         AdBlocker Lite - Cosmetic Filter Rules
         来源：EasyList Element Hides + uBOL
         ========================================= */

      /* ---- 通用广告容器 ---- */
      [id*="ad-"]:not([id*="admin"]):not([id*="dashboard"]):not([id*="setting"]),
      [id*="ads-"]:not([id*="admin"]):not([id*="dashboard"]),
      [class*="ad-"]:not([class*="admin"]):not([class*="dashboard"]):not([class*="add"]):not([class*="address"]),
      [class*="ads-"]:not([class*="admin"]):not([class*="dashboard"]),
      [id*="advert"]:not([id*="advertisement"]),
      [class*="advert"]:not([class*="advertisement"]),
      [class*="sponsor"]:not([class*="sponsorship"]),
      [class*="banner"]:not([class*="banner"]):not([role="banner"]),
      [class*="promo"]:not([class*="promotion"]),
      [class*="commercial"],
      [class*="googleads"],
      [id*="googleads"],
      [class*="doubleclick"],

      /* ---- 广告位 ---- */
      .ad-container, .ad-wrapper, .ad-slot, .ad-placeholder,
      .ad-unit, .ad-banner, .advertisement, .adsbygoogle,
      .sponsored-content, .sponsored-post, .sponsored-link,
      .promoted-content, .promoted-post, .promoted-link,
      .native-ad, .native-ads, .in-feed-ad,
      .video-ad, .video-ads, .preroll, .midroll,
      .sidebar-ad, .sidebar-ads,
      .anchor-ad, .sticky-ad, .sticky-ad-wrapper,

      /* ---- 特定平台 ---- */
      .adsbygoogle, .adsense,
      [data-ad-client], [data-ad-slot], [data-ad-format],
      [data-google-query-id],

      /* ---- 弹窗 ---- */
      [class*="popup"]:not([class*="popup-menu"]):not([class*="popup-content"]):not([class*="popup-window"]),
      [id*="popup"]:not([id*="popup-menu"]):not([id*="popup-content"]),

      /* ---- 广告 iframe ---- */
      iframe[src*="doubleclick"],
      iframe[src*="googleads"],
      iframe[src*="amazon-adsystem"],
      iframe[src*="criteo"],
      iframe[src*="taboola"],
      iframe[src*="outbrain"],
      iframe[id*="google_ads"],
      iframe[id*="ad-"],

      /* ---- 固定/悬浮广告 ---- */
      [class*="fixed"][class*="ad"],
      [id*="fixed"][id*="ad"],
      [style*="position: fixed"][class*="ad"],
      [style*="position:fixed"][class*="ad"],

      /* ---- 社交追踪按钮 ---- */
      iframe[src*="facebook.com/plugins/like"],
      iframe[src*="facebook.com/plugins/share"],
      iframe[src*="platform.twitter.com/widgets"],
      iframe[src*="linkedin.com/plugins"],

      /* ---- 常见反广告检测遮罩 ---- */
      [class*="anti-adblock"],
      [id*="anti-adblock"],
      [class*="adblock-warning"],
      [id*="adblock-warning"],
      [class*="adblock_detected"],
      [id*="adblock_detected"],

      /* ---- 底部/侧边悬浮广告 ---- */
      [class*="floating-ad"],
      [class*="float-ad"],
      [class*="bottom-ad"],
      [class*="top-ad"],
      [class*="interstitial"],

      /* ---- 文章内嵌广告 ---- */
      [class*="in-content-ad"],
      [class*="in-article-ad"],
      [class*="content-ad"],
      [class*="article-ad"],
      [class*="post-ad"],
      [class*="entry-ad"],
    `;
  }

  /**
   * 追加 CSS 到已注入的样式表
   */
  appendCSS(css) {
    if (!this.styleElement) return;
    // 追加在基础规则后面，uBOL 规则优先级更高
    this.styleElement.textContent += '\n' + css;
  }

  // ============================================================
  // 程序化广告检测（基于计算属性）
  // ============================================================

  scanProceduralAds() {
    const allElements = document.querySelectorAll('div, iframe, img, section, aside');
    let hiddenCount = 0;

    allElements.forEach(el => {
      if (this.isProceduralAd(el)) {
        this.hideProcedural(el);
        hiddenCount++;
      }
    });

    if (hiddenCount > 0) {
      this.proceduralHides += hiddenCount;
      console.debug(`[AdBlocker] 程序化过滤隐藏了 ${hiddenCount} 个广告`);
    }
  }

  isProceduralAd(el) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const tag = el.tagName.toLowerCase();

    // 跳过小元素和文档结构元素
    if (rect.width === 0 || rect.height === 0) return false;

    // 特征 1：固定定位 + 特定位置
    if (style.position === 'fixed' || style.position === 'sticky') {
      if (rect.top > window.innerHeight - 200 && rect.bottom <= window.innerHeight) {
        if (this.hasAdContent(el)) return true;
      }
      if (rect.left > window.innerWidth - 300 && rect.right <= window.innerWidth) {
        if (this.hasAdContent(el)) return true;
      }
    }

    // 特征 2：iframe 广告
    if (tag === 'iframe') {
      const src = el.getAttribute('src') || '';
      if (src && !src.includes(location.hostname)) {
        if (rect.width >= 120 && rect.width <= 1000 &&
            rect.height >= 60 && rect.height <= 600) {
          const socialSources = ['facebook', 'twitter', 'instagram', 'youtube', 'tiktok'];
          if (!socialSources.some(s => src.includes(s))) {
            return true;
          }
        }
      }
    }

    // 特征 3：绝对定位 + 非交互区域
    if (style.position === 'absolute') {
      if (rect.top > 1000 && rect.right < 50) {
        if (this.hasAdContent(el)) return true;
      }
    }

    // 特征 4：尺寸异常 (广告 banner)
    if (tag === 'img') {
      const adSizes = [
        [728, 90], [468, 60], [300, 250], [336, 280],
        [160, 600], [120, 600], [300, 600], [250, 250],
        [200, 200], [970, 90], [970, 250], [320, 50],
        [320, 100], [180, 150], [125, 125], [240, 400],
      ];
      const matchesSize = adSizes.some(([w, h]) =>
        Math.abs(rect.width - w) < 10 && Math.abs(rect.height - h) < 10
      );
      if (matchesSize) {
        if (this.isExternalResource(el)) return true;
      }
    }

    // 特征 5：aria-hidden 且无内容
    if (el.getAttribute('aria-hidden') === 'true' &&
        el.innerHTML.trim() === '' && rect.width > 100) {
      return true;
    }

    return false;
  }

  hasAdContent(el) {
    const text = el.textContent?.toLowerCase() || '';
    const html = el.innerHTML?.toLowerCase() || '';
    const classStr = el.className?.toLowerCase() || '';

    const adTextPatterns = [
      'advertisement', 'sponsored', 'promoted', '广告', '推广',
      'ad feed', 'sponsored content', 'promoted content',
      'ad by', 'brought to you by', '推荐阅读',
    ];

    const hasAdText = adTextPatterns.some(p => text.includes(p));
    if (hasAdText) return true;

    const adAttrs = ['ad-client', 'ad-slot', 'ad-format', 'ad-type'];
    const hasAdAttr = adAttrs.some(a => el.hasAttribute(`data-${a}`));
    if (hasAdAttr) return true;

    return false;
  }

  isExternalResource(el) {
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src') || '';
      return src && !src.includes(location.hostname);
    }
    return false;
  }

  hideProcedural(el) {
    if (el.dataset.__abp_hidden) return;

    el.classList.add('__abp_procedural_hidden');
    el.style.setProperty('display', 'none', 'important');
    el.dataset.__abp_hidden = 'true';
  }

  // ============================================================
  // DOM 变化监控（动态广告）
  // ============================================================

  observeDOM() {
    this.observer = new MutationObserver((mutations) => {
      let hiddenCount = 0;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (this.isProceduralAd(node)) {
                this.hideProcedural(node);
                hiddenCount++;
              }

              const ads = node.querySelectorAll('div, iframe, img');
              for (const el of ads) {
                if (this.isProceduralAd(el)) {
                  this.hideProcedural(el);
                  hiddenCount++;
                }
              }
            }
          }
        }

        if (mutation.type === 'attributes') {
          const el = mutation.target;
          if (this.shouldHideByAttribute(el)) {
            this.hideProcedural(el);
            hiddenCount++;
          }
        }
      }

      if (hiddenCount > 0) {
        this.proceduralHides += hiddenCount;
      }
    });

    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'id', 'style'],
    });
  }

  shouldHideByAttribute(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html') return false;
    if (el.dataset.__abp_hidden) return false;
    return el.className?.toLowerCase()?.includes?.('ad-') ||
           el.id?.toLowerCase()?.includes?.('ad-');
  }

  addCustomCSS(css) {
    if (this.styleElement) {
      this.styleElement.textContent += '\n' + css;
    }
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }
  }
}
