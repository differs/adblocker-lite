# AdBlocker Lite - 多引擎融合广告拦截器

> 融合 **uBlock Origin** × **AdGuard** × **Adblock Plus** 三家技术的拦截引擎

## 项目背景

本项目是学习 Chrome 广告拦截技术的实战产物，但并非"从零重写"，而是**深度研究 uBlock Origin（65.9k⭐）、AdGuard、Adblock Plus 三家技术方案后，取其精华做的融合实现**。

## 多引擎架构

```
┌─────────────────────────────────────────────────────────────┐
│                     AdBlocker Lite                            │
├─────────────────────────────────────────────────────────────┤
│  ① declarativeNetRequest (Chrome C++ 引擎)                   │
│     ├─ EasyList (Adblock Plus) — 广告网络域名拦截             │
│     ├─ EasyPrivacy (Adblock Plus) — 追踪器域名拦截            │
│     └─ Anti-Adblock (自研) — 反广告检测脚本拦截               │
│                                                               │
│  ② Scriptlet Injection Engine (uBlock Origin)                │
│     ├─ google-ads bypass — 模拟广告JS正常运行                 │
│     ├─ fuckadblock bypass — 绕过反广告检测                    │
│     ├─ popunder blocker — 拦截弹窗                            │
│     ├─ miner blocker — 拦截加密货币挖矿                      │
│     ├─ setTimeout defuser — 降频反广告轮询                    │
│     └─ navigator override — 防止浏览器指纹追踪                │
│                                                               │
│  ③ Procedural Cosmetic Filter (uBlock Origin)                │
│     ├─ 基于计算属性的广告检测（不依赖 class/id）               │
│     ├─ 固定定位广告检测                                       │
│     ├─ 第三方 iframe 广告检测                                  │
│     ├─ 标准广告尺寸检测（728x90, 300x250 等）                 │
│     └─ CSS StyleSheet 注入（性能优于 inline style）            │
│                                                               │
│  ④ URL Tracker Stripper (AdGuard)                            │
│     ├─ 移除 50+ 种追踪参数 (utm_*, fbclid, gclid 等)         │
│     ├─ 拦截 fetch/XMLHttpRequest 清理参数                     │
│     └─ 批量清理页面链接                                       │
│                                                               │
│  ⑤ Element Picker (uBlock Origin)                            │
│     ├─ 可视化元素选择器                                       │
│     ├─ 智能选择器生成（ID > Class > 路径）                    │
│     └─ 用户自定义隐藏规则                                     │
│                                                               │
│  ⑥ MutationObserver (All) — 动态广告监控                      │
└─────────────────────────────────────────────────────────────┘
```

## 功能特性

### 拦截层（C++)
- ✅ **declarativeNetRequest 规则拦截** — 86+ 条规则，C++ 层高性能匹配
- ✅ **网络请求拦截** — 拦截 Google/Facebook/Amazon 等广告网络
- ✅ **隐私追踪保护** — 屏蔽 Hotjar、Mixpanel、NewRelic 等分析工具

### 执行层（JS）
- ✅ **反广告检测绕过** — 模拟 adsbygoogle、绕过 FuckAdBlock 检测
- ✅ **程序化广告过滤** — 基于元素尺寸/位置判断广告，不依赖 CSS class
- ✅ **弹窗拦截** — 覆盖 window.open，自动过滤广告弹窗
- ✅ **挖矿拦截** — 拦截 Coinhive 等加密货币挖矿脚本
- ✅ **动态广告监控** — MutationObserver 实时捕获动态加载的广告

### 隐私层
- ✅ **URL 追踪参数清理** — 移除 utm_*, fbclid, gclid 等 50+ 参数
- ✅ **链接批量清理** — 清除页面所有链接中的追踪参数
- ✅ **请求拦截清理** — 在 fetch/XHR 发出前清除追踪参数

### 交互层
- ✅ **元素选择器** — 用户点击广告元素即可隐藏
- ✅ **白名单管理** — 为信任网站放行
- ✅ **拦截统计** — 实时显示拦截数量和效果

## 技术来源

| 技术 | 来源 | 说明 |
|------|------|------|
| declarativeNetRequest 规则 | Adblock Plus EasyList/EasyPrivacy | 标准广告过滤规则集 |
| Scriptlet Injection | uBlock Origin Resources Library | 反检测 JS 注入 |
| Procedural Cosmetic Filter | uBlock Origin | 程序化元素隐藏 |
| URL Tracker Stripper | AdGuard URL Tracking Protection | URL 追踪参数清理 |
| Element Picker | uBlock Origin | 可视化元素选择器 |
| CSS 选择器 | Adblock Plus | 标准 CSS 元素隐藏 |

## 项目结构

