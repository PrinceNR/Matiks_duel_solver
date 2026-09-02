import { createInitialState, withCapture } from './state.js';
import { solvePuzzle } from './solver.js';

const STORAGE_KEY = 'logicDuelSolverState';
const MATIKS_URL = /^https:\/\/(?:www\.)?matiks\.com\//i;
const LOGIC_MODE_PATTERN = /\b(?:HCF|GCD|LCM|MOD|REMAINDER|SUM\s+OF\s+SQUARES?|PRIME\s+(?:FACTORS?|FACTORIZATION)|ROOTS?|SQUARES?|POWERS?|CUBES?)\b/i;
const lastAutoSubmissionByTab = new Map();
const lastCaptureFrameByTab = new Map();
const manualLogicSessionByTab = new Map();

chrome.tabs.onRemoved.addListener((tabId) => {
  lastAutoSubmissionByTab.delete(tabId);
  lastCaptureFrameByTab.delete(tabId);
  manualLogicSessionByTab.delete(tabId);
});

chrome.runtime.onInstalled.addListener(async (details) => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (!stored[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: createInitialState() });
  }
  if (details.reason === 'update') {
    // A code/manifest reload should never resume unattended submission with a
    // stale capture from the previous build.
    await chrome.storage.local.set({
      [STORAGE_KEY]: createInitialState(),
      autoFillSubmitEnabled: false,
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return undefined;

  if (message.type === 'SCAN_NOW') {
    scanNow(message.tabId, { submitLogic: Boolean(message.submitLogic) })
      .then((state) => sendResponse({ ok: true, result: state }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Could not solve the puzzle.' }));
    return true;
  }

  if (message.type === 'SET_AUTO_WATCH') {
    setAutoWatch(Boolean(message.enabled), message.tabId)
      .then((state) => sendResponse({ ok: true, result: state }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Could not change Auto Solver Mode.' }));
    return true;
  }

  if (message.type === 'FILL_ANSWER') {
    fillAnswer(message.answer, message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Could not fill the answer.' }));
    return true;
  }

  // Naya handler: Jab aap popup se "Solve & Submit" dabayein
  if (message.type === 'SOLVE_AND_SUBMIT') {
    solveAndSubmit(message.tabId)
      .then((state) => sendResponse({ ok: true, result: state }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Could not solve and submit.' }));
    return true;
  }

  if (message.type === 'LOGIC_TEXT_UPDATED') {
    if (sender.tab?.id && isMatiksUrl(sender.tab.url)) {
      // Logic Duel is intentionally click-to-solve. Its MutationObserver may
      // keep detecting new rounds, but it must never calculate, fill, or
      // submit those rounds in the background. Arithmetic duel behavior is
      // left unchanged.
      const rememberedLogicUrl = manualLogicSessionByTab.get(sender.tab.id);
      const isRememberedLogicSession = rememberedLogicUrl === sender.tab.url;
      if (isRememberedLogicSession || classifyPuzzleFamily(message.capture) === 'logic') {
        manualLogicSessionByTab.set(sender.tab.id, sender.tab.url);
        sendResponse({ ok: true });
        return true;
      }

      lastCaptureFrameByTab.set(sender.tab.id, sender.frameId || 0);
      saveCapture(message.capture).then(async (state) => {
        // Auto-fill watched rounds. Submission is controlled by the separate
        // popup preference and guarded against repeated DOM mutations.
        if (state.autoWatch && state.solution?.answer && isSafeAutomaticSolution(state)) {
          const settings = await chrome.storage.local.get('autoFillSubmitEnabled');
          const shouldSubmit = Boolean(settings.autoFillSubmitEnabled);
          const signature = `${state.mode || ''}|${state.value}|${state.solution.answer}`;
          const previous = lastAutoSubmissionByTab.get(sender.tab.id);
          const now = Date.now();
          const isRapidDuplicate = previous?.signature === signature && now - previous.time < 2500;

          if (!isRapidDuplicate) {
            lastAutoSubmissionByTab.set(sender.tab.id, { signature, time: now });
            await fillAnswer(state.solution.answer, sender.tab.id, shouldSubmit, sender.frameId || 0).catch(() => {});
          }
        }
      }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'GET_STATE') {
    readState().then((state) => sendResponse({ ok: true, result: state }));
    return true;
  }

  return undefined;
});

async function scanNow(requestedTabId, options = {}) {
  const tab = await resolveTab(requestedTabId);
  assertMatiksTab(tab);
  let extracted;
  try {
    extracted = await extractBestCaptureFromFrames(tab.id);
  } catch (error) {
    await saveCapture({});
    throw error;
  }

  lastCaptureFrameByTab.set(tab.id, extracted.frameId);
  const state = await saveCapture(extracted.capture);
  rememberPuzzleSession(tab, state.puzzleFamily);

  // A normal Solve Now click submits exactly one recognized Logic Duel
  // puzzle. Arithmetic/Sprint/Fast Finger still follow their existing path.
  if (options.submitLogic && state.puzzleFamily === 'logic') {
    if (!state.solution?.answer) {
      throw new Error('No valid Logic Duel solution found to submit.');
    }
    await fillAnswer(state.solution.answer, tab.id, true, extracted.frameId);
    const submitted = await writeState({
      ...state,
      status: `Solved and submitted: ${state.solution.answer}`,
    });
    return submitted;
  }

  return state;
}

async function setAutoWatch(enabled, requestedTabId) {
  if (enabled) {
    const tab = await resolveTab(requestedTabId);
    assertMatiksTab(tab);
    const responses = await sendToAllContentFrames(tab.id, { type: 'START_LOGIC_WATCH' });
    if (!responses.some((entry) => entry.response?.ok)) throw new Error('Could not start Auto Solver Mode on this page.');

    const state = await readState();
    const next = { ...state, autoWatch: true, status: 'Auto Solver Mode active...' };
    await writeState(next);
    return next;
  }

  if (Number.isInteger(requestedTabId)) {
    await sendToAllContentFrames(requestedTabId, { type: 'STOP_LOGIC_WATCH' }).catch(() => {});
  }
  const state = await readState();
  const next = { ...state, autoWatch: false, status: 'Auto Solver Mode is off.' };
  await writeState(next);
  return next;
}

async function fillAnswer(answer, requestedTabId, submit = false, requestedFrameId) {
  const tab = await resolveTab(requestedTabId);
  assertMatiksTab(tab);
  const frameId = Number.isInteger(requestedFrameId)
    ? requestedFrameId
    : lastCaptureFrameByTab.get(tab.id);
  const response = await sendToContentScript(tab.id, { type: 'FILL_LOGIC_ANSWER', answer, submit }, frameId);
  if (!response?.ok) throw new Error(response?.error || 'Could not fill answer into game input.');
  return true;
}

// Naya function: Current puzzle ko scan karega, solve karega aur game mein fill karke enter/submit trigger karega
async function solveAndSubmit(requestedTabId) {
  const tab = await resolveTab(requestedTabId);
  assertMatiksTab(tab);
  
  let extracted;
  try {
    extracted = await extractBestCaptureFromFrames(tab.id);
  } catch (error) {
    await saveCapture({});
    throw error;
  }
  lastCaptureFrameByTab.set(tab.id, extracted.frameId);
  const state = await saveCapture(extracted.capture);
  rememberPuzzleSession(tab, state.puzzleFamily);
  if (!state.solution || !state.solution.answer) {
    throw new Error('No valid solution found to submit.');
  }
  // This function is reached only from the user's Solve Now click. A
  // recognized Logic Duel answer may be multi-part or mode-specific and must
  // not be rejected by the stricter unattended-arithmetic safety filter.
  if (state.puzzleFamily !== 'logic' && !isSafeAutomaticSolution(state)) {
    throw new Error('Puzzle is incomplete or still animating. Wait a moment and try again.');
  }

  // Answer ko fill karke submit trigger karein
  const fillResponse = await sendToContentScript(tab.id, { 
    type: 'FILL_LOGIC_ANSWER', 
    answer: state.solution.answer,
    submit: true // auto-submit flag
  }, extracted.frameId);
  
  if (!fillResponse?.ok) throw new Error(fillResponse?.error || 'Could not submit the answer.');
  return state;
}

async function saveCapture(capture) {
  const state = await readState();
  const next = {
    ...withCapture(state, capture),
    puzzleFamily: classifyPuzzleFamily(capture),
  };
  await writeState(next);
  return next;
}

function classifyPuzzleFamily(capture) {
  const mode = String(capture?.mode || '').trim();
  const value = String(capture?.value || '').trim();

  if (LOGIC_MODE_PATTERN.test(mode) || /[%^√]/.test(value)) return 'logic';
  if (/^\s*-?\d+(?:\.\d+)?(?:\s*[+\-−x×*÷/]\s*-?\d+(?:\.\d+)?){1,4}\s*$/i.test(value)) return 'arithmetic';
  return 'unknown';
}

function rememberPuzzleSession(tab, puzzleFamily) {
  if (!Number.isInteger(tab?.id)) return;
  if (puzzleFamily === 'logic') {
    manualLogicSessionByTab.set(tab.id, tab.url);
  } else if (puzzleFamily === 'arithmetic') {
    manualLogicSessionByTab.delete(tab.id);
  }
}

function isSafeAutomaticSolution(state) {
  const value = String(state?.value || '').trim();
  const mode = String(state?.mode || '').toUpperCase();
  const solution = state?.solution;

  if (!solution?.answer) return false;
  if (state.source === 'network') {
    const networkMatch = value.match(/^\s*(\d{1,4})\s*([+\-−x×*÷/])\s*(\d{1,4})\s*$/i);
    if (!networkMatch || Number(networkMatch[1]) > 1000 || Number(networkMatch[3]) > 1000) return false;
  }
  if (solution.kind === 'arithmetic' && solution.confidence === 'high') return true;
  if (/^\s*-?\d+(?:\.\d+)?(?:\s*[+\-−x×*÷/]\s*-?\d+(?:\.\d+)?){1,4}\s*$/i.test(value)) return true;
  if (value.includes('√')) return true;
  if (/^\s*-?\d+\s*\^\s*-?\d+\s*$/.test(value)) return true;
  if (value.includes('%') || /\b(MOD|REMAINDER)\b/.test(mode)) return true;
  if (/\b(HCF|GCD|LCM|PRIME FACTOR|SUM OF SQUARE)\b/.test(mode)) return true;

  // Never auto-fill/submit a generic single-number fallback. Those captures
  // are usually animation frames, scores, timer digits, or incomplete puzzles.
  return false;
}

async function resolveTab(requestedTabId) {
  if (Number.isInteger(requestedTabId)) return chrome.tabs.get(requestedTabId);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active browser tab found.');
  return tab;
}

function isMatiksUrl(url) {
  return MATIKS_URL.test(url || '');
}

function assertMatiksTab(tab) {
  if (!isMatiksUrl(tab?.url)) throw new Error('Open a Logic Duel game on Matiks first.');
}

async function sendToContentScript(tabId, message, frameId) {
  if (!Number.isInteger(tabId)) throw new Error('No active Matiks tab found.');
  const options = Number.isInteger(frameId) ? { frameId } : undefined;

  try {
    return await chrome.tabs.sendMessage(tabId, message, options);
  } catch (firstError) {
    try {
      const target = Number.isInteger(frameId) ? { tabId, frameIds: [frameId] } : { tabId };
      // Pages that were already open when the unpacked extension was
      // reloaded have no content scripts. Visual Math Duel recognition needs
      // the glyph table as well as the reader, in the same order as manifest.
      await chrome.scripting.executeScript({ target, files: ['glyph-templates.js', 'content.js'] });
      return await chrome.tabs.sendMessage(tabId, message, options);
    } catch (secondError) {
      throw new Error(secondError?.message || firstError?.message || 'Could not reach the Matiks page.');
    }
  }
}

async function getTabFrames(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
  return frames?.length ? frames : [{ frameId: 0 }];
}

async function sendToAllContentFrames(tabId, message) {
  const frames = await getTabFrames(tabId);
  const results = await Promise.all(frames.map(async ({ frameId }) => {
    try {
      const response = await sendToContentScript(tabId, message, frameId);
      return { frameId, response };
    } catch {
      return { frameId, response: null };
    }
  }));
  return results;
}

async function extractBestCaptureFromFrames(tabId) {
  const results = await sendToAllContentFrames(tabId, { type: 'EXTRACT_LOGIC_TEXT' });
  const captures = results
    .filter((entry) => entry.response?.ok && entry.response.capture?.value)
    .map((entry) => ({ frameId: entry.frameId, capture: entry.response.capture }));

  if (captures.length === 0) {
    const tab = await chrome.tabs.get(tabId);
    try {
      const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const visualResponse = await sendToContentScript(tabId, { type: 'EXTRACT_VISUAL_LOGIC', imageDataUrl }, 0);
      if (visualResponse?.ok && visualResponse.capture?.value) {
        return { frameId: 0, capture: visualResponse.capture };
      }
      if (visualResponse?.error) throw new Error(visualResponse.error);
    } catch (visualError) {
      if (/native text recognition|visual recognition/i.test(visualError?.message || '')) throw visualError;
    }

    const diagnostics = results
      .filter((entry) => entry.response?.ok && entry.response.capture?.debug)
      .map((entry) => ({ frameId: entry.frameId, ...entry.response.capture.debug }));
    const canvasCount = diagnostics.reduce((sum, item) => sum + (item.canvasCount || 0), 0);
    const center = diagnostics.flatMap((item) => item.centerElements || []).slice(0, 5).join(', ');
    if (canvasCount > 0) {
      throw new Error(`Puzzle text is canvas-rendered (${canvasCount} canvas element${canvasCount === 1 ? '' : 's'}); DOM extraction cannot read it yet.`);
    }
    throw new Error(`No readable puzzle text found. Frames checked: ${results.length}.${center ? ` Center elements: ${center}` : ''}`);
  }

  const completeArithmetic = captures.find(({ capture }) =>
    /^\s*-?\d+(?:\.\d+)?\s*[+\-−x×*÷/]\s*-?\d+(?:\.\d+)?\s*$/i.test(capture.value)
  );
  return completeArithmetic || captures[0];
}

async function readState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const state = stored[STORAGE_KEY] || createInitialState();
  if (state.value === undefined && state.target !== undefined && state.target !== null) {
    state.value = String(state.target);
  }
  if (!state.solution && state.mode && state.value) {
    state.solution = solvePuzzle(state.mode, state.value);
  }
  return state;
}

async function writeState(state) {
  const next = { ...state, updatedAt: Date.now() };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  try {
    await chrome.runtime.sendMessage({ type: 'LOGIC_STATE_UPDATED', state: next });
  } catch {}
  return next;
}
