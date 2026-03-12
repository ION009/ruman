function observe(type, callback, options) {
  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (let index = 0; index < entries.length; index += 1) {
        callback(entries[index]);
      }
    });

    observer.observe({
      type,
      buffered: true,
      ...options,
    });

    return observer;
  } catch {
    return null;
  }
}

export function startPerf(tracker) {
  if (!("PerformanceObserver" in window)) {
    return;
  }

  let cls = 0;
  let lcp = 0;
  let inp = 0;
  let ttfb = 0;
  let sent = false;

  const observers = [
    observe("largest-contentful-paint", (entry) => {
      lcp = entry.startTime || entry.renderTime || lcp;
    }),
    observe(
      "event",
      (entry) => {
        const duration = entry.duration || 0;
        if (duration > inp) {
          inp = duration;
        }
      },
      { durationThreshold: 40 },
    ),
    observe("layout-shift", (entry) => {
      if (!entry.hadRecentInput) {
        cls += entry.value || 0;
      }
    }),
    observe("navigation", (entry) => {
      ttfb = entry.responseStart || ttfb;
    }),
  ];

  function flush() {
    if (sent) {
      return;
    }
    sent = true;

    tracker.trackMetric("perf_lcp", lcp);
    tracker.trackMetric("perf_inp", inp);
    tracker.trackMetric("perf_cls", cls);
    tracker.trackMetric("perf_ttfb", ttfb);

    for (let index = 0; index < observers.length; index += 1) {
      if (observers[index]) {
        observers[index].disconnect();
      }
    }
  }

  window.addEventListener("pagehide", flush, { once: true });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    },
    { once: true },
  );
}
