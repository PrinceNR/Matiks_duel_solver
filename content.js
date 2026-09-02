/**
 * Logic Duel Solver V1 — DOM Extractor & Auto Filler
 */

const MODE_PATTERN = /^[A-Z][A-Z &'’+()/-]{2,64}$/i;
const TOKEN_PATTERN = /^-?\d+$|^[%+\-−x×÷*\/^=()]+$/;
const WORD_OPERATOR_PATTERN = /^(LCM|HCF|GCD|MOD|REMAINDER|SUM|OF|SQUARES|SQUARE|PRIME|FACTORS|FACTOR|ROOTS|ROOT|LOG|POWER|CUBE|CUBES)$/i;
const RADICAL_INDEX_PATTERN = /^\d+$/;
const TARGET_POLL_MS = 0; // retained for compatibility; auto-watch is event-driven
// Sprint arithmetic is rendered smaller than several Logic Duel prompts.
const MIN_TOKEN_FONT_SIZE = 18;

let autoWatchObserver = null;
let autoWatchQueued = false;
let autoWatchTimer = null;
let autoWatchGeneration = 0;
let lastSignature = '';
let blankFrameSeen = true;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return undefined;

  if (message.type === 'EXTRACT_LOGIC_TEXT') {
    try {
      sendResponse({ ok: true, capture: extractLogicText() });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || 'Text extraction failed.' });
    }
    return true;
  }

  if (message.type === 'START_LOGIC_WATCH') {
    startAutoWatch();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'STOP_LOGIC_WATCH') {
    stopAutoWatch();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'FILL_LOGIC_ANSWER') {
    try {
      fillGameAnswer(message.answer, message.submit);
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || 'Could not fill answer.' });
    }
    return true;
  }

  if (message.type === 'EXTRACT_VISUAL_LOGIC') {
    extractVisualLogic(message.imageDataUrl)
      .then((capture) => sendResponse({ ok: true, capture }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Visual puzzle reading failed.' }));
    return true;
  }

  return undefined;
});

function publishChangedCapture() {
  autoWatchGeneration += 1;
  const generation = autoWatchGeneration;
  if (autoWatchTimer) clearTimeout(autoWatchTimer);
  autoWatchQueued = true;
  const run = async () => {
    if (generation !== autoWatchGeneration) return;
    autoWatchQueued = false;
    try {
      const firstCapture = extractLogicText();
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (generation !== autoWatchGeneration) return;
      const capture = extractLogicText();
      const firstSignature = `${firstCapture.mode || ''}|${firstCapture.value || ''}`;
      const signature = `${capture.mode || ''}|${capture.value || ''}`;
      const hasContent = Boolean(capture.value) && firstSignature === signature;
      if (!hasContent) {
        blankFrameSeen = true;
        lastSignature = '';
        return;
      }
      if (!blankFrameSeen && signature === lastSignature) return;
      lastSignature = signature;
      blankFrameSeen = false;
      chrome.runtime.sendMessage({ type: 'LOGIC_TEXT_UPDATED', capture }).catch(() => {});
    } catch {}
  };
  // Matiks animates the operands/operator in separate DOM updates. Debouncing
  // avoids capturing and submitting a half-rendered frame such as just "43".
  autoWatchTimer = setTimeout(run, 140);
}

