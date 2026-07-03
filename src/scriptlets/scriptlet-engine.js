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
    // ublock-badware 没有 isolated scriptlet，跳过
    const rulesets = [
      { id: 'ublock-filters', types: ['main', 'isolated'] },
      { id: 'easyprivacy',    types: ['main', 'isolated'] },
      { id: 'ublock-badware', types: ['main'] },  // 只有 main
    ];

    for (const rs of rulesets) {
      for (const type of rs.types) {
        try {
          await this._loadMeta(rs.id, type);
        } catch (_) {}
      }
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
