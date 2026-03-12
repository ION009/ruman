function getUTM(url) {
  return {
    source: url.searchParams.get("utm_source") || "",
    medium: url.searchParams.get("utm_medium") || "",
    campaign: url.searchParams.get("utm_campaign") || "",
    term: url.searchParams.get("utm_term") || "",
    content: url.searchParams.get("utm_content") || "",
  };
}

function pagePayload(kind, previousPath) {
  const url = new URL(window.location.href);
  return {
    id: crypto.randomUUID(),
    type: kind,
    timestamp: new Date().toISOString(),
    path: `${url.pathname}${url.search}`,
    url: url.toString(),
    title: document.title || "",
    referrer: previousPath || document.referrer || "",
    screen: {
      width: window.screen.width,
      height: window.screen.height,
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    language: navigator.language || "",
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    utm: getUTM(url),
  };
}

export function startCore(transport) {
  let lastPath = "";

  function trackPage(kind = "pageview", previousPath = "") {
    const payload = pagePayload(kind, previousPath);
    if (payload.path === lastPath && kind === "pageview") {
      return;
    }

    lastPath = payload.path;
    transport.enqueue("event", payload);
  }

  function patchHistory(method) {
    const original = history[method];
    history[method] = function patchedHistory(...args) {
      const previousPath = `${window.location.pathname}${window.location.search}`;
      const result = original.apply(this, args);
      queueMicrotask(() => trackPage("pageview", previousPath));
      return result;
    };
  }

  patchHistory("pushState");
  patchHistory("replaceState");
  window.addEventListener("popstate", () => trackPage("pageview", lastPath));
  window.addEventListener("hashchange", () => trackPage("pageview", lastPath));
  trackPage();

  window.anlticsheat = window.anlticsheat || {};
  window.anlticsheat.track = (name, props = {}) => {
    transport.enqueue("event", {
      id: crypto.randomUUID(),
      type: "custom",
      name,
      props,
      timestamp: new Date().toISOString(),
      path: `${window.location.pathname}${window.location.search}`,
      url: window.location.href,
      title: document.title || "",
      referrer: document.referrer || "",
      screen: {
        width: window.screen.width,
        height: window.screen.height,
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      language: navigator.language || "",
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      utm: getUTM(new URL(window.location.href)),
    });
  };

  return {
    trackPage,
  };
}