function startAutoWatch() {
  stopAutoWatch();
  lastSignature = '';
  blankFrameSeen = true;
  publishChangedCapture();
  if (document.body && typeof MutationObserver === 'function') {
    autoWatchObserver = new MutationObserver(() => publishChangedCapture());
    autoWatchObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
}

function stopAutoWatch() {
  autoWatchObserver?.disconnect();
  autoWatchObserver = null;
  if (autoWatchTimer) clearTimeout(autoWatchTimer);
  autoWatchTimer = null;
  autoWatchGeneration += 1;
  autoWatchQueued = false;
  lastSignature = '';
  blankFrameSeen = true;
}

function extractLogicText() {
  const modeCandidates = [];
  const directExpressions = [];
  const visualTokens = [];
  const seenElements = new Set();
  const allElements = collectAllElements(document);

  const textNodeCandidates = extractTextNodeCandidates(document);
  directExpressions.push(...textNodeCandidates.expressions);
  visualTokens.push(...textNodeCandidates.tokens);
  modeCandidates.push(...textNodeCandidates.modes);

  // 1. Check for KaTeX rendered powers
  const powerExpr = extractKaTeXPower();
  if (powerExpr) {
    directExpressions.push({
      value: powerExpr,
      parts: [powerExpr],
      fontSize: 80,
      centerDistance: 0,
      rect: { left: 0, right: 100, top: 0, bottom: 100 },
      score: 9999,
    });
  }

  // 1.5. Check for KaTeX / SVG Roots (Only if root symbol / sqrt class actually exists)
  const rootExpr = extractKaTeXRoot();
  if (rootExpr) {
    directExpressions.push({
      value: rootExpr,
      parts: [rootExpr],
      fontSize: 80,
      centerDistance: 0,
      rect: { left: 0, right: 100, top: 0, bottom: 100 },
      score: 9999,
    });
  }

  // Sprint/Duel uses different renderers across puzzle types. Some rounds put
  // their characters in SVG <text>/<tspan> nodes or semantic elements other
  // than the small HTML tag list used by the original Logic Duel extractor.
  // Scan every element, while getRenderableText() still limits us to direct
  // text nodes so parent/child mirrors are not concatenated repeatedly.
  for (const element of allElements) {
    if (seenElements.has(element)) continue;
    seenElements.add(element);

    const renderableText = getRenderableText(element);
    const semanticText = getElementSemanticText(element);
    const text = renderableText || semanticText;
    if (!text || !isVisible(element) || isIgnoredMirror(element)) continue;

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const semanticSize = semanticText ? Math.min(Math.max(rect.width, rect.height), 64) : 0;
    const fontSize = Math.max(Number.parseFloat(style.fontSize) || 0, semanticSize);

    if (MODE_PATTERN.test(text) && looksLikePuzzleMode(text)) {
      modeCandidates.push({
        text: text.toUpperCase(),
        fontSize,
        centerDistance: distanceFromViewportCenter(rect),
        element,
      });
    }

    // Scores, timers and countdown UI contain misleading number/operator
    // combinations. Puzzle expressions in Sprint/Duel occupy the central
    // board, so never treat text outside that board as an expression token.
    if (!isInPuzzleRegion(rect)) continue;
    if (fontSize < MIN_TOKEN_FONT_SIZE) continue;

    if (isDirectExpression(text)) {
      directExpressions.push({
        value: normalizeExpression(text),
        parts: splitExpressionParts(text),
        fontSize,
        centerDistance: distanceFromViewportCenter(rect),
        rect,
        score: scoreExpression({ fontSize, rect, isDirect: true, partCount: splitExpressionParts(text).length }),
      });
      continue;
    }

    if (TOKEN_PATTERN.test(text) || WORD_OPERATOR_PATTERN.test(text)) {
      visualTokens.push({
        text: normalizeToken(text),
        fontSize,
        rect,
        centerY: rect.top + rect.height / 2,
        centerDistance: distanceFromViewportCenter(rect),
        kind: /^-?\d+$/.test(text) ? 'number' : 'operator',
      });
    }
  }

  // Some Sprint renderers split an expression across nested descendants. The
  // leaf scanner deliberately avoids concatenating parents, so also inspect
  // compact containers and accessibility/data attributes for an exact binary
  // arithmetic expression (for example a wrapper whose textContent is 42÷7).
  directExpressions.push(...extractContainerArithmeticExpressions(allElements));

  // Detect SVG radicals
  for (const svg of document.querySelectorAll('svg')) {
    if (!isVisible(svg)) continue;
    const rect = svg.getBoundingClientRect();
    const fontSize = inferSvgFontSize(svg, rect);
    if (fontSize < MIN_TOKEN_FONT_SIZE) continue;

    const rootInfo = readRootSvg(svg);
    if (!rootInfo.isRoot) continue;

    visualTokens.push({
      text: `√[${rootInfo.index || 2}]`,
      rootIndex: Number(rootInfo.index || 2),
      fontSize,
      rect,
      centerY: rect.top + rect.height / 2,
      centerDistance: distanceFromViewportCenter(rect),
      kind: 'root',
    });
  }

  const dedupedTokens = dedupeVisualTokens(visualTokens);
  const rootTokens = dedupedTokens.filter((token) => token.kind === 'root');
  const nonRootTokens = dedupedTokens.filter((token) => token.kind !== 'root');

  const rootExpressions = rootTokens.map((rootToken) => buildRootExpression(rootToken, nonRootTokens)).filter(Boolean);
  const groupedExpressions = groupTokensByVisualLine(nonRootTokens);
  const stackedExpressions = combineStackedArithmeticExpressions([...directExpressions, ...groupedExpressions]);

  const completeArithmeticExpressions = dedupeExpressions([
    ...stackedExpressions,
    ...directExpressions,
    ...groupedExpressions,
  ]).filter((expression) => isCompleteArithmetic(expression.value) && isInPuzzleRegion(expression.rect));
  const expressionPool = completeArithmeticExpressions.length > 0
    ? completeArithmeticExpressions
    : [...directExpressions, ...rootExpressions, ...stackedExpressions, ...groupedExpressions];
  const expressions = dedupeExpressions(expressionPool).sort((left, right) => right.score - left.score);
  const bestMode = chooseMode(modeCandidates);
  const bestExpression = expressions[0] || null;
  const value = bestExpression?.value || null;

  return {
    mode: bestMode?.text || null,
    value,
    rawText: [bestMode?.text, value].filter(Boolean).join('\n'),
    parts: bestExpression?.parts || [],
    numbers: value ? extractNumbers(value) : [],
    operators: value ? extractOperators(value) : [],
    root: value ? extractRoot(value) : null,
    source: 'dom',
    debug: value ? null : buildExtractionDebug(allElements),
  };
}

function buildExtractionDebug(elements) {
  const canvases = elements.filter((element) => element.tagName === 'CANVAS' && isVisible(element));
  const iframes = elements.filter((element) => element.tagName === 'IFRAME' && isVisible(element));
  const samplePoints = [
    [window.innerWidth * 0.5, window.innerHeight * 0.5],
    [window.innerWidth * 0.5, window.innerHeight * 0.58],
    [window.innerWidth * 0.5, window.innerHeight * 0.62],
  ];
  const centerElements = [];

  for (const [x, y] of samplePoints) {
    for (const element of document.elementsFromPoint(x, y).slice(0, 4)) {
      const label = [
        element.tagName?.toLowerCase(),
        element.getAttribute?.('role'),
        element.getAttribute?.('aria-label'),
        element.getAttribute?.('alt'),
        element.getAttribute?.('data-testid'),
        element.tagName === 'IMG' ? String(element.getAttribute?.('src') || '').split('/').pop()?.slice(0, 48) : '',
      ].filter(Boolean).join(':');
      if (label && !centerElements.includes(label)) centerElements.push(label.slice(0, 80));
    }
  }

  return {
    canvasCount: canvases.length,
    iframeCount: iframes.length,
    centerElements: centerElements.slice(0, 8),
    documentUrl: location.href.slice(0, 160),
  };
}

function extractKaTeXPower() {
  const msupsub = document.querySelector('.msupsub');
  if (!msupsub) return null;

  const mtightNode = msupsub.querySelector('.mtight');
  const expVal = mtightNode ? (mtightNode.textContent || '').replace(/\D/g, '') : '';
  if (!expVal) return null;

  const parentKatex = msupsub.closest('.katex') || msupsub.parentElement;
  if (!parentKatex) return null;

  const baseContainer = parentKatex.querySelector('.base') || parentKatex;
  const clone = baseContainer.cloneNode(true);
  
  const supInClone = clone.querySelector('.msupsub, .mtight, .sup, sup');
  if (supInClone) supInClone.remove();

  const allText = clone.textContent || '';
  const digits = allText.match(/\d+/g);
  let baseText = digits ? digits.join('') : '';

  if (baseText.length > 0 && expVal) {
    return `${baseText}^${expVal}`;
  }

  return null;
}

function extractKaTeXRoot() {
  // Check if actual root/sqrt element exists on screen before proceeding
  const hasSqrtElement = document.querySelector('.sqrt, .mord.sqrt');

  if (!hasSqrtElement) return null;

  const container = document.querySelector('.katex-html, .katex') || document.body;
  const text = container.innerText || container.textContent || '';
  
  const allDigits = text.match(/\d+/g);
  if (!allDigits || allDigits.length === 0) return null;

  let index = '2';
  let target = '';

  for (const d of allDigits) {
    if (d.length <= 2 && Number(d) <= 10 && index === '2') {
      index = d;
    } else if (d.length >= 3) {
      target = d;
      break;
    }
  }

  if (!target && allDigits.length >= 2) {
    index = allDigits[0];
    target = allDigits.slice(1).join('');
  } else if (!target && allDigits.length === 1) {
    target = allDigits[0];
  }

  if (target) {
    return `√[${index}] ${target}`;
  }

  return null;
}

function dedupeVisualTokens(tokens) {
  const ordered = [...tokens].sort((left, right) => right.fontSize - left.fontSize || left.rect.left - right.rect.left);
  const unique = [];

  for (const token of ordered) {
    const duplicate = unique.some((existing) => (
      existing.text === token.text &&
      sameVisualRegion(existing.rect, token.rect, existing.fontSize, token.fontSize)
    ));
    if (!duplicate) unique.push(token);
  }

  return unique;
}

function dedupeExpressions(expressions) {
  const ordered = [...expressions].sort((left, right) => right.score - left.score);
  const unique = [];

  for (const expression of ordered) {
    const duplicate = unique.some((existing) => (
      existing.value === expression.value &&
      sameVisualRegion(existing.rect, expression.rect, existing.fontSize, expression.fontSize)
    ));
    if (!duplicate) unique.push(expression);
  }

  return unique;
}

function sameVisualRegion(left, right, leftFontSize = 40, rightFontSize = 40) {
  if (!left || !right) return false;

  const leftCenterX = (left.left + left.right) / 2;
  const rightCenterX = (right.left + right.right) / 2;
  const leftCenterY = (left.top + left.bottom) / 2;
  const rightCenterY = (right.top + right.bottom) / 2;
  const centerTolerance = Math.max(12, Math.min(leftFontSize, rightFontSize) * 0.55);
  const overlap = rectangleOverlap(left, right);

  return (
    (Math.abs(leftCenterX - rightCenterX) <= centerTolerance && Math.abs(leftCenterY - rightCenterY) <= centerTolerance) ||
    overlap >= 0.55
  );
}

function rectangleOverlap(left, right) {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  const overlapArea = width * height;
  const leftArea = Math.max(1, (left.right - left.left) * (left.bottom - left.top));
  const rightArea = Math.max(1, (right.right - right.left) * (right.bottom - right.top));
  return overlapArea / Math.min(leftArea, rightArea);
}

function groupTokensByVisualLine(tokens) {
  const groups = [];
  const sorted = [...tokens].sort((left, right) => left.centerY - right.centerY || left.rect.left - right.rect.left);

  for (const token of sorted) {
    const tolerance = Math.max(18, Math.min(token.fontSize * 0.36, 44));
    let group = groups.find((candidate) => Math.abs(candidate.centerY - token.centerY) <= tolerance);

    if (!group) {
      group = { centerY: token.centerY, tokens: [] };
      groups.push(group);
    }

    group.tokens.push(token);
    group.centerY = group.tokens.reduce((sum, item) => sum + item.centerY, 0) / group.tokens.length;
  }

  return groups
    .map((group) => buildExpressionFromGroup(group.tokens))
    .filter(Boolean);
}

function combineStackedArithmeticExpressions(expressions) {
  const rows = [...expressions].sort((left, right) => left.rect.top - right.rect.top);
  const combined = [];

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const top = rows[i];
      const bottom = rows[j];
      const verticalGap = bottom.rect.top - top.rect.bottom;
      const maxGap = Math.max(70, Math.max(top.fontSize, bottom.fontSize) * 2.5);
      if (verticalGap > maxGap) break;
      if (verticalGap < -12) continue;

      const topCenterX = (top.rect.left + top.rect.right) / 2;
      const bottomCenterX = (bottom.rect.left + bottom.rect.right) / 2;
      const horizontalTolerance = Math.max(90, Math.max(top.fontSize, bottom.fontSize) * 3.5);
      if (Math.abs(topCenterX - bottomCenterX) > horizontalTolerance) continue;

      const topNumber = top.value.match(/^\s*(-?\d+(?:\.\d+)?)\s*$/);
      const bottomOperation = bottom.value.match(/^\s*([+\-−x×*÷/])\s*(-?\d+(?:\.\d+)?)\s*$/i);
      if (!topNumber || !bottomOperation) continue;

      const value = `${topNumber[1]} ${bottomOperation[1]} ${bottomOperation[2]}`;
      const rect = {
        left: Math.min(top.rect.left, bottom.rect.left),
        right: Math.max(top.rect.right, bottom.rect.right),
        top: top.rect.top,
        bottom: bottom.rect.bottom,
      };
      const fontSize = Math.max(top.fontSize, bottom.fontSize);

      combined.push({
        value,
        parts: [topNumber[1], bottomOperation[1], bottomOperation[2]],
        fontSize,
        centerDistance: distanceFromViewportCenter(rect),
        rect,
        // A complete stacked binary expression should outrank either row.
        score: scoreExpression({ fontSize, rect, isDirect: true, partCount: 3 }) + 240,
      });
    }
  }

  return combined;
}

