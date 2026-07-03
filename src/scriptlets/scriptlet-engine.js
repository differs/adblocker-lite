/**
 * Scriptlet Injection Engine (v3.0)
 *
 * 注意：所有 window.* 的 API 覆盖（adsbygoogle、fuckadblock、
 * window.open、Worker、setTimeout 等）已在 defense-injector.js
 * 中通过主世界注入完成。这里仅保留：
 *   - uBOL scriptlet 元数据加载（供统计/调试使用）
 *   - 跨世界协调（通过 DOM 事件与主世界通信）
 *
 * 技术来源：uBlock Origin Resources Library + AdGuard Scriptlets
 */

class ScriptletEngine {
  constructor() {
    this.activeScriptlets = [];
  }

  injectAll() {
    // 反检测 API 覆盖已由 defense-injector.js 在主世界完成
    // 这里仅加载 uBOL scriptlet 元数据
    this.loadUBOLScriptletMeta();
  }

  async loadUBOLScriptletMeta() {
    const rulesets = ['ublock-filters', 'easyprivacy', 'ublock-badware'];

    for (const rs of rulesets) {
      try {
        await this._loadMeta(rs, 'main');
        await this._loadMeta(rs, 'isolated');
      } catch (_) {}
    }
  }

  async _loadMeta(rulesetId, type) {
    const url = chrome.runtime.getURL(
      `rulesets/scripting/scriptlet/${type}/${rulesetId}.js`
    );
    const resp = await fetch(url);
    if (!resp.ok) return;
    const text = await resp.text();
    const match = text.match(/\(function uBOL_scriptlets\(\) \{([\s\S]*)\}\)\(\);/);
    if (!match) return;

    const jsonMatches = match[1].match(/'(scriptlet:[^']+)'/g);
    if (jsonMatches) {
      for (const m of jsonMatches) {
        this.activeScriptlets.push(m.replace(/'/g, ''));
      }
    }
  }

  getActiveScriptlets() {
    return this.activeScriptlets;
  }
}

// 自动执行
const scriptletEngine = new ScriptletEngine();
scriptletEngine.injectAll();
