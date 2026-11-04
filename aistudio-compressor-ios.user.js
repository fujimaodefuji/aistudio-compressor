// ==UserScript==
// @name         AI Studio Chat Compressor (iOS)
// @namespace    https://fujimaodefuji.github.io/aistudio-compressor
// @version      1.0.3-ios
// @description  在 Google AI Studio 提供一键压缩聊天记录 (iOS 移动专版) | 主世界代理发包，增加原生防丢弹窗剪贴板兜底
// @author       fujimaodefuji
// @match        https://aistudio.google.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // =========================================================================
  // 核心黑魔法：主世界 RPC 代理发包 (突破 iOS Safari 所有的网络沙箱拦截)
  // =========================================================================
  function injectRPCProxyToMainWorld() {
    const script = document.createElement('script');
    script.textContent = `
            (function() {
                let lastValidHeaders = null;

                const origFetch = window.fetch;
                window.fetch = async function(...args) {
                    try {
                        const req = new Request(args[0], args[1]);
                        const url = req.url || "";
                        if (url.includes('GenerateContent') || url.includes('CreatePrompt') || url.includes('ResolveDriveResource')) {
                            const hdrs = {};
                            req.headers.forEach((value, key) => {
                                if (key.toLowerCase() !== 'content-length') hdrs[key] = value;
                            });
                            if (Object.keys(hdrs).length > 0) lastValidHeaders = hdrs;
                        }
                    } catch(e) {}
                    return origFetch.apply(this, args);
                };

                window.addEventListener('message', async (e) => {
                    if (!e.data) return;

                    // 代理执行 ResolveDriveResource (获取历史)
                    if (e.data.type === 'IOS_RPC_REQ_RESOLVE') {
                        if (!lastValidHeaders) {
                            window.postMessage({ type: 'IOS_RPC_RES_RESOLVE', promptId: e.data.promptId, error: 'No headers captured' }, '*');
                            return;
                        }
                        try {
                            const res = await origFetch("https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/ResolveDriveResource", {
                                method: 'POST', credentials: 'include',
                                headers: Object.assign({'content-type': 'application/json+protobuf'}, lastValidHeaders),
                                body: JSON.stringify([e.data.promptId])
                            });
                            const text = await res.text();
                            window.postMessage({ type: 'IOS_RPC_RES_RESOLVE', promptId: e.data.promptId, ok: res.ok, text: text }, '*');
                        } catch(err) {
                            window.postMessage({ type: 'IOS_RPC_RES_RESOLVE', promptId: e.data.promptId, error: err.message }, '*');
                        }
                    }

                    // 代理执行 CreatePrompt (创建带历史的新分支)
                    if (e.data.type === 'IOS_RPC_REQ_CREATE') {
                        if (!lastValidHeaders) {
                            window.postMessage({ type: 'IOS_RPC_RES_CREATE', error: 'No headers captured' }, '*');
                            return;
                        }
                        try {
                            const res = await origFetch("https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/CreatePrompt", {
                                method: 'POST', credentials: 'include',
                                headers: Object.assign({'content-type': 'application/json+protobuf'}, lastValidHeaders),
                                body: e.data.body
                            });
                            const text = await res.text();
                            window.postMessage({ type: 'IOS_RPC_RES_CREATE', ok: res.ok, text: text }, '*');
                        } catch(err) {
                            window.postMessage({ type: 'IOS_RPC_RES_CREATE', error: err.message }, '*');
                        }
                    }
                });
            })();
        `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  // 初始化注入主世界代理
  injectRPCProxyToMainWorld();

  // 封装异步 RPC 调用
  function rpcResolvePrompt(promptId) {
    return new Promise((resolve) => {
      const handler = (e) => {
        if (e.data && e.data.type === 'IOS_RPC_RES_RESOLVE' && e.data.promptId === promptId) {
          window.removeEventListener('message', handler);
          if (e.data.error || !e.data.ok) resolve(null);
          else resolve(e.data.text);
        }
      };
      window.addEventListener('message', handler);
      window.postMessage({ type: 'IOS_RPC_REQ_RESOLVE', promptId: promptId }, '*');
    });
  }

  function rpcCreatePrompt(bodyString) {
    return new Promise((resolve, reject) => {
      const handler = (e) => {
        if (e.data && e.data.type === 'IOS_RPC_RES_CREATE') {
          window.removeEventListener('message', handler);
          if (e.data.error) reject(new Error(e.data.error));
          else if (!e.data.ok) reject(new Error('Google 拒绝请求 (无凭据)'));
          else resolve(e.data.text);
        }
      };
      window.addEventListener('message', handler);
      window.postMessage({ type: 'IOS_RPC_REQ_CREATE', body: bodyString }, '*');
    });
  }
  // =========================================================================

  const PRESET_NARRATIVE = `That concludes the current topic. Please remember the conversation history and switch roles:

You are the Narrative & Context State Compressor for an ongoing interactive roleplay and relationship dialogue.
When conversation history grows too large, your task is to distill the dynamic context, emotional tone, physical scene, and unresolved plotlines into a concise, structured XML snapshot: <state_snapshot>.

This snapshot is CRITICAL. It will be injected into the next session as the primary memory bridge to maintain continuous immersion, emotional intimacy, and exact scene continuity.

First, reflect briefly in a private <scratchpad>:
1. Identify the exact current scene, ongoing activity, and physical environment.
2. Review both characters' current physical posture, attire condition, and emotional states.
3. Extract any newly established lore, promises, or milestone changes from the recent conversation.
4. Pinpoint the unfinished interaction or immediate next step.

Then generate ONLY the final <state_snapshot> XML block. Focus strictly on DYNAMIC developments from the recent chat history (do NOT duplicate static character background lore). Be dense, objective, emotionally perceptive, and avoid unnecessary filler.

The structure MUST be strictly as follows:

<state_snapshot>
<scene_and_environment>
[记录压缩前最后一刻所处的具体地理/房间坐标、时间点、周围光线与环境细节]
</scene_and_environment>

<physical_and_attire_state>
[双方当前的姿态距离、身体接触状态、着装状态（衣物款式或解构状态）、生理疲惫/兴奋度与体能状态]
</physical_and_attire_state>

<emotional_dynamics>
[当前的亲密水温、情绪基调、心理防线状态以及本次对话中体现出的依赖/调情/抚慰氛围]
</emotional_dynamics>

<recent_milestones_and_commitments>
[仅记录本次对话中新发生的关键事件、新做出的承诺、新约定或新确立的情感突破（若无新变动填“无”）]
</recent_milestones_and_commitments>

<immediate_next_steps>
[压缩发生瞬间，双方正悬停在哪个对话话题、待完成的身体动作或下一步行动]
</immediate_next_steps>
</state_snapshot>`;

  const ACK_MSG = "（已同步最新状态与记忆快照，随时可以继续。）";

  const state = {
    compressionInProgress: false,
    lastResolvedPromptThread: null,
    lastResolvedPromptRoot: null,
    lastResolvedPromptId: null
  };

  let domWatchInterval = null;
  let initialThumbCount = 0;

  const UI = {
    init() {
      const run = () => UI.injectButton();
      run();
      window.addEventListener("DOMContentLoaded", run);
      const obs = new MutationObserver(run);
      if (document.body) obs.observe(document.body, { childList: true, subtree: true });
      setInterval(run, 1500);
    },
    injectButton() {
      if (!document.getElementById("compressor-button-ios")) {
        let toolbar = null;
        const selectors = ["ms-toolbar .toolbar-right", "ms-playground-toolbar .toolbar-right", ".toolbar-right", "header .right-actions"];
        for (const sel of selectors) {
          toolbar = document.querySelector(sel);
          if (toolbar) break;
        }
        if (toolbar) {
          UI.ensureStyles();
          const btn = document.createElement("button");
          btn.id = "compressor-button-ios";
          btn.className = "ms-button-icon";
          btn.title = "Compress (iOS)";
          btn.innerHTML = `<span class="material-symbols-outlined compressor-icon">docs</span><span class="compressor-spinner"></span>`;
          btn.onclick = Compression.run;
          toolbar.appendChild(btn);
        }
      }
    },
    ensureStyles() {
      if (document.getElementById("ios-compressor-style")) return;
      const style = document.createElement("style");
      style.id = "ios-compressor-style";
      style.textContent = `
            @keyframes ios-spin { 100% { transform: rotate(360deg); } }
            #compressor-button-ios { width: 36px; height: 36px; border: none; background: transparent; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
            #compressor-button-ios .compressor-spinner { width: 18px; height: 18px; border: 2px solid rgba(0,0,0,0.2); border-top-color: currentColor; border-radius: 50%; animation: ios-spin 0.8s linear infinite; display: none; }
            #compressor-button-ios.loading .compressor-spinner { display: block; }
            #compressor-button-ios.loading .compressor-icon { display: none; }`;
      document.head.appendChild(style);
    },
    setLoading(loading) {
      const btn = document.getElementById("compressor-button-ios");
      if (btn) btn.classList.toggle("loading", loading);
    },
    // 绝对防丢兜底：原生居中弹窗供用户手动复制快照
    showFallbackModal(snapshotText, errorMsg) {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:999999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;backdrop-filter:blur(5px);';

      const card = document.createElement('div');
      card.style.cssText = 'background:#fff;border-radius:16px;width:100%;max-width:400px;padding:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);display:flex;flex-direction:column;gap:12px;';

      const title = document.createElement('h3');
      title.style.cssText = 'margin:0;color:#ef4444;font-size:18px;font-weight:600;display:flex;align-items:center;gap:6px;';
      title.innerText = '⚠️ 派生跳转受限';

      const desc = document.createElement('p');
      desc.style.cssText = 'margin:0;font-size:13px;color:#475569;line-height:1.5;';
      desc.innerText = `记忆快照已成功提取！但受 iOS 沙箱拦截无法自动创建新对话。\n(${errorMsg})\n\n请点击下方按钮复制快照，并手动点击左上角【New Chat】粘贴。`;

      const textarea = document.createElement('textarea');
      textarea.style.cssText = 'width:100%;height:180px;border:1px solid #cbd5e1;border-radius:8px;padding:10px;font-family:monospace;font-size:12px;background:#f8fafc;color:#0f172a;resize:none;box-sizing:border-box;';
      textarea.value = snapshotText;
      textarea.readOnly = true;

      const btnGroup = document.createElement('div');
      btnGroup.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:5px;';

      const closeBtn = document.createElement('button');
      closeBtn.innerText = '关闭';
      closeBtn.style.cssText = 'padding:10px 18px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#334155;font-weight:600;font-size:14px;cursor:pointer;';
      closeBtn.onclick = () => overlay.remove();

      const copyBtn = document.createElement('button');
      copyBtn.innerText = '📋 复制快照';
      copyBtn.style.cssText = 'padding:10px 18px;border-radius:8px;border:none;background:#4f46e5;color:#fff;font-weight:600;font-size:14px;cursor:pointer;flex:1;';

      // 手动点击触发，100%能够突破苹果剪贴板限制
      copyBtn.onclick = () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(snapshotText).then(() => {
            copyBtn.innerText = '✅ 复制成功';
            copyBtn.style.background = '#10b981';
            setTimeout(() => overlay.remove(), 1500);
          }).catch(() => alert("复制失败，请手动在上方文本框长按全选复制。"));
        } else {
          textarea.select();
          document.execCommand('copy');
          copyBtn.innerText = '✅ 复制成功';
          copyBtn.style.background = '#10b981';
          setTimeout(() => overlay.remove(), 1500);
        }
      };

      btnGroup.appendChild(closeBtn);
      btnGroup.appendChild(copyBtn);

      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(textarea);
      card.appendChild(btnGroup);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    }
  };

  const Compression = {
    run() {
      if (state.compressionInProgress) return;
      let textarea = null;
      for (const sel of ["ms-autosize-textarea textarea", 'textarea[aria-label="Start typing a prompt"]', "textarea"]) {
        textarea = document.querySelector(sel);
        if (textarea) break;
      }
      if (!textarea) return alert("未找到输入框！");

      state.compressionInProgress = true;
      UI.setLoading(true);

      initialThumbCount = countThumbIcons();

      const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      if (desc?.set) desc.set.call(textarea, PRESET_NARRATIVE);
      else textarea.value = PRESET_NARRATIVE;

      textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));

      setTimeout(() => {
        let sendBtn = null;
        for (const sel of ["ms-run-button button", 'button[aria-label="Run"]', 'button[aria-label^="Run"]']) {
          sendBtn = document.querySelector(sel);
          if (sendBtn && !sendBtn.disabled) break;
        }
        if (sendBtn) {
          sendBtn.click();
          Compression.startDOMWatch();
        } else {
          Compression.finalizeRun();
        }
      }, 150);
    },
    startDOMWatch() {
      if (domWatchInterval) clearInterval(domWatchInterval);
      let checks = 0;
      let seenNewTurn = false;

      domWatchInterval = setInterval(() => {
        if (!state.compressionInProgress) {
          clearInterval(domWatchInterval);
          return;
        }
        checks++;

        const currentThumbs = countThumbIcons();
        const runBtns = Array.from(document.querySelectorAll("button"));
        const isStopVisible = runBtns.some(b => (b.textContent||"").includes("Stop") || (b.getAttribute("aria-label")||"").includes("Stop"));

        if (currentThumbs > initialThumbCount) seenNewTurn = true;

        if (!isStopVisible && (seenNewTurn || checks > 10)) {
          const snapshot = extractSnapshotFromLatestModelTurn();
          if (snapshot) {
            clearInterval(domWatchInterval);
            rebuildConversation(snapshot);
            return;
          }
        }

        if (checks > 180) {
          alert("生成超时，请检查网络或重试。");
          Compression.finalizeRun();
        }
      }, 1000);
    },
    finalizeRun() {
      state.compressionInProgress = false;
      if (domWatchInterval) clearInterval(domWatchInterval);
      UI.setLoading(false);
    }
  };

  function safeParseJSON(text) { try { return JSON.parse(text); } catch { return null; } }
  function deepClone(val) { return val == null ? val : JSON.parse(JSON.stringify(val)); }

  function countThumbIcons() {
    return Array.from(document.querySelectorAll("mat-icon, .material-symbols-outlined")).filter(el => (el.textContent || "").includes("thumb_up")).length;
  }

  function extractSnapshotFromLatestModelTurn() {
    try {
      const thumbIcons = Array.from(document.querySelectorAll("mat-icon, .material-symbols-outlined")).filter(el => (el.textContent || "").includes("thumb_up"));
      let target = null;
      if (thumbIcons.length > 0) target = thumbIcons[thumbIcons.length - 1].closest("ms-chat-turn, .chat-turn") || thumbIcons[thumbIcons.length - 1].parentElement?.parentElement?.parentElement;
      if (!target) {
        const turns = document.querySelectorAll("ms-chat-turn, .chat-turn");
        if (turns.length > 0) target = turns[turns.length - 1];
      }
      if (!target) return null;
      const turnText = target.innerText || "";
      if (turnText.includes("[记录压缩前") || turnText.includes("switch roles:")) return null;
      const match = turnText.match(/<state_snapshot>[\s\S]*?<\/state_snapshot>/i);
      return match ? match[0].trim() : null;
    } catch (e) { return null; }
  }

  async function rebuildConversation(snapshotText) {
    try {
      const currentPathMatch = (location.pathname || "").match(/\/prompts\/([^/?#]+)/);
      const currentId = currentPathMatch ? currentPathMatch[1] : null;

      let turns = [];
      if (state.lastResolvedPromptThread?.length && state.lastResolvedPromptId === currentId) {
        turns = extractResolvedTurns(state.lastResolvedPromptThread);
      } else {
        const fetchedText = await rpcResolvePrompt(currentId);
        if (fetchedText) {
          const payload = safeParseJSON(fetchedText);
          const root = payload?.[0];
          if (root && root[13]?.[0]) {
            state.lastResolvedPromptRoot = deepClone(root);
            turns = extractResolvedTurns(root[13][0]);
          }
        }
      }

      // 剔除压缩提示词和快照所在的旧记录
      const sanitized = turns.filter(t => !t.text.includes("Narrative & Context State Compressor") && !t.text.includes("<state_snapshot>"));

      // 严谨保留尾部对话（防止超长 Token 截断，保留最后 8 轮交互）
      const preserved = sanitized.slice(-8);

      const newTurns = [
        { role: "user", text: snapshotText },
        { role: "model", text: ACK_MSG },
        ...preserved
      ];

      const body = buildCreatePayload(newTurns);
      if (!body) throw new Error("缺少原会话数据");

      // 通过主世界代理发包创建新分支
      const resText = await rpcCreatePrompt(body);

      const resData = safeParseJSON(resText);
      const top = typeof resData?.[0] === "string" ? resData[0] : "";
      const m = top.match(/(?:^|\/)prompts\/([^/?#]+)/);

      if (m) {
        const basePathMatch = (location.pathname || "").match(/^(.*\/prompts\/)/);
        location.assign(`${location.origin}${basePathMatch ? basePathMatch[1] : "/prompts/"}${m[1]}`);
      } else {
        throw new Error("响应中未找到新分支 ID。");
      }
    } catch (err) {
      // 终极保护触发：抛出美丽的弹窗，用户亲手点击复制按钮
      UI.showFallbackModal(snapshotText, err.message);
    } finally {
      Compression.finalizeRun();
    }
  }

  function extractResolvedTurns(entries) {
    const turns = [];
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 9) continue;
      const role = entry[8];
      const parts = entry[29];
      if (typeof role === "string" && Array.isArray(parts)) {
        const text = parts.filter(p => Array.isArray(p) && !p[12]).map(p => p[1] || "").join("");
        if (text) turns.push({ role, text, entry: deepClone(entry) });
      }
    }
    return turns;
  }

  function buildCreatePayload(turnRecords) {
    const sourceRoot = state.lastResolvedPromptRoot;
    if (!Array.isArray(sourceRoot) || sourceRoot.length < 14) return null;

    const primaryThread = turnRecords.map((t, idx) => {
      if (t.entry && Array.isArray(t.entry)) {
        const e = deepClone(t.entry);
        e[0] = t.text; e[8] = t.role;
        if (Array.isArray(e[21])) e[21] = null;
        e[32] = [Math.floor(Date.now()/1000), 0];
        return e;
      }
      const e = new Array(33).fill(null);
      e[0] = t.text; e[8] = t.role; e[32] = [Math.floor(Date.now()/1000), 0];
      return e;
    });

    let title = (sourceRoot[4]?.[0] || "Chat").trim();
    title = `Compression of ${title.replace(/^branch of\s+/i, "")}`;

    const createRoot = new Array(Math.max(14, sourceRoot.length)).fill(null);
    createRoot[3] = deepClone(sourceRoot[3]);
    createRoot[4] = [title];
    createRoot[12] = deepClone(sourceRoot[12] || []);
    createRoot[13] = [primaryThread, deepClone(sourceRoot[13][1] || [])];
    return JSON.stringify([createRoot]);
  }

  function bootstrap() {
    UI.init();
  }

  bootstrap();

})();