function extractContainerArithmeticExpressions(elements) {
  const expressions = [];

  for (const element of elements) {
    if (!isVisible(element) || isIgnoredMirror(element)) continue;
    const elementRect = element.getBoundingClientRect();
    if (!isInPuzzleRegion(elementRect)) continue;

    const sources = [
      element.textContent,
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('data-value'),
      element.getAttribute('data-expression'),
      element.getAttribute('data-testid'),
      element.getAttribute('alt'),
    ];

    for (const source of sources) {
      const compact = normalizeText(source || '');
      if (!compact || compact.length > 32) continue;
      const match = compact.match(/^\s*(-?\d+(?:\.\d+)?)\s*([+\-−x×*÷/])\s*(-?\d+(?:\.\d+)?)\s*$/i);
      if (!match) continue;

      const rect = elementRect;
      const style = window.getComputedStyle(element);
      const fontSize = Number.parseFloat(style.fontSize) || Math.min(rect.height, 32) || 18;
      const value = `${match[1]} ${match[2]} ${match[3]}`;
      expressions.push({
        value,
        parts: [match[1], match[2], match[3]],
        fontSize,
        centerDistance: distanceFromViewportCenter(rect),
        rect,
        score: scoreExpression({ fontSize, rect, isDirect: true, partCount: 3 }) + 420,
      });
      break;
    }
  }

  return expressions;
}

