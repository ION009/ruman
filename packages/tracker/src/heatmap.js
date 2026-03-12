const RAGE_CLICK_WINDOW_MS = 600;
const MOVE_SAMPLE_INTERVAL_MS = 120;
const MOVE_MIN_DELTA_PX = 8;
const MOVE_MIN_DELTA_MOBILE_PX = 12;
const MOVE_INTERPOLATION_STEP_PX = 48;
const MOVE_INTERPOLATION_STEP_MOBILE_PX = 36;
const MOVE_INTERPOLATION_MAX_POINTS = 2;
const SCROLL_SAMPLE_INTERVAL_MS = 200;
const SCROLL_MIN_DELTA_PERCENT = 3;
const HOVER_MIN_DURATION_MS = 180;
const INTERACTIVE_SELECTOR =
  "a[href],button,input,select,textarea,summary,label,[role='button'],[role='link'],[contenteditable=''],[contenteditable='true'],[onclick],[data-track-id]";
const ERROR_SELECTOR = "[disabled],[aria-disabled='true'],[aria-invalid='true'],[data-error],[data-invalid='true']";
const BLOCKED_ZONE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='']",
  "[contenteditable='true']",
  "[data-replay-block]",
  "[data-replay-ignore]",
  "[data-private]",
  "[data-norecord]",
  "[autocomplete='cc-number']",
  "[autocomplete='cc-csc']",
  "[autocomplete='cc-exp']",
  "[autocomplete='cc-exp-month']",
  "[autocomplete='cc-exp-year']",
  "[autocomplete='current-password']",
  "[autocomplete='new-password']",
  "[autocomplete='one-time-code']",
  "[type='password']",
  "[type='hidden']",
].join(",");

function normalizePointerType(value) {
  switch ((value || "").toLowerCase()) {
    case "mouse":
      return "mouse";
    case "touch":
      return "touch";
    case "pen":
      return "pen";
    case "keyboard":
      return "keyboard";
    default:
      return "mouse";
  }
}

function stableSelector(target) {
  const element = trackedTarget(target);
  if (!element) {
    return null;
  }

  const tracked = element.closest("[data-track-id]");
  if (tracked) {
    return tracked.getAttribute("data-track-id");
  }

  const identified = element.closest("[id]");
  if (identified && identified.id) {
    return `#${escapeCSS(identified.id)}`;
  }

  const classSelector = shortestUniqueClassSelector(element);
  if (classSelector) {
    return classSelector;
  }

  const cssPath = nthPathSelector(element);
  if (cssPath) {
    return cssPath;
  }

  return xpathSelector(element);
}

function isLikelyDeadClick(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  return !target.closest(INTERACTIVE_SELECTOR);
}

function isLikelyErrorClick(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest(ERROR_SELECTOR));
}

function percent(value, total) {
  if (!total) {
    return 0;
  }
  return (value / total) * 100;
}

function trackedTarget(target) {
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest(INTERACTIVE_SELECTOR) || target;
}

