"use client";

import Image from "next/image";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import type {
  DepthMetric,
  HeatmapBucket,
  HeatmapClickFilter,
  HeatmapDomSnapshot,
  HeatmapMode,
  ViewportHint,
} from "@/lib/dashboard/types";

type HeatPoint = {
  x: number;
  y: number;
  radius: number;
  strength: number;
};

type HoverPreview = {
  bucketIndex: number;
  bucket: HeatmapBucket;
  pointerX: number;
  pointerY: number;
  radiusPx: number;
  metricCount: number;
};

const CLICK_PALETTE_STOPS: Array<[number, string]> = [
  [0, "#2f6dff"],
  [0.22, "#34d6ff"],
  [0.5, "#6bf274"],
  [0.74, "#ffe45a"],
  [1, "#ff2a2a"],
];

const MOVE_PALETTE_STOPS: Array<[number, string]> = [
  [0, "#1f4fb5"],
  [0.38, "#2f6dff"],
  [0.72, "#30b9ff"],
  [1, "#68e4ff"],
];

const MAX_RENDER_EDGE = 1500;

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function formatCount(value: number) {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return normalized.toLocaleString();
}

function metricLabelForMode(mode: HeatmapMode, clickFilter: HeatmapClickFilter) {
  if (mode === "move") {
    return "moves";
  }
  if (mode === "rage" || clickFilter === "rage") {
    return "rage clicks";
  }
  if (clickFilter === "dead") {
    return "dead clicks";
  }
  if (clickFilter === "error") {
    return "error clicks";
  }
  return "clicks";
}

function metricCountForBucket(
  bucket: HeatmapBucket,
  mode: HeatmapMode,
  clickFilter: HeatmapClickFilter,
) {
  if (mode === "move") {
    return bucket.count > 0 ? bucket.count : bucket.weight;
  }
  if (mode === "rage" || clickFilter === "rage") {
    return bucket.rageCount;
  }
  if (clickFilter === "dead") {
    return bucket.deadCount;
  }
  if (clickFilter === "error") {
    return bucket.errorCount;
  }
  return bucket.count > 0 ? bucket.count : bucket.weight;
}

function createPalette(stops: Array<[number, string]>) {
  const paletteCanvas = document.createElement("canvas");
  paletteCanvas.width = 256;
  paletteCanvas.height = 1;
  const context = paletteCanvas.getContext("2d");
  if (!context) {
    return new Uint8ClampedArray(256 * 4);
  }

  const gradient = context.createLinearGradient(0, 0, 256, 0);
  for (const [offset, color] of stops) {
    gradient.addColorStop(offset, color);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 1);
  return context.getImageData(0, 0, 256, 1).data;
}

