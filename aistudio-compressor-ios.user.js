// ==UserScript==
// @name         AI Studio Chat Compressor (iOS)
// @namespace    https://fujimaodefuji.github.io/aistudio-compressor
// @version      1.0.0-ios
// @description  在 Google AI Studio 提供一键压缩聊天记录 (iOS 移动专版) | 专为 Safari 优化防死锁与点赞判定
// @author       fujimaodefuji
// @match        https://aistudio.google.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @grant        GM.registerMenuCommand
// ==/UserScript==

(function () {
  "use strict";

  const DEFAULT_SNAPSHOT_REGEX = "<state_snapshot>[\\s\\S]*?<\\/state_snapshot>";

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
      NARRATIVE: `That concludes the current topic. Please remember the conversation history and switch roles:

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
</state_snapshot>`,
      ACK: "（已同步最新状态与记忆快照，随时可以继续。）"
    }
  };

  const state = {
    compressionInProgress: false,
    googleApiKey: "",
    lastResolvedPromptThread: null,
    lastResolvedPromptRoot: null,
    lastResolvedPromptId: null
  };

  let domWatchInterval = null;
  let initialThumbCount = 0;

  function getCookieValue(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : "";
  }

  async function buildSapisidAuthHeader() {
    const sapisid = getCookieValue("SAPISID") || getCookieValue("__Secure-3PAPISID") || getCookieValue("APISID");
    if (!sapisid || !globalThis.crypto?.subtle) return null;
    const ts = Math.floor(Date.now() / 1000);
    const encoder = new TextEncoder();
    const digest = await globalThis.crypto.subtle.digest("SHA-1", encoder.encode(`${ts} ${sapisid} ${location.origin}`));
    const hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
    return `SAPISIDHASH ${ts}_${hash} SAPISID1PHASH ${ts}_${hash} SAPISID3PHASH ${ts}_${hash}`;
  }

  function rememberGoogleApiKey(headers) {
    if (!headers) return;
    const normalized = {};
    for (const [k, v] of Object.entries(headers)) normalized[k.toLowerCase()] = v;
    if (normalized["x-goog-api-key"]) state.googleApiKey = String(normalized["x-goog-api-key"]).trim();
  }

  const NetworkMonitor = {
    init() {
      try {
        if (typeof window.fetch === "function" && !window.__ios_compressor_hooked) {
          const origFetch = window.fetch;
          window.fetch = async function (input, init = {}) {
            const req = input instanceof Request ? input : new Request(input, init);
            if (req.url.includes(Config.TARGETS.GENERATE)) {
              try {
                const headers = Object.fromEntries(req.headers.entries());
                rememberGoogleApiKey(headers);
              } catch (e) {}
            }
            const res = await origFetch(request);
            if (req.url.includes(Config.TARGETS.RESOLVE)) {
              try {
                res.clone().text().then(txt => maybeCaptureResolvedPromptThread(txt));
              } catch (e) {}
            }
            return res;
          };
          window.__ios_compressor_hooked = true;
        }
      } catch (e) {}
    }
  };

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

      state.compressionInProgress = true;
      UI.setLoading(true);

      // iOS核心：发送前记录点赞数
      initialThumbCount = countThumbIcons();

      // 写入预设并发送
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

        // 核心：点赞出现且Stop消失，说明真停笔
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
      if (turnText.includes("[记录压缩前") || turnText.includes("switch roles:")) return null; // 过滤提示词
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

      const sanitized = turns.filter(t => !t.text.includes("Narrative & Context State Compressor") && !t.text.includes("<state_snapshot>"));
      const preserved = sanitized.slice(-6); // 简单保留最后6条交互

      const newTurns = [
        { role: "user", text: snapshotText },
        { role: "model", text: Config.PROMPTS.ACK },
        ...preserved
      ];

      const body = buildCreatePayload(newTurns);
      if (!body) throw new Error("Build payload failed");

      const auth = await buildSapisidAuthHeader();
      const res = await fetch(`${Config.NETWORK.RPC_ORIGIN}${Config.TARGETS.CREATE_PROMPT}`, {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json+protobuf", "x-goog-api-key": state.googleApiKey, "x-goog-authuser": "0", authorization: auth },
        body
      });

      const resData = safeParseJSON(await res.text());
      const top = typeof resData?.[0] === "string" ? resData[0] : "";
      const m = top.match(/(?:^|\/)prompts\/([^/?#]+)/);
      if (m) {
        const basePathMatch = (location.pathname || "").match(/^(.*\/prompts\/)/);
        location.assign(`${location.origin}${basePathMatch ? basePathMatch[1] : "/prompts/"}${m[1]}`);
      }
    } catch (err) {
      navigator.clipboard.writeText(snapshotText);
      alert("✅ 记忆快照生成完毕！\n受限未能跳转，已复制到剪贴板。");
    } finally {
      Compression.finalizeRun();
    }
  }

  async function fetchAndExtractTurns(promptId) {
    if (!promptId) return [];
    const auth = await buildSapisidAuthHeader();
    try {
      const res = await fetch(`${Config.NETWORK.RPC_ORIGIN}${Config.TARGETS.RESOLVE}`, {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json+protobuf", "x-goog-api-key": state.googleApiKey, "x-goog-authuser": "0", authorization: auth },
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
        const text = parts.filter(Array.isArray).map(p => p[1] || "").join("");
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
    NetworkMonitor.init();
    UI.init();
  }
  bootstrap();

})();
