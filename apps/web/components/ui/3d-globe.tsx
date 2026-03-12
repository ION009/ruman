"use client";

import createGlobe from "cobe";
import { LocateFixed, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn, formatCompact, formatPercent } from "@/lib/utils";

export interface GlobeMarker {
  lat: number;
  lng: number;
  src: string;
  label?: string;
  size?: number;
}

export interface GlobeCountrySignal {
  id: string;
  label: string;
  value: number;
  countryCode?: string;
  lat?: number;
  lng?: number;
  sessions?: number;
  pageviews?: number;
  share?: number;
  continent?: string;
  precision?: string;
}

export interface Globe3DConfig {
  globeColor?: string;
  atmosphereColor?: string;
  atmosphereIntensity?: number;
  autoRotateSpeed?: number;
  bumpScale?: number;
  enableZoom?: boolean;
  enablePan?: boolean;
  minDistance?: number;
  maxDistance?: number;
}

interface Globe3DProps {
  markers?: GlobeMarker[];
  signals?: GlobeCountrySignal[];
  selectedSignalId?: string | null;
  config?: Globe3DConfig;
  className?: string;
  showInfoPanel?: boolean;
  showLegend?: boolean;
  onMarkerClick?: (marker: GlobeMarker) => void;
  onMarkerHover?: (marker: GlobeMarker | null) => void;
  onSignalClick?: (signal: GlobeCountrySignal) => void;
  onSignalHover?: (signal: GlobeCountrySignal | null) => void;
}

