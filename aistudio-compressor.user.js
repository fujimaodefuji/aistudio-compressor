// ==UserScript==
// @name         AI Studio Chat Compressor
// @namespace    https://fujimaodefuji.github.io/aistudio-compressor
// @version      0.4.3
// @description  在 Google AI Studio 提供一键压缩聊天记录、注入快照、监控 GenerateContent 请求的工具，方便长对话续写与历史迁移 | Provides a one-click tool in Google AI Studio to compress chat history, inject snapshots, and monitor GenerateContent requests, facilitating long conversation continuation and history migration
// @author       fujimaodefuji
// @match        https://aistudio.google.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  "use strict";

  // ---------------------------
  // Constants & environment
  // ---------------------------

  const DEFAULT_SNAPSHOT_REGEX = "<state_snapshot>[\\s\\S]*?<\\/state_snapshot>";

  const PRESET_PROMPTS = {
    coding: `That concludes the above topic. Please remember the chat history and switch roles:

  You are the component that summarizes internal chat history into a given structure.

  When the conversation history grows too large, you will be invoked to distill the entire history into a concise, structured
  XML snapshot. This snapshot is CRITICAL, as it will become the agent's *only* memory of the past. The agent will resume its
  work based solely on this snapshot. All crucial details, plans, errors, and user directives MUST be preserved.

  First, you will think through the entire history in a private <scratchpad>. Review the user's overall goal, the agent's
  actions, tool outputs, file modifications, and any unresolved questions. Identify every piece of information that is essential
  for future actions.

  After your reasoning is complete, generate the final <state_snapshot> XML object. Be incredibly dense with information. Omit
  any irrelevant conversational filler.

  The structure MUST be as follows:

  <state_snapshot>
      <overall_goal>
          [A single, concise sentence describing the user's high-level objective]
      </overall_goal>

      <key_knowledge>
          [Crucial facts, conventions, and constraints the agent must remember based on conversation history]
      </key_knowledge>

      <file_system_state>
          [List files that have been created, read, modified, or deleted]
      </file_system_state>

      <recent_actions>
          [A summary of the last few significant agent actions and their outcomes]
      </recent_actions>

      <current_plan>
          [The agent's step-by-step plan. Mark completed steps]
      </current_plan>
  </state_snapshot>`,

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
    TAGS: {
      UI: "[Compressor UI]",
      NET: "[Compressor Monitor]"
    },
    TARGETS: {
      GENERATE: "/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent",
      RESOLVE: "/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/ResolveDriveResource",
      CREATE_PROMPT: "/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/CreatePrompt"
    },
    NETWORK: {
      RPC_ORIGIN: "https://alkalimakersuite-pa.clients6.google.com"
    },
    EVENTS: {
      REQUEST: "aistudio-compressor:generatecontent-request",
      RESPONSE: "aistudio-compressor:generatecontent-response"
    },
    UI: {
      BUTTON_ID: "compressor-button-hybrid",
      TOOLBAR_SELECTORS: [
        "ms-toolbar .toolbar-right",
        "ms-playground-toolbar .toolbar-right",
        "ms-playground-toolbar .toolbar-container .toolbar-right",
        ".toolbar-right"
      ],
      TARGET_PATH: "/prompts/",
      INPUT_SELECTORS: [
        "ms-autosize-textarea textarea",
        'textarea[aria-label="Start typing a prompt"]',
        "textarea"
      ],
      SEND_BUTTON_SELECTORS: [
        "ms-run-button button",
        "ms-run-button button.run-button",
        'button[aria-label="Run"]',
        'button[aria-label^="Run"]',
        'button[description*="Send prompt"]',
        'button[aria-label*="keyboard_return"]',
        'button[type="submit"]'
      ]
    },
    SETTINGS: {
      PAGE_URL: "https://fujimaodefuji.github.io/aistudio-compressor"
    },
    PROMPTS: {
      FULL: PRESET_PROMPTS.narrative,
      SNIPPET: "You are the Narrative & Context State Compressor"
    }
  };

  const env = {
    isMac: /Mac|iPhone|iPad/.test(navigator.platform),
    isAppContext: location.pathname.startsWith("/app/"),
    topWindow: unsafeWindow?.top || window
  };
  const settingsOrigin = getSettingsOrigin();
  const SCRIPT_VERSION = "0.4.3";

  const state = {
    compressionInProgress: false,
    compressionRequestPending: false,
    compressionResponsePending: false,
    lastPromptHistory: null,
    lastPromptHistoryUpdatedAt: 0,
    lastResolvedPromptThread: null,
    lastResolvedPromptRoot: null,
    lastResolvedPromptId: null,
    lastResolvedPromptUpdatedAt: 0,
    googleApiKey: "",
    googleApiKeyUpdatedAt: 0,
    pendingBranchTurns: null,
    historyCapturePending: false,
    branchInProgress: false,
    activeCompressionPrompt: "",
    activeCompressionSnippet: Config.PROMPTS.SNIPPET
  };

  const log = {
    ui: (...args) => console.log(Config.TAGS.UI, ...args),
    net: (...args) => console.log(Config.TAGS.NET, ...args)
  };

  const STORAGE_KEY = "__aistudio_compressor_settings_v1";
  const DEFAULT_SETTINGS = {
    activePreset: "narrative",
    compressPrompt: PRESET_PROMPTS.narrative,
    ackMessage: "（已同步最新状态与记忆快照，随时可以继续。）",
    snapshotRegex: DEFAULT_SNAPSHOT_REGEX,
    tailPercent: 30,
    tailMinChars: 2000
  };
  let userSettings = loadUserSettings();
  refreshActivePromptFromSettings();

  function loadUserSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
      return { ...DEFAULT_SETTINGS };
    } catch (err) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function persistUserSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userSettings));
    } catch (err) {}
  }

  function updateUserSettings(partial) {
    userSettings = { ...userSettings, ...partial };
    persistUserSettings();
  }

  function getCompressPrompt() {
    return userSettings?.compressPrompt || Config.PROMPTS.FULL;
  }

  function getAckMessage() {
    return (userSettings?.ackMessage || "").trim() || DEFAULT_SETTINGS.ackMessage;
  }

  function getSnapshotRegex() {
    return (userSettings?.snapshotRegex || "").trim() || DEFAULT_SNAPSHOT_REGEX;
  }

  function getTailRetentionConfig() {
    const percent = Number(userSettings?.tailPercent);
    const minChars = Number(userSettings?.tailMinChars);
    const normalizedPercent = Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) : DEFAULT_SETTINGS.tailPercent;
    const normalizedMinChars = Number.isFinite(minChars) && minChars > 0 ? Math.floor(minChars) : DEFAULT_SETTINGS.tailMinChars;
    return { percent: normalizedPercent, minChars: normalizedMinChars };
  }

  function deriveSnippet(prompt) {
    const text = (prompt || "").trim();
    if (!text) return Config.PROMPTS.SNIPPET;
    return text.slice(0, 120);
  }

  function refreshActivePromptFromSettings() {
    state.activeCompressionPrompt = getCompressPrompt();
    state.activeCompressionSnippet = deriveSnippet(state.activeCompressionPrompt);
  }

  function getSettingsOrigin() {
    const url = Config.SETTINGS?.PAGE_URL;
    if (!url) return null;
    try {
      return new URL(url, location.href).origin;
    } catch {
      return null;
    }
  }

  function getSettingsSnapshot() {
    return {
      activePreset: userSettings?.activePreset || DEFAULT_SETTINGS.activePreset,
      compressPrompt: userSettings?.compressPrompt || Config.PROMPTS.FULL,
      ackMessage: userSettings?.ackMessage || DEFAULT_SETTINGS.ackMessage,
      snapshotRegex: userSettings?.snapshotRegex || DEFAULT_SNAPSHOT_REGEX,
      tailPercent: Number.isFinite(userSettings?.tailPercent) ? userSettings.tailPercent : DEFAULT_SETTINGS.tailPercent,
      tailMinChars: Number.isFinite(userSettings?.tailMinChars) ? userSettings.tailMinChars : DEFAULT_SETTINGS.tailMinChars
    };
  }

  function normalizeSettingsPayload(payload) {
    if (!payload || typeof payload !== "object") {
      return { ...DEFAULT_SETTINGS };
    }
    const next = { ...DEFAULT_SETTINGS };
    if (typeof payload.activePreset === "string") {
      next.activePreset = payload.activePreset;
    }
    if (typeof payload.compressPrompt === "string") {
      const trimmed = payload.compressPrompt.trim();
      next.compressPrompt = trimmed || Config.PROMPTS.FULL;
    }
    if (typeof payload.ackMessage === "string") {
      next.ackMessage = payload.ackMessage.trim() || DEFAULT_SETTINGS.ackMessage;
    }
    if (typeof payload.snapshotRegex === "string") {
      next.snapshotRegex = payload.snapshotRegex.trim() || DEFAULT_SNAPSHOT_REGEX;
    }
    if (payload.tailPercent != null) {
      const parsedPercent = Number(payload.tailPercent);
      if (Number.isFinite(parsedPercent)) {
        next.tailPercent = Math.min(Math.max(parsedPercent, 0), 100);
      }
    }
    if (payload.tailMinChars != null) {
      const parsedMinChars = Number(payload.tailMinChars);
      if (Number.isFinite(parsedMinChars) && parsedMinChars >= 0) {
        next.tailMinChars = Math.floor(parsedMinChars);
      }
    }
    return next;
  }

  function scheduleSettingsHydration(win) {
    if (!win) return;
    const targetOrigin = settingsOrigin || "*";
    const message = {
      source: "aistudio-compressor",
      type: "hydrate",
      payload: getSettingsSnapshot()
    };
    let attempts = 0;
    const maxAttempts = 10;
    let timer = null;

    const dispatch = () => {
      if (!win || win.closed) {
        clearInterval(timer);
        return;
      }
      attempts += 1;
      try {
        win.postMessage(message, targetOrigin);
      } catch (err) {}
      if (attempts >= maxAttempts) {
        clearInterval(timer);
      }
    };

    dispatch();
    timer = setInterval(dispatch, 1200);
  }

  function installSettingsMessageBridge() {
    window.addEventListener("message", handleSettingsMessage);
  }

  function handleSettingsMessage(event) {
    if (!event || !event.data) return;
    if (settingsOrigin && event.origin !== settingsOrigin) return;
    const data = event.data;
    if (data?.source !== "aistudio-compressor") return;
    if (data.type === "update-settings" && data.payload) {
      const normalized = normalizeSettingsPayload(data.payload);
      updateUserSettings(normalized);
      if (!state.compressionInProgress) {
        refreshActivePromptFromSettings();
      }
      log.ui("Settings updated via external page");
    }
  }

  function openSettingsWindow() {
    const targetUrl = Config.SETTINGS?.PAGE_URL;
    if (!targetUrl) {
      alert("未配置设置页面 URL。");
      return;
    }
    const win = window.open(targetUrl, "aistudio_compressor_settings", "width=750,height=800,resizable=yes,scrollbars=yes");
    if (!win || win.closed) {
      alert("无法打开设置窗口，请允许弹窗。");
      return;
    }
    scheduleSettingsHydration(win);
  }

  function resetSettingsToDefault() {
    if (!confirm("确认恢复 Compressor 设置为默认值？")) return;
    userSettings = { ...DEFAULT_SETTINGS };
    persistUserSettings();
    if (!state.compressionInProgress) {
      refreshActivePromptFromSettings();
    }
    alert("已恢复默认设置。");
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== "function") return;
    GM_registerMenuCommand("打开 Compressor 设置...", openSettingsWindow);
    GM_registerMenuCommand("重置 Compressor 设置", resetSettingsToDefault);
  }

  // ---------------------------
  // Event bridge & handlers
  // ---------------------------

  function installTopLevelHandlers() {
    if (!env.topWindow.__aistudio_compressor_handlers_installed) {
      env.topWindow.addEventListener(Config.EVENTS.REQUEST, Compression.handleRequestEvent);
      env.topWindow.addEventListener(Config.EVENTS.RESPONSE, Compression.handleResponseEvent);
      env.topWindow.__aistudio_compressor_handlers_installed = true;
    }
  }

  function emitNetworkEvent(name, detail) {
    try {
      env.topWindow.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (err) {}
  }

  // ---------------------------
  // Network monitor module
  // ---------------------------

  const NetworkMonitor = {
    init() {
      const label = env.isAppContext ? "app-window" : "top-window";
      hookContext(window, label);

      window.addEventListener("DOMContentLoaded", () => {
        hookContext(window, `${label} DOMContentLoaded`);
        hookChildFrames("DOMContentLoaded");
      });

      window.addEventListener("load", () => {
        hookContext(window, `${label} load`);
        hookChildFrames("load");
      });

      setInterval(() => hookChildFrames("poll"), 2000);
    }
  };

  function hookChildFrames(reason) {
    if (!document?.querySelectorAll) return;
    for (const frame of document.querySelectorAll("iframe")) {
      const ctx = frame.contentWindow;
      if (!ctx || !canAccessWindow(ctx)) continue;
      try {
        hookContext(ctx, `iframe ${frame.src || frame.name || "unnamed"} via ${reason}`);
      } catch (err) {}
    }
  }

  function hookContext(ctx, label) {
    if (!canAccessWindow(ctx)) return;
    installFetchHook(ctx, label);
    installXHRHook(ctx, label);
  }

  function canAccessWindow(ctx) {
    try {
      return ctx && ctx.location && ctx.location.origin === location.origin;
    } catch {
      return false;
    }
  }

  function installFetchHook(ctx, label) {
    if (!ctx || typeof ctx.fetch !== "function" || ctx.__aistudio_compressor_fetch_hooked) return;

    const originalFetch = ctx.fetch.bind(ctx);

    ctx.fetch = async function interceptFetch(input, init = {}) {
      const request = input instanceof Request ? input : new Request(input, init);
      const shouldLogGenerate = isTargetRequest(request.url, "GENERATE");
      const shouldCaptureResolve = isTargetRequest(request.url, "RESOLVE");

      if (shouldLogGenerate) {
        await logRequestPayload(request);
      }

      const response = await originalFetch(request);

      if (shouldLogGenerate || shouldCaptureResolve) {
        await logResponsePayload(request.url, response.clone());
      }

      return response;
    };

    ctx.__aistudio_compressor_fetch_hooked = true;
    if (ctx !== unsafeWindow && typeof unsafeWindow.fetch === "function" && !unsafeWindow.__aistudio_compressor_fetch_hooked) {
      unsafeWindow.fetch = ctx.fetch;
      unsafeWindow.__aistudio_compressor_fetch_hooked = true;
    }
  }

  async function logRequestPayload(request) {
    try {
      const clonedRequest = request.clone();
      const bodyText = await clonedRequest.text();
      const headers = Object.fromEntries(clonedRequest.headers.entries());
      rememberGoogleApiKey(headers, clonedRequest.url);
      emitNetworkEvent(Config.EVENTS.REQUEST, {
        url: clonedRequest.url,
        headers,
        bodyText
      });
    } catch (err) {}
  }

  async function logResponsePayload(url, response) {
    try {
      const bodyText = await response.text();
      const parsed = safeParseJSON(bodyText);
      maybeCaptureResolvedPromptThread(url, bodyText, parsed);
      emitNetworkEvent(Config.EVENTS.RESPONSE, {
        url,
        status: response.status,
        statusText: response.statusText,
        bodyText
      });
    } catch (err) {}
  }

  function installXHRHook(ctx, label) {
    if (!ctx || typeof ctx.XMLHttpRequest !== "function" || ctx.__aistudio_compressor_xhr_hooked) return;

    const OriginalXHR = ctx.XMLHttpRequest;

    function WrappedXHR() {
      const realXHR = new OriginalXHR();
      let monitored = false;
      let requestUrl = null;
      const requestHeaders = {};

      const originalOpen = realXHR.open;
      realXHR.open = function (...args) {
        const [, url] = args;
        requestUrl = url || null;
        monitored = Boolean(url) && (isTargetRequest(url, "GENERATE") || isTargetRequest(url, "RESOLVE"));
        return originalOpen.apply(this, args);
      };

      const originalSetRequestHeader = realXHR.setRequestHeader;
      realXHR.setRequestHeader = function (name, value) {
        if (typeof name === "string") {
          requestHeaders[name] = value;
          rememberGoogleApiKey(requestHeaders, resolveUrl(requestUrl));
        }
        return originalSetRequestHeader.apply(this, arguments);
      };

      const originalSend = realXHR.send;
      realXHR.send = function (body) {
        if (monitored) {
          const absoluteUrl = resolveUrl(requestUrl);
          const bodyText = bodyToText(body);
          const headers = Object.keys(requestHeaders).length ? { ...requestHeaders } : null;
          rememberGoogleApiKey(headers, absoluteUrl);
          emitNetworkEvent(Config.EVENTS.REQUEST, {
            url: absoluteUrl,
            headers,
            bodyText
          });
        }
        return originalSend.apply(this, arguments);
      };

      realXHR.addEventListener("readystatechange", function () {
        if (realXHR.readyState !== 4 || !monitored) return;
        const responseUrl = realXHR.responseURL || resolveUrl(requestUrl);
        const parsed = safeParseJSON(realXHR.responseText);
        maybeCaptureResolvedPromptThread(responseUrl, realXHR.responseText, parsed);
        emitNetworkEvent(Config.EVENTS.RESPONSE, {
          url: responseUrl,
          status: realXHR.status,
          statusText: realXHR.statusText,
          bodyText: realXHR.responseText
        });
      });

      return realXHR;
    }

    ctx.XMLHttpRequest = WrappedXHR;
    ctx.__aistudio_compressor_xhr_hooked = true;
    if (ctx !== unsafeWindow && typeof unsafeWindow.XMLHttpRequest === "function" && !unsafeWindow.__aistudio_compressor_xhr_hooked) {
      unsafeWindow.XMLHttpRequest = WrappedXHR;
      unsafeWindow.__aistudio_compressor_xhr_hooked = true;
    }
  }

  function resolveUrl(url) {
    if (!url) return "";
    try {
      return new URL(url, location.origin).toString();
    } catch {
      return url;
    }
  }

  function bodyToText(body) {
    if (!body) return null;
    if (typeof body === "string") return body;
    if (body instanceof ArrayBuffer) {
      try { return new TextDecoder().decode(body); } catch { return null; }
    }
    if (ArrayBuffer.isView(body)) {
      try { return new TextDecoder().decode(body.buffer); } catch { return null; }
    }
    return null;
  }

  function isTargetRequest(url, key = "GENERATE") {
    try {
      const parsed = new URL(url, location.origin);
      return parsed.pathname.endsWith(Config.TARGETS[key]);
    } catch {
      return false;
    }
  }

  // ---------------------------
  // Compression lifecycle
  // ---------------------------

  const Compression = {
    run() {
      if (state.compressionInProgress) return;
      const textarea = UI.findInput();
      if (!textarea) {
        alert("未找到输入框，请确保处于 prompts 对话页面。");
        return;
      }
      const prompt = getCompressPrompt();
      Compression.prepareRunContext();
      state.activeCompressionPrompt = prompt;
      state.activeCompressionSnippet = deriveSnippet(prompt);
      state.compressionInProgress = true;
      state.compressionRequestPending = true;
      state.compressionResponsePending = false;
      UI.setButtonLoading(true);
      setTextareaValue(textarea, prompt);
      textarea.focus();
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt, inputType: "insertText" }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
      enableSendButton();
      sendCompressionRequest(textarea).then(sent => {
        if (sent) return;
        Compression.finalizeRun();
      });
    },

    prepareRunContext() {
      state.lastPromptHistory = null;
      state.lastPromptHistoryUpdatedAt = 0;
      state.pendingBranchTurns = null;
      state.historyCapturePending = true;
      state.compressionRequestPending = false;
      state.compressionResponsePending = false;
    },

    handleRequestEvent(event) {
      const detail = event?.detail;
      if (!detail?.bodyText) return;
      const isCompressionBody = Compression.isCompressionPrompt(detail.bodyText);

      if (isCompressionBody && state.historyCapturePending) {
        state.historyCapturePending = false;
        const payload = safeParseJSON(detail.bodyText);
        if (payload) {
          state.lastPromptHistory = payload;
          state.lastPromptHistoryUpdatedAt = Date.now();
        }
      }

      if (isCompressionBody && state.compressionInProgress) {
        state.compressionRequestPending = false;
        state.compressionResponsePending = true;
      }
    },

    handleResponseEvent(event) {
      if (!state.compressionInProgress || !state.compressionResponsePending) return;
      const detail = event?.detail;
      if (!detail?.bodyText) {
        Compression.finalizeRun();
        return;
      }
      const data = safeParseJSON(detail.bodyText);
      if (!data) {
        Compression.finalizeRun();
        return;
      }
      const snapshot = extractStateSnapshot(data);
      if (!snapshot) {
        Compression.finalizeRun();
        return;
      }
      rebuildConversation(snapshot).catch(err => {
        log.net("Failed to rebuild conversation", err);
      });
      Compression.finalizeRun();
    },

    finalizeRun() {
      state.compressionRequestPending = false;
      state.compressionResponsePending = false;
      state.compressionInProgress = false;
      state.historyCapturePending = false;
      UI.setButtonLoading(false);
    },

    isCompressionPrompt(bodyText) {
      if (typeof bodyText !== "string") return false;
      const snippet = state.activeCompressionSnippet || deriveSnippet(getCompressPrompt());
      if (!snippet) return bodyText.includes(Config.PROMPTS.SNIPPET);
      const variants = buildSnippetVariants(snippet);
      for (const candidate of variants) {
        if (candidate && bodyText.includes(candidate)) return true;
      }
      return false;
    }
  };

  function enableSendButton() {
    const sendButton = UI.findSendButton();
    if (sendButton) {
      sendButton.removeAttribute("disabled");
      sendButton.removeAttribute("aria-disabled");
      sendButton.disabled = false;
      sendButton.classList.remove("disabled");
    }
  }

  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function nextFrame() { return new Promise(resolve => requestAnimationFrame(() => resolve())); }

  async function waitForCompressionRequestCapture(timeoutMs = 1800) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!state.compressionInProgress) return false;
      if (state.compressionResponsePending || !state.compressionRequestPending) return true;
      await delay(50);
    }
    return state.compressionResponsePending || !state.compressionRequestPending;
  }

  function dispatchPointerClickSequence(el) {
    if (!el || typeof el.dispatchEvent !== "function") return false;
    const doc = el.ownerDocument || document;
    const view = doc.defaultView || window;
    const rect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const centerX = rect.left + (rect.width || 0) / 2;
    const centerY = rect.top + (rect.height || 0) / 2;
    const eventSteps = [
      { type: "pointerdown", pointer: true, buttons: 1, detail: 0 },
      { type: "mousedown", buttons: 1, detail: 1 },
      { type: "pointerup", pointer: true, buttons: 0, detail: 0 },
      { type: "mouseup", buttons: 0, detail: 1 },
      { type: "click", buttons: 0, detail: 1 }
    ];

    try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch {} }

    for (const step of eventSteps) {
      const init = {
        bubbles: true, cancelable: true, composed: true, view,
        clientX: centerX, clientY: centerY, button: 0, buttons: step.buttons, detail: step.detail
      };
      const event = (step.pointer && typeof view.PointerEvent === "function")
        ? new view.PointerEvent(step.type, { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true })
        : new view.MouseEvent(step.type, init);
      el.dispatchEvent(event);
    }
    return true;
  }

  function triggerKeyboardSend(textarea) {
    const doc = textarea.ownerDocument || document;
    const view = doc.defaultView || window;
    const keyOptions = { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true, view };
    if (env.isMac) keyOptions.metaKey = true; else keyOptions.ctrlKey = true;
    textarea.dispatchEvent(new view.KeyboardEvent("keydown", keyOptions));
    textarea.dispatchEvent(new view.KeyboardEvent("keyup", keyOptions));
  }

  async function sendPromptWithRetries(textarea, options = {}) {
    const clickPlan = [
      { label: "immediate", delayMs: 0, useFrame: false },
      { label: "next-frame", delayMs: 0, useFrame: true },
      { label: "delay-80ms", delayMs: 80, useFrame: false },
      { label: "delay-220ms", delayMs: 220, useFrame: false }
    ];
    const verifyFn = typeof options.verifyFn === "function" ? options.verifyFn : null;
    const abortCheck = typeof options.abortCheck === "function" ? options.abortCheck : null;

    for (const step of clickPlan) {
      if (step.useFrame) await nextFrame(); else if (step.delayMs > 0) await delay(step.delayMs);
      if (abortCheck && abortCheck()) return false;

      enableSendButton();
      const sendButton = UI.findSendButton();
      if (!sendButton) continue;

      dispatchPointerClickSequence(sendButton);
      if (!verifyFn || await verifyFn()) return true;
    }

    triggerKeyboardSend(textarea);
    if (!verifyFn || await verifyFn()) return true;
    return false;
  }

  async function sendCompressionRequest(textarea) {
    return sendPromptWithRetries(textarea, {
      labelPrefix: "Compression request",
      verifyFn: () => waitForCompressionRequestCapture(),
      abortCheck: () => !state.compressionInProgress
    });
  }

  function setTextareaValue(textarea, value) {
    if ("value" in textarea) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      const setter = descriptor?.set;
      if (setter) {
        setter.call(textarea, value);
        return;
      }
      textarea.value = value;
    } else {
      textarea.textContent = value;
    }
  }

  // ---------------------------
  // Conversation rebuild & branch creation
  // ---------------------------

  async function rebuildConversation(snapshotText) {
    const turns = await getRebuildSourceTurns();
    if (!turns.length) return;
    const sanitizedTurns = stripCompressionArtifacts(turns);
    if (!sanitizedTurns.length) return;
    const preserved = pickTailTurns(sanitizedTurns);

    const ackReply = getAckMessage();

    const newTurns = [
      createTurn("user", snapshotText),
      createTurn("model", ackReply),
      ...preserved
    ];
    state.pendingBranchTurns = newTurns;
    Branching.branchFromHere().catch(err => {
      log.net("Compressed branch creation failed", err);
    });
  }

  // 关键升级：内置优先截取 <state_snapshot>，自动剔除前置思考草稿
  function extractStateSnapshot(events) {
    const fullText = collectModelOutputText(events);
    if (!fullText) return null;

    const pattern = getSnapshotRegex();
    if (pattern) {
      const matched = matchByRegex(fullText, pattern);
      if (matched) return matched.trim();
    }

    // 智能兜底：如果用户正则没生效，自动尝试提取 <state_snapshot>
    const fallbackMatch = matchByRegex(fullText, DEFAULT_SNAPSHOT_REGEX);
    if (fallbackMatch) {
      return fallbackMatch.trim();
    }

    return fullText.trim();
  }

  function collectModelOutputText(events) {
    const eventList = normalizeEvents(events);
    if (!eventList.length) return "";
    let buffer = "";
    for (const event of eventList) {
      const candidates = Array.isArray(event?.[0]) ? event[0] : null;
      if (!candidates) continue;
      for (const candidate of candidates) {
        if (!Array.isArray(candidate)) continue;
        const contentBlock = Array.isArray(candidate[0]) ? candidate[0] : null;
        if (!contentBlock) continue;
        const parts = Array.isArray(contentBlock[0]) ? contentBlock[0] : null;
        if (!parts) continue;
        for (const part of parts) {
          if (!Array.isArray(part)) continue;
          const text = part[1];
          const isThought = Boolean(part[12]);
          if (typeof text === "string" && !isThought) {
            buffer += text;
          }
        }
      }
    }
    return buffer;
  }

  function normalizeEvents(payload) {
    if (!Array.isArray(payload)) return [];
    if (payload.length === 1 && Array.isArray(payload[0])) {
      const inner = payload[0];
      if (inner.every(item => Array.isArray(item))) return inner;
    }
    return payload;
  }

  function extractTurns(payload) {
    try {
      if (!Array.isArray(payload)) return [];
      const rawTurns = payload[1];
      if (!Array.isArray(rawTurns)) return [];
      const turns = [];
      for (const entry of rawTurns) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const role = entry[1];
        const text = extractTurnText(entry[0], role);
        if (typeof role === "string" && text) {
          turns.push({ role, text, entry: deepClone(entry) });
        }
      }
      return turns;
    } catch (err) {
      return [];
    }
  }

  async function getRebuildSourceTurns() {
    const currentPromptId = Branching.getCurrentPromptId();
    if (state.lastResolvedPromptThread?.length) {
      if (!currentPromptId || !state.lastResolvedPromptId || state.lastResolvedPromptId === currentPromptId) {
        const resolvedTurns = extractResolvedTurns(state.lastResolvedPromptThread);
        if (resolvedTurns.length) return resolvedTurns;
      }
    }

    const fetchedCapture = await ensureResolvedPromptThread(currentPromptId);
    if (fetchedCapture?.entries?.length) {
      const fetchedTurns = extractResolvedTurns(fetchedCapture.entries);
      if (fetchedTurns.length) return fetchedTurns;
    }

    if (!state.lastPromptHistory) return [];
    return extractTurns(state.lastPromptHistory);
  }

  async function ensureResolvedPromptThread(promptId) {
    if (!promptId) return null;
    if (state.lastResolvedPromptThread?.length && (!state.lastResolvedPromptId || state.lastResolvedPromptId === promptId)) {
      return {
        promptId: state.lastResolvedPromptId || promptId,
        title: getResolvedPromptTitle(state.lastResolvedPromptRoot),
        root: state.lastResolvedPromptRoot ? deepClone(state.lastResolvedPromptRoot) : null,
        entries: state.lastResolvedPromptThread.map(entry => deepClone(entry))
      };
    }
    return fetchResolvedPromptThread(promptId);
  }

  async function fetchResolvedPromptThread(promptId) {
    const authHeader = await buildSapisidAuthHeader();
    if (!authHeader) return null;
    const endpoint = `${Config.NETWORK.RPC_ORIGIN}${Config.TARGETS.RESOLVE}`;
    const apiKey = getGoogleApiKey();
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json+protobuf",
          "x-goog-api-key": apiKey,
          "x-goog-authuser": "0",
          authorization: authHeader
        },
        body: JSON.stringify([promptId])
      });
      const bodyText = await response.text();
      if (!response.ok) return null;
      const capture = extractResolvedPromptThread(safeParseJSON(bodyText));
      if (!capture?.entries?.length) return null;
      rememberResolvedPromptCapture(capture, "Fetched resolved prompt thread on demand");
      return capture;
    } catch (err) {
      return null;
    }
  }

  function getCookieValue(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : "";
  }

  function getHeaderValue(headers, name) {
    if (!headers || typeof headers !== "object" || !name) return "";
    const normalizedName = String(name).toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (String(key).toLowerCase() === normalizedName && typeof value === "string") {
        return value;
      }
    }
    return "";
  }

  function rememberGoogleApiKey(headers, sourceUrl = "") {
    const candidate = getHeaderValue(headers, "x-goog-api-key").trim();
    if (!candidate) return "";
    state.googleApiKey = candidate;
    state.googleApiKeyUpdatedAt = Date.now();
    return candidate;
  }

  function getGoogleApiKey() {
    const apiKey = (state.googleApiKey || "").trim();
    if (!apiKey) throw new Error("Google API key has not been captured yet; trigger one native AI Studio request first");
    return apiKey;
  }

  async function buildSapisidAuthHeader() {
    const sapisid = getCookieValue("SAPISID") || getCookieValue("__Secure-3PAPISID") || getCookieValue("APISID");
    if (!sapisid || !globalThis.crypto?.subtle) return null;
    const timestamp = Math.floor(Date.now() / 1000);
    const origin = location.origin;
    const encoder = new TextEncoder();
    const source = `${timestamp} ${sapisid} ${origin}`;
    const digest = await globalThis.crypto.subtle.digest("SHA-1", encoder.encode(source));
    const hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
    return `SAPISIDHASH ${timestamp}_${hash} SAPISID1PHASH ${timestamp}_${hash} SAPISID3PHASH ${timestamp}_${hash}`;
  }

  function extractResolvedTurns(entries) {
    if (!Array.isArray(entries)) return [];
    const turns = [];
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 9) continue;
      const role = entry[8];
      const text = extractResolvedEntryText(entry);
      if (typeof role === "string" && text) {
        turns.push({ role, text, entry: deepClone(entry) });
      }
    }
    return turns;
  }

  function extractResolvedEntryText(entry) {
    if (!Array.isArray(entry)) return "";
    if (typeof entry[0] === "string" && entry[0]) return entry[0];
    const parts = Array.isArray(entry[29]) ? entry[29] : null;
    if (!parts) return "";
    let buffer = "";
    for (const part of parts) {
      if (Array.isArray(part) && typeof part[1] === "string") {
        buffer += part[1];
      }
    }
    return buffer;
  }

  function rememberResolvedPromptCapture(capture, label = "Captured resolved prompt thread") {
    if (!capture?.entries?.length) return;
    state.lastResolvedPromptThread = capture.entries.map(entry => deepClone(entry));
    state.lastResolvedPromptRoot = Array.isArray(capture.root) ? deepClone(capture.root) : null;
    state.lastResolvedPromptId = capture.promptId;
    state.lastResolvedPromptUpdatedAt = Date.now();
  }

  function maybeCaptureResolvedPromptThread(url, bodyText, parsed = null) {
    if (!isTargetRequest(url, "RESOLVE") || typeof bodyText !== "string") return;
    const payload = parsed || safeParseJSON(bodyText);
    const capture = extractResolvedPromptThread(payload);
    if (capture?.entries?.length) rememberResolvedPromptCapture(capture);
  }

  function collectPromptIds(value, matches = [], seen = new Set()) {
    if (value == null) return matches;
    if (typeof value === "string") {
      const match = value.match(/(?:^|\b)prompts\/([^/?#\s"']+)/);
      if (match && !matches.includes(match[1])) matches.push(match[1]);
      return matches;
    }
    if (typeof value !== "object" || seen.has(value)) return matches;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) collectPromptIds(item, matches, seen);
      return matches;
    }
    for (const nested of Object.values(value)) collectPromptIds(nested, matches, seen);
    return matches;
  }

  function extractResolvedPromptThread(payload) {
    if (!Array.isArray(payload) || !Array.isArray(payload[0])) return null;
    const root = payload[0];
    if (!Array.isArray(root) || root.length < 14) return null;
    const threads = Array.isArray(root[13]) ? root[13] : null;
    const primaryThread = Array.isArray(threads?.[0]) ? threads[0] : null;
    if (!primaryThread?.length) return null;
    return {
      promptId: extractMutationPromptId(root),
      title: getResolvedPromptTitle(root),
      root: deepClone(root),
      entries: primaryThread.filter(Array.isArray).map(entry => deepClone(entry))
    };
  }

  function getResolvedPromptTitle(root) {
    const candidate = Array.isArray(root?.[4]) ? root[4][0] : null;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    const heading = document.querySelector("main h1")?.textContent || document.querySelector("h1")?.textContent || "";
    return heading.trim();
  }

  function buildDirectBranchCreateBody(capture, turnRecords = null) {
    const sourceRoot = Array.isArray(capture?.root) ? capture.root : state.lastResolvedPromptRoot;
    if (!Array.isArray(sourceRoot) || sourceRoot.length < 14) return null;
    const modelConfig = Array.isArray(sourceRoot[3]) ? deepClone(sourceRoot[3]) : null;
    if (!modelConfig) return null;
    const threads = Array.isArray(sourceRoot[13]) ? sourceRoot[13] : [];
    const secondaryThread = Array.isArray(threads[1]) ? deepClone(threads[1]) : [];
    const primaryThread = Array.isArray(turnRecords) && turnRecords.length
      ? turnRecords.map((turn, index) => buildMutationThreadEntry(turn, index))
      : (Array.isArray(threads[0]) ? deepClone(threads[0]) : []);
    if (!primaryThread.length) return null;
    const baseTitle = getResolvedPromptTitle(sourceRoot) || "Compressed Chat";
    const normalizedTitle = baseTitle.replace(/^branch of\s+/i, "").trim() || baseTitle;
    const branchTitle = `Compression of ${normalizedTitle}`;
    const createRoot = new Array(Math.max(14, sourceRoot.length)).fill(null);
    createRoot[3] = modelConfig;
    createRoot[4] = [branchTitle];
    createRoot[12] = Array.isArray(sourceRoot[12]) ? deepClone(sourceRoot[12]) : [];
    createRoot[13] = [primaryThread, secondaryThread];
    return JSON.stringify([createRoot]);
  }

  function stripCompressionArtifacts(turns) {
    if (!turns.length) return turns;
    const sanitized = turns.slice();
    let removedSnapshotTurn = false;

    while (sanitized.length) {
      const lastTurn = sanitized[sanitized.length - 1];
      if (isCompressionPromptTurn(lastTurn)) {
        sanitized.pop();
        removedSnapshotTurn = false;
        continue;
      }
      if (isCompressionSnapshotTurn(lastTurn)) {
        sanitized.pop();
        removedSnapshotTurn = true;
        continue;
      }
      if (removedSnapshotTurn && isThoughtOnlyTurn(lastTurn)) {
        sanitized.pop();
        continue;
      }
      break;
    }
    return sanitized;
  }

  function isCompressionPromptTurn(turn) {
    const snippet = state.activeCompressionSnippet || deriveSnippet(getCompressPrompt());
    return Boolean(turn?.role === "user" && typeof turn.text === "string" && snippet && turn.text.includes(snippet));
  }

  function isCompressionSnapshotTurn(turn) {
    if (turn?.role !== "model" || typeof turn.text !== "string" || !turn.text) return false;
    if (/<state_snapshot>[\s\S]*<\/state_snapshot>/i.test(turn.text)) return true;
    const pattern = getSnapshotRegex();
    if (pattern && matchByRegex(turn.text, pattern)) return true;
    return /<scratchpad>/i.test(turn.text) && /state[_ -]?snapshot/i.test(turn.text);
  }

  function isThoughtOnlyTurn(turn) {
    return Boolean(turn?.role === "model" && Array.isArray(turn.entry) && turn.entry.length >= 33 && turn.entry[19] === 1);
  }

  function extractTurnText(rawContent, role) {
    if (!rawContent) return "";
    if (typeof rawContent === "string") return rawContent;
    if (!Array.isArray(rawContent)) return "";

    let buffer = "";
    const shouldSkipFirstBlock = role === "model";
    let skipThoughtChunk = shouldSkipFirstBlock;
    let skippedChunk = "";
    for (const block of rawContent) {
      if (!Array.isArray(block)) continue;
      if (Boolean(block[12])) continue;
      const chunk = block[1];
      if (typeof chunk === "string") {
        if (skipThoughtChunk) {
          skipThoughtChunk = false;
          skippedChunk = chunk;
          continue;
        }
        buffer += chunk;
      }
    }
    return buffer || skippedChunk;
  }

  function pickTailTurns(turns) {
    if (!turns.length) return [];
    const fullText = turns.map(t => t.text).join("\n");
    const { percent, minChars } = getTailRetentionConfig();
    if (percent >= 100) return turns.slice();
    const computedTarget = Math.floor(fullText.length * (percent / 100));
    const targetLength = Math.min(fullText.length, Math.max(minChars, computedTarget));
    if (targetLength <= 0) return [];
    let acc = 0;
    let startIndex = turns.length - 1;
    while (startIndex >= 0) {
      acc += turns[startIndex].text.length;
      if (acc >= targetLength && turns[startIndex].role === "user") break;
      startIndex--;
    }
    startIndex = Math.max(0, startIndex);
    while (startIndex > 0 && turns[startIndex].role !== "user") startIndex--;
    return turns.slice(startIndex);
  }

  function createTurn(role, text) { return { role, text }; }

  // ---------------------------
  // Branching controls
  // ---------------------------

  const Branching = {
    async branchFromHere() {
      if (state.branchInProgress) return;
      state.branchInProgress = true;
      try {
        const promptChange = await Branching.branchFromHereViaCreatePrompt();
        const basePath = Branching.getPromptBasePath();
        location.assign(`${location.origin}${basePath}${promptChange.promptId}`);
      } catch (err) {
        state.pendingBranchTurns = null;
        throw err;
      } finally {
        state.branchInProgress = false;
      }
    },

    async branchFromHereViaCreatePrompt() {
      const previousPromptId = Branching.getCurrentPromptId();
      if (!previousPromptId) throw new Error("current prompt id not found");
      if (!state.pendingBranchTurns?.length) throw new Error("no pending turns available");
      const capture = await ensureResolvedPromptThread(previousPromptId);
      const body = buildDirectBranchCreateBody(capture, state.pendingBranchTurns);
      if (!body) throw new Error("unable to build CreatePrompt branch payload");
      const authHeader = await buildSapisidAuthHeader();
      if (!authHeader) throw new Error("unable to build SAPISIDHASH auth header");

      const pendingBranchTurns = state.pendingBranchTurns;
      const apiKey = getGoogleApiKey();
      state.pendingBranchTurns = null;
      try {
        const response = await fetch(`${Config.NETWORK.RPC_ORIGIN}${Config.TARGETS.CREATE_PROMPT}`, {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json+protobuf",
            "x-goog-api-key": apiKey,
            "x-goog-authuser": "0",
            authorization: authHeader
          },
          body
        });
        const bodyText = await response.text();
        if (!response.ok) throw new Error(`CreatePrompt failed: ${response.status}`);
        const parsed = safeParseJSON(bodyText);
        const promptId = Branching.pickCreatedPromptId(parsed, previousPromptId);
        if (!promptId) throw new Error("No prompt id returned");
        return { promptId, via: "direct-create-prompt" };
      } catch (err) {
        state.pendingBranchTurns = pendingBranchTurns;
        throw err;
      }
    },

    pickCreatedPromptId(payload, previousPromptId = null) {
      const topLevelPrompt = typeof payload?.[0] === "string" ? payload[0] : "";
      const topLevelMatch = topLevelPrompt.match(/(?:^|\/)prompts\/([^/?#]+)/);
      if (topLevelMatch && (!previousPromptId || topLevelMatch[1] !== previousPromptId)) {
        return topLevelMatch[1];
      }
      const promptIds = collectPromptIds(payload);
      return promptIds.find(id => id && id !== previousPromptId) || null;
    },

    getPromptBasePath() {
      const path = location.pathname || "";
      const match = path.match(/^(.*\/prompts\/)/);
      return match ? match[1] : "/prompts/";
    },

    getCurrentPromptId() {
      const path = location.pathname || "";
      const match = path.match(/\/prompts\/([^/?#]+)/);
      return match ? match[1] : null;
    }
  };

  // ---------------------------
  // UI module
  // ---------------------------

  const UI = {
    init() {
      UI.injectButton();
      window.addEventListener("DOMContentLoaded", () => UI.injectButton());
      window.addEventListener("load", () => UI.injectButton());
      const observer = new MutationObserver(() => UI.injectButton());

      function startObserver() {
        for (const doc of UI.getCandidateDocuments()) {
          if (doc.body) observer.observe(doc.body, { childList: true, subtree: true });
        }
      }
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startObserver, { once: true });
      } else {
        startObserver();
      }
      setInterval(() => UI.injectButton(), 2000);
    },

    injectButton() {
      if (!window.location.href.includes(Config.UI.TARGET_PATH)) return;
      for (const doc of UI.getCandidateDocuments()) {
        if (doc.getElementById(Config.UI.BUTTON_ID)) return;
        const toolbar = UI.findToolbar(doc);
        if (!toolbar) continue;
        const button = UI.createButton(doc);
        const moreButton = toolbar.querySelector(
          'button[iconname="more_vert"], button[aria-label="View more actions"], button[aria-label="More actions"], button[aria-label="More options"]'
        );
        let referenceNode = null;
        if (moreButton) {
          referenceNode = (moreButton.parentElement === toolbar) ? moreButton : moreButton.parentElement;
        }
        if (referenceNode) {
          toolbar.insertBefore(button, referenceNode);
        } else {
          toolbar.appendChild(button);
        }
        return;
      }
    },

    findToolbar(doc) {
      const selectors = Array.isArray(Config.UI.TOOLBAR_SELECTORS)
        ? Config.UI.TOOLBAR_SELECTORS
        : [Config.UI.TOOLBAR_SELECTORS].filter(Boolean);
      for (const selector of selectors) {
        const nodes = Array.from(doc.querySelectorAll(selector));
        for (const node of nodes) {
          if (UI.isToolbarCandidate(node)) return node;
        }
      }
      return null;
    },

    isToolbarCandidate(node) {
      if (!node || typeof node.querySelector !== "function") return false;
      return Boolean(
        node.querySelector('button[iconname="more_vert"], button[aria-label*="actions"]') ||
        node.querySelector('button[aria-label="Toggle run settings panel"]') ||
        node.querySelector('button[aria-label="New chat"]')
      );
    },

    createButton(doc = document) {
      UI.ensureStyles(doc);
      const button = doc.createElement("button");
      button.id = Config.UI.BUTTON_ID;
      button.title = "Compress Chat History (一键压缩会话)";
      button.setAttribute("ms-button", "");
      button.setAttribute("variant", "icon-borderless");
      button.className = "mat-mdc-tooltip-trigger ms-button-borderless ms-button-icon";
      button.type = "button";
      button.addEventListener("click", Compression.run);

      const iconSpan = doc.createElement("span");
      iconSpan.className = "material-symbols-outlined notranslate ms-button-icon-symbol compressor-icon";
      iconSpan.textContent = "docs";
      button.appendChild(iconSpan);

      const spinnerSpan = doc.createElement("span");
      spinnerSpan.className = "compressor-spinner";
      button.appendChild(spinnerSpan);

      return button;
    },

    ensureStyles(doc) {
      const styleId = `${Config.UI.BUTTON_ID}-style`;
      if (doc.getElementById(styleId)) return;
      const style = doc.createElement("style");
      style.id = styleId;
      style.textContent = `@keyframes aistudio-compressor-spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}
#${Config.UI.BUTTON_ID} {
    position: relative;
    width: 36px !important;
    min-width: 36px !important;
    height: 36px !important;
    padding: 6px !important;
    border-radius: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
}
#${Config.UI.BUTTON_ID} .compressor-spinner {
    box-sizing: border-box;
    width: 20px;
    height: 20px;
    border: 2px solid rgba(0, 0, 0, 0.2);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: aistudio-compressor-spin 0.8s linear infinite;
    display: none;
}
#${Config.UI.BUTTON_ID}.compressor-loading .compressor-spinner {
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
#${Config.UI.BUTTON_ID}.compressor-loading .compressor-icon {
    display: none;
}`;
      (doc.head || doc.documentElement || doc.body)?.appendChild(style);
    },

    findInput() {
      for (const doc of UI.getCandidateDocuments()) {
        for (const selector of Config.UI.INPUT_SELECTORS) {
          const el = doc.querySelector(selector);
          if (el) return el;
        }
      }
      return null;
    },

    findSendButton() {
      for (const doc of UI.getCandidateDocuments()) {
        for (const selector of Config.UI.SEND_BUTTON_SELECTORS) {
          const btn = doc.querySelector(selector);
          if (btn) return btn;
        }
      }
      return null;
    },

    getCandidateDocuments() {
      const docs = [document];
      const frameDoc = document.querySelector('iframe[src*="bscframe"]')?.contentDocument;
      if (frameDoc && frameDoc !== document) docs.push(frameDoc);
      return docs;
    },

    setButtonLoading(isLoading) {
      const button = UI.findButton();
      if (!button) return;
      if (isLoading) {
        button.classList.add("compressor-loading");
        button.setAttribute("disabled", "true");
      } else {
        button.classList.remove("compressor-loading");
        button.removeAttribute("disabled");
      }
    },

    findButton() {
      for (const doc of UI.getCandidateDocuments()) {
        const btn = doc.getElementById(Config.UI.BUTTON_ID);
        if (btn) return btn;
      }
      return null;
    }
  };

  // ---------------------------
  // Mutation Builders & Helpers
  // ---------------------------

  function extractMutationPromptId(root) {
    const resourceName = typeof root?.[0] === "string" ? root[0] : "";
    const match = resourceName.match(/(?:^|\/)prompts\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  function buildMutationThreadEntry(turn, sequence = 0) {
    if (isReusablePromptThreadEntry(turn?.entry)) {
      const entry = deepClone(turn.entry);
      entry[0] = turn?.text || "";
      entry[8] = turn?.role === "model" ? "model" : "user";
      if (Array.isArray(entry[21]) && typeof entry[21][0] === "string" && /(?:^|\/)prompts\//.test(entry[21][0])) {
        entry[21] = null;
      }
      entry[32] = buildEntryTimestamp(sequence);
      return entry;
    }
    return buildCreatePromptEntry(turn, sequence);
  }

  function isReusablePromptThreadEntry(entry) {
    return Array.isArray(entry) && entry.length >= 33 && typeof entry[8] === "string";
  }

  function buildCreatePromptEntry(turn, sequence = 0) {
    const text = turn?.text || "";
    const role = turn?.role === "model" ? "model" : "user";
    const entry = new Array(33).fill(null);
    entry[0] = text;
    entry[8] = role;
    const tokenEstimate = estimateTokenCount(text);
    if (tokenEstimate > 0) entry[18] = tokenEstimate;
    entry[32] = buildEntryTimestamp(sequence);
    return entry;
  }

  function buildEntryTimestamp(sequence = 0) {
    const timestampMs = Date.now() + Math.max(0, Number(sequence) || 0);
    const seconds = Math.floor(timestampMs / 1000);
    const nanos = (timestampMs % 1000) * 1_000_000;
    return [seconds, nanos];
  }

  function estimateTokenCount(text) {
    if (!text) return 0;
    return Math.max(1, Math.round(text.length / 4));
  }

  function deepClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function safeParseJSON(text) {
    if (typeof text !== "string") return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  function buildSnippetVariants(snippet) {
    if (typeof snippet !== "string" || !snippet) return [];
    const variants = [snippet];
    const escaped = escapeForJSON(snippet);
    if (escaped && escaped !== snippet) variants.push(escaped);
    return variants;
  }

  function escapeForJSON(text) {
    try {
      const encoded = JSON.stringify(text);
      return typeof encoded === "string" ? encoded.slice(1, -1) : text;
    } catch {
      return text;
    }
  }

  function matchByRegex(text, pattern) {
    if (!pattern) return null;
    try {
      const regex = new RegExp(pattern, "s");
      const result = text.match(regex);
      return result ? result[0] : null;
    } catch (err) {
      return null;
    }
  }

  function bootstrap() {
    const runtimeInfo = {
      version: SCRIPT_VERSION,
      href: location.href,
      loadedAt: new Date().toISOString()
    };
    env.topWindow.__AISTUDIO_COMPRESSOR_RUNTIME__ = runtimeInfo;

    installTopLevelHandlers();
    registerMenuCommands();
    installSettingsMessageBridge();
    NetworkMonitor.init();
    if (!env.isAppContext) {
      UI.init();
    }
  }

  bootstrap();

})();