function extractTextNodeCandidates(root) {
  const expressions = [];
  const tokens = [];
  const modes = [];
  const walker = document.createTreeWalker(root.body || root.documentElement, NodeFilter.SHOW_TEXT);
  let node;

  while ((node = walker.nextNode())) {
    const text = normalizeText(node.nodeValue || '');
    if (!text || text.length > 80) continue;
    const parent = node.parentElement;
    if (!parent || isIgnoredMirror(parent)) continue;

    const style = window.getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const range = document.createRange();
    range.selectNodeContents(node);
    const rangeRects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    range.detach?.();
    if (rangeRects.length === 0) continue;

    for (const rect of rangeRects) {
      const fontSize = Math.max(Number.parseFloat(style.fontSize) || 0, rect.height * 0.75);
      const centerDistance = distanceFromViewportCenter(rect);

      if (MODE_PATTERN.test(text) && looksLikePuzzleMode(text)) {
        modes.push({ text: text.toUpperCase(), fontSize, centerDistance, element: parent });
      }

      if (!isInPuzzleRegion(rect)) continue;

      if (isCompleteArithmetic(text)) {
        expressions.push({
          value: normalizeExpression(text),
          parts: splitExpressionParts(text),
          fontSize,
          centerDistance,
          rect,
          score: scoreExpression({ fontSize, rect, isDirect: true, partCount: 3 }) + 600,
        });
        continue;
      }

      const compactParts = text.match(/^-?\d+(?:\.\d+)?$|^[+\-−x×*÷/]\s*-?\d+(?:\.\d+)?$|^[+\-−x×*÷/]$/i);
      if (!compactParts) continue;

      const parts = normalizeExpression(text).split(/\s+/).filter(Boolean);
      // Split a compact operator/operand node such as "+4" into colocated
      // visual tokens so stacked-expression reconstruction can combine it.
      const match = normalizeExpression(text).match(/^([+\-x×*÷/])\s*(-?\d+(?:\.\d+)?)$/i);
      if (match) {
        const operatorWidth = Math.max(rect.width * 0.45, fontSize * 0.65);
        tokens.push({
          text: match[1], fontSize, rect: { left: rect.left, right: Math.min(rect.right, rect.left + operatorWidth), top: rect.top, bottom: rect.bottom },
          centerY: rect.top + rect.height / 2, centerDistance, kind: 'operator',
        });
        tokens.push({
          text: match[2], fontSize, rect: { left: Math.min(rect.right, rect.left + operatorWidth), right: rect.right, top: rect.top, bottom: rect.bottom },
          centerY: rect.top + rect.height / 2, centerDistance, kind: 'number',
        });
      } else {
        const value = parts[0];
        tokens.push({
          text: normalizeToken(value),
          fontSize,
          rect,
          centerY: rect.top + rect.height / 2,
          centerDistance,
          kind: /^-?\d+(?:\.\d+)?$/.test(value) ? 'number' : 'operator',
        });
      }
    }
  }

  return { expressions, tokens, modes };
}