```
adblocker-lite/
├── manifest.json                    # 扩展清单（MV3）
├── scripts/
│   └── build-rules.mjs              # uBOL 规则构建工具
├── rulesets/                        # uBO Lite 生成的规则集
│   ├── main/                        # DNR 网络拦截规则（6个核心集）
│   │   ├── ublock-filters.json      #   5,540 条
│   │   ├── easylist.json            #   3,683 条
│   │   ├── easyprivacy.json         #   8,837 条
│   │   ├── pgl.json                 #   1 条（域名列表）
│   │   ├── ublock-badware.json      #   419 条
│   │   └── urlhaus-full.json        #   1 条（域名列表）
│   ├── regex/                       # 正则规则
│   ├── urlskip/                     # URL 参数清理规则
│   └── scripting/                   # CSS + scriptlet 注入文件
│       ├── generic/                 #   通用 CSS 隐藏规则
│       ├── specific/                #   站点特定 CSS 规则
│       └── scriptlet/               #   JS 注入脚本
├── web_accessible_resources/        # 替代资源（redirect 用）
├── src/
│   ├── background/
│   │   └── service_worker.js        # 后台 Service Worker
│   ├── content/
│   │   └── content.js               # 主引擎（融合调度）
│   ├── scriptlets/
│   │   └── scriptlet-engine.js      # Scriptlet 引擎（uBO 增强）
│   ├── cosmetic/
│   │   └── cosmetic-engine.js       # 程序化过滤 + uBOL CSS 加载
│   ├── anti-tracking/
│   │   └── tracker-params.js        # URL 追踪清理（AdGuard）
│   ├── picker/
│   │   └── element-picker.js        # 元素选择器（uBO）
│   └── popup/
│       ├── popup.html               # 弹出窗口 UI
│       ├── popup.css                # 样式
│       └── popup.js                 # UI 逻辑
├── assets/
│   └── icons/                       # 扩展图标
├── generate-icons.html              # 图标生成工具
└── README.md
```

## 规则集

### EasyList (40 条规则)
拦截主流广告网络：
- Google Ads (doubleclick, googlesyndication, googleadservices)
- Facebook Ads
- Amazon Ads
- Taboola / Outbrain（原生广告）
- Criteo / TheTradeDesk（重定向广告）
- 通用广告路径模式

### EasyPrivacy (28 条规则)
保护用户隐私，拦截：
- 用户行为分析（Hotjar, FullStory, MouseFlow）
- 数据分析（Mixpanel, Amplitude, Segment）
- A/B 测试（Optimizely, VWO）
- 性能监控（NewRelic, Datadog）
- 社交追踪（LinkedIn Ads, Twitter, TikTok）

### Anti-Adblock (18 条规则)
反制广告拦截检测：
- 拦截反广告检测脚本
- 阻止广告恢复提示
- 隐藏反广告弹窗

## 安装使用

### 开发模式加载

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启 **开发者模式**（右上角）
3. 点击 **加载已解压的扩展程序**
4. 选择本项目目录

### 生成图标

1. 在浏览器打开 `generate-icons.html`
2. 点击生成按钮
3. 下载图标文件到 `assets/icons/` 目录
4. 重新加载扩展

### 验证拦截效果

访问任意含有广告的网站（如新闻门户），打开开发者工具：
- Network tab 过滤 `ERR_BLOCKED_BY_CLIENT` 查看拦截的请求
- 观察页面上广告位是否消失

## 扩展开发

### 添加自定义规则

编辑 `rules/easy-list.json`，添加新规则：

```json
{
  "id": 2000,
  "priority": 1,
  "action": { "type": "block" },
  "condition": {
    "urlFilter": "||newadnetwork.com",
    "resourceTypes": ["script", "image"]
  }
}
```

### 添加动态规则（通过 popup 白名单）

在弹窗的「白名单」tab 中输入域名即可添加永久允许规则。

## 与 uBlock Origin 对比

| 特性 | AdBlocker Lite v2 | uBlock Origin v2 |
|------|------------------|-----------------|
| ⭐ Stars | 学习项目 | 65.9k |
| MV 版本 | MV3 | MV2 (即将停止支持) |
| 规则引擎 | declarativeNetRequest (uBOL 规则集) | 自研静态网络过滤引擎 |
| 规则数量 | ~18,000 条 DNR + ~26,000 CSS | 10 万+ |
| 动态过滤 | 基础白名单 + uBOL 规则集 | 完整动态防火墙 |
| 程序化过滤 | 基于元素尺寸/位置检测 | 基于元素尺寸/位置检测 |
| 反广告绕过 | uBO 风格 scriptlet + 增强 bypass | uBO 完整 scriptlet 库 |
| 构建工具 | scripts/build-rules.mjs (uBOL 流水线) | 自研构建工具 |
| 适合场景 | 学习 MV3 + 日常使用 | 日常使用 |

## 学习资源

- [Chrome 广告拦截技术深度解析博客](./../../blogs/03-adblock-declarative-net-request.md)
- [Chrome Extensions declarativeNetRequest 官方文档](https://developer.chrome.google.cn/docs/extensions/reference/declarativeNetRequest)
- [uBlock Origin 源码](https://github.com/gorhill/uBlock)
- [Replace Google CDN (declarativeNetRequest 示例)](https://github.com/justjavac/ReplaceGoogleCDN)

## License

MIT
