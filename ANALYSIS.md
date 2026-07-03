# AdBlocker Lite 技术深度分析报告

> 分析日期: 2026-07-03
> 分析范围: 全代码库架构、规则引擎、反广告绕过技术
> 对标对象: uBlock Origin (65.9k⭐)、AdGuard、Adblock Plus

---

## 目录

1. [总体评价](#1-总体评价)
2. [架构先进性分析](#2-架构先进性分析)
3. [declarativeNetRequest 规则引擎深度分析](#3-declarativenetrequest-规则引擎深度分析)
4. [反广告绕过能力评估](#4-反广告绕过能力评估)
5. [最新广告封锁对抗技术全景](#5-最新广告封锁对抗技术全景)
6. [技术提升路线图](#6-技术提升路线图)

---

## 1. 总体评价

### 评分矩阵

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构设计 | ★★★★☆ | 多引擎融合思路正确，分层清晰 |
| 规则覆盖 | ★☆☆☆☆ | 仅 86 条规则，uBO 的 0.1% |
| 网络请求拦截 | ★★★☆☆ | DNR 基础用法正确，但未发挥全部能力 |
| 反广告绕过 | ★★☆☆☆ | 基础 scriptlet 注入有，但落后于最新技术 |
| 隐私保护 | ★★★☆☆ | 追踪参数清理方向正确，列表需要扩展 |
| 性能优化 | ★★☆☆☆ | 未使用规则优先级、缓存、批量处理等优化 |
| 代码质量 | ★★★★☆ | 代码规范、注释完整、结构清晰 |

### 核心问题

1. **规则数量严重不足** — 86 条 vs uBlock Origin 的 100 万+ 条规则
2. **反广告绕过手段单一** — 仅覆盖基础检测，无法应对 2025+ 的复杂反制
3. **未利用 DNR 高级特性** — 缺少 `removeParam`、`redirect`、`modifyHeaders` 等 action 的充分发挥
4. **规则集架构落后** — 手动编辑 JSON 而非自动转换工具链

---

## 2. 架构先进性分析

### 2.1 优点: 多引擎融合设计正确

当前架构参考 uBO/AdGuard/ABP 三家技术，方向正确:

```
Content Script 主引擎
├── [1] Scriptlet Engine (uBO 风格) -> JS 反检测注入
├── [2] Cosmetic Engine (uBO 风格) -> 程序化 CSS 隐藏
├── [3] Tracker Stripper (AdGuard 风格) -> URL 参数清理
├── [4] Element Picker (uBO 风格) -> 用户交互隐藏
├── [5] declarativeNetRequest (Chrome C++) -> 网络拦截
└── [6] MutationObserver (All) -> 动态 DOM 监控
```

### 2.2 缺点: 执行时机和深度不足

| 对比项 | AdBlocker Lite | uBlock Origin |
|--------|---------------|---------------|
| 规则引擎 | 86 条静态 DNR | 100 万+ 条多引擎协同 |
| 网络过滤 | 仅 DNR `block` | 静态 + 动态 + JS 过滤引擎 |
| 内容脚本注入时机 | `document_start` 正确 | 更精细的时机控制 |
| HTML 过滤 | 不支持 | $document 规则 |
| CSP 注入 | 不支持 | $csp 规则 |
| removeparam | 只在前端 JS 实现 | DNR 原生 + JS 双保险 |

---

## 3. declarativeNetRequest 规则引擎深度分析

### 3.1 MV3 DNR 配额现状 (2025-2026 Chrome 最新规范)

| 规则类型 | 配额上限 | 说明 |
|---------|---------|------|
| 静态规则集 | **330,000 条** (已扩) | 最多 100 个规则集 |
| 动态规则 | 30,000 条 | 通过 JS 管理 |
| 会话规则 | 30,000 条 | 浏览器关闭时清除 |
| 正则表达式规则 | 2,000 条 | 限静态规则集 |
| 每个规则集 | 至少 10,000 条 | 建议 25,000 条为佳 |

> **关键发现**: Chrome 已将静态规则上限从最初的 30,000 大幅提升至 330,000 条。
> **当前只用 86 条，极度浪费可用配额。**

### 3.2 DNR Action 类型使用情况

| Action 类型 | 用途 | 当前状态 | 建议 |
|------------|------|---------|------|
| `block` | 拦截请求 | 已使用 | 继续使用 |
| `allow` | 放行请求 | 已使用(白名单) | 继续使用 |
| `allowAllRequests` | 放行整个页面 | 未使用 | 强烈建议: 白名单优化 |
| `redirect` | 重定向请求 | 仅 1 条规则 | 强烈建议: 替换广告 JS 为无害 stub |
| `upgradeScheme` | HTTP->HTTPS | 未使用 | 可以考虑 |
| `modifyHeaders` | 修改请求/响应头 | 仅 1 条规则 | 强烈建议: 移除追踪 Header |
| `removeParam` | 移除 URL 参数 | 未使用 | 强烈建议: DNR 原生移除追踪参数 |

### 3.3 当前规则的严重问题

#### 问题 1: `onRuleMatchedDebug` 是 Debug API

```javascript
// 当前代码 - 生产环境不可用
chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => { ... });
```

`onRuleMatchedDebug` **仅在未打包模式下生效**，上架 Chrome Web Store 后完全失效。
需要更换为 `getMatchedRules()` API。

#### 问题 2: 规则粒度过粗

当前示例拦截所有 `doubleclick.net` 请求，包括一些必要的非广告功能。
uBO 的典型做法是使用更精确的路径级别过滤或加上 `^` 结尾分隔符。

#### 问题 3: 未使用 `priority` 体系

所有规则 priority=1，没有建立规则优先级体系。
需要保留高 priority 用于精确规则，低 priority 用于通配规则。

### 3.4 规则集架构: 从 uBO Lite 学习

uBlock Origin Lite 的规则集架构是目前 MV3 的黄金标准:

```
platform/mv3/rulesets.json (配置文件)
├── ublock-filters        -> uBO 内置过滤规则
├── ublock-privacy        -> 隐私保护规则
├── easylist              -> EasyList 广告规则
├── easyprivacy           -> EasyPrivacy 隐私规则
├── ublock-badware        -> 恶意软件防护
├── ublock-quick-fixes    -> 快速修复(高优先级)
├── ublock-unbreak        -> 解决误杀问题
```

核心设计:
1. **规则集拆分**: 按功能分类，用户可以按需启用
2. **自动转换工具**: `make-rulesets.js` 从 EasyList/AdGuard 格式自动生成 DNR JSON
3. **优先级分层**: quick-fixes 用高优先级覆盖旧规则
4. **内容脚本/声明式分离**: DNR 处理网络层，content script 处理 DOM 层

---

## 4. 反广告绕过能力评估

### 4.1 当前覆盖的检测类型

| 检测类型 | 当前应对 | 效果 |
|---------|---------|------|
| FuckAdBlock / BlockAdBlock | injectFuckAdBlock() | 基础覆盖 |
| adsbygoogle 检测 | injectGoogleAdsBypass() | 基础覆盖 |
| 弹窗广告 | injectPopUnderBlocker() | 基础覆盖 |
| 挖矿脚本 | injectCryptoMinerBlocker() | 基础覆盖 |
| setTimeout 轮询检测 | injectSetTimeoutDefuser() | 策略过于简单 |
| 全局变量检测 | injectNoopFunc() | 基础覆盖 |

### 4.2 未覆盖的关键检测技术

| 反广告技术 | 流行度 | 当前状态 | 严重程度 |
|-----------|--------|---------|---------|
| Bait Element 检测 (诱饵元素) | 极高 | 未覆盖 | 致命 |
| getComputedStyle 检测 | 极高 | 未覆盖 | 致命 |
| offsetHeight/offsetParent 检测 | 极高 | 未覆盖 | 致命 |
| Canvas 指纹检测 | 高 | 未覆盖 | 高危 |
| Service Worker 拦截检测 | 高 | 未覆盖 | 高危 |
| fetch + AbortController 检测 | 高 | 未覆盖 | 高危 |
| PerformanceObserver 资源计时 | 高 | 未覆盖 | 高危 |
| IntersectionObserver 可见性 | 中 | 未覆盖 | 中危 |
| MutationObserver 反检测 | 中 | 未覆盖 | 中危 |

---

## 5. 最新广告封锁对抗技术全景

### 5.1 反广告检测技术演进 (2024-2026)

#### 第一代 (基础检测) <-- 当前已覆盖
```
检测方法:
  - 检查 adsbygoogle 是否加载成功
  - 检查特定 DOM 元素是否被隐藏
  - 检查全局变量 (fuckAdBlock, blockAdBlock)
  - 检查 iframe 加载是否失败
```

#### 第二代 (行为检测) <-- 部分覆盖
```
检测方法:
  - Bait Element: 插入对广告拦截器可见的隐藏元素，检查 offsetHeight
  - getComputedStyle: 检查 display:none
  - 定时轮询: setTimeout/setInterval 定期检查
  - 资源加载超时检测
```

#### 第三代 (浏览器 API 检测) <-- 未覆盖
```
检测方法:
  - PerformanceObserver: 检测被拦截资源的加载耗时(0ms 即被拦截)
  - Canvas Fingerprinting: 通过 Canvas 绘制检测环境异常
  - Service Worker: 拦截 SW 注册或消息
  - AbortController: fetch 被 DNR 拦截后会触发 abort
  - IntersectionObserver: 检测广告位元素是否可见
```

#### 第四代 (AI + 行为分析) <-- 未覆盖 (2025/2026 最前沿)
```
检测方法:
  - 机器学习模型分析用户行为模式
  - 动态广告渲染路径(每次不同 class/id 名)
  - 服务端广告注入 (SSR 直接渲染广告 HTML)
  - Cloudflare Turnstile 挑战
  - 广告内容通过 WebSocket 推送
  - 分布式广告网络(去中心化广告加载)
  - WebAssembly 广告检测 (检测代码以 WASM 形式运行)
```

### 5.2 主流反广告检测解决方案分析

#### FuckAdBlock (v3.2.1)
```javascript
// 核心检测逻辑
const bait = document.createElement('div');
bait.className = 'pub_300x250 pub_300x250m pub_728x90';
bait.style = 'width:1px!important;height:1px!important;position:absolute!important;left:-10000px!important;top:-1000px!important;';
document.body.appendChild(bait);

// 如果 offsetHeight == 0 或 offsetParent == null -> 广告拦截器隐藏了它
if (bait.offsetHeight === 0 || bait.offsetParent === null) {
  // 检测到广告拦截器!
}
```

#### PageFair / SourcePoint (2025 主流)
```
技术特点:
  - 使用 CNAME 伪装绕过域名拦截
  - 广告 JS 通过第一方域名提供
  - SSR 直出广告 HTML 到页面
  - 使用 WebSocket 实时传输广告内容
  - 广告位动态 class/id 生成 (每次加载不同)
```

#### Admiral / Mediavine (2025 主流)
```
技术特点:
  - 多层检测: DOM + Performance + timing
  - Canvas 指纹识别唯一用户
  - 持久化检测: localStorage 标记已检测状态
  - Perma-Paywall: 一旦检测到广告拦截器，永久锁定内容
  - 分级应对: 警告 -> 软墙 -> 硬墙
```

#### Youtube 2025 反制方案
```
技术特点:
  - Service Worker 接管视频播放
  - ad_break 通过视频流内嵌(非独立请求)
  - 检测 adblock 扩展的 API 调用
  - 使用 Trusted Types 防止 DOM 篡改
  - Account-based 检测(需要登录)
```

---

## 6. 技术提升路线图

### 阶段一: 规则引擎重构 (1-2 周) -- 最高优先级

#### Step 1: 建立规则自动生成工具链

参考 uBO `platform/mv3/make-rulesets.js`，建立自己的规则转换系统:

```
流程:
  1. 从 uAssets/EasyList/AdGuard 拉取最新规则
  2. 解析传统格式 (||domain.com^, ##.selector, #@# 等)
  3. 转换为 DNR JSON 格式
  4. 规则验证 (去重、冲突检测)
  5. 输出多规则集文件
```

#### Step 2: 规则优先级体系

建议优先级分配:
| 优先级范围 | 用途 |
|-----------|------|
| 100000+ | 精确规则/用户自定义 |
| 50000-99999 | 反误杀规则 (unbreak) |
| 1000-49999 | 高质量域名规则 |
| 1-999 | 通配规则 |

#### Step 3: 全力利用 DNR Action

需要新增的 DNR 规则类型:

1. **removeParam** - 清除追踪参数 (替代 JS 实现)
2. **redirect/stub** - 替换广告 JS 为无害脚本
3. **modifyHeaders** - 移除追踪 Header
4. **allowAllRequests** - 白名单页面放行全部请求

### 阶段二: 反广告绕过引擎升级 (2-3 周)

#### Step 1: 覆盖诱饵元素检测

需要对 HTMLElement.prototype 的以下属性进行拦截:
- `offsetHeight` - 返回假高度
- `offsetWidth` - 返回假宽度
- `offsetParent` - 返回父节点
- `getClientRects` - 返回非空列表
- `getBoundingClientRect` - 返回假区域

#### Step 2: 覆盖 getComputedStyle 检测

对 `window.getComputedStyle` 进行拦截，对含诱饵特征的元素返回 `display:block`。

#### Step 3: PerformanceObserver 反检测

对 `Performance.getEntriesByType('resource')` 进行拦截，隐藏被拦截资源的记录。

#### Step 4: Canvas 指纹保护

对 `HTMLCanvasElement.prototype.toDataURL` 和 `toBlob` 添加随机噪点干扰。

### 阶段三: 隐私保护升级 (1 周)

#### 增强追踪参数清理

当前 `tracker-params.js` 有 30+ 种参数，需要扩展至 100+。

#### 添加 DNR 原生 removeParam

利用 `modifyHeaders` 和 `redirect` transform 在 DNR 层清理。

#### 添加 Cookie 清理

在内容脚本中增加 `document.cookie` 的第三分方 Cookie 拦截。

### 阶段四: 性能优化 (1 周)

1. **规则合并**: 将相同 action 的域名合并为 `urlFilter` 数组
2. **通配符优化**: 使用 `||domain.com^` 替代 `*/ads/*`
3. **规则集拆分**: 按功能拆分为 5-10 个规则集
4. **增加 noopjs/redirect 资源**: 建立资源库替换广告 JS

### 技术方案总结

```
短期(1-2周):
  - 建立自动规则转换工具链
  - 从 86 条 扩展到 5000+ 条核心规则
  - 修复 onRuleMatchedDebug 问题
  - 增加 redirect/modifyHeaders action

中期(2-4周):
  - 覆盖诱饵元素/ComputedStyle/Performance 检测
  - 扩展到 30000+ 条规则
  - 增加 Canvas 指纹保护
  - Cookie 清理功能

长期(1-2月):
  - WebSocket 广告拦截
  - Service Worker 反拦截
  - 动态规则更新系统
  - 用户自定义规则 UI
```