function buildExpressionFromGroup(tokens) {
  const ordered = collapseConsecutiveMirrors([...tokens].sort((left, right) => left.rect.left - right.rect.left));
  const numbers = ordered.filter((token) => token.kind === 'number');
  const meaningful = ordered.filter((token) => token.kind !== 'operator' || token.text !== 'OF');
  if (numbers.length === 0 || meaningful.length === 0) return null;

  const left = ordered[0].rect.left;
  const right = ordered[ordered.length - 1].rect.right;
  const span = right - left;
  if (span > Math.max(720, window.innerWidth * 0.9)) return null;

  const value = normalizeExpression(ordered.map((token) => token.text).join(' '));
  const averageFontSize = ordered.reduce((sum, token) => sum + token.fontSize, 0) / ordered.length;
  const averageCenterDistance = ordered.reduce((sum, token) => sum + token.centerDistance, 0) / ordered.length;
  const rect = {
    left,
    right,
    top: Math.min(...ordered.map((token) => token.rect.top)),
    bottom: Math.max(...ordered.map((token) => token.rect.bottom)),
  };

  return {
    value,
    parts: ordered.map((token) => token.text),
    fontSize: averageFontSize,
    centerDistance: averageCenterDistance,
    rect,
    score: scoreExpression({
      fontSize: averageFontSize,
      rect,
      isDirect: false,
      partCount: ordered.length,
      hasRoot: ordered.some((token) => token.kind === 'root'),
    }),
  };
}

function buildRootExpression(rootToken, tokens) {
  const rootCenterX = (rootToken.rect.left + rootToken.rect.right) / 2;
  const rootCenterY = (rootToken.rect.top + rootToken.rect.bottom) / 2;
  const lineTolerance = Math.max(50, rootToken.fontSize * 1.2);

  const numericCandidates = tokens
    .filter((token) => token.kind === 'number')
    .filter((token) => Math.abs(token.centerY - rootCenterY) <= lineTolerance)
    .filter((token) => ((token.rect.left + token.rect.right) / 2) > rootCenterX - 20)
    .sort((left, right) => left.rect.left - right.rect.left);

  const radicand = numericCandidates[0];
  if (!radicand) {
    return {
      value: `√[${rootToken.rootIndex || 2}]`,
      parts: [`√[${rootToken.rootIndex || 2}]`],
      fontSize: rootToken.fontSize,
      centerDistance: rootToken.centerDistance,
      rect: rootToken.rect,
      score: scoreExpression({ fontSize: rootToken.fontSize, rect: rootToken.rect, isDirect: true, partCount: 1, hasRoot: true }),
    };
  }

  const rect = {
    left: Math.min(rootToken.rect.left, radicand.rect.left),
    right: Math.max(rootToken.rect.right, radicand.rect.right),
    top: Math.min(rootToken.rect.top, radicand.rect.top),
    bottom: Math.max(rootToken.rect.bottom, radicand.rect.bottom),
  };
  const value = `√[${rootToken.rootIndex || 2}] ${radicand.text}`;

  return {
    value,
    parts: [`√[${rootToken.rootIndex || 2}]`, radicand.text],
    fontSize: Math.max(rootToken.fontSize, radicand.fontSize),
    centerDistance: distanceFromViewportCenter(rect),
    rect,
    score: scoreExpression({ fontSize: Math.max(rootToken.fontSize, radicand.fontSize), rect, isDirect: true, partCount: 2, hasRoot: true }),
  };
}

function collapseConsecutiveMirrors(tokens) {
  const compacted = [];
  for (const token of tokens) {
    const previous = compacted[compacted.length - 1];
    if (
      previous &&
      previous.text === token.text &&
      (sameVisualRegion(previous.rect, token.rect, previous.fontSize, token.fontSize) || horizontalGap(previous.rect, token.rect) <= Math.max(18, Math.min(previous.fontSize, token.fontSize) * 0.8))
    ) {
      continue;
    }
    compacted.push(token);
  }
  return compacted;
}

function horizontalGap(left, right) {
  if (right.left >= left.right) return right.left - left.right;
  if (left.left >= right.right) return left.left - right.right;
  return 0;
}

function readRootSvg(svg) {
  const labelledAsRoot = /sqrt|square root|cube root|radical/i.test([
    svg.getAttribute('aria-label'),
    svg.getAttribute('data-testid'),
    svg.querySelector('title')?.textContent,
  ].filter(Boolean).join(' '));
  const insideSqrt = Boolean(svg.closest('.sqrt, .mord.sqrt'));
  if (!insideSqrt && !labelledAsRoot) return { isRoot: false, index: null };

  const markup = String(svg.outerHTML || '').toLowerCase();
  const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
  const viewBoxWidth = viewBox[2] || 0;
  const viewBoxHeight = viewBox[3] || 0;
  const widthAttribute = String(svg.getAttribute('width') || '').toLowerCase();
  const looksLikeMathSvg = Boolean(
    /path|polyline|line/.test(markup) &&
    markup.includes('preserveaspectratio') &&
    (viewBoxWidth >= 1000 || (viewBoxWidth / Math.max(viewBoxHeight, 1)) >= 4 || widthAttribute.endsWith('em'))
  );

  let index = null;
  const previous = svg.previousElementSibling;
  const previousText = normalizeText(previous?.innerText || previous?.textContent || '');
  if (previous && RADICAL_INDEX_PATTERN.test(previousText)) index = previousText;

  return { isRoot: looksLikeMathSvg, index };
}

