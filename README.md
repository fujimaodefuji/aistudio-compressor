# AI Studio Chat Compressor

[![Tampermonkey Install](https://img.shields.io/badge/Tampermonkey-一键安装-27ae60?logo=tampermonkey&logoColor=white)](https://fujimaodefuji.github.io/aistudio-compressor/aistudio-compressor.user.js)
[![Version](https://img.shields.io/badge/version-v0.4.3-blue.svg)](https://github.com/fujimaodefuji/aistudio-compressor)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

一个专为 Google AI Studio（MakerSuite）桌面端设计的智能长对话压缩与分支派生工具（Tampermonkey 用户脚本）。通过高密度结构化记忆提炼，彻底解决长对话导致的 Token 暴增、页面卡顿与关键设定遗忘问题。

> ⚠️ **运行环境限制**：本脚本深度依赖 Chromium 底层机制，目前**仅完美支持 PC 桌面端浏览器（Windows / Mac 的 Chrome 或 Edge）**。不支持 iOS Safari 等移动端严格沙箱环境。

---

## 🌟 核心特性

- 💻 **多设备开箱即用 (v0.4.3)**：默认内置并固化【互动叙事 / 关系记忆】最优预设与中文状态确认语，多台电脑一键安装即用，免去重复配置。
- 🛡️ **防吞格式优化 (v0.4.3)**：彻底抛弃 HTML 注释 `<!-- -->`，改用显式 `[...]` 结构化占位符，完美防止内容被 AI Studio 前端渲染引擎当成网页注释隐藏。
- ✂️ **纯净记忆提取 (v0.4.3)**：内置强大的正则兜底逻辑，自动切除大模型前置的思考草稿（Scratchpad），只将最纯净的 `<state_snapshot>` 记忆块带入新分支。
- 🌐 **全域多账号与 GCP 兼容**：派生新分支时自动继承 Google 多账号（`/u/0/`、`/u/1/`）与 GCP 工作区（`/projects/<id>/`）前缀，杜绝 404 与权限断联。
- 🌿 **智能记忆切片与无缝派生**：提取 XML 快照的同时，配合滑动窗口动态保留尾部历史对话，一键创建干净、轻量的新会话分支。
- 🎭 **双场景预设自由切换**：内置【互动叙事】与【代码工程】两套成熟提示词，支持在控制台热切换。

---

## 快速安装与使用

### 1. 安装脚本
在电脑的 Chrome 或 Edge 浏览器上安装好 **Tampermonkey（篡改猴）** 扩展后，点击上方 **[一键安装]** 徽标，或者直接访问以下链接导入：
👉 [安装脚本直链](https://fujimaodefuji.github.io/aistudio-compressor/aistudio-compressor.user.js)

### 2. 使用方法
1. 打开任意 AI Studio 对话页面，页面右上角工具栏会出现蓝色的 **📄 文档图标按钮**。
2. 当当前对话 Token 过长、需要清理时，点击该按钮，脚本将自动发送压缩指令。
3. 压缩生成后，脚本会自动提取 XML 快照，派生出携带短记忆的新对话分支并自动跳转，无缝续写！

---

## 自定义设置控制台（GitHub Pages）

- **控制台地址**：<https://fujimaodefuji.github.io/aistudio-compressor>
- **配置项说明**：
  - **模板切换**：一键切换叙事模板或代码重构模板，支持完全自定义。
  - **快照确认应答 (Ack Message)**：自定义分支建立时模型的第一句回复（默认：`（已同步最新状态与记忆快照，随时可以继续。）`）。
  - **快照提取正则 (Regex)**：自定义快照截取规则。
  - **历史裁剪阈值**：自定义尾部历史保留比例与最少保留字符数。

> 💡 **操作提示**：脚本源码已将最佳实践设为默认值。若需个性化修改，请在 **AI Studio 网页内** 点击 **Tampermonkey 图标 ->「打开 Compressor 设置...」** 呼出控制台，确保配置可跨域同步写入当前浏览器。

---

## 兼容网址格式

本脚本适配 Google AI Studio 现行的所有 URL 路径规则：

| 场景 | 示例 URL 结构 | 兼容状态 |
| :--- | :--- | :--- |
| **标准单账号** | `https://aistudio.google.com/prompts/{id}` | ✅ 完整支持 |
| **Google 多账号** | `https://aistudio.google.com/u/1/prompts/{id}` | ✅ 自动保持账号状态 |
| **GCP 项目空间** | `https://aistudio.google.com/projects/{project_id}/prompts/{id}` | ✅ 自动继承工作区前缀 |
| **新建空白会话** | `https://aistudio.google.com/prompts/new_chat` | ✅ 完整支持 |

---

## 目录结构

```text
aistudio-compressor/
├── aistudio-compressor.user.js   # 核心 Tampermonkey 用户脚本 (稳定版 v0.4.3)
├── index.html                    # 独立设置控制台 UI（部署至 GitHub Pages）
├── README.md                     # 项目说明文档
└── .github/workflows/            # GitHub Pages 自动化部署工作流
    └── deploy-gh-pages.yml