function createAlphaStamp(radiusPx: number) {
  const radius = Math.max(1, Math.round(radiusPx));
  const size = radius * 2;
  const stamp = document.createElement("canvas");
  stamp.width = size;
  stamp.height = size;
  const context = stamp.getContext("2d");
  if (!context) {
    return null;
  }

  const gradient = context.createRadialGradient(radius, radius, 0, radius, radius, radius);
  gradient.addColorStop(0, "rgba(0, 0, 0, 1)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return stamp;
}

function buildIntensityCanvas(width: number, height: number, points: HeatPoint[], blurPx: number) {
  const layerCanvas = document.createElement("canvas");
  layerCanvas.width = width;
  layerCanvas.height = height;
  const layerContext = layerCanvas.getContext("2d");
  if (!layerContext) {
    return null;
  }

  const stampCache = new Map<number, HTMLCanvasElement>();
  for (const point of points) {
    const radius = Math.max(3, Math.round(point.radius));
    let stamp = stampCache.get(radius);
    if (!stamp) {
      const next = createAlphaStamp(radius);
      if (!next) {
        continue;
      }
      stamp = next;
      stampCache.set(radius, stamp);
    }

    layerContext.globalAlpha = Math.max(0.03, Math.min(1, point.strength));
    layerContext.drawImage(stamp, point.x - radius, point.y - radius);
  }
  layerContext.globalAlpha = 1;

  if (blurPx <= 0) {
    return layerCanvas;
  }

  const blurCanvas = document.createElement("canvas");
  blurCanvas.width = width;
  blurCanvas.height = height;
  const blurContext = blurCanvas.getContext("2d");
  if (!blurContext) {
    return layerCanvas;
  }

  blurContext.filter = `blur(${blurPx}px)`;
  blurContext.drawImage(layerCanvas, 0, 0);
  blurContext.filter = "none";
  return blurCanvas;
}

function colorizeIntensityCanvas(alphaCanvas: HTMLCanvasElement, palette: Uint8ClampedArray, layerOpacity: number) {
  const width = alphaCanvas.width;
  const height = alphaCanvas.height;
  const alphaContext = alphaCanvas.getContext("2d");
  if (!alphaContext) {
    return null;
  }

  const image = alphaContext.getImageData(0, 0, width, height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha === 0) {
      continue;
    }
    const paletteIndex = Math.min(255, alpha) * 4;
    data[index] = palette[paletteIndex];
    data[index + 1] = palette[paletteIndex + 1];
    data[index + 2] = palette[paletteIndex + 2];
    data[index + 3] = Math.min(255, Math.round(alpha * Math.max(0, Math.min(1, layerOpacity))));
  }

  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = width;
  colorCanvas.height = height;
  const colorContext = colorCanvas.getContext("2d");
  if (!colorContext) {
    return null;
  }

  colorContext.putImageData(image, 0, 0);
  return colorCanvas;
}

function drawHeatLayer(
  targetContext: CanvasRenderingContext2D,
  width: number,
  height: number,
  points: HeatPoint[],
  palette: Uint8ClampedArray,
  layerOpacity: number,
  blurPx: number,
) {
  if (!points.length) {
    return;
  }

  const longestEdge = Math.max(width, height, 1);
  const qualityScale = Math.min(1, MAX_RENDER_EDGE / longestEdge);
  const renderWidth = Math.max(160, Math.round(width * qualityScale));
  const renderHeight = Math.max(160, Math.round(height * qualityScale));
  const blur = Math.max(2, blurPx * qualityScale);

  const renderPoints = points.map((point) => ({
    x: (clampPercent(point.x) / 100) * renderWidth,
    y: (clampPercent(point.y) / 100) * renderHeight,
    radius: Math.max(3, (point.radius / 100) * renderWidth),
    strength: point.strength,
  }));

  const intensityCanvas = buildIntensityCanvas(renderWidth, renderHeight, renderPoints, blur);
  if (!intensityCanvas) {
    return;
  }

  const colorizedCanvas = colorizeIntensityCanvas(intensityCanvas, palette, layerOpacity);
  if (!colorizedCanvas) {
    return;
  }

  targetContext.save();
  targetContext.globalCompositeOperation = "screen";
  targetContext.drawImage(colorizedCanvas, 0, 0, width, height);
  targetContext.restore();
}

function useElementSize(elementRef: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    const update = () => {
      const nextWidth = Math.max(0, Math.round(element.clientWidth));
      const nextHeight = Math.max(0, Math.round(element.clientHeight));
      setSize((previous) => {
        if (previous.width === nextWidth && previous.height === nextHeight) {
          return previous;
        }
        return { width: nextWidth, height: nextHeight };
      });
    };

    update();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [elementRef]);

  return size;
}

function escapeHTMLAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function buildSnapshotDocument(snapshot: HeatmapDomSnapshot | undefined) {
  if (!snapshot) {
    return "";
  }

  const rawHTML = (snapshot.html || "").trim();
  if (!rawHTML) {
    return "";
  }

  const safeCSS = (snapshot.css || "").replace(/<\/style/gi, "<\\/style");
  const baseTag = snapshot.pageUrl ? `<base href="${escapeHTMLAttribute(snapshot.pageUrl)}">` : "";
  const styleTag = safeCSS ? `<style data-anlticsheat-dom-snapshot="1">${safeCSS}</style>` : "";
  const titleTag = snapshot.pageTitle
    ? `<title>${escapeHTMLAttribute(snapshot.pageTitle)}</title>`
    : "";
  const headInjection = `${baseTag}${titleTag}${styleTag}`;

  if (/<html[\s>]/i.test(rawHTML)) {
    if (/<head[\s>]/i.test(rawHTML)) {
      return rawHTML
        .replace(/<head([^>]*)>/i, `<head$1>${headInjection}`)
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    }

    return rawHTML
      .replace(
        /<html([^>]*)>/i,
        `<html$1><head><meta charset="utf-8">${headInjection}</head>`,
      )
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  }

  return `<!doctype html><html><head><meta charset="utf-8">${headInjection}</head><body>${rawHTML}</body></html>`;
}

function HeatCanvasOverlay({
  width,
  height,
  clickPoints,
  movePoints,
  showClicks,
  showMoves,
  clickOpacity,
  moveOpacity,
  blendMode,
}: {
  width: number;
  height: number;
  clickPoints: HeatPoint[];
  movePoints: HeatPoint[];
  showClicks: boolean;
  showMoves: boolean;
  clickOpacity: number;
  moveOpacity: number;
  blendMode: "screen" | "multiply" | "normal";
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const clickPalette = useMemo(
    () => (typeof document === "undefined" ? new Uint8ClampedArray(256 * 4) : createPalette(CLICK_PALETTE_STOPS)),
    [],
  );
  const movePalette = useMemo(
    () => (typeof document === "undefined" ? new Uint8ClampedArray(256 * 4) : createPalette(MOVE_PALETTE_STOPS)),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) {
      return;
    }

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const renderWidth = Math.max(1, Math.round(width * dpr));
    const renderHeight = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    if (showMoves) {
      drawHeatLayer(context, width, height, movePoints, movePalette, moveOpacity, 8);
    }
    if (showClicks) {
      drawHeatLayer(context, width, height, clickPoints, clickPalette, clickOpacity, 10);
    }
  }, [clickOpacity, clickPalette, clickPoints, height, moveOpacity, movePalette, movePoints, showClicks, showMoves, width]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      style={{ mixBlendMode: blendMode }}
    />
  );
}

