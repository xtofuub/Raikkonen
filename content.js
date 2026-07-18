(() => {
  "use strict";

  if (window.__KIMI_AUTO_CONTINUE_V6__) return;
  window.__KIMI_AUTO_CONTINUE_V6__ = true;

  const DEFAULTS = {
    enabled: true,
    dismissTips: true,
    aggressiveMode: true
  };

  const CONTINUE_LABELS = [
    "continue task",
    "resume task",
    "continue",
    "resume"
  ];

  const DISMISS_LABELS = [
    "got it",
    "i got it",
    "understood",
    "okay",
    "ok"
  ];

  let settings = { ...DEFAULTS };
  let scanning = false;
  let scanAgain = false;
  let queuedTimer = null;
  let pollTimer = null;

  const cooldowns = new Map();

  const status = {
    frame: window.top === window ? "top" : "iframe",
    lastScan: 0,
    continueFound: 0,
    dismissFound: 0,
    lastAction: "Waiting for Kimi…",
    lastActionAt: 0
  };

  function normalise(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function stripTrailingPunctuation(value) {
    return normalise(value).replace(/[\s.!?…,:;]+$/g, "");
  }

  function visible(element) {
    if (!(element instanceof Element)) return false;

    let style;
    try {
      style = getComputedStyle(element);
    } catch {
      return false;
    }

    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number.parseFloat(style.opacity || "1") < 0.05 ||
      style.pointerEvents === "none"
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function disabled(element) {
    return Boolean(
      element.disabled ||
      element.hasAttribute("disabled") ||
      element.getAttribute("aria-disabled") === "true"
    );
  }

  function ownText(element) {
    if (!(element instanceof Element)) return "";

    return normalise(
      Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.nodeValue || "")
        .join(" ")
    );
  }

  function labelsFor(element) {
    if (!(element instanceof Element)) return [];

    const values = [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-label"),
      element.value,
      ownText(element),
      element.innerText,
      element.textContent
    ];

    return [...new Set(values.map(normalise).filter(Boolean))];
  }

  function matchesExactLabel(element, labels) {
    const wanted = new Set(labels.map(stripTrailingPunctuation));

    return labelsFor(element).some((value) => {
      const cleaned = stripTrailingPunctuation(value);
      return wanted.has(cleaned);
    });
  }

  function allRoots() {
    const roots = [];
    const queue = [document];
    const seen = new Set();

    while (queue.length) {
      const root = queue.shift();
      if (!root || seen.has(root)) continue;

      seen.add(root);
      roots.push(root);

      let elements = [];
      try {
        elements = root.querySelectorAll("*");
      } catch {
        continue;
      }

      for (const element of elements) {
        if (element.shadowRoot) queue.push(element.shadowRoot);
      }
    }

    return roots;
  }

  function parentAcrossShadow(element) {
    if (!element) return null;
    if (element.parentElement) return element.parentElement;

    const root = element.getRootNode?.();
    return root instanceof ShadowRoot ? root.host : null;
  }

  function clickabilityScore(element) {
    if (!(element instanceof Element) || !visible(element) || disabled(element)) {
      return -Infinity;
    }

    const tag = element.tagName.toLowerCase();
    let score = 0;

    if (tag === "button") score += 160;
    if (tag === "input" && ["button", "submit"].includes(element.type)) score += 150;
    if (element.getAttribute("role") === "button") score += 130;
    if (tag === "a") score += 80;
    if (element.hasAttribute("onclick")) score += 70;
    if (element.hasAttribute("tabindex")) score += 35;

    try {
      if (getComputedStyle(element).cursor === "pointer") score += 25;
    } catch {}

    const rect = element.getBoundingClientRect();

    if (rect.width >= 45 && rect.width <= 420) score += 18;
    if (rect.height >= 24 && rect.height <= 90) score += 18;

    if (matchesExactLabel(element, DISMISS_LABELS)) score += 45;
    if (matchesExactLabel(element, CONTINUE_LABELS)) score += 40;

    return score;
  }

  function bestClickableAncestor(start) {
    const candidates = [];
    let current = start;

    for (let depth = 0; current && depth < 14; depth += 1) {
      if (current instanceof Element) {
        candidates.push(current);
      }
      current = parentAcrossShadow(current);
    }

    candidates.sort((a, b) => clickabilityScore(b) - clickabilityScore(a));
    return clickabilityScore(candidates[0]) > 0 ? candidates[0] : null;
  }

  function collectLabelCandidates(labels) {
    const found = new Set();

    for (const root of allRoots()) {
      let elements = [];

      try {
        elements = root.querySelectorAll(
          'button, input[type="button"], input[type="submit"], ' +
          '[role="button"], a, [onclick], [tabindex], span, div, p'
        );
      } catch {
        continue;
      }

      for (const element of elements) {
        if (!visible(element)) continue;
        if (!matchesExactLabel(element, labels)) continue;

        const clickable = bestClickableAncestor(element);
        if (clickable) found.add(clickable);
      }

      // Some component libraries split the button into wrappers whose full
      // text does not match. Search direct text nodes as a fallback.
      try {
        const walker = document.createTreeWalker(
          root,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode(node) {
              const text = stripTrailingPunctuation(node.nodeValue);
              return labels.map(stripTrailingPunctuation).includes(text)
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT;
            }
          }
        );

        let node;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement;
          if (!parent || !visible(parent)) continue;

          const clickable = bestClickableAncestor(parent);
          if (clickable) found.add(clickable);
        }
      } catch {}
    }

    return [...found].sort(
      (a, b) => clickabilityScore(b) - clickabilityScore(a)
    );
  }

  function pageText() {
    return normalise(
      document.body?.innerText ||
      document.body?.textContent ||
      ""
    );
  }

  function shouldUseContinueCandidate(element) {
    if (matchesExactLabel(element, ["continue task", "resume task"])) {
      return true;
    }

    const text = pageText();

    return (
      text.includes("task paused due to system peak") ||
      text.includes("continue task") ||
      text.includes("resume task")
    );
  }

  function setStatus(message) {
    status.lastAction = message;
    status.lastActionAt = Date.now();

    browser.storage.local.set({
      diagnosticStatus: {
        ...status,
        url: location.href
      }
    }).catch(() => {});
  }

  function cooldownReady(key, delay) {
    const now = Date.now();
    const last = cooldowns.get(key) || 0;

    if (now - last < delay) return false;

    cooldowns.set(key, now);
    return true;
  }

  function nativeClick(element) {
    try {
      const prototype =
        element instanceof HTMLButtonElement
          ? HTMLButtonElement.prototype
          : element instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : element instanceof HTMLAnchorElement
              ? HTMLAnchorElement.prototype
              : HTMLElement.prototype;

      prototype.click.call(element);
      return true;
    } catch {
      try {
        element.click();
        return true;
      } catch {
        return false;
      }
    }
  }

  function fireActivation(element) {
    if (!element || !visible(element) || disabled(element)) return false;

    try {
      element.focus({ preventScroll: true });
    } catch {}

    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    const common = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      clientX,
      clientY
    };

    try {
      if (typeof PointerEvent === "function") {
        element.dispatchEvent(
          new PointerEvent("pointerover", {
            ...common,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            buttons: 0
          })
        );

        element.dispatchEvent(
          new PointerEvent("pointerdown", {
            ...common,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            buttons: 1
          })
        );
      }

      element.dispatchEvent(
        new MouseEvent("mouseover", {
          ...common,
          view: window,
          buttons: 0
        })
      );

      element.dispatchEvent(
        new MouseEvent("mousedown", {
          ...common,
          view: window,
          buttons: 1
        })
      );

      if (typeof PointerEvent === "function") {
        element.dispatchEvent(
          new PointerEvent("pointerup", {
            ...common,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            buttons: 0
          })
        );
      }

      element.dispatchEvent(
        new MouseEvent("mouseup", {
          ...common,
          view: window,
          buttons: 0
        })
      );

      const clicked = nativeClick(element);

      // Keyboard fallback for custom role="button" components.
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true,
          composed: true
        })
      );

      element.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true,
          composed: true
        })
      );

      return clicked;
    } catch (error) {
      console.warn("[Kimi Auto Continue] Activation failed:", error);
      return false;
    }
  }

  function clickFirst(candidates, key, cooldownMs, label) {
    if (!candidates.length || !cooldownReady(key, cooldownMs)) return false;

    for (const element of candidates) {
      const text = labelsFor(element).find(Boolean) || label;

      if (fireActivation(element)) {
        setStatus(`Clicked ${label}: “${text.slice(0, 70)}”`);
        console.debug("[Kimi Auto Continue]", status.lastAction, element);

        // Recheck quickly in case the first activation landed on an inner
        // wrapper or the popup rerendered.
        queueScan(120);
        return true;
      }
    }

    return false;
  }

  async function scan() {
    if (!settings.enabled) return;

    if (scanning) {
      scanAgain = true;
      return;
    }

    scanning = true;

    try {
      status.lastScan = Date.now();

      const dismissCandidates = settings.dismissTips
        ? collectLabelCandidates(DISMISS_LABELS)
        : [];

      const continueCandidates = collectLabelCandidates(CONTINUE_LABELS)
        .filter(shouldUseContinueCandidate);

      status.dismissFound = dismissCandidates.length;
      status.continueFound = continueCandidates.length;

      // A blocking popup always takes priority over the resume control.
      if (
        settings.dismissTips &&
        clickFirst(dismissCandidates, "dismiss", 550, "Got it")
      ) {
        return;
      }

      const continueDelay = settings.aggressiveMode ? 420 : 1100;
      clickFirst(
        continueCandidates,
        "continue",
        continueDelay,
        "Continue Task"
      );
    } finally {
      scanning = false;

      if (scanAgain) {
        scanAgain = false;
        queueScan(20);
      }
    }
  }

  function queueScan(delay = 20) {
    // Do not keep cancelling and postponing the same scan while Kimi streams
    // DOM mutations. One queued scan is enough.
    if (queuedTimer !== null) return;

    queuedTimer = window.setTimeout(async () => {
      queuedTimer = null;
      await scan();
    }, delay);
  }

  function schedulePoll() {
    window.clearTimeout(pollTimer);

    const delay = document.hidden
      ? (settings.aggressiveMode ? 800 : 1500)
      : (settings.aggressiveMode ? 260 : 650);

    pollTimer = window.setTimeout(async () => {
      await scan();
      schedulePoll();
    }, delay);
  }

  const observer = new MutationObserver(() => {
    queueScan(15);
  });

  function start() {
    const root = document.documentElement;

    if (!root) {
      window.setTimeout(start, 25);
      return;
    }

    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "disabled",
        "aria-disabled",
        "aria-label",
        "title",
        "role",
        "value"
      ]
    });

    queueScan(0);
    schedulePoll();
  }

  browser.storage.local.get(DEFAULTS).then((saved) => {
    settings = { ...DEFAULTS, ...saved };
    setStatus("Extension loaded; watching for controls");
    start();
  }).catch(start);

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    for (const key of Object.keys(DEFAULTS)) {
      if (changes[key]) settings[key] = changes[key].newValue;
    }

    queueScan(0);
    schedulePoll();
  });

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "scan-now") {
      queueScan(0);

      return Promise.resolve({
        ok: true,
        status: { ...status }
      });
    }

    if (message?.type === "diagnose") {
      return Promise.resolve({
        ok: true,
        status: {
          ...status,
          url: location.href,
          title: document.title
        }
      });
    }

    return undefined;
  });

  document.addEventListener("visibilitychange", () => {
    queueScan(0);
    schedulePoll();
  });

  window.addEventListener("pageshow", () => {
    queueScan(0);
    schedulePoll();
  });

  window.addEventListener("focus", () => {
    queueScan(0);
  });
})();