function escapeCSS(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function isUniqueSelector(selector) {
  if (!selector) {
    return false;
  }
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function combineClasses(classes, size, start, path, output) {
  if (path.length === size) {
    output.push(path.join("."));
    return;
  }
  for (let index = start; index < classes.length; index += 1) {
    path.push(escapeCSS(classes[index]));
    combineClasses(classes, size, index + 1, path, output);
    path.pop();
  }
}

function shortestUniqueClassSelector(element) {
  const tag = element.tagName.toLowerCase();
  const classes = Array.from(element.classList || []).filter(Boolean).slice(0, 6);
  if (!classes.length) {
    return null;
  }

  const maxSize = Math.min(3, classes.length);
  for (let size = 1; size <= maxSize; size += 1) {
    const candidates = [];
    combineClasses(classes, size, 0, [], candidates);
    for (let index = 0; index < candidates.length; index += 1) {
      const selector = `${tag}.${candidates[index]}`;
      if (isUniqueSelector(selector)) {
        return selector;
      }
    }
  }

  return null;
}

function nthPathSelector(element) {
  const segments = [];
  let current = element;

  while (current && current.nodeType === 1 && current !== document.documentElement) {
    const parent = current.parentElement;
    if (!parent) {
      break;
    }

    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      index += 1;
      sibling = sibling.previousElementSibling;
    }

    const tag = current.tagName.toLowerCase();
    segments.unshift(`${tag}:nth-child(${index})`);
    const selector = `html > ${segments.join(" > ")}`;
    if (isUniqueSelector(selector)) {
      return selector;
    }

    current = parent;
  }

  return segments.length ? `html > ${segments.join(" > ")}` : null;
}

function xpathSelector(element) {
  const segments = [];
  let current = element;

  while (current && current.nodeType === 1) {
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    segments.unshift(`${current.tagName.toLowerCase()}[${index}]`);
    current = current.parentElement;
  }

  if (!segments.length) {
    return null;
  }
  return `xpath:/${segments.join("/")}`;
}

function documentBounds() {
  const doc = document.documentElement;
  const body = document.body;
  const visualViewport = window.visualViewport;
  return {
    width: Math.max(
      (doc && Math.max(doc.scrollWidth, doc.clientWidth, doc.offsetWidth)) || 0,
      (body && Math.max(body.scrollWidth, body.clientWidth, body.offsetWidth)) || 0,
      Math.round((visualViewport && visualViewport.width) || 0),
      window.innerWidth || 0,
      1,
    ),
    height: Math.max(
      (doc && Math.max(doc.scrollHeight, doc.clientHeight, doc.offsetHeight)) || 0,
      (body && Math.max(body.scrollHeight, body.clientHeight, body.offsetHeight)) || 0,
      Math.round((visualViewport && visualViewport.height) || 0),
      window.innerHeight || 0,
      1,
    ),
  };
}

function toDocumentPercent(clientX, clientY, bounds = documentBounds()) {
  return {
    x: Math.max(0, Math.min(100, percent((clientX || 0) + (window.scrollX || 0), bounds.width))),
    y: Math.max(0, Math.min(100, percent((clientY || 0) + (window.scrollY || 0), bounds.height))),
  };
}

function isBlockedZone(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target.closest("[data-replay-unmask]")) {
    return false;
  }
  return Boolean(target.closest(BLOCKED_ZONE_SELECTOR));
}

function moveDeltaThresholdPx() {
  const viewportWidth = window.innerWidth || 0;
  if (viewportWidth > 0 && viewportWidth < 768) {
    return MOVE_MIN_DELTA_MOBILE_PX;
  }
  return MOVE_MIN_DELTA_PX;
}

function moveInterpolationStepPx() {
  const viewportWidth = window.innerWidth || 0;
  if (viewportWidth > 0 && viewportWidth < 768) {
    return MOVE_INTERPOLATION_STEP_MOBILE_PX;
  }
  return MOVE_INTERPOLATION_STEP_PX;
}

