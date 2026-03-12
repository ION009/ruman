"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { DashboardMapCountryMetric } from "@/lib/dashboard/types";
import { clamp, cn, formatCompact, formatPercent } from "@/lib/utils";

const VIEWBOX_WIDTH = 920;
const VIEWBOX_HEIGHT = 620;
const GLOBE_RADIUS = 232;
const GLOBE_CENTER_X = VIEWBOX_WIDTH / 2;
const GLOBE_CENTER_Y = 306;
const GLOBE_TILT_DEGREES = 16;
const GRID_STEP_DEGREES = 4.4;

type Ring = [number, number][];
type Polygon = Ring[];

type GeoFeatureShape = {
  code: string;
  name: string;
  labelRank: number;
  centroid: { lat: number; lon: number };
  referenceLon: number;
  polygons: Polygon[];
  bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number };
};

type GlobeDot = {
  key: string;
  lat: number;
  lon: number;
  countryCode: string | null;
};

type GeoAtlas = {
  dots: GlobeDot[];
  features: GeoFeatureShape[];
  featureByCode: Map<string, GeoFeatureShape>;
};

type GeoJsonGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

type GeoJsonFeature = {
  geometry: GeoJsonGeometry | null;
  properties?: Record<string, unknown>;
};

type GeoJsonFeatureCollection = {
  features?: GeoJsonFeature[];
};

type ProjectedDot = {
  key: string;
  x: number;
  y: number;
  depth: number;
  countryCode: string | null;
};

type TooltipState = {
  x: number;
  y: number;
  label: string;
  countryCode: string;
  visitors?: number;
  sessions?: number;
  pageviews?: number;
  share?: number;
};

type GeoDotGlobeProps = {
  countries: DashboardMapCountryMetric[];
  selectedCountryCode?: string | null;
  focusCountryCode?: string | null;
  onSelectCountry?: (countryCode: string) => void;
  className?: string;
};

let geoAtlasPromise: Promise<GeoAtlas> | null = null;

