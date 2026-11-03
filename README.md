# AI Studio Chat Compressor

[![Tampermonkey Install](https://img.shields.io/badge/Tampermonkey-一键安装-27ae60?logo=tampermonkey&logoColor=white)](https://fujimaodefuji.github.io/aistudio-compressor/aistudio-compressor.user.js)
[![Version](https://img.shields.io/badge/version-v0.4.1-blue.svg)](https://github.com/fujimaodefuji/aistudio-compressor)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

一个运行在 Google AI Studio（MakerSuite）网页版的高效长对话管理工具（Tampermonkey 用户脚本）。针对长会话造成的 Token 膨胀、页面卡顿与上下文遗忘问题，提供以下核心能力：

- 🚀 **一键提炼记忆**：自动注入压缩指令，将繁冗对话提炼为高密度的 `<state_snapshot>` 结构化快照。
- 🌿 **智能分支迁移**：提取快照并结合滑动窗口保留的尾部对话，一键派生（Fork）出干净连贯的新分支。
- 🌐 **多级路径与工作区全兼容 (v0.4.1)**：全面适配 `https://aistudio.google.com/*/*/prompts/*`，完美支持 Google 多账号切换（`/u/0/`、`/u/1/`）与 Google Cloud 项目空间（`/projects/<id>/`），派生跳转自动继承前缀，杜绝 404 与权限丢失。
- 🎭 **多场景预设切换**：内置「代码工程/任务跟踪」与「互动叙事/关系记忆」提示词模板，支持灵活自定义。
- 💬 **自定义确认应答**：分支建立时的首轮确认消息可自由定制（不再局限于生硬的固定英文）。
- 📡 **底层网络监控**：原生拦截排查 `GenerateContent` / `CreatePrompt` / `ResolveDriveResource` 等 RPC 请求。
- ⚙️ **可视化控制台**：基于 GitHub Pages 的轻量控制台，支持正则提取、尾部字符百分比阈值及模板热同步。

---

## 兼容网址格式

本脚本已实现对 Google AI Studio 全格式 URL 的深度兼容：

| 格式场景 | 示例 URL 结构 | 兼容状态 |
| :--- | :--- | :--- |
| **标准单账号** | `https://aistudio.google.com/prompts/{id}` | ✅ 完整支持 |
| **Google 多账号** | `https://aistudio.google.com/u/1/prompts/{id}` | ✅ 支持并自动保持账号状态 |
| **GCP 项目空间** | `https://aistudio.google.com/projects/{project_id}/prompts/{id}` | ✅ 支持并继承工作区上下文 |
| **新建空白会话** | `https://aistudio.google.com/prompts/new_chat` | ✅ 完整支持 |

---

## 快速安装与使用

1. **一键安装**：点击上方 **[一键安装]** 徽标，Tampermonkey 将自动弹出安装界面（或直接访问脚本链接导入）。
2. **确认匹配规则**：确保脚本已启用，默认覆盖 `*prompts/*` 及其多级嵌套路径。
3. **打开 AI Studio**：进入任意对话，页面右上方工具栏会出现带有文档图标的压缩按钮。
4. **触发压缩**：点击按钮，脚本将自动完成「填入压缩指令 ➔ 发送生成 ➔ 解析 XML 快照 ➔ 创建新分支并自动跳转」。

---

## 设置控制台（GitHub Pages）

- **控制台地址**：<https://fujimaodefuji.github.io/aistudio-compressor>
- **核心配置项**：
  - **模板切换**：
    - `💻 代码开发 / 任务重构 (Coding & Task)`：重点抓取整体目标、文件系统改动、最近操作与待办清单。
    - `📖 互动叙事 / 关系记忆 (Narrative & Roleplay)`：高密度保留物理场景、体态着装、亲密水温与即时未尽话题，避免触发安全审查。
    - `⚙️ 自定义模式 (Custom)`：根据自身业务流自由打磨专属快照指令。
  - **快照确认应答 (Ack Message)**：自定义派生分支时 AI 接纳快照的第一句回复。
  - **结果提取正则 (Regex)**：自定义快照截取规则（默认精准提取 `<state_snapshot>`）。
  - **历史裁剪阈值**：设置尾部历史保留百分比与最少保留字符数（保留字数 = MAX(总字数 × 百分比, 最少字数)）。

脚本菜单入口：
```text
Tampermonkey 扩展图标 -> AI Studio Chat Compressor
├─ 打开 Compressor 设置... （自动弹窗呼出上方控制台并同步状态）
└─ 重置 Compressor 设置
