/**
 * URL Tracking Parameter Stripper
 *
 * 技术来源：uBlock Origin (removeparam) + AdGuard URL Tracking Protection
 * 作用：移除 URL 中的追踪参数，保护隐私同时减轻网络请求
 *
 * 拦截成功率提升点：
 * - 很多广告网络通过 URL 参数来追踪用户点击来源
 * - 移除这些参数可以破坏广告归因系统
 * - 减少不必要的网络重定向
 */

class TrackerParamStripper {
  constructor() {
    // 已知的追踪参数列表（按优先级排序）
    this.trackingParams = [
      // Google Analytics / Ads
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid',
      'fbclid', 'fbadid', 'fbcid', 'fbc',

      // Microsoft / Bing
      'msclkid', 'mkt_tok',

      // Twitter
      'twclid', 'twi',

      // LinkedIn
      'li_fat_id',

      // Pinterest
      'pin_cid',

      // HubSpot
      '_hsenc', '_hsmi', 'hsCtaTracking',

      // Mailchimp
      'mc_cid', 'mc_eid',

      // Mailchimp
      'mc_cid', 'mc_eid',

      // General tracking
      'ref', 'ref_src', 'ref_url',
      'source', 'src',
      'campaign', 'cn',
      'content', 'cc',
      'term', 'ck_subscriber_id',

      // Affiliate tracking
      'aff_id', 'affiliate_id', 'affiliate',
      'utm_nooverride', 'wickedid',
      'yclid', '_openstat',

      // Email tracking
      'trk', 'trkCampaign', 'trkContent',

      // Facebook Pixel
      'fbp', 'fbeventid',
      'ef_id', 's_kwcid',

      // Vero
      'vero_id',

      // TikTok
      'ttclid',

      // Snapchat
      'sc_clid',

      // Reddit
      'rdt_cid',

      // Branch.io
      'utm_campaign',

      // Adjust
      'adj_',
    ];

    // Notify/scriptlet 参数（保持可见）
    this.safeParams = ['q', 's', 'search', 'query', 'page', 'p'];
  }

  /**
   * 清理 URL 中的追踪参数
   * 在请求发出前执行
   */
  stripTrackingParams(url) {
    try {
      const parsed = new URL(url);
      let modified = false;

      for (const param of this.trackingParams) {
        if (parsed.searchParams.has(param)) {
          parsed.searchParams.delete(param);
          modified = true;
        }
      }

      if (modified) {
        return parsed.toString();
      }

      return url;
    } catch (e) {
      return url;
    }
  }

  /**
   * 批量清理页面所有链接中的追踪参数
   */
  stripAllLinks() {
    const links = document.querySelectorAll('a[href]');
    let stripped = 0;

    links.forEach(link => {
      const original = link.getAttribute('href');
      if (!original) return;

      const cleaned = this.stripTrackingParams(original);
      if (cleaned !== original) {
        link.setAttribute('href', cleaned);
        stripped++;
      }
    });

    if (stripped > 0) {
      console.debug(`[AdBlocker] 清理了 ${stripped} 个追踪链接`);
    }

    return stripped;
  }

  /**
   * 拦截并清理即将发出的请求
   * 通过 content script 拦截 fetch/XHR
   */
  interceptNetworkRequests() {
    // 保存 this 引用供内部回调使用
    const self = this;

    // 拦截 fetch
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      let url = args[0];
      if (typeof url === 'string') {
        args[0] = self.stripTrackingParams(url);
      } else if (url instanceof Request) {
        const cleaned = self.stripTrackingParams(url.url);
        if (cleaned !== url.url) {
          args[0] = new Request(cleaned, url);
        }
      }
      return originalFetch.call(window, ...args);
    };

    // 拦截 XMLHttpRequest - 使用已存在的实例方法，避免创建新实例
    const originalOpen = XMLHttpRequest.prototype.open;
    const stripFn = (url) => self.stripTrackingParams(url);
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      if (typeof url === 'string') {
        url = stripFn(url);
      }
      return originalOpen.call(this, method, url, ...rest);
    };
  }
}

// 自动执行
const paramStripper = new TrackerParamStripper();
paramStripper.stripAllLinks();
paramStripper.interceptNetworkRequests();
