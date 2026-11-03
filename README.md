# AI Studio Chat Compressor

[![Tampermonkey Install](https://img.shields.io/badge/Tampermonkey-一键安装-27ae60?logo=tampermonkey&logoColor=white)](https://fujimaodefuji.github.io/aistudio-compressor/aistudio-compressor.user.js)
[![Version](https://img.shields.io/badge/version-v0.4.2-blue.svg)](https://github.com/fujimaodefuji/aistudio-compressor)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

一个专为 Google AI Studio（MakerSuite）设计的智能长对话压缩与分支派生工具（Tampermonkey 用户脚本）。通过高密度结构化记忆提炼，彻底解决长对话导致的 Token 暴增、页面卡顿与关键设定遗忘问题。

---

## 🌟 核心特性

- 💻 **多设备开箱即用 (v0.4.2)**：默认固化调优版【互动叙事 / 关系记忆】预设与中文状态确认语，多台电脑安装即用，无需换设备反复配置。
- 🛡️ **防吞格式优化 (v0.4.2)**：彻底抛弃 HTML 注释 `<!-- -->`，改用显式 `[...]` 结构化占位符，避免内容被 AI Studio 前端渲染引擎当成网页注释隐藏，大幅提升 AI 对各标签提取的精准度。
- 🌐 **全域多账号与 GCP 兼容**：采用全局 `@match https://aistudio.google.com/*` 注入，派生新分支时自动继承 Google 多账号（`/u/0/`、`/u/1/`）与 GCP 工作区（`/projects/<id>/`）前缀，杜绝 404 与权限断联。
- 🌿 **智能记忆切片与分支派生**：支持 `<state_snapshot>` 快照精准提取，配合滑动窗口动态保留尾部历史，一键创建干净、轻量的新会话分支。
- 🎭 **双场景预设自由切换**：
  - `📖 互动叙事 / 关系记忆 (默认)`：重点锁死具体物理场景、体态着装、亲密水温与即时未尽话题，避免触发敏感词审查。
  - `💻 代码开发 / 任务重构`：重点提取顶层架构目标、文件读写状态、已执行操作与待办 Checklist。
- 📡 **RPC 网络请求监控**：底层拦截诊断 `GenerateContent`、`CreatePrompt` 与 `ResolveDriveResource` 等原生请求。

---

## 快速安装与多设备同步

### 1. 安装脚本
在任何电脑（笔记本、台式机）的浏览器上安装好 **Tampermonkey（篡改猴）** 扩展后，点击上方 **[一键安装]** 徽标，或者直接访问以下链接导入：
👉 [安装脚本直链](https://fujimaodefuji.github.io/aistudio-compressor/aistudio-compressor.user.js)

### 2. 使用方法
1. 打开任意 AI Studio 对话页面，页面右上角工具栏会出现文档图标按钮。
2. 对话过长时点击按钮，脚本将自动发送压缩指令。
3. 压缩生成后，脚本会自动提取 XML 快照，派生出携带记忆的新对话分支并自动跳转。

---

## 自定义设置控制台（GitHub Pages）

- **控制台地址**：<https://fujimaodefuji.github.io/aistudio-compressor>
- **配置项说明**：
  - **模板切换**：可在「互动叙事」、「代码任务」或「自定义模式」之间切换。
  - **快照确认应答 (Ack Message)**：自定义分支建立时模型的第一句回复（默认：`（已同步最新状态与记忆快照，随时可以继续。）`）。
  - **快照提取正则 (Regex)**：自定义快照截取规则（默认留空即可自动截取）。
  - **历史裁剪阈值**：自定义尾部历史保留比例与最少保留字符数。

> 💡 **多设备配置提示**：脚本源码已将最佳实践设为默认值，换电脑无需配置。若需个性化修改设置，请在 **AI Studio 网页内** 点击 **Tampermonkey 图标 ->「打开 Compressor 设置...」** 呼出控制台，确保配置可跨域同步写入当前浏览器。

---

## 本地高效调试（开发指南）

推荐使用本地直连加载，保存文件刷新网页即可实时预览：

```javascript
// ==UserScript==
// @name         AI Studio Compressor (Dev Loader)
// @match        https://aistudio.google.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @require      file:///YOUR_LOCAL_PATH/aistudio-compressor/aistudio-compressor.user.js
// ==/UserScript==
