/**
 * 分层拦截统计收集器
 *
 * 从所有引擎收集各层拦截数据，上报给 Service Worker 持久化。
 *
 * 统计维度:
 *   dnr              → DNR 网络请求拦截（按规则集分组）
 *   css_base         → 基础 CSS 选择器隐藏
 *   css_generic      → uBOL 通用 CSS 隐藏
 *   css_specific     → uBOL 站点特定 CSS 隐藏
 *   procedural       → 程序化广告检测（尺寸/位置）
 *   scriptlet        → 反广告检测 scriptlet 触发
 *   tracker_params   → URL 追踪参数清理
 *   popup_blocked    → 弹窗拦截
 *   miner_blocked    → 挖矿脚本拦截
 *   fetch_faked      → 广告请求假响应
 *   bait_spoofed     → 诱饵元素欺骗
 */

const STATS_KEYS = {
  DNR: 'dnr',
  CSS_BASE: 'css_base',
  CSS_GENERIC: 'css_generic',
  CSS_SPECIFIC: 'css_specific',
  PROCEDURAL: 'procedural',
  SCRIPTLET: 'scriptlet',
  TRACKER_PARAMS: 'tracker_params',
  POPUP_BLOCKED: 'popup_blocked',
  MINER_BLOCKED: 'miner_blocked',
  FETCH_FAKED: 'fetch_faked',
  BAIT_SPOOFED: 'bait_spoofed',
};

class StatsCollector {
  constructor() {
    this._counts = {};
    this._lastReport = 0;
    this._reportInterval = 5000; // 5 秒上报一次
    this._initialized = false;

    // 初始化所有分类为 0
    for (const key of Object.values(STATS_KEYS)) {
      this._counts[key] = 0;
    }
  }

  /** 增加指定分类计数 */
  increment(category, count = 1) {
    if (!(category in this._counts)) return;
    this._counts[category] += count;
    this._scheduleReport();
  }

  /** 批量增加 */
  incrementBy(category, count) {
    if (!(category in this._counts)) return;
    this._counts[category] += count;
    this._scheduleReport();
  }

  /** 设置特定值（用于 DNR 等外部统计） */
  set(category, value) {
    if (!(category in this._counts)) return;
    this._counts[category] = value;
  }

  /** 获取快照 */
  snapshot() {
    return { ...this._counts };
  }

  /** 获取所有分类的当前计数并重置 */
  flush() {
    const snapshot = this.snapshot();
    // 不重置 DNR 计数（由 service worker 管理）
    // 不重置累加型计数
    return snapshot;
  }

  _scheduleReport() {
    const now = Date.now();
    if (now - this._lastReport < this._reportInterval) return;

    this._lastReport = now;

    // 延迟上报，合并短时间内的多次变化
    if (this._reportTimer) clearTimeout(this._reportTimer);
    this._reportTimer = setTimeout(() => this._report(), 100);
  }

  async _report() {
    try {
      await chrome.runtime.sendMessage({
        type: 'REPORT_STATS',
        stats: this.flush(),
      });
    } catch (_) {
      // Service Worker 可能未就绪
    }
  }
}

// 单例
const statsCollector = new StatsCollector();