function inferSvgFontSize(svg, rect) {
  const parentSize = Number.parseFloat(window.getComputedStyle(svg.parentElement || svg).fontSize) || 0;
  const heightSize = rect.height || 0;
  return Math.max(parentSize, heightSize * 0.9);
}

function chooseMode(candidates) {
  return [...candidates].sort((left, right) => {
    const leftScore = Math.min(left.fontSize, 60) * 2 + Math.max(0, 700 - left.centerDistance) * 0.2;
    const rightScore = Math.min(right.fontSize, 60) * 2 + Math.max(0, 700 - right.centerDistance) * 0.2;
    return rightScore - leftScore;
  })[0] || null;
}

function scoreExpression({ fontSize, rect, isDirect, partCount = 1, hasRoot = false }) {
  const centerDistance = distanceFromViewportCenter(rect);
  return (
    Math.min(fontSize, 140) * 6 +
    Math.max(0, 800 - centerDistance) * 0.36 +
    Math.min(partCount, 12) * 18 +
    (hasRoot ? 65 : 0) +
    (isDirect ? 85 : 0)
  );
}

function isDirectExpression(text) {
  return /\d/.test(text) && (/[%+\-−x×÷*\/^=]/.test(text) || /\^/.test(text)) && /^[\d\s%+\-−x×÷*\/^=()]+$/.test(text);
}

function splitExpressionParts(value) {
  return normalizeExpression(value).split(/\s+/).filter(Boolean);
}