export function startHeatmap(tracker) {
  let page = tracker.currentPath();
  let maxScrollDepth = 0;
  let lastScrollAt = 0;
  let recentClicks = [];
  let scheduled = false;
  let moveScheduled = false;
  let pendingMoveX = 0;
  let pendingMoveY = 0;
  let pendingMovePointerType = "mouse";
  let lastMoveAt = 0;
  let lastMoveX = -1;
  let lastMoveY = -1;
  let activeHover = null;

  function emitMovePoint(clientX, clientY, pointerType) {
    const bounds = documentBounds();
    const coords = toDocumentPercent(clientX, clientY, bounds);
    tracker.trackHeatmap("move", {
      x: coords.x,
      y: coords.y,
      rawX: clientX,
      rawY: clientY,
      pointerType,
      documentWidth: bounds.width,
      documentHeight: bounds.height,
    });
  }

  function flushHover(force = false) {
    if (!activeHover) {
      return;
    }

    const current = activeHover;
    activeHover = null;
    const duration = Date.now() - current.startedAt;
    if (!force && duration < HOVER_MIN_DURATION_MS) {
      return;
    }

    if (!(current.target instanceof Element)) {
      return;
    }

    const rect = current.target.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || centerX < 0 || centerY < 0) {
      return;
    }

    const bounds = documentBounds();
    const coords = toDocumentPercent(centerX, centerY, bounds);
    tracker.trackHeatmap("hover", {
      x: coords.x,
      y: coords.y,
      rawX: centerX,
      rawY: centerY,
      scrollX: window.scrollX || 0,
      scrollY: window.scrollY || 0,
      pointerType: current.pointerType,
      selector: current.selector,
      hoverMs: duration,
      blockedZone: isBlockedZone(current.target),
      documentWidth: bounds.width,
      documentHeight: bounds.height,
    });
  }

  function resetIfNeeded() {
    const nextPage = tracker.currentPath();
    if (nextPage === page) {
      return;
    }
    flushHover(true);
    page = nextPage;
    maxScrollDepth = 0;
    lastScrollAt = 0;
    recentClicks = [];
    lastMoveAt = 0;
    lastMoveX = -1;
    lastMoveY = -1;
  }

  function depthPercent() {
    const doc = document.documentElement;
    return Math.max(
      0,
      Math.min(
        100,
        percent((window.scrollY || 0) + (window.innerHeight || 0), Math.max((doc && doc.scrollHeight) || 0, window.innerHeight || 0)),
      ),
    );
  }

  function updateDepth(force = false) {
    scheduled = false;
    resetIfNeeded();
    const depth = depthPercent();

    if (depth <= maxScrollDepth && !force) {
      return;
    }
    const now = Date.now();
    if (
      !force &&
      depth - maxScrollDepth < SCROLL_MIN_DELTA_PERCENT &&
      now - lastScrollAt < SCROLL_SAMPLE_INTERVAL_MS
    ) {
      return;
    }

    maxScrollDepth = Math.max(maxScrollDepth, depth);
    lastScrollAt = now;
    tracker.trackHeatmap("scroll", {
      depth: Math.round(maxScrollDepth),
      scrollY: window.scrollY || 0,
      documentWidth: documentBounds().width,
      documentHeight: documentBounds().height,
    });
  }

  function flushMove() {
    moveScheduled = false;
    resetIfNeeded();

    if (document.visibilityState === "hidden") {
      return;
    }

    const now = Date.now();
    if (now - lastMoveAt < MOVE_SAMPLE_INTERVAL_MS) {
      return;
    }

    if (
      lastMoveX >= 0 &&
      lastMoveY >= 0 &&
      Math.abs(pendingMoveX - lastMoveX) < moveDeltaThresholdPx() &&
      Math.abs(pendingMoveY - lastMoveY) < moveDeltaThresholdPx()
    ) {
      return;
    }

    const previousMoveX = lastMoveX;
    const previousMoveY = lastMoveY;
    lastMoveX = pendingMoveX;
    lastMoveY = pendingMoveY;
    lastMoveAt = now;

    if (previousMoveX >= 0 && previousMoveY >= 0) {
      const deltaX = pendingMoveX - previousMoveX;
      const deltaY = pendingMoveY - previousMoveY;
      const distance = Math.hypot(deltaX, deltaY);
      const interpolationStep = Math.max(moveInterpolationStepPx(), moveDeltaThresholdPx() * 2);
      const interpolationPoints = Math.min(
        MOVE_INTERPOLATION_MAX_POINTS,
        Math.floor(distance / Math.max(1, interpolationStep)),
      );

      for (let index = 1; index <= interpolationPoints; index += 1) {
        const ratio = index / (interpolationPoints + 1);
        emitMovePoint(previousMoveX + deltaX * ratio, previousMoveY + deltaY * ratio, pendingMovePointerType);
      }
    }

    emitMovePoint(pendingMoveX, pendingMoveY, pendingMovePointerType);
  }

  const moveEventName = "PointerEvent" in window ? "pointermove" : "mousemove";
  const hoverOverEventName = "PointerEvent" in window ? "pointerover" : "mouseover";
  const hoverOutEventName = "PointerEvent" in window ? "pointerout" : "mouseout";

  window.addEventListener(
    moveEventName,
    (event) => {
      if (!event.isTrusted) {
        return;
      }
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
        return;
      }

      let pointerType = "mouse";
      if ("pointerType" in event) {
        if (event.isPrimary === false) {
          return;
        }
        pointerType = normalizePointerType(event.pointerType);
      }

      if (pointerType === "touch") {
        return;
      }
      if (event.clientX < 0 || event.clientY < 0) {
        return;
      }

      pendingMoveX = event.clientX;
      pendingMoveY = event.clientY;
      pendingMovePointerType = pointerType;

      if (moveScheduled) {
        return;
      }
      moveScheduled = true;
      window.requestAnimationFrame(flushMove);
    },
    { passive: true },
  );

  document.addEventListener(
    hoverOverEventName,
    (event) => {
      if (!event.isTrusted) {
        return;
      }

      let pointerType = "mouse";
      if ("pointerType" in event) {
        if (event.isPrimary === false) {
          return;
        }
        pointerType = normalizePointerType(event.pointerType);
      }
      if (pointerType === "touch") {
        return;
      }

      const target = trackedTarget(event.target);
      if (!target) {
        return;
      }
      const selector = stableSelector(target);
      if (!selector) {
        return;
      }
      if (
        activeHover &&
        activeHover.target === target &&
        activeHover.selector === selector &&
        activeHover.pointerType === pointerType
      ) {
        return;
      }

      flushHover(false);
      activeHover = {
        target,
        selector,
        pointerType,
        startedAt: Date.now(),
      };
    },
    { passive: true, capture: true },
  );

  document.addEventListener(
    hoverOutEventName,
    (event) => {
      if (!activeHover) {
        return;
      }

      const target = trackedTarget(event.target);
      if (!target || target !== activeHover.target) {
        return;
      }

      const related = trackedTarget(event.relatedTarget);
      if (related && activeHover.target.contains(related)) {
        return;
      }

      flushHover(false);
    },
    { passive: true, capture: true },
  );

  function trackClick(event, pointerType) {
    if (!event.isTrusted || document.visibilityState === "hidden") {
      return;
    }
    if (pointerType === "keyboard" && event.clientX === 0 && event.clientY === 0) {
      return;
    }
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return;
    }
    if (event.clientX < 0 || event.clientY < 0) {
      return;
    }

    resetIfNeeded();
    flushHover(false);
    const now = Date.now();
    const selector = stableSelector(event.target);
    const key = selector || event.target;
    recentClicks = recentClicks.filter((entry) => now - entry.at <= RAGE_CLICK_WINDOW_MS);
    const rage = recentClicks.filter((entry) => entry.key === key && entry.pointerType === pointerType).length >= 2;
    recentClicks.push({ at: now, key, pointerType });
    const dead = isLikelyDeadClick(event.target);
    const error = isLikelyErrorClick(event.target);
    const bounds = documentBounds();
    const coords = toDocumentPercent(event.clientX, event.clientY, bounds);

    tracker.trackHeatmap("click", {
      x: coords.x,
      y: coords.y,
      rawX: event.clientX,
      rawY: event.clientY,
      scrollX: window.scrollX || 0,
      scrollY: window.scrollY || 0,
      pointerType,
      selector,
      rage,
      dead,
      error,
      blockedZone: isBlockedZone(event.target),
      documentWidth: bounds.width,
      documentHeight: bounds.height,
    });
  }

  if ("PointerEvent" in window) {
    document.addEventListener(
      "pointerup",
      (event) => {
        const pointerType = normalizePointerType(event.pointerType);
        if (event.isPrimary === false) {
          return;
        }
        if (pointerType !== "touch" && event.button !== 0) {
          return;
        }
        trackClick(event, pointerType);
      },
      { passive: true },
    );

    // Keyboard-triggered clicks still dispatch a `click` with detail=0.
    document.addEventListener(
      "click",
      (event) => {
        if (event.detail !== 0) {
          return;
        }
        trackClick(event, "keyboard");
      },
      { passive: true },
    );
  } else {
    document.addEventListener(
      "click",
      (event) => {
        trackClick(event, "mouse");
      },
      { passive: true },
    );
  }

  window.addEventListener(
    "scroll",
    () => {
      if (scheduled) {
        return;
      }
      scheduled = true;
      window.requestAnimationFrame(updateDepth);
    },
    { passive: true },
  );

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      updateDepth(true);
      flushHover(true);
    }
  });
  window.addEventListener(
    "pagehide",
    () => {
      updateDepth(true);
      flushHover(true);
    },
    { passive: true },
  );

  window.requestAnimationFrame(updateDepth);
}