function clampVal(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const COUNTRY_SPREAD: Record<string, number> = {
  RU:10,US:7,CA:7,CN:7,BR:7,AU:8,IN:5,ID:5,AR:5,KZ:6,SA:5,DZ:5,CD:5,MX:5,SD:4,
  SG:0.6,HK:0.6,MO:0.5,BH:0.5,MT:0.5,LU:0.5,BN:0.6,MC:0.3,
};

const GOLDEN_ANGLE = 2.39996322972865;

const COUNTRY_COORDS: Record<string, [number, number]> = {
  AF:[33,65],AL:[41,20],DZ:[28,3],AD:[42.5,1.5],AO:[-12.5,18.5],AG:[17.05,-61.8],AR:[-34,-64],AM:[40,45],AU:[-27,133],AT:[47.3,13.3],AZ:[40.5,47.5],BS:[24.25,-76],BH:[26,50.55],BD:[24,90],BB:[13.17,-59.53],BY:[53,28],BE:[50.83,4],BZ:[17.25,-88.75],BJ:[9.5,2.25],BT:[27.5,90.5],BO:[-17,-65],BA:[44,18],BW:[-22,24],BR:[-10,-55],BN:[4.5,114.67],BG:[43,25],BF:[13,-2],BI:[-3.5,30],KH:[13,105],CM:[6,12],CA:[60,-95],CV:[16,-24],CF:[7,21],TD:[15,19],CL:[-30,-71],CN:[35,105],CO:[4,-72],KM:[-12.17,44.25],CG:[-1,15],CD:[-4,25],CR:[10,-84],CI:[8,-5],HR:[45.17,15.5],CU:[21.5,-80],CY:[35,33],CZ:[49.75,15.5],DK:[56,10],DJ:[11.5,43],DM:[15.42,-61.33],DO:[19,-70.67],EC:[-2,-77.5],EG:[27,30],SV:[13.83,-88.92],GQ:[2,10],ER:[15,39],EE:[59,26],SZ:[-26.5,31.5],ET:[8,38],FJ:[-18,175],FI:[64,26],FR:[46,2],GA:[-1,11.75],GM:[13.47,-16.57],GE:[42,43.5],DE:[51,9],GH:[8,-2],GR:[39,22],GD:[12.12,-61.67],GT:[15.5,-90.25],GN:[11,-10],GW:[12,-15],GY:[5,-59],HT:[19,-72.42],HN:[15,-86.5],HU:[47,20],IS:[65,-18],IN:[20,77],ID:[-5,120],IR:[32,53],IQ:[33,44],IE:[53,-8],IL:[31.5,34.75],IT:[42.83,12.83],JM:[18.25,-77.5],JP:[36,138],JO:[31,36],KZ:[48,68],KE:[1,38],KI:[1.42,173],KP:[40,127],KR:[37,127.5],KW:[29.5,45.75],KG:[41,75],LA:[18,105],LV:[57,25],LB:[33.83,35.83],LS:[-29.5,28.5],LR:[6.5,-9.5],LY:[25,17],LI:[47.27,9.53],LT:[56,24],LU:[49.75,6.17],MG:[-20,47],MW:[-13.5,34],MY:[2.5,112.5],MV:[3.25,73],ML:[17,-4],MT:[35.83,14.58],MH:[9,168],MR:[20,-12],MU:[-20.28,57.55],MX:[23,-102],FM:[6.92,158.25],MD:[47,29],MC:[43.73,7.4],MN:[46,105],ME:[42.5,19.3],MA:[32,-5],MZ:[-18.25,35],MM:[22,98],NA:[-22,17],NR:[-0.53,166.92],NP:[28,84],NL:[52.5,5.75],NZ:[-41,174],NI:[13,-85],NE:[16,8],NG:[10,8],MK:[41.83,22],NO:[62,10],OM:[21,57],PK:[30,70],PW:[7.5,134.5],PA:[9,-80],PG:[-6,147],PY:[-23,-58],PE:[-10,-76],PH:[13,122],PL:[52,20],PT:[39.5,-8],QA:[25.5,51.25],RO:[46,25],RU:[60,100],RW:[-2,30],KN:[17.33,-62.75],LC:[13.88,-60.97],VC:[13.25,-61.2],WS:[-13.58,-172.33],SM:[43.77,12.42],ST:[1,7],SA:[25,45],SN:[14,-14],RS:[44,21],SC:[-4.58,55.67],SL:[8.5,-11.5],SG:[1.37,103.8],SK:[48.67,19.5],SI:[46.12,14.82],SB:[-8,159],SO:[10,49],ZA:[-29,24],SS:[8,30],ES:[40,-4],LK:[7,81],SD:[15,30],SR:[4,-56],SE:[62,15],CH:[47,8],SY:[35,38],TW:[23.5,121],TJ:[39,71],TZ:[-6,35],TH:[15,100],TL:[-8.55,125.73],TG:[8,1.17],TO:[-20,-175],TT:[11,-61],TN:[34,9],TR:[39,35],TM:[40,60],TV:[-8,178],UG:[1,32],UA:[49,32],AE:[24,54],GB:[54,-2],US:[38,-97],UY:[-33,-56],UZ:[41,64],VU:[-16,167],VE:[8,-66],VN:[16,106],YE:[15,48],ZM:[-15,30],ZW:[-20,30],
  PS:[31.9,35.2],XK:[42.6,20.9],CW:[12.2,-68.98],SX:[18.03,-63.05],HK:[22.3,114.2],MO:[22.2,113.55],PR:[18.25,-66.5],RE:[-21.1,55.5],GP:[16.25,-61.58],MQ:[14.67,-61],GF:[4,-53],YT:[-12.83,45.17],NC:[-21.5,165.5],PF:[-15,-140],GL:[72,-40],FO:[62,-7],GI:[36.13,-5.35],BM:[32.33,-64.75],
};

// Orthographic inverse projection: screen pixel → (lat, lng) degrees.
// Returns null when the pixel is outside the globe circle.

const regionNames = typeof Intl !== "undefined" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

function getCountryName(code: string) {
  try {
    return regionNames?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

function flagEmoji(code: string) {
  const n = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(n)) return "";
  return String.fromCodePoint(...n.split("").map((c) => 127397 + c.charCodeAt(0)));
}

function unprojectFromScreen(
  mx: number,
  my: number,
  phi: number,
  theta: number,
  cx: number,
  cy: number,
  r: number,
): { lat: number; lng: number } | null {
  const nx = (mx - cx) / r;
  const ny = -(my - cy) / r; // flip Y for math coords

  if (nx * nx + ny * ny > 1) return null;

  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));

  const sinLat = ny * Math.cos(theta) + nz * Math.sin(theta);
  const lat = Math.asin(Math.max(-1, Math.min(1, sinLat))) * (180 / Math.PI);
  const lng =
    (phi + Math.atan2(nx, nz * Math.cos(theta) - ny * Math.sin(theta))) *
    (180 / Math.PI);

  return { lat, lng };
}

// Forward projection: (lat, lng) → screen pixel. Returns null when on back of globe.
function projectToScreen(
  lat: number,
  lng: number,
  phi: number,
  theta: number,
  cx: number,
  cy: number,
  r: number,
): { x: number; y: number } | null {
  const latRad = (lat * Math.PI) / 180;
  const relLng = (lng * Math.PI) / 180 - phi;
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  const z = sinTheta * sinLat + cosTheta * cosLat * Math.cos(relLng);
  if (z <= 0) return null;

  const x = cosLat * Math.sin(relLng);
  const y = cosTheta * sinLat - sinTheta * cosLat * Math.cos(relLng);

  return { x: cx + x * r, y: cy - y * r };
}

