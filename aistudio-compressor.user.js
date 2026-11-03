// ==UserScript==
// @name         AI Studio Chat Compressor (PC Edition)
// @namespace    https://fujimaodefuji.github.io/aistudio-compressor
// @version      0.5.2-pc
// @description  在 Google AI Studio 提供一键压缩聊天记录、注入快照、监控 GenerateContent 请求的工具 (PC 电脑专版) | Windows/Mac Chrome/Edge 专享稳定版
// @author       fujimaodefuji
// @match        https://aistudio.google.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    "use strict";

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
    const SCRIPT_VERSION = "0.5.2-pc";

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
            if (parsed && typeof parsed === "object") return { ...DEFAULT_SETTINGS, ...parsed };
            return { ...DEFAULT_SETTINGS };
        } catch (err) {
            return { ...DEFAULT_SETTINGS };
        }
    }

    function persistUserSettings() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(userSettings)); } catch (err) {}
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
        try { return new URL(url, location.href).origin; } catch { return null; }
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
        if (!payload || typeof payload !== "object") return { ...DEFAULT_SETTINGS };
        const next = { ...DEFAULT_SETTINGS };
        if (typeof payload.activePreset === "string") next.activePreset = payload.activePreset;
        if (typeof payload.compressPrompt === "string") next.compressPrompt = payload.compressPrompt.trim() || Config.PROMPTS.FULL;
        if (typeof payload.ackMessage === "string") next.ackMessage = payload.ackMessage.trim() || DEFAULT_SETTINGS.ackMessage;
        if (typeof payload.snapshotRegex === "string") next.snapshotRegex = payload.snapshotRegex.trim() || DEFAULT_SNAPSHOT_REGEX;
        if (payload.tailPercent != null) {
            const p = Number(payload.tailPercent);
            if (Number.isFinite(p)) next.tailPercent = Math.min(Math.max(p, 0), 100);
        }
        if (payload.tailMinChars != null) {
            const m = Number(payload.tailMinChars);
            if (Number.isFinite(m) && m >= 0) next.tailMinChars = Math.floor(m);
        }
        return next;
    }

    function scheduleSettingsHydration(win) {
        if (!win) return;
        const targetOrigin = settingsOrigin || "*";
        const message = { source: "aistudio-compressor", type: "hydrate", payload: getSettingsSnapshot() };
        let attempts = 0;
        const timer = setInterval(() => {
            if (!win || win.closed || ++attempts >= 10) { clearInterval(timer); return; }
            try { win.postMessage(message, targetOrigin); } catch (e) {}
        }, 1200);
    }

    function installSettingsMessageBridge() {
        window.addEventListener("message", event => {
            if (!event?.data || event.data.source !== "aistudio-compressor") return;
            if (settingsOrigin && event.origin !== settingsOrigin) return;
            if (event.data.type === "update-settings" && event.data.payload) {
                updateUserSettings(normalizeSettingsPayload(event.data.payload));
                if (!state.compressionInProgress) refreshActivePromptFromSettings();
            }
        });
    }

    function openSettingsWindow() {
        const targetUrl = Config.SETTINGS?.PAGE_URL;
        if (!targetUrl) return alert("未配置设置页面 URL。");
        const win = window.open(targetUrl, "aistudio_compressor_settings", "width=750,height=800,resizable=yes,scrollbars=yes");
        scheduleSettingsHydration(win);
    }

    function resetSettingsToDefault() {
        if (!confirm("确认恢复 Compressor 设置为默认值？")) return;
        userSettings = { ...DEFAULT_SETTINGS };
        persistUserSettings();
        if (!state.compressionInProgress) refreshActivePromptFromSettings();
        alert("已恢复默认设置。");
    }

    function registerMenuCommands() {
        if (typeof GM_registerMenuCommand !== "function") return;
        GM_registerMenuCommand("⚡ 立即压缩当前会话 (Run Compression)", () => Compression.run());
        GM_registerMenuCommand("⚙️ 打开 Compressor 设置...", () => openSettingsWindow());
        GM_registerMenuCommand("♻️ 重置 Compressor 设置", () => resetSettingsToDefault());
    }

    function installTopLevelHandlers() {
        if (!env.topWindow.__aistudio_compressor_handlers_installed) {
            env.topWindow.addEventListener(Config.EVENTS.REQUEST, Compression.handleRequestEvent);
            env.topWindow.addEventListener(Config.EVENTS.RESPONSE, Compression.handleResponseEvent);
            env.topWindow.__aistudio_compressor_handlers_installed = true;
        }
    }

    function emitNetworkEvent(name, detail) {
        try { env.topWindow.dispatchEvent(new CustomEvent(name, { detail })); } catch (err) {}
    }

    const NetworkMonitor = {
        init() {
            hookContext(window);
            window.addEventListener("DOMContentLoaded", () => hookContext(window));
            window.addEventListener("load", () => hookContext(window));
        }
    };

    function hookContext(ctx) {
        if (!ctx) return;
        installFetchHook(ctx);
        installXHRHook(ctx);
    }

    function installFetchHook(ctx) {
        if (!ctx || typeof ctx.fetch !== "function" || ctx.__aistudio_compressor_fetch_hooked) return;
        const originalFetch = ctx.fetch.bind(ctx);
        ctx.fetch = async function (input, init = {}) {
            const request = input instanceof Request ? input : new Request(input, init);
            const isGenerate = isTargetRequest(request.url, "GENERATE");
            const isResolve = isTargetRequest(request.url, "RESOLVE");

            if (isGenerate) {
                try {
                    const cloned = request.clone();
                    const bodyText = await cloned.text();
                    const headers = Object.fromEntries(cloned.headers.entries());
                    rememberGoogleApiKey(headers, cloned.url);
                    emitNetworkEvent(Config.EVENTS.REQUEST, { url: cloned.url, headers, bodyText });
                } catch (e) {}
            }

            const response = await originalFetch(request);

            if (isGenerate || isResolve) {
                try {
                    const clonedRes = response.clone();
                    const bodyText = await clonedRes.text();
                    maybeCaptureResolvedPromptThread(request.url, bodyText);
                    emitNetworkEvent(Config.EVENTS.RESPONSE, {
                        url: request.url,
                        status: response.status,
                        statusText: response.statusText,
                        bodyText
                    });
                } catch (e) {}
            }
            return response;
        };
        ctx.__aistudio_compressor_fetch_hooked = true;
        if (ctx !== unsafeWindow && typeof unsafeWindow.fetch === "function") {
            unsafeWindow.fetch = ctx.fetch;
        }
    }

    function installXHRHook(ctx) {
        if (!ctx || typeof ctx.XMLHttpRequest !== "function" || ctx.__aistudio_compressor_xhr_hooked) return;
        const OriginalXHR = ctx.XMLHttpRequest;
        function WrappedXHR() {
            const realXHR = new OriginalXHR();
            let monitored = false;
            let requestUrl = null;
            const requestHeaders = {};

            const origOpen = realXHR.open;
            realXHR.open = function (...args) {
                requestUrl = args[1] || null;
                monitored = Boolean(requestUrl) && (isTargetRequest(requestUrl, "GENERATE") || isTargetRequest(requestUrl, "RESOLVE"));
                return origOpen.apply(this, args);
            };

            const origSetHeader = realXHR.setRequestHeader;
            realXHR.setRequestHeader = function (name, value) {
                if (typeof name === "string") {
                    requestHeaders[name] = value;
                    rememberGoogleApiKey(requestHeaders, resolveUrl(requestUrl));
                }
                return origSetHeader.apply(this, arguments);
            };

            const origSend = realXHR.send;
            realXHR.send = function (body) {
                if (monitored) {
                    const absoluteUrl = resolveUrl(requestUrl);
                    const bodyText = bodyToText(body);
                    rememberGoogleApiKey(requestHeaders, absoluteUrl);
                    emitNetworkEvent(Config.EVENTS.REQUEST, { url: absoluteUrl, headers: requestHeaders, bodyText });
                }
                return origSend.apply(this, arguments);
            };

            realXHR.addEventListener("readystatechange", function () {
                if (realXHR.readyState === 4 && monitored) {
                    const responseUrl = realXHR.responseURL || resolveUrl(requestUrl);
                    maybeCaptureResolvedPromptThread(responseUrl, realXHR.responseText);
                    emitNetworkEvent(Config.EVENTS.RESPONSE, {
                        url: responseUrl,
                        status: realXHR.status,
                        statusText: realXHR.statusText,
                        bodyText: realXHR.responseText
                    });
                }
            });
            return realXHR;
        }
        ctx.XMLHttpRequest = WrappedXHR;
        ctx.__aistudio_compressor_xhr_hooked = true;
    }

    function resolveUrl(url) {
        try { return new URL(url, location.origin).toString(); } catch { return url || ""; }
    }

    function bodyToText(body) {
        if (!body) return null;
        if (typeof body === "string") return body;
        try { return new TextDecoder().decode(body); } catch { return null; }
    }

    function isTargetRequest(url, key = "GENERATE") {
        try {
            const parsed = new URL(url, location.origin);
            return parsed.pathname.endsWith(Config.TARGETS[key]);
        } catch { return false; }
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
                if (!sent) Compression.finalizeRun();
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
            if (!detail?.bodyText) return Compression.finalizeRun();
            const data = safeParseJSON(detail.bodyText);
            if (!data) return Compression.finalizeRun();
            const snapshot = extractStateSnapshot(data);
            if (!snapshot) return Compression.finalizeRun();

            rebuildConversation(snapshot).catch(err => log.net("Rebuild conversation failed", err));
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
            return variants.some(candidate => candidate && bodyText.includes(candidate));
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

    function dispatchPointerClickSequence(el) {
        if (!el?.dispatchEvent) return false;
        const view = el.ownerDocument?.defaultView || window;
        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
        const cx = rect.left + (rect.width || 0) / 2;
        const cy = rect.top + (rect.height || 0) / 2;

        try { el.focus({ preventScroll: true }); } catch (e) {}

        const steps = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
        for (const type of steps) {
            const isPointer = type.startsWith("pointer");
            const evt = (isPointer && typeof view.PointerEvent === "function")
                ? new view.PointerEvent(type, { bubbles: true, cancelable: true, view, clientX: cx, clientY: cy, button: 0, buttons: 1 })
                : new view.MouseEvent(type, { bubbles: true, cancelable: true, view, clientX: cx, clientY: cy, button: 0, buttons: 1 });
            el.dispatchEvent(evt);
        }
        return true;
    }

    async function sendCompressionRequest(textarea) {
        await delay(120);
        enableSendButton();
        const btn = UI.findSendButton();
        if (btn) {
            dispatchPointerClickSequence(btn);
            return true;
        }
        const view = textarea.ownerDocument?.defaultView || window;
        const keyOptions = { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true, view, ctrlKey: !env.isMac, metaKey: env.isMac };
        textarea.dispatchEvent(new view.KeyboardEvent("keydown", keyOptions));
        textarea.dispatchEvent(new view.KeyboardEvent("keyup", keyOptions));
        return true;
    }

    function setTextareaValue(textarea, value) {
        if ("value" in textarea) {
            const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
            if (desc?.set) desc.set.call(textarea, value);
            else textarea.value = value;
        } else {
            textarea.textContent = value;
        }
    }

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
        Branching.branchFromHere().catch(err => log.net("Branch create failed", err));
    }

    function extractStateSnapshot(events) {
        const fullText = collectModelOutputText(events);
        if (!fullText) return null;
        const pattern = getSnapshotRegex();
        if (pattern) {
            const matched = matchByRegex(fullText, pattern);
            if (matched) return matched.trim();
        }
        const fallback = matchByRegex(fullText, DEFAULT_SNAPSHOT_REGEX);
        return fallback ? fallback.trim() : fullText.trim();
    }

    function collectModelOutputText(events) {
        const list = normalizeEvents(events);
        let buffer = "";
        for (const evt of list) {
            const candidates = Array.isArray(evt?.[0]) ? evt[0] : null;
            if (!candidates) continue;
            for (const c of candidates) {
                const parts = c?.[0]?.[0];
                if (!Array.isArray(parts)) continue;
                for (const p of parts) {
                    if (Array.isArray(p) && typeof p[1] === "string" && !p[12]) {
                        buffer += p[1];
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
            const rawTurns = payload?.[1];
            if (!Array.isArray(rawTurns)) return [];
            const turns = [];
            for (const entry of rawTurns) {
                const role = entry[1];
                const text = extractTurnText(entry[0], role);
                if (typeof role === "string" && text) {
                    turns.push({ role, text, entry: deepClone(entry) });
                }
            }
            return turns;
        } catch { return []; }
    }

    async function getRebuildSourceTurns() {
        const currentPromptId = Branching.getCurrentPromptId();
        if (state.lastResolvedPromptThread?.length) {
            if (!currentPromptId || !state.lastResolvedPromptId || state.lastResolvedPromptId === currentPromptId) {
                const turns = extractResolvedTurns(state.lastResolvedPromptThread);
                if (turns.length) return turns;
            }
        }
        const fetched = await ensureResolvedPromptThread(currentPromptId);
        if (fetched?.entries?.length) {
            const turns = extractResolvedTurns(fetched.entries);
            if (turns.length) return turns;
        }
        return state.lastPromptHistory ? extractTurns(state.lastPromptHistory) : [];
    }

    async function ensureResolvedPromptThread(promptId) {
        if (!promptId) return null;
        if (state.lastResolvedPromptThread?.length && (!state.lastResolvedPromptId || state.lastResolvedPromptId === promptId)) {
            return {
                promptId: state.lastResolvedPromptId || promptId,
                title: getResolvedPromptTitle(state.lastResolvedPromptRoot),
                root: state.lastResolvedPromptRoot ? deepClone(state.lastResolvedPromptRoot) : null,
                entries: state.lastResolvedPromptThread.map(e => deepClone(e))
            };
        }
        return fetchResolvedPromptThread(promptId);
    }

    async function fetchResolvedPromptThread(promptId) {
        const authHeader = await buildSapisidAuthHeader();
        if (!authHeader) return null;
        try {
            const res = await fetch(`${Config.NETWORK.RPC_ORIGIN}${Config.TARGETS.RESOLVE}`, {
                method: "POST",
                credentials: "include",
                headers: {
                    "content-type": "application/json+protobuf",
                    "x-goog-api-key": getGoogleApiKey(),
                    "x-goog-authuser": "0",
                    authorization: authHeader
                },
                body: JSON.stringify([promptId])
            });
            if (!res.ok) return null;
            const capture = extractResolvedPromptThread(safeParseJSON(await res.text()));
            if (capture?.entries?.length) rememberResolvedPromptCapture(capture);
            return capture;
        } catch { return null; }
    }

    function getCookieValue(name) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
        return match ? decodeURIComponent(match[1]) : "";
    }

    function rememberGoogleApiKey(headers, sourceUrl = "") {
        const key = headers?.["x-goog-api-key"] || "";
        if (key) {
            state.googleApiKey = key.trim();
            state.googleApiKeyUpdatedAt = Date.now();
        }
    }

    function getGoogleApiKey() {
        if (!state.googleApiKey) throw new Error("API key not captured yet");
        return state.googleApiKey;
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

    function extractResolvedTurns(entries) {
        if (!Array.isArray(entries)) return [];
        const turns = [];
        for (const entry of entries) {
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
        const parts = entry[29];
        if (!Array.isArray(parts)) return "";
        return parts.filter(Array.isArray).map(p => p[1] || "").join("");
    }

    function rememberResolvedPromptCapture(capture) {
        if (!capture?.entries?.length) return;
        state.lastResolvedPromptThread = capture.entries.map(e => deepClone(e));
        state.lastResolvedPromptRoot = Array.isArray(capture.root) ? deepClone(capture.root) : null;
        state.lastResolvedPromptId = capture.promptId;
        state.lastResolvedPromptUpdatedAt = Date.now();
    }

    function maybeCaptureResolvedPromptThread(url, bodyText) {
        if (!isTargetRequest(url, "RESOLVE") || typeof bodyText !== "string") return;
        const capture = extractResolvedPromptThread(safeParseJSON(bodyText));
        if (capture?.entries?.length) rememberResolvedPromptCapture(capture);
    }

    function collectPromptIds(value, matches = [], seen = new Set()) {
        if (!value || typeof value !== "object" || seen.has(value)) return matches;
        seen.add(value);
        if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === "string") {
                    const m = item.match(/(?:^|\b)prompts\/([^/?#\s"']+)/);
                    if (m && !matches.includes(m[1])) matches.push(m[1]);
                } else collectPromptIds(item, matches, seen);
            }
            return matches;
        }
        for (const v of Object.values(value)) collectPromptIds(v, matches, seen);
        return matches;
    }

    function extractResolvedPromptThread(payload) {
        const root = payload?.[0];
        if (!Array.isArray(root) || root.length < 14) return null;
        const primaryThread = root[13]?.[0];
        if (!Array.isArray(primaryThread) || !primaryThread.length) return null;
        return {
            promptId: extractMutationPromptId(root),
            title: getResolvedPromptTitle(root),
            root: deepClone(root),
            entries: primaryThread.filter(Array.isArray).map(e => deepClone(e))
        };
    }

    function getResolvedPromptTitle(root) {
        const candidate = root?.[4]?.[0];
        return (typeof candidate === "string" && candidate.trim()) ? candidate.trim() : "Compressed Chat";
    }

    function buildDirectBranchCreateBody(capture, turnRecords = null) {
        const sourceRoot = capture?.root || state.lastResolvedPromptRoot;
        if (!Array.isArray(sourceRoot) || sourceRoot.length < 14) return null;
        const modelConfig = deepClone(sourceRoot[3]);
        if (!modelConfig) return null;
        const threads = sourceRoot[13] || [];
        const primaryThread = turnRecords?.length
            ? turnRecords.map((turn, index) => buildMutationThreadEntry(turn, index))
            : deepClone(threads[0] || []);
        if (!primaryThread.length) return null;

        const baseTitle = getResolvedPromptTitle(sourceRoot);
        const branchTitle = `Compression of ${baseTitle.replace(/^branch of\s+/i, "")}`;
        const createRoot = new Array(Math.max(14, sourceRoot.length)).fill(null);
        createRoot[3] = modelConfig;
        createRoot[4] = [branchTitle];
        createRoot[12] = deepClone(sourceRoot[12] || []);
        createRoot[13] = [primaryThread, deepClone(threads[1] || [])];
        return JSON.stringify([createRoot]);
    }

    function stripCompressionArtifacts(turns) {
        if (!turns.length) return turns;
        const sanitized = turns.slice();
        let removedSnapshot = false;
        while (sanitized.length) {
            const last = sanitized[sanitized.length - 1];
            if (isCompressionPromptTurn(last)) {
                sanitized.pop();
                removedSnapshot = false;
                continue;
            }
            if (isCompressionSnapshotTurn(last)) {
                sanitized.pop();
                removedSnapshot = true;
                continue;
            }
            if (removedSnapshot && last?.role === "model" && last.entry?.[19] === 1) {
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
        return Boolean(pattern && matchByRegex(turn.text, pattern));
    }

    function extractTurnText(rawContent, role) {
        if (!rawContent) return "";
        if (typeof rawContent === "string") return rawContent;
        if (!Array.isArray(rawContent)) return "";
        let buffer = "";
        let skipThought = role === "model";
        for (const block of rawContent) {
            if (!Array.isArray(block) || block[12]) continue;
            if (typeof block[1] === "string") {
                if (skipThought) { skipThought = false; continue; }
                buffer += block[1];
            }
        }
        return buffer;
    }

    function pickTailTurns(turns) {
        if (!turns.length) return [];
        const fullText = turns.map(t => t.text).join("\n");
        const { percent, minChars } = getTailRetentionConfig();
        if (percent >= 100) return turns.slice();
        const targetLen = Math.min(fullText.length, Math.max(minChars, Math.floor(fullText.length * (percent / 100))));
        if (targetLen <= 0) return [];
        let acc = 0;
        let idx = turns.length - 1;
        while (idx >= 0) {
            acc += turns[idx].text.length;
            if (acc >= targetLen && turns[idx].role === "user") break;
            idx--;
        }
        idx = Math.max(0, idx);
        while (idx > 0 && turns[idx].role !== "user") idx--;
        return turns.slice(idx);
    }

    function createTurn(role, text) { return { role, text }; }

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
            const capture = await ensureResolvedPromptThread(previousPromptId);
            const body = buildDirectBranchCreateBody(capture, state.pendingBranchTurns);
            if (!body) throw new Error("unable to build branch payload");
            const authHeader = await buildSapisidAuthHeader();
            if (!authHeader) throw new Error("unable to build auth header");

            state.pendingBranchTurns = null;
            const res = await fetch(`${Config.NETWORK.RPC_ORIGIN}${Config.TARGETS.CREATE_PROMPT}`, {
                method: "POST",
                credentials: "include",
                headers: {
                    "content-type": "application/json+protobuf",
                    "x-goog-api-key": getGoogleApiKey(),
                    "x-goog-authuser": "0",
                    authorization: authHeader
                },
                body
            });
            if (!res.ok) throw new Error(`CreatePrompt failed: ${res.status}`);
            const promptId = Branching.pickCreatedPromptId(safeParseJSON(await res.text()), previousPromptId);
            if (!promptId) throw new Error("No prompt id returned");
            return { promptId };
        },

        pickCreatedPromptId(payload, previousPromptId = null) {
            const top = typeof payload?.[0] === "string" ? payload[0] : "";
            const m = top.match(/(?:^|\/)prompts\/([^/?#]+)/);
            if (m && (!previousPromptId || m[1] !== previousPromptId)) return m[1];
            return collectPromptIds(payload).find(id => id && id !== previousPromptId) || null;
        },

        getPromptBasePath() {
            const match = (location.pathname || "").match(/^(.*\/prompts\/)/);
            return match ? match[1] : "/prompts/";
        },

        getCurrentPromptId() {
            const match = (location.pathname || "").match(/\/prompts\/([^/?#]+)/);
            return match ? match[1] : null;
        }
    };

    // ---------------------------
    // UI module（PC 专属：完美匹配 Angular 工具栏）
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
            for (const selector of Config.UI.TOOLBAR_SELECTORS) {
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

        // PC 专属：严谨绑定 Angular Material 样式与类名
        createButton(doc = document) {
            UI.ensureStyles(doc);
            const button = doc.createElement("button");
            button.id = Config.UI.BUTTON_ID;
            button.title = "Compress Chat History (一键压缩会话)";
            button.setAttribute("ms-button", "");
            button.setAttribute("variant", "icon-borderless");
            button.setAttribute("mattooltip", "Compress Chat History");
            button.setAttribute("mattooltipposition", "below");
            button.setAttribute("iconname", "summarize");
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
            style.textContent = `
@keyframes aistudio-compressor-spin {
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

    function bootstrap() {
        installTopLevelHandlers();
        registerMenuCommands();
        installSettingsMessageBridge();
        NetworkMonitor.init();
        UI.init();
    }

    bootstrap();

})();