function looksLikePuzzleMode(text) {
  if (/\d/.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  const normalized = text.toUpperCase().replace(/\s+/g, ' ').trim();
  const blockedLabels = new Set(['TYPE OUT YOUR ANSWER', 'ENTER ANSWER', 'YOUR ANSWER', 'STARTING IN']);
  const blocked = /^(YOU|OPPONENT|PLAYER|SCORE|TIME|TYPE|OUT|YOUR|ENTER|ANSWER|START|PAUSE|QUIT|MENU)$/i;
  return words.length >= 1 && words.length <= 9 && !blockedLabels.has(normalized) && !words.every((word) => blocked.test(word));
}

function extractNumbers(value) {
  const withoutRootIndex = String(value).replace(/√\[\d+\]/g, '√');
  return (withoutRootIndex.match(/-?\d+/g) || []).map((number) => Number.parseInt(number, 10));
}

function extractOperators(value) {
  return (value.match(/[%+\-−x×÷*\/^=()^]/g) || []).filter(Boolean);
}

function extractRoot(value) {
  const match = value.match(/√(?:\[(\d+)\])?/);
  return match ? { symbol: '√', index: match[1] ? Number.parseInt(match[1], 10) : 2 } : null;
}

function normalizeExpression(value) {
  return String(value)
    .replace(/−/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*([%+x×÷*\/^=()])\s*/g, ' $1 ')
    .replace(/\s*√\s*/g, '√')
    .replace(/\s*\[\s*(\d+)\s*\]/g, '[$1]')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToken(value) {
  return String(value).replace(/−/g, '-').trim();
}

function isCompleteArithmetic(value) {
  return /^\s*-?\d+(?:\.\d+)?(?:\s*[+\-−x×*÷/]\s*-?\d+(?:\.\d+)?){1,4}\s*$/i.test(String(value || ''));
}

function isInPuzzleRegion(rect) {
  if (!rect) return false;
  const centerX = (rect.left + rect.right) / 2;
  const centerY = (rect.top + rect.bottom) / 2;
  return (
    centerX >= window.innerWidth * 0.32 &&
    centerX <= window.innerWidth * 0.68 &&
    centerY >= window.innerHeight * 0.38 &&
    centerY <= window.innerHeight * 0.76
  );
}

function getElementSemanticText(element) {
  const reactText = getReactElementText(element);
  const interpretedReactText = interpretSemanticMathText(reactText);
  if (interpretedReactText) return interpretedReactText;

  const attributes = [
    element.getAttribute?.('aria-label'),
    element.getAttribute?.('alt'),
    element.getAttribute?.('title'),
    element.getAttribute?.('data-value'),
    element.getAttribute?.('data-expression'),
    element.getAttribute?.('data-symbol'),
  ];

  if (element.tagName === 'IMG') {
    attributes.push(element.currentSrc, element.getAttribute('src'));
  }

  for (const attribute of attributes) {
    const interpreted = interpretSemanticMathText(attribute);
    if (interpreted) return interpreted;
  }
  return '';
}

function getReactElementText(element) {
  try {
    for (const key of Object.keys(element)) {
      if (key.startsWith('__reactProps$')) {
        const value = flattenReactChildren(element[key]?.children, 0);
        if (value) return value;
      }
      if (key.startsWith('__reactFiber$')) {
        const fiber = element[key];
        const children = fiber?.memoizedProps?.children ?? fiber?.pendingProps?.children;
        const value = flattenReactChildren(children, 0);
        if (value) return value;
      }
    }
  } catch {}
  return '';
}

function flattenReactChildren(value, depth) {
  if (depth > 8 || value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    return normalizeText(value.map((item) => flattenReactChildren(item, depth + 1)).filter(Boolean).join(' '));
  }
  if (typeof value === 'object') {
    const props = value.props || value.memoizedProps || value.pendingProps;
    if (props && Object.prototype.hasOwnProperty.call(props, 'children')) {
      return flattenReactChildren(props.children, depth + 1);
    }
  }
  return '';
}

function interpretSemanticMathText(value) {
  if (!value) return '';
  let text = String(value).trim();
  try {
    if (/^data:image\/svg\+xml/i.test(text)) text = decodeURIComponent(text);
  } catch {}

  const exactExpression = normalizeText(text).match(/(-?\d+(?:\.\d+)?)\s*([+\-−x×*÷/])\s*(-?\d+(?:\.\d+)?)/i);
  if (exactExpression) return `${exactExpression[1]} ${exactExpression[2]} ${exactExpression[3]}`;

  const lower = text.toLowerCase();
  const operatorMap = [
    [/\b(plus|add|addition)\b/, '+'],
    [/\b(minus|subtract|subtraction)\b/, '-'],
    [/\b(times|multiply|multiplication)\b/, '×'],
    [/\b(divide|division|divided)\b/, '÷'],
  ];
  for (const [pattern, symbol] of operatorMap) {
    if (pattern.test(lower)) return symbol;
  }

  const namedDigit = lower.match(/(?:digit|number|num)[-_\s]?(\d{1,4})(?:\D|$)/);
  if (namedDigit) return namedDigit[1];
  const basenameDigit = lower.match(/(?:^|[/\\_-])(\d{1,4})(?:\.(?:svg|png|webp|gif)|[/\\_-]|$)/);
  if (basenameDigit) return basenameDigit[1];
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return text;
  if (/^[+\-−x×*÷/]$/i.test(text)) return text;
  return '';
}

function collectAllElements(root) {
  const elements = Array.from(root.querySelectorAll('*'));
  for (let index = 0; index < elements.length; index++) {
    const shadowRoot = elements[index].shadowRoot;
    if (shadowRoot) elements.push(...shadowRoot.querySelectorAll('*'));
  }
  return elements;
}

function getRenderableText(element) {
  const directText = Array.from(element.childNodes || [])
    .filter((node) => node.nodeType === 3)
    .map((node) => node.nodeValue || '')
    .join(' ');

  const normalizedDirectText = normalizeText(directText);
  const leafText = element.children.length === 0 ? normalizeText(element.textContent || '') : '';
  const realText = normalizedDirectText || leafText;

  // A few UI renderers expose mathematical symbols through CSS generated
  // content. Preserve it alongside real text (for example ::before "+" + "9").
  const pieces = [];
  for (const pseudo of ['::before']) {
    const content = window.getComputedStyle(element, pseudo).content;
    if (content && content !== 'none' && content !== 'normal') {
      const value = normalizeText(content.replace(/^['"]|['"]$/g, ''));
      if (value) pieces.push(value);
    }
  }
  if (realText) pieces.push(realText);
  for (const pseudo of ['::after']) {
    const content = window.getComputedStyle(element, pseudo).content;
    if (content && content !== 'none' && content !== 'normal') {
      const value = normalizeText(content.replace(/^['"]|['"]$/g, ''));
      if (value) pieces.push(value);
    }
  }
  return normalizeText(pieces.join(' '));
}

function isIgnoredMirror(element) {
  return Boolean(
    element.getAttribute('aria-hidden') === 'true' ||
    element.closest('[aria-hidden="true"]') ||
    element.getAttribute('data-testid') === 'hidden'
  );
}

function isVisible(element) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return Boolean(
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0'
  );
}

function distanceFromViewportCenter(rect) {
  const x = (rect.left + rect.right) / 2;
  const y = (rect.top + rect.bottom) / 2;
  return Math.hypot(x - window.innerWidth / 2, y - window.innerHeight / 2);
}

function normalizeText(value) {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function fillGameAnswer(answer, submit = false) {
  const parts = String(answer || '').trim().split(/\s+/).filter(Boolean);
  const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).filter((el) => isVisible(el));

  if (inputs.length === 0) throw new Error('No game input field found on page.');

  if (parts.length > 1 && inputs.length >= parts.length) {
    for (let i = 0; i < parts.length; i++) {
      setInputValue(inputs[i], parts[i], submit && i === parts.length - 1);
    }
    return;
  }

  setInputValue(inputs[inputs.length - 1], parts.join(' '), submit);
}

function setInputValue(targetInput, val, submit = false) {
  targetInput.focus();
  if (targetInput.tagName === 'INPUT' || targetInput.tagName === 'TEXTAREA') {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(targetInput, val);
    } else {
    targetInput.value = val;
    }
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    targetInput.textContent = val;
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (submit) {
    setTimeout(() => {
      targetInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      targetInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      targetInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }, 0);
  }
}

// A content-script MutationObserver is destroyed by page refresh/navigation.
// Restore it when the saved extension state says Auto Solver Mode is enabled.
chrome.storage.local.get('logicDuelSolverState').then((stored) => {
  if (stored.logicDuelSolverState?.autoWatch) startAutoWatch();
}).catch(() => {});

async function extractVisualLogic(imageDataUrl) {
  if (!imageDataUrl) throw new Error('No page image was captured.');

  const blob = await fetch(imageDataUrl).then((response) => response.blob());
  const bitmap = await createImageBitmap(blob);
  try {
    if (typeof TextDetector === 'function') {
      try {
        const detections = await new TextDetector().detect(bitmap);
        const combined = detections.map((item) => item.rawValue).join(' ');
        const match = combined.match(/(-?\d{1,4})\s*([+\-−x×*÷/])\s*(-?\d{1,4})/i);
        if (match) return visualCapture(`${match[1]} ${match[2]} ${match[3]}`);
      } catch {}
    }

    return visualCapture(recognizeMatiksArithmetic(bitmap));
  } finally {
    bitmap.close?.();
  }
}

function recognizeMatiksArithmetic(bitmap) {
  const templates = window.LOGIC_DUEL_GLYPH_TEMPLATES;
  if (!templates) throw new Error('Matiks visual templates were not loaded.');

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const isWhite = (x, y) => {
    const index = (y * bitmap.width + x) * 4;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    return Math.min(red, green, blue) > 165 && Math.max(red, green, blue) - Math.min(red, green, blue) < 48;
  };

  const xStart = Math.floor(bitmap.width * 0.38);
  const xEnd = Math.ceil(bitmap.width * 0.62);
  const yStart = Math.floor(bitmap.height * 0.35);
  const yEnd = Math.ceil(bitmap.height * 0.68);
  const activeRows = [];
  for (let y = yStart; y < yEnd; y++) {
    let count = 0;
    for (let x = xStart; x < xEnd; x++) if (isWhite(x, y)) count++;
    if (count >= 2) activeRows.push(y);
  }

  const rowGroups = groupCoordinates(activeRows, 1).filter((group) => {
    const height = group[group.length - 1] - group[0] + 1;
    return height >= Math.max(7, bitmap.height * 0.006) && height <= bitmap.height * 0.05;
  });
  const puzzleRows = rowGroups.filter((row) => {
    const center = (row[0] + row[row.length - 1]) / 2;
    return center >= bitmap.height * 0.40 && center <= bitmap.height * 0.64;
  }).slice(0, 5);
  if (puzzleRows.length < 2) throw new Error('Offline visual recognition could not locate the puzzle rows.');

  const recognizeRow = (row, allowedByIndex) => {
    const top = row[0];
    const bottom = row[row.length - 1];
    const activeColumns = [];
    for (let x = xStart; x < xEnd; x++) {
      let active = false;
      for (let y = top; y <= bottom; y++) {
        if (isWhite(x, y)) { active = true; break; }
      }
      if (active) activeColumns.push(x);
    }
    const columnGroups = groupCoordinates(activeColumns, Math.max(2, Math.round(bitmap.width * 0.001)));
    return columnGroups.map((columns, index) => {
      const mask = normalizeGlyphMask(isWhite, columns[0], top, columns[columns.length - 1], bottom);
      return matchGlyph(mask, templates, allowedByIndex(index, columnGroups.length));
    }).join('');
  };

  const digits = new Set('0123456789'.split(''));
  const operators = new Set(['+', '-', '×', '÷']);
  const topValue = recognizeRow(puzzleRows[0], () => digits);
  const lowerValues = puzzleRows.slice(1).map((row) => recognizeRow(row, (index) => index === 0 ? operators : digits));
  const validLowerValues = [];
  for (const value of lowerValues) {
    if (!/^([+\-×÷])(\d{1,4})$/.test(value)) break;
    validLowerValues.push(value);
  }
  if (!/^\d{1,4}$/.test(topValue) || validLowerValues.length === 0) {
    throw new Error(`Offline visual recognition was incomplete (${topValue || '?'} / ${lowerValues.join(' / ') || '?'}).`);
  }
  return [topValue, ...validLowerValues].join(' ');
}

function groupCoordinates(values, allowedGap) {
  const groups = [];
  for (const value of values) {
    const current = groups[groups.length - 1];
    if (!current || value > current[current.length - 1] + allowedGap) groups.push([value]);
    else current.push(value);
  }
  return groups;
}

function normalizeGlyphMask(isWhite, left, top, right, bottom) {
  const sourceWidth = right - left + 1;
  const sourceHeight = bottom - top + 1;
  const scale = Math.min(14 / sourceWidth, 18 / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const offsetX = Math.floor((16 - width) / 2);
  const offsetY = Math.floor((20 - height) / 2);
  const output = Array(320).fill('0');
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceX = left + Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / width));
      const sourceY = top + Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / height));
      if (isWhite(sourceX, sourceY)) output[(offsetY + y) * 16 + offsetX + x] = '1';
    }
  }
  return output.join('');
}

function matchGlyph(mask, templates, allowed) {
  let bestCharacter = '';
  let bestDistance = Infinity;
  for (const character of allowed) {
    const template = templates[character];
    if (!template) continue;
    let differences = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i] !== template[i]) differences++;
    const distance = differences / mask.length;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCharacter = character;
    }
  }
  if (!bestCharacter || bestDistance > 0.34) return '?';
  return bestCharacter;
}

function visualCapture(value) {
  const normalized = normalizeExpression(value);
  return {
    mode: null,
    value: normalized,
    rawText: normalized,
    parts: splitExpressionParts(normalized),
    numbers: extractNumbers(normalized),
    operators: extractOperators(normalized),
    root: null,
    source: 'visual',
  };
}