export function Globe3D({
  markers = [],
  signals = [],
  config,
  className,
  onSignalClick,
}: Globe3DProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const overlayRef   = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const pointerInteracting        = useRef<number | null>(null);
  const pointerInteractionMovement = useRef(0);
  const phiRef         = useRef(0);
  const thetaRef       = useRef(0.3);
  const scaleRef       = useRef(1);
  const targetScaleRef = useRef(1);
  const widthRef       = useRef(0);
  const heightRef      = useRef(0);
  const hoveredCodeRef   = useRef<string | null>(null);
  const countryDotsRef   = useRef<Map<string, [number, number][]>>(new Map());

  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    label: string;
    countryCode: string;
    visitors?: number;
    sessions?: number;
    pageviews?: number;
    share?: number;
  } | null>(null);

  const autoRotateSpeed = Math.min(config?.autoRotateSpeed ?? 0.002, 0.004);
  const enableZoom      = config?.enableZoom ?? true;
  const minScale = 0.5;
  const maxScale = 3;

  // Build cobe markers (flat list) + per-country dot positions for highlight overlay.
  const { signalMarkers, countryDots } = useMemo(() => {
    if (!signals.length) {
      return {
        signalMarkers: [] as Array<{ location: [number, number]; size: number }>,
        countryDots: new Map<string, [number, number][]>(),
      };
    }

    const maxValue = signals.reduce((m, s) => Math.max(m, s.value), 0);
    const allDots: Array<{ location: [number, number]; size: number }> = [];
    const dotsByCountry = new Map<string, [number, number][]>();

    for (const s of signals) {
      let lat = s.lat;
      let lng = s.lng;
      const code = (s.countryCode ?? s.id ?? "").toUpperCase();

      if (lat == null || lng == null) {
        const coords = COUNTRY_COORDS[code];
        if (!coords) continue;
        [lat, lng] = coords;
      }

      const intensity = maxValue > 0 ? s.value / maxValue : 0.5;
      const spread    = COUNTRY_SPREAD[code] ?? 3;
      const count     = Math.round(6 + intensity * 18);
      const dotSize   = 0.012 + intensity * 0.014;
      const latRad    = (lat * Math.PI) / 180;
      const lngScale  = Math.max(Math.cos(latRad), 0.3);

      const positions: [number, number][] = [];
      for (let i = 0; i < count; i++) {
        const rr = spread * Math.sqrt((i + 0.5) / count);
        const t  = i * GOLDEN_ANGLE;
        const dLat = lat + rr * Math.cos(t);
        const dLng = lng + (rr * Math.sin(t)) / lngScale;
        allDots.push({ location: [dLat, dLng], size: dotSize });
        positions.push([dLat, dLng]);
      }

      dotsByCountry.set(code, positions);
    }

    return { signalMarkers: allDots, countryDots: dotsByCountry };
  }, [signals]);

  // Keep ref in sync for access inside onRender
  countryDotsRef.current = countryDots;

  const markerLocations = useMemo(
    () => markers.map((m) => ({ location: [m.lat, m.lng] as [number, number], size: m.size ?? 0.06 })),
    [markers],
  );

  const allMarkers = useMemo(
    () => [...signalMarkers, ...markerLocations],
    [signalMarkers, markerLocations],
  );

  // ── Resize ──────────────────────────────────────────────────────────────────

  const onResize = useCallback(() => {
    if (!containerRef.current) return;
    widthRef.current  = containerRef.current.offsetWidth;
    heightRef.current = containerRef.current.offsetHeight;
  }, []);

  useEffect(() => {
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [onResize]);

  // ── Globe ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!canvasRef.current) return;
    onResize();

    const width  = widthRef.current;
    const height = heightRef.current || width;

    const globe = createGlobe(canvasRef.current, {
      devicePixelRatio: Math.min(window.devicePixelRatio, 2),
      width:  width  * 2,
      height: height * 2,
      phi:   0,
      theta: 0.3,
      dark:        0,
      diffuse:     1.2,
      mapSamples:  36000,
      mapBrightness: 0.5,
      baseColor:   [1, 1, 1],
      markerColor: [1, 0.88, 0.66],
      glowColor:   [0.9, 0.9, 0.9],
      markers:     allMarkers,
      scale:       scaleRef.current,
      onRender: (state) => {
        // ── Smooth zoom ──
        const scaleDiff = targetScaleRef.current - scaleRef.current;
        scaleRef.current += scaleDiff * 0.2;
        if (Math.abs(scaleDiff) < 0.001) scaleRef.current = targetScaleRef.current;
        state.scale = scaleRef.current;

        // ── Auto-rotate ──
        if (pointerInteracting.current === null) phiRef.current += autoRotateSpeed;
        state.phi   = phiRef.current;
        state.theta = 0.3;
        state.width  = widthRef.current * 2;
        state.height = (heightRef.current || widthRef.current) * 2;

        // ── Highlight overlay ──
        const overlay = overlayRef.current;
        if (overlay) {
          const ow = state.width;
          const oh = state.height;
          if (overlay.width !== ow || overlay.height !== oh) {
            overlay.width = ow;
            overlay.height = oh;
          }
          const ctx = overlay.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, ow, oh);
            const hCode = hoveredCodeRef.current;
            if (hCode) {
              const cxg = ow / 2;
              const cyg = oh / 2;
              const rg = (Math.min(ow, oh) / 2) * scaleRef.current;
              const dots = countryDotsRef.current.get(hCode);
              if (dots && dots.length > 0) {
                // Country with traffic — highlight its scatter dots
                ctx.fillStyle = "#EF7A29";
                ctx.shadowColor = "rgba(239, 122, 41, 0.6)";
                ctx.shadowBlur = 10;
                for (const [lat, lng] of dots) {
                  const p = projectToScreen(lat, lng, state.phi, 0.3, cxg, cyg, rg);
                  if (p) {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
                    ctx.fill();
                  }
                }
              } else {
                // Country without traffic — pulse at centroid
                const coords = COUNTRY_COORDS[hCode];
                if (coords) {
                  const p = projectToScreen(coords[0], coords[1], state.phi, 0.3, cxg, cyg, rg);
                  if (p) {
                    ctx.fillStyle = "rgba(138, 136, 134, 0.6)";
                    ctx.shadowColor = "rgba(138, 136, 134, 0.3)";
                    ctx.shadowBlur = 14;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
                    ctx.fill();
                  }
                }
              }
            }
          }
        }
      },
    });

    return () => { globe.destroy(); };
  }, [allMarkers, autoRotateSpeed, onResize]);

  // ── Pointer handlers ────────────────────────────────────────────────────────

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerInteracting.current = e.clientX - pointerInteractionMovement.current;
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
  }, []);

  const handlePointerUp = useCallback(() => {
    pointerInteracting.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "grab";
  }, []);

  const handlePointerOut = useCallback(() => {
    pointerInteracting.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "grab";
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!enableZoom) return;
      e.preventDefault();
      targetScaleRef.current = clampVal(
        targetScaleRef.current + e.deltaY * -0.001,
        minScale,
        maxScale,
      );
    },
    [enableZoom],
  );

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1 && pointerInteracting.current !== null) {
      const touch = e.touches[0]!;
      const delta = touch.clientX - pointerInteracting.current;
      pointerInteractionMovement.current = delta;
      phiRef.current += delta / 200;
      pointerInteracting.current = touch.clientX;
    }
  }, []);

  // Combined drag + hover detection on the container div.
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // ── Drag ──
      if (pointerInteracting.current !== null) {
        const delta = e.clientX - pointerInteracting.current;
        pointerInteractionMovement.current = delta;
        phiRef.current += delta / 200;
        pointerInteracting.current = e.clientX;
        if (hoveredCodeRef.current) {
          hoveredCodeRef.current = null;
          setTooltip(null);
        }
        return;
      }

      // ── Hover ──
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mx  = e.clientX - rect.left;
      const my  = e.clientY - rect.top;
      const w   = widthRef.current  || rect.width;
      const h   = heightRef.current || rect.height;
      const r   = (Math.min(w, h) / 2) * scaleRef.current;
      const cx  = w / 2;
      const cy  = h / 2;

      const hit = unprojectFromScreen(mx, my, phiRef.current, 0.3, cx, cy, r);

      if (!hit) {
        hoveredCodeRef.current = null;
        setTooltip(null);
        return;
      }

      // Find nearest country from ALL known countries
      const MAX_DIST_SQ = 25 * 25;
      let nearestCode: string | null = null;
      let nearestDist = MAX_DIST_SQ;

      for (const code of Object.keys(COUNTRY_COORDS)) {
        const coords = COUNTRY_COORDS[code];
        if (!coords) continue;

        const dlat = hit.lat - coords[0];
        let   dlng = hit.lng - coords[1];
        if (dlng >  180) dlng -= 360;
        if (dlng < -180) dlng += 360;

        const dist = dlat * dlat + dlng * dlng;
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestCode = code;
        }
      }

      // Update ref immediately (overlay reads this every frame)
      hoveredCodeRef.current = nearestCode;

      if (!nearestCode) {
        setTooltip(null);
        return;
      }

      // Only update React state (causes re-render) when country changes or there's no tooltip yet
      const countryChanged = tooltip?.countryCode !== nearestCode;
      if (countryChanged) {
        const signal = signals.find(
          (s) => (s.countryCode ?? s.id ?? "").toUpperCase() === nearestCode,
        );
        setTooltip({
          x: clampVal(mx + 14, 4, rect.width  - 200),
          y: clampVal(my + 14, 4, rect.height - 100),
          label: signal?.label || getCountryName(nearestCode),
          countryCode: nearestCode,
          visitors: signal?.value,
          sessions: signal?.sessions,
          pageviews: signal?.pageviews,
          share: signal?.share,
        });
      } else if (tooltip) {
        // Same country — just update position without full state churn
        setTooltip((prev) =>
          prev
            ? {
                ...prev,
                x: clampVal(mx + 14, 4, rect.width - 200),
                y: clampVal(my + 14, 4, rect.height - 100),
              }
            : prev,
        );
      }
    },
    [signals, tooltip],
  );

  const handleMouseLeave = useCallback(() => {
    hoveredCodeRef.current = null;
    setTooltip(null);
  }, []);

  const handleGlobeClick = useCallback(() => {
    if (!tooltip || tooltip.visitors == null || !onSignalClick) return;
    const signal = signals.find(
      (s) => (s.countryCode ?? s.id ?? "").toUpperCase() === tooltip.countryCode,
    );
    if (signal) onSignalClick(signal);
  }, [tooltip, signals, onSignalClick]);

  function zoomBy(factor: number) {
    targetScaleRef.current = clampVal(targetScaleRef.current * factor, minScale, maxScale);
  }

  function resetView() {
    targetScaleRef.current = 1;
    phiRef.current  = 0;
    thetaRef.current = 0.3;
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative mx-auto flex w-full items-center justify-center overflow-visible",
        className,
      )}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleGlobeClick}
    >
      {/* cobe globe */}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerOut={handlePointerOut}
        onWheel={handleWheel}
        onTouchMove={handleTouchMove}
        onTouchStart={(e) => {
          if (e.touches.length === 1) {
            pointerInteracting.current =
              e.touches[0]!.clientX - pointerInteractionMovement.current;
          }
        }}
        onTouchEnd={handlePointerUp}
        style={{ width: "100%", height: "100%", contain: "layout paint size", cursor: "grab" }}
      />

      {/* Highlight overlay — drawn in onRender, synced with globe rotation */}
      <canvas
        ref={overlayRef}
        className="pointer-events-none absolute inset-0"
        style={{ width: "100%", height: "100%" }}
      />

      {/* Country tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-30 rounded-lg bg-foreground shadow-[0_4px_12px_rgba(0,0,0,0.24)]"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-surface-hover">
            <span className="text-sm leading-none">{flagEmoji(tooltip.countryCode)}</span>
            <span>{tooltip.label}</span>
          </div>
          {tooltip.visitors != null && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-white/10 px-3 py-2">
              <div>
                <div className="text-[10px] text-white/50">Visitors</div>
                <div className="text-xs font-semibold tabular-nums text-surface-hover">{formatCompact(tooltip.visitors)}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/50">Sessions</div>
                <div className="text-xs font-semibold tabular-nums text-surface-hover">{formatCompact(tooltip.sessions ?? 0)}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/50">Pageviews</div>
                <div className="text-xs font-semibold tabular-nums text-surface-hover">{formatCompact(tooltip.pageviews ?? 0)}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/50">Share</div>
                <div className="text-xs font-semibold tabular-nums text-surface-hover">{formatPercent(tooltip.share ?? 0, 1)}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {enableZoom && (
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-black/10 bg-white/82 p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <button
            type="button"
            aria-label="Zoom out"
            className="flex size-9 items-center justify-center rounded-full text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900"
            onClick={() => zoomBy(0.85)}
          >
            <Minus className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            className="flex size-9 items-center justify-center rounded-full text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900"
            onClick={() => zoomBy(1.18)}
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Reset view"
            className="flex size-9 items-center justify-center rounded-full text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900"
            onClick={resetView}
          >
            <LocateFixed className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

export default Globe3D;
