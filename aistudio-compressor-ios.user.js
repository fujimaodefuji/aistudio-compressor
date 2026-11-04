// ==UserScript==
// @name         AI Studio Chat Compressor (iOS)
// @namespace    https://fujimaodefuji.github.io/aistudio-compressor
// @version      1.0.2-ios
// @description  在 Google AI Studio 提供一键压缩聊天记录 (iOS 移动专版) | 主世界头信息全量克隆，彻底解决无 Key 报 403 无法派生分支的问题
// @author       fujimaodefuji
// @match        https://aistudio.google.com/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM.registerMenuCommand
// ==/UserScript==

(function () {
  "use strict";

  const DEFAULT_SNAPSHOT_REGEX = "<state_snapshot>[\\s\\S]*?<\\/state_snapshot>";

  const PRESET_PROMPTS = {
    narrative: `That concludes the current topic. Please remember the conversation history and switch roles:

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
</state_snapshot>`
  };

  const Config = {
    TARGETS: {
      GENERATE: "/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent",
      RESOLVE: "/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/ResolveDriveResource",
      CREATE_PROMPT: "/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/CreatePrompt"
    },
    NETWORK: { RPC_ORIGIN: "https://alkalimakersuite-pa.clients6.google.com" },
    UI: {
      BUTTON_ID: "compressor-button-ios",
      TOOLBAR_SELECTORS: [
        "ms-toolbar .toolbar-right",
        "ms-playground-toolbar .toolbar-right",
        ".toolbar-right",
        "header .right-actions"
      ],
      INPUT_SELECTORS: [
        "ms-autosize-textarea textarea",
        'textarea[aria-label="Start typing a prompt"]',
        "textarea"
      ],
      SEND_BUTTON_SELECTORS: [
        "ms-run-button button",
        'button[aria-label="Run"]',
        'button[aria-label^="Run"]'
      ]
    },
    PROMPTS: {
      NARRATIVE: PRESET_PROMPTS.narrative,
      ACK: "（已同步最新状态与记忆快照，随时可以继续。）"
    }
  };

  const state = {
    compressionInProgress: false,
    capturedHeaders: {}, // 核心：存储全量克隆的合法请求头
    lastResolvedPromptThread: null,
    lastResolvedPromptRoot: null,
    lastResolvedPromptId: null
  };

  let domWatchInterval = null;
  let initialThumbCount = 0;

  // =========================================================================
  // 黑魔法：主世界注入（Main-World Injection）突破苹果沙箱拦截
  // 直接把原网页真实发出的合法请求 Headers 偷下来
  // =========================================================================
  function injectNetworkMonitorToMainWorld() {
    const script = document.createElement('script');
    script.textContent = `
            (function() {
                // 1. 劫持原生 Fetch
                const origFetch = window.fetch;
                window.fetch = async function(...args) {
                    try {
                        const req = new Request(args[0], args[1]);
                        const url = req.url || "";
                        if (url.includes('GenerateContent') || url.includes('CreatePrompt') || url.includes('ResolveDriveResource')) {
                            const headersObj = {};
                            req.headers.forEach((value, key) => {
                                if (key.toLowerCase() !== 'content-length') {
                                    headersObj[key] = value;
                                }
                            });
                            // 偷取完整 Headers 并传回插件层
                            if (Object.keys(headersObj).length > 0) {
                                window.postMessage({ type: 'COMP_HEADERS_CAPTURED', data: headersObj }, '*');
                            }
                        }
                    } catch(e) {}

                    const res = await origFetch.apply(this, args);

                    try {
                        const urlStr = (args[0] && typeof args[0] === 'string') ? args[0] : (args[0] && args[0].url ? args[0].url : "");
                        if (urlStr.includes('ResolveDriveResource')) {
                            res.clone().text().then(text => {
                                window.postMessage({ type: 'COMP_RESOLVE_DATA', data: text }, '*');
                            }).catch(()=>{});
                        }
                    } catch(e) {}
                    return res;
                };

                // 2. 劫持原生 XHR（防漏兜底）
                const origXHR = window.XMLHttpRequest;
                window.XMLHttpRequest = function() {
                    const xhr = new origXHR();
                    let url = '';
                    let reqHeaders = {};

                    const origOpen = xhr.open;
                    xhr.open = function(...a) { url = a[1] || ''; return origOpen.apply(this, a); };

                    const origSetHeader = xhr.setRequestHeader;
                    xhr.setRequestHeader = function(name, val) {
                        if (name.toLowerCase() !== 'content-length') reqHeaders[name] = val;
                        return origSetHeader.apply(this, arguments);
                    };

                    const origSend = xhr.send;
                    xhr.send = function(...a) {
                        if (url.includes('GenerateContent') || url.includes('CreatePrompt') || url.includes('ResolveDriveResource')) {
                            if (Object.keys(reqHeaders).length > 0) {
                                window.postMessage({ type: 'COMP_HEADERS_CAPTURED', data: reqHeaders }, '*');
                            }
                        }
                        return origSend.apply(this, a);
                    };

                    xhr.addEventListener('load', function() {
                        if (url.includes('ResolveDriveResource')) {
                            window.postMessage({ type: 'COMP_RESOLVE_DATA', data: xhr.responseText }, '*');
                        }
                    });
                    return xhr;
                };
            })();
        `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  // 接收主世界传回的关键数据
  window.addEventListener('message', e => {
    if (!e.data) return;
    if (e.data.type === 'COMP_HEADERS_CAPTURED') {
      state.capturedHeaders = { ...state.capturedHeaders, ...e.data.data };
    }
    if (e.data.type === 'COMP_RESOLVE_DATA') {
      maybeCaptureResolvedPromptThread(e.data.data);
    }
  });

  // =========================================================================

  function safeParseJSON(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  function deepClone(val) {
    return val == null ? val : JSON.parse(JSON.stringify(val));
  }

  function maybeCaptureResolvedPromptThread(bodyText) {
    if (typeof bodyText !== "string") return;
    const payload = safeParseJSON(bodyText);
    const root = payload?.[0];
    if (!Array.isArray(root) || root.length < 14) return;
    const thread = root[13]?.[0];
    if (!Array.isArray(thread) || !thread.length) return;

    state.lastResolvedPromptRoot = deepClone(root);
    state.lastResolvedPromptThread = thread.filter(Array.isArray).map(e => deepClone(e));
    const m = (root[0] || "").match(/(?:^|\/)prompts\/([^/?#]+)/);
    state.lastResolvedPromptId = m ? m[1] : null;
  }

  const UI = {
    init() {
      const run = () => UI.injectButton();
      run();
      window.addEventListener("DOMContentLoaded", run);
      const obs = new MutationObserver(run);
      if (document.body) obs.observe(document.body, { childList: true, subtree: true });
      setInterval(run, 1500);

      try {
        if (typeof GM_registerMenuCommand === "function") {
          GM_registerMenuCommand("⚡ 立即压缩当前会话 (iOS)", Compression.run);
        }
      } catch (e) {}
    },
    injectButton() {
      if (!document.getElementById(Config.UI.BUTTON_ID)) {
        let toolbar = null;
        for (const sel of Config.UI.TOOLBAR_SELECTORS) {
          toolbar = document.querySelector(sel);
          if (toolbar) break;
        }
        if (toolbar) {
          UI.ensureStyles();
          const btn = document.createElement("button");
          btn.id = Config.UI.BUTTON_ID;
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
            #${Config.UI.BUTTON_ID} { width: 36px; height: 36px; border: none; background: transparent; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
            #${Config.UI.BUTTON_ID} .compressor-spinner { width: 18px; height: 18px; border: 2px solid rgba(0,0,0,0.2); border-top-color: currentColor; border-radius: 50%; animation: ios-spin 0.8s linear infinite; display: none; }
            #${Config.UI.BUTTON_ID}.loading .compressor-spinner { display: block; }
            #${Config.UI.BUTTON_ID}.loading .compressor-icon { display: none; }`;
      document.head.appendChild(style);
    },
    setLoading(loading) {
      const btn = document.getElementById(Config.UI.BUTTON_ID);
      if (btn) btn.classList.toggle("loading", loading);
    }
  };

  const Compression = {
    run() {
      if (state.compressionInProgress) return;
      let textarea = null;
      for (const sel of Config.UI.INPUT_SELECTORS) {
        textarea = document.querySelector(sel);
        if (textarea) break;
      }
      if (!textarea) return alert("未找到输入框！");

      // 安全预检：确保已经偷取到了合法头信息
      if (Object.keys(state.capturedHeaders).length === 0) {
        alert("🔒 环境安全锁拦截：\n\n请先在当前对话框随便发送一句任意消息（如打个句号）。\n我们需要拦截一次正常通信以获取合法的免登录凭据（Headers），这是避免派生报错的必需步骤！\n\n待模型回复完毕后，再点击本按钮。");
        return;
      }

      state.compressionInProgress = true;
      UI.setLoading(true);

      initialThumbCount = countThumbIcons();

      const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      if (desc?.set) desc.set.call(textarea, Config.PROMPTS.NARRATIVE);
      else textarea.value = Config.PROMPTS.NARRATIVE;

      textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));

      setTimeout(() => {
        let sendBtn = null;
        for (const sel of Config.UI.SEND_BUTTON_SELECTORS) {
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

        if (checks > 120) Compression.finalizeRun();
      }, 1000);
    },
    finalizeRun() {
      state.compressionInProgress = false;
      if (domWatchInterval) clearInterval(domWatchInterval);
      UI.setLoading(false);
    }
  };

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
        turns = await fetchAndExtractTurns(currentId);
      }

      // 剔除压缩提示词和快照所在的旧记录
      const sanitized = turns.filter(t => !t.text.includes("Narrative & Context State Compressor") && !t.text.includes("<state_snapshot>"));

      // 严谨保留尾部对话（防止截断，默认为原功能算法的简化版，只拿最后8-10轮以避免 Token 超标）
      const preserved = sanitized.slice(-8);

      const newTurns = [
        { role: "user", text: snapshotText },
        { role: "model", text: Config.PROMPTS.ACK },
        ...preserved
      ];

      const body = buildCreatePayload(newTurns);
      if (!body) throw new Error("构建派生数据失败，原会话数据未就绪。");

      // ======= 降维打击：直接克隆合法 Header =======
      const clonedHeaders = {
        "content-type": "application/json+protobuf",
        ...state.capturedHeaders
      };

      const res = await fetch(`${Config.NETWORK.RPC_ORIGIN}${Config.TARGETS.CREATE_PROMPT}`, {
        method: "POST",
        credentials: "include",
        headers: clonedHeaders,
        body
      });

      if (!res.ok) throw new Error(`Google 服务器拒绝 (${res.status})`);

      const resData = safeParseJSON(await res.text());
      const top = typeof resData?.[0] === "string" ? resData[0] : "";
      const m = top.match(/(?:^|\/)prompts\/([^/?#]+)/);

      if (m) {
        const basePathMatch = (location.pathname || "").match(/^(.*\/prompts\/)/);
        location.assign(`${location.origin}${basePathMatch ? basePathMatch[1] : "/prompts/"}${m[1]}`);
      } else {
        throw new Error("响应中未找到新分支 ID。");
      }
    } catch (err) {
      navigator.clipboard.writeText(snapshotText);
      alert(`⚠️ 派生跳转失败\n\n错误原因：${err.message}\n\n已将提取的记忆快照复制到剪贴板，可手动新建对话并粘贴。`);
    } finally {
      Compression.finalizeRun();
    }
  }

  async function fetchAndExtractTurns(promptId) {
    if (!promptId) return [];
    try {
      const clonedHeaders = {
        "content-type": "application/json+protobuf",
        ...state.capturedHeaders
      };
      const res = await fetch(`${Config.NETWORK.RPC_ORIGIN}${Config.TARGETS.RESOLVE}`, {
        method: "POST",
        credentials: "include",
        headers: clonedHeaders,
        body: JSON.stringify([promptId])
      });
      const payload = safeParseJSON(await res.text());
      const root = payload?.[0];
      if (!root || !root[13]?.[0]) return [];
      state.lastResolvedPromptRoot = deepClone(root);
      return extractResolvedTurns(root[13][0]);
    } catch { return []; }
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
    injectNetworkMonitorToMainWorld();
    UI.init();
  }

  bootstrap();

})();
