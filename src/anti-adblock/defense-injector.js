/**
 * Anti-Adblock Defense Injector
 *
 * 将反检测脚本注入到页面的主世界（main world）中执行，
 * 确保在网站脚本运行之前完成所有 API hook。
 *
 * 注入方式（绕过 CSP）：
 *   防御代码在 web_accessible_resources/defense.js 中，
 *   通过 <script src="chrome-extension://.../defense.js"> 加载。
 *   chrome-extension:// 协议在大部分网站的 CSP script-src 白名单中。
 *
 * Chrome MV3 中，content script 运行在 isolated world，
 * 无法直接修改页面中的 window、HTMLElement.prototype 等。
 * 必须通过 <script> 标签注入到主世界。
 *
 * 注入时机：document_start（在 content script 加载时立即注入）
 */

const DEFENSE_SCRIPT_URL = chrome.runtime.getURL('web_accessible_resources/defense.js');

class DefenseInjector {
  constructor() {
    this._injected = false;
  }

  inject() {
    if (this._injected) return;
    this._injected = true;

    try {
      const script = document.createElement('script');
      script.src = DEFENSE_SCRIPT_URL;
      script.id = '__adblocker_defense';
      script.async = false;
      document.documentElement.appendChild(script);
    } catch (e) {
      console.error('[DefenseInjector] 注入失败:', e.message);
    }

    console.debug('[DefenseInjector] 主世界防御脚本已注入:', DEFENSE_SCRIPT_URL);
  }
}

const defenseInjector = new DefenseInjector();

if (document.documentElement) {
  defenseInjector.inject();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    defenseInjector.inject();
  }, { once: true });
}
