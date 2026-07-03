/**
 * Element Picker - 可视化元素选择器
 *
 * 技术来源：uBlock Origin Element Picker + AdGuard Element Blocker
 * 作用：用户点击页面元素来隐藏广告，生成对应的选择器规则
 */

class ElementPicker {
  constructor() {
    this.active = false;
    this.target = null;
    this.highlight = null;
    this.overlay = null;
    this.onPick = null;
  }

  /**
   * 启动元素选择模式
   */
  start(onPick) {
    if (this.active) return;

    this.onPick = onPick || ((selector) => {
      console.log('[AdBlocker] 用户选择隐藏:', selector);
      this.hideElement(selector);
    });

    this.active = true;
    this.createOverlay();
    this.createHighlight();
    this.attachEvents();

    document.body.style.cursor = 'crosshair';

    // 提示用户
    this.showToast('点击要隐藏的广告元素');
  }

  /**
   * 停止选择模式
   */
  stop() {
    if (!this.active) return;

    this.active = false;
    this.removeOverlay();
    this.removeHighlight();
    this.detachEvents();

    document.body.style.cursor = '';
    this.hideToast();
  }

  // ============================================================
  // 覆盖层（高亮 + 遮罩）
  // ============================================================
  createOverlay() {
    // 半透明遮罩层
    this.overlay = document.createElement('div');
    this.overlay.id = '__abp_picker_overlay';
    this.overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      z-index: 2147483646;
      pointer-events: none;
    `;
    document.body.appendChild(this.overlay);
  }

  createHighlight() {
    this.highlight = document.createElement('div');
    this.highlight.id = '__abp_picker_highlight';
    this.highlight.style.cssText = `
      position: fixed;
      border: 3px solid #FF4444;
      background: rgba(255, 68, 68, 0.1);
      z-index: 2147483647;
      pointer-events: none;
      transition: all 0.1s ease;
      display: none;
    `;
    document.body.appendChild(this.highlight);
  }

  removeOverlay() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  removeHighlight() {
    if (this.highlight) {
      this.highlight.remove();
      this.highlight = null;
    }
  }

  // ============================================================
  // 事件处理
  // ============================================================
  attachEvents() {
    this._onMouseMove = this.onMouseMove.bind(this);
    this._onClick = this.onClick.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);

    document.addEventListener('mousemove', this._onMouseMove, true);
    document.addEventListener('click', this._onClick, true);
    document.addEventListener('keydown', this._onKeyDown, true);
  }

  detachEvents() {
    document.removeEventListener('mousemove', this._onMouseMove, true);
    document.removeEventListener('click', this._onClick, true);
    document.removeEventListener('keydown', this._onKeyDown, true);
  }

  onMouseMove(e) {
    if (!this.active) return;

    // 获取鼠标下的元素
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === document.body || el === document.documentElement) {
      this.highlight.style.display = 'none';
      this.target = null;
      return;
    }

    this.target = el;
    const rect = el.getBoundingClientRect();

    this.highlight.style.display = 'block';
    this.highlight.style.left = rect.left + 'px';
    this.highlight.style.top = rect.top + 'px';
    this.highlight.style.width = rect.width + 'px';
    this.highlight.style.height = rect.height + 'px';
  }

  onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (!this.target) return;

    const selector = this.generateSelector(this.target);
    this.onPick(selector, this.target);
    this.stop();
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      this.stop();
    }
  }

  // ============================================================
  // 选择器生成
  // ============================================================
  generateSelector(el) {
    // 策略 1: 使用 ID
    if (el.id) {
      return '#' + CSS.escape(el.id);
    }

    // 策略 2: 使用唯一 class
    const classes = Array.from(el.classList)
      .filter(c => !c.startsWith('__abp') && !c.startsWith('adblock'))
      .slice(0, 3);

    if (classes.length > 0) {
      const selector = '.' + classes.map(c => CSS.escape(c)).join('.');
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    }

    // 策略 3: 使用路径 + 属性
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;

    if (parent) {
      const siblings = Array.from(parent.children).filter(
        c => c.tagName === el.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(el) + 1;
        return this.generateSelector(parent) + ' > ' + tag + ':nth-child(' + index + ')';
      }
      return this.generateSelector(parent) + ' > ' + tag;
    }

    return tag;
  }

  // ============================================================
  // 隐藏元素
  // ============================================================
  hideElement(selector) {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        el.style.setProperty('display', 'none', 'important');
        el.dataset.__abp_user_hidden = 'true';
      });

      // 通知 background 保存规则
      chrome.runtime.sendMessage({
        type: 'ADD_USER_RULE',
        selector: selector
      });

      this.showToast(`已隐藏: ${selector}`);
    } catch (e) {
      this.showToast('选择器无效，请重试');
    }
  }

  // ============================================================
  // Toast 提示
  // ============================================================
  showToast(msg) {
    const existing = document.getElementById('__abp_toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = '__abp_toast';
    toast.textContent = msg;
    toast.style.cssText = `
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      background: #333; color: #fff; padding: 10px 20px;
      border-radius: 8px; font-size: 14px; z-index: 2147483647;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      font-family: -apple-system, sans-serif;
    `;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
  }

  hideToast() {
    const toast = document.getElementById('__abp_toast');
    if (toast) toast.remove();
  }
}

// 导出单例
const elementPicker = new ElementPicker();

// 监听来自 popup/background 的激活指令
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ACTIVATE_PICKER') {
    elementPicker.start((selector, el) => {
      // 回调：用户选择了一个元素
      sendResponse({ success: true, selector });
    });
    return true;
  }
});
