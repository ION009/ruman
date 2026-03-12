"use client";

import {
  AlertTriangle,
  Bug,
  MousePointerClick,
  Pause,
  Play,
  Route,
  TimerReset,
  WifiOff,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ReplayChunk, ReplayEvent, ReplaySessionDetail } from "@/lib/dashboard/types";
import { clamp, formatCompact } from "@/lib/utils";

type ReplayPlayerProps = {
  detail: ReplaySessionDetail;
};

type SelectedNode = {
  id: number;
  tagName: string;
  selector: string;
  text: string;
};

type ReplayIssue = {
  id: string;
  type: "console" | "network" | "rage" | "route" | "custom" | "metric";
  label: string;
  detail?: string;
  timeMs: number;
};

type SerializedReplayNode = {
  id: number;
  nodeType: number;
  tagName?: string;
  textContent?: string;
  blocked?: boolean;
  attributes?: Record<string, string>;
  childNodes?: SerializedReplayNode[];
};

type ReplayDerived = {
  cacheKey: string;
  durationMs: number;
  endTs: number;
  events: ReplayEvent[];
  issues: ReplayIssue[];
  startTs: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function buildIssueList(events: ReplayEvent[], startTs: number) {
  const issues: ReplayIssue[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const data = asRecord(event.data);
    const timeMs = Math.max(0, event.ts - startTs);

    if (event.type === "console") {
      issues.push({
        id: `console-${index}`,
        type: "console",
        label: "Console error",
        detail: asString(data.message),
        timeMs,
      });
    }
    if (event.type === "network" && !Boolean(data.ok)) {
      issues.push({
        id: `network-${index}`,
        type: "network",
        label: `${asString(data.method) || "GET"} failed`,
        detail: asString(data.url),
        timeMs,
      });
    }
    if (event.type === "click" && Boolean(data.rage)) {
      issues.push({
        id: `rage-${index}`,
        type: "rage",
        label: "Rage click cluster",
        detail: asString(data.selector),
        timeMs,
      });
    }
    if (event.type === "route") {
      issues.push({
        id: `route-${index}`,
        type: "route",
        label: "Route changed",
        detail: asString(data.path),
        timeMs,
      });
    }
    if (event.type === "custom") {
      issues.push({
        id: `custom-${index}`,
        type: "custom",
        label: asString(data.name) || "Custom event",
        timeMs,
      });
    }
    if (event.type === "metric") {
      issues.push({
        id: `metric-${index}`,
        type: "metric",
        label: `${asString(data.name).toUpperCase()} ${asNumber(data.value)}`,
        timeMs,
      });
    }
  }
  return issues;
}

function issueIcon(type: ReplayIssue["type"]) {
  switch (type) {
    case "console":
      return Bug;
    case "network":
      return WifiOff;
    case "rage":
      return MousePointerClick;
    case "route":
      return Route;
    case "metric":
      return Zap;
    default:
      return AlertTriangle;
  }
}

function formatPlaybackTime(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function replayEventsFromChunks(chunks: ReplayChunk[]) {
  const output: ReplayEvent[] = [];
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    for (let eventIndex = 0; eventIndex < chunk.events.length; eventIndex += 1) {
      output.push(chunk.events[eventIndex]);
    }
  }
  output.sort((a, b) => a.ts - b.ts);
  return output;
}

function deriveReplay(detail: ReplaySessionDetail): ReplayDerived {
  const cacheKey = `${detail.session.sessionId}:${detail.session.updatedAt}:${detail.session.eventCount}:${detail.chunks.length}`;
  const events = replayEventsFromChunks(detail.chunks);
  const startTs = events[0]?.ts ?? Date.now();
  const endTs = events[events.length - 1]?.ts ?? startTs;
  return {
    cacheKey,
    durationMs: Math.max(0, endTs - startTs),
    endTs,
    events,
    issues: buildIssueList(events, startTs),
    startTs,
  };
}

function buildReplayNode(serialized: SerializedReplayNode, doc: Document, nodeMap: Map<number, Node>): Node | null {
  if (!serialized || typeof serialized.id !== "number") {
    return null;
  }

  if (serialized.nodeType === 3) {
    const node = doc.createTextNode(asString(serialized.textContent));
    nodeMap.set(serialized.id, node);
    return node;
  }

  if (serialized.nodeType !== 1 || !serialized.tagName) {
    return null;
  }

  const element = doc.createElement(serialized.tagName);
  element.setAttribute("data-ah-node-id", String(serialized.id));
  if (serialized.blocked) {
    element.setAttribute("data-ah-blocked", "1");
  }

  const attributes = serialized.attributes ?? {};
  for (const [name, value] of Object.entries(attributes)) {
    try {
      element.setAttribute(name, value);
    } catch {}
  }

  const children = serialized.childNodes ?? [];
  for (let index = 0; index < children.length; index += 1) {
    const child = buildReplayNode(children[index], doc, nodeMap);
    if (child) {
      element.appendChild(child);
    }
  }

  nodeMap.set(serialized.id, element);
  return element;
}

function ensureReplayStyles(doc: Document) {
  if (doc.getElementById("anlticsheat-replay-style")) {
    return;
  }

  const style = doc.createElement("style");
  style.id = "anlticsheat-replay-style";
  style.textContent = `
    [data-ah-blocked="1"] {
      background:
        repeating-linear-gradient(
          -45deg,
          rgba(15, 23, 42, 0.08),
          rgba(15, 23, 42, 0.08) 12px,
          rgba(15, 23, 42, 0.03) 12px,
          rgba(15, 23, 42, 0.03) 24px
        );
      color: transparent;
      min-height: 1.5rem;
      border-radius: 0.35rem;
    }
    body {
      margin: 0;
      overscroll-behavior: contain;
      scroll-behavior: auto !important;
    }
    html {
      scroll-behavior: auto !important;
    }
    *,
    *::before,
    *::after {
      animation: none !important;
      transition: none !important;
      scroll-behavior: auto !important;
    }
  `;
  doc.head.appendChild(style);
}

function applyCapturedStyles(doc: Document, cssText: string) {
  const existing = doc.getElementById("anlticsheat-replay-captured-style");
  if (existing) {
    existing.remove();
  }

  const trimmedCSS = cssText.trim();
  if (!trimmedCSS) {
    return;
  }

  const style = doc.createElement("style");
  style.id = "anlticsheat-replay-captured-style";
  style.textContent = trimmedCSS;
  doc.head.appendChild(style);
}

function deleteMappedSubtree(node: Node, nodeMap: Map<number, Node>) {
  if (node instanceof Element) {
    const nodeId = Number.parseInt(node.getAttribute("data-ah-node-id") ?? "", 10);
    if (Number.isFinite(nodeId)) {
      nodeMap.delete(nodeId);
    }
    const children = Array.from(node.childNodes);
    for (let index = 0; index < children.length; index += 1) {
      deleteMappedSubtree(children[index], nodeMap);
    }
    return;
  }

  for (const [id, mappedNode] of nodeMap.entries()) {
    if (mappedNode === node) {
      nodeMap.delete(id);
      break;
    }
  }
}

function pointerSize(pointerType: string) {
  switch (pointerType) {
    case "touch":
      return 16;
    case "pen":
      return 14;
    default:
      return 12;
  }
}

function selectedNodeFromElement(element: Element | null | undefined) {
  if (!element) {
    return null;
  }
  const nodeId = Number.parseInt(element.getAttribute("data-ah-node-id") ?? "", 10);
  const selector = [
    element.tagName.toLowerCase(),
    element.id ? `#${element.id}` : "",
    element.classList.length ? `.${Array.from(element.classList).slice(0, 2).join(".")}` : "",
  ]
    .filter(Boolean)
    .join("");

  return {
    id: Number.isFinite(nodeId) ? nodeId : 0,
    tagName: element.tagName.toLowerCase(),
    selector,
    text: (element.textContent ?? "").trim().slice(0, 120),
  };
}

export function ReplayPlayer({ detail }: ReplayPlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const eventIndexRef = useRef(-1);
  const currentMsRef = useRef(0);
  const nodeMapRef = useRef<Map<number, Node>>(new Map());
  const frameRef = useRef<number | null>(null);
  const playOriginRef = useRef(0);
  const playStartRef = useRef(0);
  const viewportRef = useRef({
    width: Math.max(320, detail.session.viewport.width || 1280),
    height: Math.max(220, detail.session.viewport.height || 720),
  });
  const pointerLayerRef = useRef<HTMLDivElement | null>(null);
  const pointerDotRef = useRef<HTMLDivElement | null>(null);
  const pointerPulseRef = useRef<HTMLDivElement | null>(null);
  const pulseTimeoutRef = useRef<number | null>(null);
  const lastCommittedMsRef = useRef(0);
  const replayRef = useRef<ReplayDerived | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentMs, setCurrentMs] = useState(0);
  const [viewport, setViewport] = useState({
    width: viewportRef.current.width,
    height: viewportRef.current.height,
  });
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);

  const nextReplay = deriveReplay(detail);
  if (!replayRef.current || replayRef.current.cacheKey !== nextReplay.cacheKey) {
    replayRef.current = nextReplay;
  }
  const replay = replayRef.current ?? nextReplay;
  const { durationMs, events, issues, startTs } = replay;

  function clearPulse() {
    if (pulseTimeoutRef.current) {
      window.clearTimeout(pulseTimeoutRef.current);
      pulseTimeoutRef.current = null;
    }
    const pulse = pointerPulseRef.current;
    if (pulse) {
      pulse.style.display = "none";
      pulse.getAnimations().forEach((animation) => animation.cancel());
    }
  }

  function hidePointer() {
    clearPulse();
    const layer = pointerLayerRef.current;
    if (layer) {
      layer.style.display = "none";
    }
  }

  function updateViewportSize(widthValue: number, heightValue: number) {
    const nextWidth = Math.max(320, Math.round(widthValue || detail.session.viewport.width || 1280));
    const nextHeight = Math.max(220, Math.round(heightValue || detail.session.viewport.height || 720));
    if (viewportRef.current.width === nextWidth && viewportRef.current.height === nextHeight) {
      return;
    }
    viewportRef.current = { width: nextWidth, height: nextHeight };
    setViewport((current) => (
      current.width === nextWidth && current.height === nextHeight
        ? current
        : { width: nextWidth, height: nextHeight }
    ));
  }

  function renderPointer(x: number, y: number, pointerType: string, withPulse = false) {
    const layer = pointerLayerRef.current;
    const dot = pointerDotRef.current;
    if (!layer || !dot) {
      return;
    }

    const size = pointerSize(pointerType);
    const transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    layer.style.display = "block";
    dot.style.transform = transform;
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;

    if (!withPulse) {
      clearPulse();
      return;
    }

    const pulse = pointerPulseRef.current;
    if (!pulse) {
      return;
    }
    clearPulse();
    pulse.style.display = "block";
    pulse.style.transform = transform;
    pulse.animate(
      [
        { opacity: 0.9, transform: `${transform} scale(0.45)` },
        { opacity: 0, transform: `${transform} scale(1)` },
      ],
      {
        duration: 420,
        easing: "cubic-bezier(0, 0, 0.2, 1)",
      },
    );
    pulseTimeoutRef.current = window.setTimeout(() => {
      pulse.style.display = "none";
      pulseTimeoutRef.current = null;
    }, 430);
  }

  function commitCurrentMs(nextMs: number, force = false) {
    currentMsRef.current = nextMs;
    const now = performance.now();
    if (!force && now - lastCommittedMsRef.current < 50 && nextMs < durationMs) {
      return;
    }
    lastCommittedMsRef.current = now;
    setCurrentMs(Math.round(nextMs));
  }

  function resetDocument() {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) {
      return null;
    }

    doc.open();
    doc.write("<!doctype html><html><head></head><body></body></html>");
    doc.close();
    ensureReplayStyles(doc);
    doc.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const target = (event.target as Element | null)?.closest("[data-ah-node-id]");
      setSelectedNode(selectedNodeFromElement(target));
    });
    nodeMapRef.current = new Map();
    hidePointer();
    return doc;
  }

  function applyFullSnapshot(event: ReplayEvent) {
    const iframe = iframeRef.current;
    const doc = resetDocument();
    if (!iframe || !doc) {
      return;
    }

    const data = asRecord(event.data);
    const rootNode = buildReplayNode(asRecord(data.root) as SerializedReplayNode, doc, nodeMapRef.current);
    if (rootNode && rootNode.nodeType === Node.ELEMENT_NODE) {
      try {
        doc.replaceChild(rootNode, doc.documentElement);
      } catch {}
    }
    for (const stylesheetLink of Array.from(doc.querySelectorAll('link[rel="stylesheet"], link[rel="preload"][as="style"]'))) {
      stylesheetLink.remove();
    }
    ensureReplayStyles(doc);
    applyCapturedStyles(doc, asString(data.cssText));

    const viewportData = asRecord(data.viewport);
    updateViewportSize(asNumber(viewportData.width), asNumber(viewportData.height));

    const scroll = asRecord(data.scroll);
    window.requestAnimationFrame(() => {
      iframe.contentWindow?.scrollTo(asNumber(scroll.x), asNumber(scroll.y));
    });
  }

  function applyMutation(event: ReplayEvent) {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      return;
    }

    const data = asRecord(event.data);
    const removes = Array.isArray(data.removes) ? data.removes : [];
    const texts = Array.isArray(data.texts) ? data.texts : [];
    const attrs = Array.isArray(data.attrs) ? data.attrs : [];
    const adds = Array.isArray(data.adds) ? data.adds : [];

    for (let index = 0; index < removes.length; index += 1) {
      const item = asRecord(removes[index]);
      const node = nodeMapRef.current.get(asNumber(item.id));
      if (node && node.parentNode) {
        deleteMappedSubtree(node, nodeMapRef.current);
        node.parentNode.removeChild(node);
      }
    }

    for (let index = 0; index < texts.length; index += 1) {
      const item = asRecord(texts[index]);
      const node = nodeMapRef.current.get(asNumber(item.id));
      if (node && node.nodeType === Node.TEXT_NODE) {
        node.textContent = asString(item.textContent);
      }
    }

    for (let index = 0; index < attrs.length; index += 1) {
      const item = asRecord(attrs[index]);
      const node = nodeMapRef.current.get(asNumber(item.id));
      if (!(node instanceof Element)) {
        continue;
      }
      const name = asString(item.name);
      const value = item.value;
      if (!name) {
        continue;
      }
      if (typeof value === "string" && value) {
        node.setAttribute(name, value);
      } else {
        node.removeAttribute(name);
      }
    }

    for (let index = 0; index < adds.length; index += 1) {
      const item = asRecord(adds[index]);
      const parent = nodeMapRef.current.get(asNumber(item.parentId));
      if (!(parent instanceof Element) && !(parent instanceof Document)) {
        continue;
      }
      const serialized = asRecord(item.node) as SerializedReplayNode;
      const nextNodeCandidate = nodeMapRef.current.get(asNumber(item.nextId));
      const nextNode = nextNodeCandidate?.parentNode === parent ? nextNodeCandidate : null;
      const existing = nodeMapRef.current.get(serialized.id);
      if (existing && existing.parentNode) {
        deleteMappedSubtree(existing, nodeMapRef.current);
        existing.parentNode.removeChild(existing);
      }
      const built = buildReplayNode(serialized, doc, nodeMapRef.current);
      if (!built) {
        continue;
      }
      parent.insertBefore(built, nextNode ?? null);
    }
  }

  function applyEvent(event: ReplayEvent) {
    const data = asRecord(event.data);

    switch (event.type) {
      case "full_snapshot":
        applyFullSnapshot(event);
        break;
      case "mutation":
        applyMutation(event);
        break;
      case "scroll": {
        const iframe = iframeRef.current;
        const targetId = asNumber(data.targetId);
        if (!iframe) {
          break;
        }
        if (!targetId) {
          iframe.contentWindow?.scrollTo(asNumber(data.x), asNumber(data.y));
          break;
        }
        const node = nodeMapRef.current.get(targetId);
        if (node instanceof Element) {
          node.scrollLeft = asNumber(data.x);
          node.scrollTop = asNumber(data.y);
        }
        break;
      }
      case "viewport":
        updateViewportSize(asNumber(data.width), asNumber(data.height));
        break;
      case "pointer_move":
        renderPointer(asNumber(data.x), asNumber(data.y), asString(data.pointerType) || "mouse");
        break;
      case "click":
        renderPointer(asNumber(data.x), asNumber(data.y), asString(data.pointerType) || "mouse", true);
        break;
      default:
        break;
    }
  }

  function seek(targetMs: number) {
    const safeTarget = clamp(targetMs, 0, durationMs);
    const targetTs = startTs + safeTarget;
    const snapshotIndex = (() => {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index].type === "full_snapshot" && events[index].ts <= targetTs) {
          return index;
        }
      }
      return -1;
    })();

    resetDocument();
    setSelectedNode(null);
    eventIndexRef.current = -1;

    const startIndex = snapshotIndex >= 0 ? snapshotIndex : 0;
    for (let index = startIndex; index < events.length; index += 1) {
      if (events[index].ts > targetTs) {
        break;
      }
      applyEvent(events[index]);
      eventIndexRef.current = index;
    }

    currentMsRef.current = safeTarget;
    lastCommittedMsRef.current = 0;
    commitCurrentMs(safeTarget, true);
  }

  useEffect(() => {
    setIsPlaying(false);
    viewportRef.current = {
      width: Math.max(320, detail.session.viewport.width || 1280),
      height: Math.max(220, detail.session.viewport.height || 720),
    };
    setViewport(viewportRef.current);
    seek(0);
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      clearPulse();
    };
  }, [replay.cacheKey, detail.session.viewport.height, detail.session.viewport.width]);

  useEffect(() => {
    if (!isPlaying || events.length === 0) {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      return;
    }

    playOriginRef.current = currentMsRef.current;
    playStartRef.current = performance.now();

    const tick = (now: number) => {
      const nextMs = clamp(playOriginRef.current + (now - playStartRef.current) * speed, 0, durationMs);
      const targetTs = startTs + nextMs;

      while (eventIndexRef.current + 1 < events.length && events[eventIndexRef.current + 1].ts <= targetTs) {
        eventIndexRef.current += 1;
        applyEvent(events[eventIndexRef.current]);
      }

      commitCurrentMs(nextMs);

      if (nextMs >= durationMs) {
        commitCurrentMs(durationMs, true);
        setIsPlaying(false);
        return;
      }

      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [isPlaying, speed, replay.cacheKey]);

  return (
    <div className="space-y-4">
      <Card className="section-frame rounded-2xl overflow-hidden">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">Replay console</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">
                  {detail.session.deviceType || "unknown"} / {detail.session.browser || "browser"}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {detail.session.viewport.width}x{detail.session.viewport.height}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {detail.session.sampleRate > 0 ? `${Math.round(detail.session.sampleRate * 100)}% sampled` : "sampled"}
                </Badge>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => seek(0)}>
                <TimerReset className="size-4" />
                Reset
              </Button>
              <Button size="sm" onClick={() => setIsPlaying((value) => !value)}>
                {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
                {isPlaying ? "Pause" : "Play"}
              </Button>
              {[0.5, 1, 1.5, 2].map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={speed === value ? "default" : "outline"}
                  onClick={() => setSpeed(value)}
                >
                  {value}x
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 p-4">
          <div className="rounded-2xl border border-border/70 bg-white/85">
            <ScrollArea className="w-full">
              <div className="relative overflow-hidden" style={{ width: `${viewport.width}px`, height: `${viewport.height}px` }}>
                <iframe
                  ref={iframeRef}
                  sandbox="allow-same-origin"
                  className="h-full w-full bg-surface-primary"
                  title="Session replay player"
                />

                <div
                  ref={pointerLayerRef}
                  className="pointer-events-none absolute inset-0"
                  aria-hidden="true"
                  style={{ display: "none" }}
                >
                  <div
                    ref={pointerDotRef}
                    className="absolute rounded-full border-2 border-white bg-foreground shadow-[0_0_0_4px_rgba(255,255,255,0.4)]"
                    style={{ width: 12, height: 12 }}
                  />
                  <div
                    ref={pointerPulseRef}
                    className="absolute rounded-full border border-primary/70 bg-primary/12"
                    style={{ display: "none", width: 34, height: 34 }}
                  />
                </div>
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{formatPlaybackTime(currentMs)}</span>
              <span>{formatPlaybackTime(durationMs)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(1, durationMs)}
              value={currentMs}
              onChange={(event) => {
                setIsPlaying(false);
                seek(Number.parseInt(event.target.value, 10) || 0);
              }}
              className="w-full accent-primary"
            />
            <div className="relative h-8 rounded-full border border-border/70 bg-secondary/45 px-3">
              {issues.map((issue) => {
                const Icon = issueIcon(issue.type);
                const position = durationMs > 0 ? (issue.timeMs / durationMs) * 100 : 0;
                return (
                  <button
                    key={issue.id}
                    type="button"
                    onClick={() => {
                      setIsPlaying(false);
                      seek(issue.timeMs);
                    }}
                    className="absolute top-1/2 -translate-y-1/2 rounded-full bg-background p-1 shadow-sm ring-1 ring-border/60 transition-transform hover:scale-110"
                    style={{ left: `calc(${position}% - 10px)` }}
                    title={`${issue.label}${issue.detail ? ` · ${issue.detail}` : ""}`}
                  >
                    <Icon className="size-3.5 text-foreground/70" />
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.7fr),minmax(0,0.3fr)]">
        <Card className="section-frame rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Issue markers</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {issues.length === 0 ? (
              <p className="text-sm text-muted-foreground">This replay did not emit any marked issues.</p>
            ) : (
              <div className="space-y-2">
                {issues.slice(0, 24).map((issue) => {
                  const Icon = issueIcon(issue.type);
                  return (
                    <button
                      key={issue.id}
                      type="button"
                      onClick={() => {
                        setIsPlaying(false);
                        seek(issue.timeMs);
                      }}
                      className="flex w-full items-center justify-between rounded-xl border border-border/70 bg-white/70 px-3 py-2 text-left transition-colors hover:bg-secondary/65"
                    >
                      <span className="flex items-center gap-2 text-sm">
                        <Icon className="size-4 text-primary" />
                        <span>
                          {issue.label}
                          {issue.detail ? <span className="ml-1 text-muted-foreground">{issue.detail}</span> : null}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">{formatPlaybackTime(issue.timeMs)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="section-frame rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">DOM inspector</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 text-sm">
            {selectedNode ? (
              <>
                <div className="rounded-xl border border-border/70 bg-white/70 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Node</p>
                  <p className="mt-2 font-medium">{selectedNode.selector || selectedNode.tagName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">#{selectedNode.id}</p>
                </div>
                <div className="rounded-xl border border-border/70 bg-white/70 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Visible text</p>
                  <p className="mt-2 break-words text-sm text-muted-foreground">{selectedNode.text || "Masked or empty"}</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Click any replayed element to inspect its node metadata.</p>
            )}

            <div className="rounded-xl border border-border/70 bg-secondary/45 p-3 text-xs text-muted-foreground">
              {detail.session.chunkCount} chunks · {formatCompact(detail.session.eventCount)} events · {formatCompact(issues.length)} markers
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