function flagEmoji(code: string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return "";
  return String.fromCodePoint(...normalized.split("").map((c) => 127397 + c.charCodeAt(0)));
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function normalizeLongitude(value: number) {
  let normalized = value;
  while (normalized > 180) {
    normalized -= 360;
  }
  while (normalized < -180) {
    normalized += 360;
  }
  return normalized;
}

function normalizeLongitudeAround(value: number, reference: number) {
  let normalized = value;
  while (normalized-reference > 180) {
    normalized -= 360;
  }
  while (reference-normalized > 180) {
    normalized += 360;
  }
  return normalized;
}

function pointInRing(lon: number, lat: number, ring: Ring) {
  let inside = false;

  for (let index = 0, last = ring.length - 1; index < ring.length; last = index, index += 1) {
    const [x1, y1] = ring[index] ?? [0, 0];
    const [x2, y2] = ring[last] ?? [0, 0];
    const intersects =
      (y1 > lat) !== (y2 > lat) &&
      lon < ((x2 - x1) * (lat - y1)) / ((y2 - y1) || Number.EPSILON) + x1;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInFeature(feature: GeoFeatureShape, lon: number, lat: number) {
  const adjustedLon = normalizeLongitudeAround(lon, feature.referenceLon);
  if (
    adjustedLon < feature.bbox.minLon ||
    adjustedLon > feature.bbox.maxLon ||
    lat < feature.bbox.minLat ||
    lat > feature.bbox.maxLat
  ) {
    return false;
  }

  return feature.polygons.some((polygon) => {
    const [outerRing, ...holes] = polygon;
    if (!outerRing || !pointInRing(adjustedLon, lat, outerRing)) {
      return false;
    }
    return !holes.some((hole) => pointInRing(adjustedLon, lat, hole));
  });
}

function projectPoint(lat: number, lon: number, rotation: number) {
  const lambda = degreesToRadians(normalizeLongitudeAround(lon, rotation) - rotation);
  const phi = degreesToRadians(lat);
  const phi0 = degreesToRadians(GLOBE_TILT_DEGREES);

  const cosc = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lambda);
  if (cosc <= 0) {
    return null;
  }

  const x = GLOBE_CENTER_X + GLOBE_RADIUS * Math.cos(phi) * Math.sin(lambda);
  const y =
    GLOBE_CENTER_Y -
    GLOBE_RADIUS *
      (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lambda));

  return { x, y, depth: cosc };
}

function extractPolygons(geometry: GeoJsonGeometry | null): Polygon[] {
  if (!geometry) {
    return [];
  }

  if (geometry.type === "Polygon") {
    return [geometry.coordinates as number[][][]].map((polygon) =>
      polygon.map((ring) => ring.map(([lon, lat]) => [lon, lat] as [number, number])),
    );
  }

  return (geometry.coordinates as number[][][][]).map((polygon) =>
    polygon.map((ring) => ring.map(([lon, lat]) => [lon, lat] as [number, number])),
  );
}

function buildFeatureShape(feature: GeoJsonFeature): GeoFeatureShape | null {
  const polygons = extractPolygons(feature.geometry);
  const outerPoints = polygons.flatMap((polygon) => polygon[0] ?? []);
  if (!outerPoints.length) {
    return null;
  }

  let latitudeSum = 0;
  let longitudeX = 0;
  let longitudeY = 0;

  outerPoints.forEach(([lon, lat]) => {
    latitudeSum += lat;
    const radians = degreesToRadians(lon);
    longitudeX += Math.cos(radians);
    longitudeY += Math.sin(radians);
  });

  const centroidLat = latitudeSum / outerPoints.length;
  const referenceLon = normalizeLongitude((Math.atan2(longitudeY, longitudeX) * 180) / Math.PI);

  const normalizedPolygons = polygons.map((polygon) =>
    polygon.map((ring) =>
      ring.map(([lon, lat]) => [normalizeLongitudeAround(lon, referenceLon), lat] as [number, number]),
    ),
  );

  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  normalizedPolygons.forEach((polygon) => {
    polygon.forEach((ring) => {
      ring.forEach(([lon, lat]) => {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      });
    });
  });

  const code =
    String(feature.properties?.ISO_A2 ?? feature.properties?.POSTAL ?? feature.properties?.ADM0_A3 ?? "")
      .trim()
      .toUpperCase();

  if (!code || code === "-99") {
    return null;
  }

  const centroidLon = normalizeLongitude(referenceLon);
  return {
    code,
    name: String(feature.properties?.NAME ?? feature.properties?.ADMIN ?? code).trim(),
    labelRank: Number(feature.properties?.LABELRANK ?? 8),
    centroid: { lat: centroidLat, lon: centroidLon },
    referenceLon,
    polygons: normalizedPolygons,
    bbox: { minLon, maxLon, minLat, maxLat },
  };
}

function locateCountry(features: GeoFeatureShape[], lon: number, lat: number) {
  for (const feature of features) {
    if (pointInFeature(feature, lon, lat)) {
      return feature.code;
    }
  }
  return null;
}

function buildDotGrid(features: GeoFeatureShape[]) {
  const dots: GlobeDot[] = [];

  for (let lat = -78; lat <= 82; lat += GRID_STEP_DEGREES) {
    const lonStep = GRID_STEP_DEGREES / Math.max(Math.cos(degreesToRadians(lat)), 0.32);
    for (let lon = -180; lon < 180; lon += lonStep) {
      dots.push({
        key: `${lat.toFixed(1)}:${lon.toFixed(1)}`,
        lat,
        lon,
        countryCode: locateCountry(features, lon, lat),
      });
    }
  }

  return dots;
}

async function loadGeoAtlas() {
  const response = await fetch("/atlas/countries.geojson", { cache: "force-cache" });
  if (!response.ok) {
    throw new Error("Failed to load country atlas.");
  }

  const payload = (await response.json()) as GeoJsonFeatureCollection;
  const features = (payload.features ?? [])
    .map((feature) => buildFeatureShape(feature))
    .filter((feature): feature is GeoFeatureShape => Boolean(feature))
    .sort((left, right) => left.labelRank - right.labelRank);

  const featureByCode = new Map(features.map((feature) => [feature.code, feature]));

  return {
    dots: buildDotGrid(features),
    features,
    featureByCode,
  } satisfies GeoAtlas;
}

function getGeoAtlasPromise() {
  if (!geoAtlasPromise) {
    geoAtlasPromise = loadGeoAtlas();
  }
  return geoAtlasPromise;
}

function buildInitialLongitude(countries: DashboardMapCountryMetric[], featureByCode: Map<string, GeoFeatureShape>) {
  const ranked = countries.slice(0, 8);
  if (!ranked.length) {
    return 10;
  }

  let x = 0;
  let y = 0;

  ranked.forEach((country) => {
    const feature = featureByCode.get(country.countryCode);
    if (!feature) {
      return;
    }
    const radians = degreesToRadians(feature.centroid.lon);
    const weight = Math.max(country.visitors, 1);
    x += Math.cos(radians) * weight;
    y += Math.sin(radians) * weight;
  });

  if (x === 0 && y === 0) {
    return 10;
  }

  return normalizeLongitude((Math.atan2(y, x) * 180) / Math.PI);
}

export function GeoDotGlobe({
  countries,
  selectedCountryCode,
  focusCountryCode,
  onSelectCountry,
  className,
}: GeoDotGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [atlas, setAtlas] = useState<GeoAtlas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoveredCountryCode, setHoveredCountryCode] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    let cancelled = false;

    getGeoAtlasPromise()
      .then((nextAtlas) => {
        if (!cancelled) {
          setAtlas(nextAtlas);
          setError(null);
        }
      })
      .catch((nextError: unknown) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load country atlas.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const countriesByCode = useMemo(
    () => new Map(countries.map((country) => [country.countryCode, country])),
    [countries],
  );

  const rotation = useMemo(() => {
    if (!atlas) {
      return 10;
    }
    if (focusCountryCode) {
      return atlas.featureByCode.get(focusCountryCode)?.centroid.lon ?? buildInitialLongitude(countries, atlas.featureByCode);
    }
    return buildInitialLongitude(countries, atlas.featureByCode);
  }, [atlas, countries, focusCountryCode]);

  const topVisitors = countries[0]?.visitors ?? 1;

  const projectedDots = useMemo<ProjectedDot[]>(() => {
    if (!atlas) {
      return [];
    }

    return atlas.dots
      .map((dot) => {
        const projected = projectPoint(dot.lat, dot.lon, rotation);
        if (!projected) {
          return null;
        }

        return {
          key: dot.key,
          x: projected.x,
          y: projected.y,
          depth: projected.depth,
          countryCode: dot.countryCode,
        };
      })
      .filter((dot): dot is ProjectedDot => Boolean(dot))
      .sort((left, right) => left.depth - right.depth);
  }, [atlas, rotation]);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const viewX = ((event.clientX - rect.left) / rect.width) * VIEWBOX_WIDTH;
    const viewY = ((event.clientY - rect.top) / rect.height) * VIEWBOX_HEIGHT;
    const distanceFromCenter = Math.hypot(viewX - GLOBE_CENTER_X, viewY - GLOBE_CENTER_Y);
    if (distanceFromCenter > GLOBE_RADIUS + 6) {
      setHoveredCountryCode(null);
      setTooltip(null);
      return;
    }

    const threshold = 14 * (VIEWBOX_WIDTH / rect.width);
    let nearestCountryCode: string | null = null;
    let nearestDot: ProjectedDot | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const dot of projectedDots) {
      if (!dot.countryCode) {
        continue;
      }
      const distance = Math.hypot(dot.x - viewX, dot.y - viewY);
      if (distance < threshold && distance < nearestDistance) {
        nearestCountryCode = dot.countryCode;
        nearestDot = dot;
        nearestDistance = distance;
      }
    }

    if (!nearestCountryCode || !nearestDot) {
      setHoveredCountryCode(null);
      setTooltip(null);
      return;
    }

    const feature = atlas?.featureByCode.get(nearestCountryCode);
    const country = countriesByCode.get(nearestCountryCode);
    const label = country?.countryName || feature?.name || nearestCountryCode;

    setHoveredCountryCode(nearestCountryCode);
    setTooltip({
      x: clamp(event.clientX - rect.left + 16, 16, rect.width - 200),
      y: clamp(event.clientY - rect.top + 16, 16, rect.height - 100),
      label,
      countryCode: nearestCountryCode,
      visitors: country?.visitors,
      sessions: country?.sessions,
      pageviews: country?.pageviews,
      share: country?.share,
    });
  };

  const handlePointerLeave = () => {
    setHoveredCountryCode(null);
    setTooltip(null);
  };

  const handleClick = () => {
    if (!hoveredCountryCode || !countriesByCode.has(hoveredCountryCode)) {
      return;
    }
    onSelectCountry?.(hoveredCountryCode);
  };

  if (error) {
    return (
      <div
        className={cn(
          "flex min-h-[420px] items-center justify-center rounded-[24px] border border-border-default bg-surface-primary px-6 text-center text-sm text-text-secondary",
          className,
        )}
      >
        {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("relative w-full overflow-hidden rounded-[28px] border border-border-default bg-surface-primary", className)}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={handleClick}
      role="img"
      aria-label="Dot globe showing visitor geography by country."
    >
      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        className={cn(
          "h-full w-full",
          hoveredCountryCode && countriesByCode.has(hoveredCountryCode) ? "cursor-pointer" : "cursor-default",
        )}
      >
        <defs>
          <radialGradient id="geo-sphere-fill" cx="38%" cy="30%" r="74%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="52%" stopColor="#F4F4F2" />
            <stop offset="100%" stopColor="#D6D5D1" />
          </radialGradient>
          <radialGradient id="geo-sphere-light" cx="34%" cy="22%" r="60%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <clipPath id="geo-globe-clip">
            <circle cx={GLOBE_CENTER_X} cy={GLOBE_CENTER_Y} r={GLOBE_RADIUS} />
          </clipPath>
        </defs>

        <rect width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="#FCFCFA" />
        <ellipse cx={GLOBE_CENTER_X} cy={VIEWBOX_HEIGHT - 38} rx="244" ry="52" fill="rgba(28,25,23,0.10)" />
        <circle
          cx={GLOBE_CENTER_X}
          cy={GLOBE_CENTER_Y}
          r={GLOBE_RADIUS}
          fill="url(#geo-sphere-fill)"
          stroke="rgba(28,25,23,0.10)"
          strokeWidth="1"
        />
        <circle cx={GLOBE_CENTER_X} cy={GLOBE_CENTER_Y} r={GLOBE_RADIUS} fill="url(#geo-sphere-light)" />

        <g clipPath="url(#geo-globe-clip)">
          {projectedDots.map((dot) => {
            if (!dot.countryCode) {
              return null;
            }

            const country = countriesByCode.get(dot.countryCode);
            const intensity = country ? clamp(country.visitors / topVisitors, 0.18, 1) : 0;
            const isHovered = dot.countryCode === hoveredCountryCode;
            const isSelected = dot.countryCode === selectedCountryCode && !hoveredCountryCode;
            const isActive = Boolean(country);
            const isHoveredWithData = isHovered && isActive;
            const isHoveredNoData = isHovered && !isActive;

            const fill = isHoveredWithData
              ? "#EF7A29"
              : isHoveredNoData
                ? "#8A8886"
                : isSelected
                  ? "#EF7A29"
                  : isActive
                    ? "#EF7A29"
                    : "#141312";
            const opacity = isHovered
              ? 1
              : isSelected
                ? 1
                : isActive
                  ? 1
                  : 0.62;
            const radius = isHoveredWithData
              ? 2.2
              : isHoveredNoData
                ? 1.8
                : isSelected
                  ? 1.95
                  : isActive
                    ? 1.5
                    : 1.25;

            return (
              <circle
                key={dot.key}
                cx={dot.x}
                cy={dot.y}
                r={radius}
                fill={fill}
                fillOpacity={opacity}
              />
            );
          })}
        </g>
      </svg>

      {!atlas ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-full border border-border-default bg-surface-primary px-4 py-2 text-xs uppercase tracking-[0.24em] text-text-secondary">
            Loading globe
          </div>
        </div>
      ) : null}

      {tooltip ? (
        <div
          className="pointer-events-none absolute z-20 rounded-lg bg-foreground shadow-[0_4px_12px_rgba(0,0,0,0.18)]"
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
      ) : null}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_200%,rgba(0,0,0,0.16),rgba(255,255,255,0))]" />
    </div>
  );
}