export function HeatmapStage({
  buckets,
  moveBuckets,
  domSnapshot,
  screenshot,
  viewport,
  documentHint,
  mode = "engagement",
  clickFilter = "all",
  scrollFunnel = [],
  clickOpacity = 0.78,
  moveOpacity = 0.42,
  intensity = 1,
  showHotspotLabels = false,
}: {
  buckets: HeatmapBucket[];
  moveBuckets: HeatmapBucket[];
  domSnapshot?: HeatmapDomSnapshot;
  screenshot?: string;
  viewport: ViewportHint;
  documentHint: ViewportHint;
  mode?: HeatmapMode;
  clickFilter?: HeatmapClickFilter;
  scrollFunnel?: DepthMetric[];
  clickOpacity?: number;
  moveOpacity?: number;
  intensity?: number;
  showHotspotLabels?: boolean;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const frameSize = useElementSize(frameRef);
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);
  const snapshotSourceDocument = useMemo(() => buildSnapshotDocument(domSnapshot), [domSnapshot]);

  const normalizedIntensity = Math.max(0.7, Math.min(2, intensity));
  const hasBackgroundLayer = Boolean(snapshotSourceDocument || screenshot);
  const heatBlendMode: "screen" | "multiply" = hasBackgroundLayer ? "multiply" : "screen";
  const snapshotViewportWidth = domSnapshot?.viewport.width || 0;
  const snapshotViewportHeight = domSnapshot?.viewport.height || 0;
  const snapshotDocumentWidth = domSnapshot?.document.width || 0;
  const snapshotDocumentHeight = domSnapshot?.document.height || 0;
  const trackedViewportWidth = viewport.width || 0;
  const trackedViewportHeight = viewport.height || 0;
  const trackedDocumentWidth = documentHint.width || 0;
  const trackedDocumentHeight = documentHint.height || 0;
  const viewportWidth = Math.max(320, snapshotViewportWidth || trackedViewportWidth || 0);
  const viewportHeight = Math.max(240, snapshotViewportHeight || trackedViewportHeight || 0);
  const documentWidth = Math.max(viewportWidth, trackedDocumentWidth, snapshotDocumentWidth);
  const documentHeight = Math.max(viewportHeight, trackedDocumentHeight, snapshotDocumentHeight);
  const clickSampleTotal = buckets.reduce((total, bucket) => total + bucket.count, 0);
  const lowSampleRadiusFactor = clickSampleTotal > 0 && clickSampleTotal < 500 ? 0.86 : 1;
  const clickRadiusPx = Math.max(15, Math.min(25, viewportWidth * 0.02 * lowSampleRadiusFactor));
  const moveRadiusPx = Math.max(12, Math.min(20, viewportWidth * 0.015));
  const clickRadius = (clickRadiusPx / documentWidth) * 100;
  const moveRadius = (moveRadiusPx / documentWidth) * 100;
  const activeBuckets = mode === "move" ? moveBuckets : buckets;
  const hoveredMetricLabel = metricLabelForMode(mode, clickFilter);
  const zoneRankByIndex = useMemo(() => {
    const ranked = activeBuckets
      .map((bucket, index) => ({
        index,
        value: metricCountForBucket(bucket, mode, clickFilter),
      }))
      .sort((a, b) => b.value - a.value);

    const map = new Map<number, number>();
    for (let index = 0; index < ranked.length; index += 1) {
      map.set(ranked[index].index, index + 1);
    }
    return map;
  }, [activeBuckets, clickFilter, mode]);

  const showClicks = mode === "engagement" || mode === "click" || mode === "rage";
  const showMoves = mode === "engagement" || mode === "move";
  const clickStrengthMax = Math.max(...buckets.map((bucket) => (bucket.weight || bucket.count) + bucket.rageCount * 0.9), 1);
  const moveStrengthMax = Math.max(...moveBuckets.map((bucket) => bucket.weight || bucket.count), 1);

  const clickPoints = buckets.map((bucket) => {
    const weightedClicks = (bucket.weight || bucket.count) + bucket.rageCount * 0.9;
    const strength = Math.pow(weightedClicks / clickStrengthMax, 0.72) * normalizedIntensity;
    const radiusScale = Math.min(1.55, Math.max(0.82, 0.82 + strength * 0.55));
    return {
      x: bucket.x,
      y: bucket.y,
      strength: Math.min(1, Math.max(0.05, strength)),
      radius: clickRadius * radiusScale,
    };
  });

  const movePoints = moveBuckets.map((bucket) => {
    const strength = Math.pow((bucket.weight || bucket.count) / moveStrengthMax, 0.7) * Math.max(0.85, normalizedIntensity * 0.9);
    const radiusScale = Math.min(1.45, Math.max(0.78, 0.78 + strength * 0.48));
    return {
      x: bucket.x,
      y: bucket.y,
      strength: Math.min(1, Math.max(0.04, strength)),
      radius: moveRadius * radiusScale,
    };
  });

  const hotspotLabels = [...buckets]
    .sort((a, b) => (b.weight || b.count) - (a.weight || a.count))
    .slice(0, 8);
  const scrollBaseline = Math.max(scrollFunnel[0]?.sessions ?? 0, 1);
  const hoverTooltip = hoverPreview && frameSize.width > 0 && frameSize.height > 0
    ? {
        left: `${Math.max(6, Math.min(94, (hoverPreview.pointerX / frameSize.width) * 100))}%`,
        top: `${Math.max(8, Math.min(92, (hoverPreview.pointerY / frameSize.height) * 100))}%`,
        translateX: hoverPreview.pointerX > frameSize.width * 0.62 ? "-100%" : "0%",
        translateY: hoverPreview.pointerY > frameSize.height * 0.72 ? "-100%" : "0%",
      }
    : null;

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!frameSize.width || !frameSize.height || mode === "scroll" || activeBuckets.length === 0) {
      if (hoverPreview) {
        setHoverPreview(null);
      }
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const hoverRadiusPx = mode === "move" ? Math.max(22, moveRadiusPx * 1.15) : Math.max(26, clickRadiusPx * 1.3);
    const nearestThreshold = hoverRadiusPx * 1.25;

    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < activeBuckets.length; index += 1) {
      const bucket = activeBuckets[index];
      const bucketX = (clampPercent(bucket.x) / 100) * rect.width;
      const bucketY = (clampPercent(bucket.y) / 100) * rect.height;
      const distance = Math.hypot(pointerX - bucketX, pointerY - bucketY);
      if (distance <= nearestThreshold && distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }

    if (nearestIndex < 0) {
      if (hoverPreview) {
        setHoverPreview(null);
      }
      return;
    }

    const nearestBucket = activeBuckets[nearestIndex];
    const nextPreview: HoverPreview = {
      bucketIndex: nearestIndex,
      bucket: nearestBucket,
      pointerX,
      pointerY,
      radiusPx: hoverRadiusPx,
      metricCount: metricCountForBucket(nearestBucket, mode, clickFilter),
    };

    setHoverPreview((previous) => {
      if (
        previous &&
        previous.bucketIndex === nextPreview.bucketIndex &&
        Math.abs(previous.pointerX - nextPreview.pointerX) < 1 &&
        Math.abs(previous.pointerY - nextPreview.pointerY) < 1 &&
        previous.metricCount === nextPreview.metricCount
      ) {
        return previous;
      }
      return nextPreview;
    });
  }

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-border/70 bg-[#201b17]">
      <div className="max-h-[72vh] overflow-auto">
        <div
          ref={frameRef}
          className="relative min-w-full cursor-crosshair"
          style={{ aspectRatio: `${documentWidth}/${documentHeight}` }}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverPreview(null)}
        >
          {snapshotSourceDocument ? (
            <iframe
              title="Tracked page DOM snapshot"
              srcDoc={snapshotSourceDocument}
              sandbox=""
              className="pointer-events-none absolute inset-0 h-full w-full border-0 bg-surface-primary"
              loading="lazy"
            />
          ) : screenshot ? (
            <Image
              src={screenshot}
              alt="Tracked page screenshot for heatmap overlay"
              fill
              className="object-fill object-top opacity-92"
              unoptimized
            />
          ) : (
            <div className="heatmap-faux-shot absolute inset-0">
              <div className="absolute left-[8%] top-[10%] h-[12%] w-[36%] rounded-[1.3rem] bg-white/10" />
              <div className="absolute left-[8%] top-[28%] h-[18%] w-[84%] rounded-[1.8rem] bg-white/8" />
              <div className="absolute left-[8%] top-[52%] grid w-[84%] grid-cols-3 gap-3">
                <div className="h-28 rounded-[1.5rem] bg-white/6" />
                <div className="h-28 rounded-[1.5rem] bg-white/6" />
                <div className="h-28 rounded-[1.5rem] bg-white/6" />
              </div>
              <div className="absolute left-[8%] top-[72%] h-[14%] w-[84%] rounded-[1.7rem] bg-white/6" />
              <div className="absolute left-[8%] top-[90%] h-[6%] w-[64%] rounded-[1.2rem] bg-white/8" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0">
            <div
              className={`absolute inset-0 ${
                hasBackgroundLayer
                  ? "bg-gradient-to-b from-black/10 via-black/[0.03] to-black/20"
                  : "bg-gradient-to-b from-black/5 via-transparent to-black/12"
              }`}
            />
            {mode !== "scroll" && frameSize.width > 0 && frameSize.height > 0 ? (
              <HeatCanvasOverlay
                width={frameSize.width}
                height={frameSize.height}
                clickPoints={clickPoints}
                movePoints={movePoints}
                showClicks={showClicks}
                showMoves={showMoves}
                clickOpacity={clickOpacity}
                moveOpacity={moveOpacity}
                blendMode={heatBlendMode}
              />
            ) : null}
            {mode === "scroll" ? (
              <div className="absolute inset-0">
                {scrollFunnel.map((depth) => {
                  const ratio = Math.max(0, Math.min(1, depth.sessions / scrollBaseline));
                  const top = Math.max(0, Math.min(100, depth.depth - 2));
                  return (
                    <div key={depth.depth} className="absolute left-0 right-0" style={{ top: `${top}%` }}>
                      <div
                        className="h-5 border-y border-white/20"
                        style={{
                          background: `linear-gradient(90deg, rgba(14,167,181,${0.18 + ratio * 0.26}), rgba(239,84,50,${0.12 + ratio * 0.34}))`,
                        }}
                      />
                      <div className="absolute -top-5 left-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {depth.depth}% · {depth.sessions}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {showHotspotLabels ? (
              <div className="absolute inset-0">
                {hotspotLabels.map((bucket, index) => (
                  <div
                    key={`${bucket.x}-${bucket.y}-${index}`}
                    className="absolute flex size-6 items-center justify-center rounded-full border border-white/75 bg-black/65 text-[10px] font-semibold text-white shadow-md"
                    style={{
                      left: `${Math.max(0, Math.min(100, bucket.x))}%`,
                      top: `${Math.max(0, Math.min(100, bucket.y))}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    {index + 1}
                  </div>
                ))}
              </div>
            ) : null}
            {hoverPreview ? (
              <div
                className="absolute rounded-full border border-white/85 bg-transparent shadow-[0_0_0_2px_rgba(17,24,39,0.26)]"
                style={{
                  left: `${clampPercent(hoverPreview.bucket.x)}%`,
                  top: `${clampPercent(hoverPreview.bucket.y)}%`,
                  width: `${Math.max(28, hoverPreview.radiusPx * 1.25)}px`,
                  height: `${Math.max(28, hoverPreview.radiusPx * 1.25)}px`,
                  transform: "translate(-50%, -50%)",
                }}
              />
            ) : null}
            {hoverPreview && hoverTooltip ? (
              <div
                className="absolute z-30 w-60 rounded-xl border border-border/70 bg-background/95 px-3 py-2 text-xs text-foreground shadow-xl backdrop-blur-sm"
                style={{
                  left: hoverTooltip.left,
                  top: hoverTooltip.top,
                  transform: `translate(calc(${hoverTooltip.translateX} + 12px), calc(${hoverTooltip.translateY} + 12px))`,
                }}
              >
                <p className="font-semibold">
                  Zone {String(zoneRankByIndex.get(hoverPreview.bucketIndex) ?? 0).padStart(2, "0")}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {Math.round(clampPercent(hoverPreview.bucket.x))}% x {Math.round(clampPercent(hoverPreview.bucket.y))}%
                </p>
                <p className="mt-1.5 text-[11px]">
                  <span className="font-semibold">{formatCount(hoverPreview.metricCount)}</span> {hoveredMetricLabel}
                </p>
                {mode !== "move" ? (
                  <p className="text-[11px] text-muted-foreground">
                    Rage {formatCount(hoverPreview.bucket.rageCount)} · Dead {formatCount(hoverPreview.bucket.deadCount)} · Error{" "}
                    {formatCount(hoverPreview.bucket.errorCount)}
                  </p>
                ) : null}
                <p className="text-[11px] text-muted-foreground">
                  Sessions {formatCount(hoverPreview.bucket.sessions)} · Visitors {formatCount(hoverPreview.bucket.visitors)}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
