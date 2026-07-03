# AdBlocker Lite

> 基于 Manifest V3 declarativeNetRequest 的广告拦截扩展  
> 融合 **uBlock Origin** × **AdGuard** × **EasyList** 三家技术体系  
> 16 层反广告检测防御 + 18,000+ 条 DNR 规则

---

## 目录

- [架构总览](#架构总览)
- [双世界防御模型](#双世界防御模型)
- [规则引擎](#规则引擎)
- [反广告检测防御体系](#反广告检测防御体系)
- [项目结构](#项目结构)
- [安装使用](#安装使用)
- [构建规则](#构建规则)
- [技术对比](#技术对比)
- [许可协议](#许可协议)

---

## 架构总览

AdBlocker Lite 不是"从零重写"的广告拦截器，而是深度研究三家主流方案后做的融合实现：

```
┌──────────────────────────────────────────────────────────────────┐
│                     AdBlocker Lite                                 │
├───────────────────────┬──────────────────────────────────────────┤
│   网络层 (Chrome C++)  │   执行层 (Content Script)                 │
│                       │                                          │
│  declarativeNetRequest│  ┌─ defense-injector.js  (主世界 16 防御) │
│                       │  ├─ cosmetic-engine.js   (CSS + 程序化)   │
│  6 个静态规则集        │  ├─ anti-adblock-engine  (prototype 操纵) │
│  18,249 条 DNR 规则    │  ├─ tracker-params.js    (URL 追参清理)   │
│  36 个 redirect 资源   │  ├─ picker                (元素选择器)    │
│                       │  └─ content.js            (引擎协调)      │
├───────────────────────┴──────────────────────────────────────────┤
│  规则来源：uBO Lite (uBOL) 构建工具链                             │
│  自动从 EasyList / EasyPrivacy / uAssets 拉取并转换               │
└──────────────────────────────────────────────────────────────────┘
```

### 执行流水线

```
document_start                    DOMContentLoaded
    │                                    │
    ├─ defense-injector.js               │
    │   └── <script> 注入主世界           ├─ activateAll()
    │       │                            │   ├─ ResourceTiming 过滤
    │       ├─ offsetHeight/Width/Parent  │   └─ MutationObserver 保护
    │       ├─ getComputedStyle          │
    │       ├─ Canvas/WebGL 噪点         ├─ new AdBlockerContent()
    │       ├─ PerformanceObserver 过滤   │   └─ MutationObserver 启动
    │       ├─ fetch Abort 假 200        │
    │       ├─ IntersectionObserver      ├─ cosmetic-engine.js
    │       ├─ adsbygoogle bypass        │   ├─ 基础 CSS (同步)
    │       ├─ fuckadblock bypass        │   ├─ uBOL CSS (异步)
    │       ├─ popunder/miner 拦截       │   └─ 程序化广告检测
    │       ├─ setInterval 降频          │
    │       └─ document.createElement    ├─ tracker-params.js
    │                                    │   ├─ stripAllLinks()
    └─ anti-adblock-engine.js            │   └─ XHR hook
        └─ 定义 singleton                │
                                         └─ scriptlet-engine.js
    └─ scriptlet-engine.js                  └─ uBOL 元数据加载
        └─ 定义 singleton
```

---

## 双世界防御模型

这是本项目的核心技术决策。Chrome MV3 中，content script 运行在 **isolated world**，与页面脚本所在的 **main world** 有独立的全局作用域。

| 操作 | Isolated World | Main World (通过 `<script>` 注入) |
|------|---------------|----------------------------------|
| `window.fetch` | ❌ 只影响 content script | ✅ 影响页面请求 |
| `window.open` | ❌ 只影响 content script | ✅ 拦截页面弹窗 |
| `HTMLElement.prototype` | ✅ 共享原型 | ✅ 共享原型 |
| `window.getComputedStyle` | ❌ 独立作用域 | ✅ 影响页面检测 |
| `Performance.prototype` | ✅ 共享原型 | ✅ 共享原型 |
| `MutationObserver.prototype` | ✅ 共享原型 | ✅ 共享原型 |

因此我们采用**双文件分层防御**：

```
defense-injector.js       → 主世界注入（<script> 标签）
  ├─ 页面全局 API 覆盖    → window.fetch, window.open, window.Worker
  ├─ 页面对象属性覆盖     → getComputedStyle, adsbygoogle
  └─ 共享原型操作         → HTMLElement, Canvas, WebGL, Performance

anti-adblock-engine.js    → 隔离世界运行
  ├─ 共享原型操作         → Performance.prototype, MutationObserver.prototype
  └─ 跨世界协调           → WeakSet 追踪
```

---

## 规则引擎

### 6 个核心规则集

从 uBO Lite (uBOL) 构建工具链自动生成，覆盖广告拦截、隐私保护、恶意软件防护：

| 规则集 | DNR 规则数 | CSS 规则数 | 来源 | 说明 |
|--------|-----------|-----------|------|------|
| `ublock-filters` | 5,349 | 5,854 | uBO uAssets | 广告 + 追踪 + 恶意软件 |
| `easylist` | 3,663 | 20,512 | EasyList | 标准广告过滤 |
| `easyprivacy` | 8,830 | 6 | EasyPrivacy | 隐私追踪保护 |
| `pgl` | 1 | 0 | Peter Lowe | 广告/追踪服务器列表 |
| `ublock-badware` | 405 | 227 | uBO | 恶意网站 |
| `urlhaus-full` | 1 | 0 | URLhaus | 恶意 URL |
| **合计** | **18,249** | **26,599** | | |

### 完整规则利用

除了 DNR 网络拦截规则，还有三套补充规则：

```
rulesets/
├── main/*.json          → 18,249 条 DNR 规则（C++ 层匹配）
├── regex/*.json         →   正则规则（复杂 URL 匹配）
├── urlskip/*.json       →   URL 参数清理规则
└── scripting/
    ├── generic/*.js     →   通用 CSS 隐藏规则
    ├── specific/*.json  →   站点特定 CSS 规则（按 hostname 加载）
    └── scriptlet/*.js   →   JS 注入脚本（元数据提取）
```

### 构建规则

```bash
# 从 uBO Lite 拉取并转换最新规则
node scripts/build-rules.mjs
```

构建流程：
1. 自动 clone/pull uBlock Origin 源码
2. 运行 `make-rulesets.js` 转换引擎
3. 将 EasyList / uAssets 等原始规则转换为 DNR JSON
4. 输出到 `rulesets/` 和 `web_accessible_resources/`

---

## 反广告检测防御体系

覆盖 16 种检测技术，全部通过主世界注入在页面脚本运行前生效：

### DOM 层防御（5 层）

| # | 防御 | 对抗目标 | 实现 |
|---|------|---------|------|
| 1 | **offsetHeight/Width** | 诱饵元素尺寸检测 | 拦截 `HTMLElement.prototype` getter，对隐藏/诱饵元素返回 250x300 |
| 2 | **offsetParent** | 元素在文档流中可见性 | 对隐藏元素返回 `document.body` |
| 3 | **getBoundingClientRect** | 广告位坐标检测 | 伪装为视口内正常位置 |
| 4 | **getComputedStyle** | `display:none` 检测 | 通过 Proxy 拦截，返回 `block` / `visible` |
| 5 | **IntersectionObserver** | 广告位可见性 | 替换构造函数，回调中篡改为 `isIntersecting: true` |

### 指纹层防御（3 层）

| # | 防御 | 对抗目标 | 实现 |
|---|------|---------|------|
| 6 | **Canvas toDataURL** | Canvas 指纹哈希 | 小画布或透明画布的 base64 数据中随机改 1 字节 (XOR 1) |
| 7 | **Canvas getImageData** | 像素级指纹 | 每 80 个像素改 1 字节 |
| 8 | **WebGL getParameter** | 显卡型号指纹 | 统一返回 `Intel Inc.` / `Intel Iris OpenGL Engine` |

### 性能层防御（2 层）

| # | 防御 | 对抗目标 | 实现 |
|---|------|---------|------|
| 9 | **Performance.getEntriesByType** | 资源加载检测 (0ms = 被拦截) | 过滤 `duration===0` 的广告 URL entry |
| 10 | **PerformanceObserver** | 实时资源监听 | 包装回调，过滤拦截资源 |

### 网络层防御（2 层）

| # | 防御 | 对抗目标 | 实现 |
|---|------|---------|------|
| 11 | **fetch Abort** | DNR 拦截导致的 AbortError | catch 中返回 `Response('', {status:200})` |
| 12 | **XHR 追参清理** | URL 追踪参数 | `XMLHttpRequest.prototype.open` hook |

### Scriptlet 层防御（4 层）

| # | 防御 | 对抗目标 | 实现 |
|---|------|---------|------|
| 13 | **adsbygoogle bypass** | Google Ads 检测 | 拦截 `push` 调用，模拟广告加载成功 |
| 14 | **fuckadblock bypass** | FuckAdBlock / BlockAdBlock | 覆盖 `prototype.isDetected`，设置全局变量 |
| 15 | **popunder/miner** | 弹窗 + 加密货币挖矿 | 拦截 `window.open` + `Worker` 构造函数 |
| 16 | **setInterval 降频** | 反广告轮询检测 | `fn.toString()` 检测关键词，降频至 5 秒 |

### 辅助防御

| 防御 | 说明 |
|------|------|
| **navigator.webdriver** | 隐藏自动化标记 |
| **Trusted Types** | 创建默认 policy 允许 CSS/JS 注入 |
| **document.createElement('a')** | 拦截自动点击广告链接 |

---

## 项目结构

```
adblocker-lite/
├── manifest.json                    # MV3 扩展清单
├── scripts/
│   └── build-rules.mjs              # uBOL 规则构建工具
├── rulesets/                        # uBO Lite 生成的规则集
│   ├── main/                        # DNR 网络拦截规则（6 个核心集）
│   ├── regex/                       # 正则规则
│   ├── urlskip/                     # URL 参数清理
│   └── scripting/                   # CSS + scriptlet 注入
│       ├── generic/                 # 通用 CSS 规则
│       ├── specific/                # 站点特定 CSS 规则
│       └── scriptlet/               # JS 注入脚本
├── web_accessible_resources/        # redirect 替代资源（36 个）
├── src/
│   ├── anti-adblock/
│   │   ├── defense-injector.js      # 主世界注入（16 种防御）
│   │   └── anti-adblock-engine.js   # 隔离世界防御
│   ├── background/
│   │   └── service_worker.js        # DNR 规则管理 + 统计
│   ├── content/
│   │   └── content.js               # 引擎协调
│   ├── scriptlets/
│   │   └── scriptlet-engine.js      # uBOL 元数据加载
│   ├── cosmetic/
│   │   └── cosmetic-engine.js       # CSS 注入 + 程序化检测
│   ├── anti-tracking/
│   │   └── tracker-params.js        # URL 追踪参数清理
│   ├── picker/
│   │   └── element-picker.js        # 可视化元素选择器
│   └── popup/
│       ├── popup.html               # 弹出窗口
│       ├── popup.css
│       └── popup.js
├── assets/icons/                    # 扩展图标
└── generate-icons.html              # 图标生成工具
```

### 文件职责

| 文件 | 定位 | 执行环境 | 执行时机 |
|------|------|---------|---------|
| `defense-injector.js` | 反检测主引擎 | Main World (via `<script>`) | `document_start` |
| `anti-adblock-engine.js` | 反检测辅助 | Isolated World | `DOMContentLoaded` |
| `cosmetic-engine.js` | CSS 隐藏 + 程序化检测 | Isolated World | `document_start` |
| `scriptlet-engine.js` | uBOL 元数据 | Isolated World | `document_start` |
| `tracker-params.js` | URL 追踪清理 | Isolated World | `document_start` |
| `content.js` | 引擎协调 | Isolated World | `DOMContentLoaded` |
| `service_worker.js` | DNR 管理 + 统计 | Service Worker | `onInstalled` / `onStartup` |

---

## 安装使用

### 开发模式加载

```bash
git clone git@github.com:differs/adblocker-lite.git
cd adblocker-lite
```

1. 打开 Chrome → `chrome://extensions/`
2. 开启 **开发者模式**（右上角）
3. 点击 **加载已解压的扩展程序**
4. 选择 `adblocker-lite` 目录

### 验证拦截效果

打开开发者工具 → Network 面板，过滤 `ERR_BLOCKED_BY_CLIENT`：

```
https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js  → ERR_BLOCKED_BY_CLIENT
https://www.googletagmanager.com/gtag/js?id=UA-XXXXX           → ERR_BLOCKED_BY_CLIENT
https://connect.facebook.net/en_US/fbevents.js                  → ERR_BLOCKED_BY_CLIENT
```

### 更新规则

```bash
# 需要 Node.js 18+
node scripts/build-rules.mjs
```

重新加载扩展即可使用最新规则（Chrome 扩展管理页 → 🔄 刷新按钮）。

---

## 技术对比

| 特性 | AdBlocker Lite | uBlock Origin v2 | uBlock Origin Lite |
|------|---------------|-------------------|-------------------|
| 架构版本 | MV3 | MV2 | MV3 |
| 规则引擎 | declarativeNetRequest | 自研静态网络过滤 | declarativeNetRequest |
| 规则数量 | 18,000+ DNR + 26,000+ CSS | 100,000+ | ~20,000 DNR |
| 执行模型 | 双世界（主世界 + 隔离世界） | 阻塞式 webRequest | 声明式 + scripting API |
| 反广告检测 | 16 层全主世界注入 | scriptlet 完整库 | scriptlet 有限支持 |
| 元素隐藏 | CSS StyleSheet + 程序化检测 | CSS + 程序化 | CSS + 程序化 |
| 动态过滤 | 白名单 + DNR 规则集切换 | 完整动态防火墙 | 规则集切换 |
| 构建工具 | `scripts/build-rules.mjs` | 自研 make 工具链 | 内置 make-rulesets.js |
| 最小 Chrome 版本 | 120 | 不限 | 120 |
| 适合场景 | MV3 学习 + 日常使用 | 日常使用（即将淘汰） | 日常使用 |

---

## 许可协议

MIT

本项目使用了 uBlock Origin 的规则转换工具链和规则集数据，uBlock Origin 采用 GPL-3.0 协议。
