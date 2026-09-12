import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import characterFilmstripSource from "./sources/character-filmstrip.html?raw";
import characterWaveSource from "./sources/character-wave.html?raw";

export type CharacterCarouselVariant = "filmstrip" | "wave";

export type CarouselItem = {
  id?: string;
  src: string;
  name: string;
  role?: string;
};

export type CharacterCarouselProps = {
  variant?: CharacterCarouselVariant;
  items?: CarouselItem[];
  sideCards?: number;
  orientation?: "horizontal" | "vertical";
  focusIndex?: number;
  cursorFollow?: boolean;
  autoPlay?: boolean;
  direction?: 'left-right' | 'left' | 'right';
  curve?: 'linear' | 'exponential';
  switchDuration?: number;
  holdDuration?: number;
  speed?: number;
  scale?: number;
  opacity?: number;
  hue?: number;
  saturation?: number;
  brightness?: number;
  className?: string;
  style?: CSSProperties;
  onCardClick?: (index: number) => void;
  onCardDoubleClick?: (index: number, src: string, name: string) => void;
  onActiveIndexChange?: (index: number) => void;
};

export const CHARACTER_CAROUSEL_DEFAULTS = {
  variant: "filmstrip",
  speed: 1,
  scale: 1,
  opacity: 1,
  hue: 0,
  saturation: 1,
  brightness: 1,
  autoPlay: true,
  direction: 'left-right',
  curve: 'exponential',
  switchDuration: 0.5,
  holdDuration: 1.0,
} as const satisfies Required<Pick<CharacterCarouselProps, "variant" | "speed" | "scale" | "opacity" | "hue" | "saturation" | "brightness" | "autoPlay" | "direction" | "curve" | "switchDuration" | "holdDuration">>;

const SOURCE_BY_VARIANT: Record<CharacterCarouselVariant, string> = {
  filmstrip: characterFilmstripSource,
  wave: characterWaveSource,
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function parseRgb(color: string, fallback: string = '124, 58, 237'): string {
  if (!color) return fallback;
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return `${r}, ${g}, ${b}`;
    } else if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `${r}, ${g}, ${b}`;
    }
  } else if (color.startsWith('rgb')) {
    const m = color.match(/\d+[\s,]+\d+[\s,]+\d+/);
    if (m) return m[0].replace(/\s+/g, ', ');
  }
  return fallback;
}

function getObsidianTheme(): {
  accent: string;
  accentRgb: string;
  bgPrimary: string;
  bgSecondary: string;
} {
  if (typeof document === 'undefined') {
    return {
      accent: '#7c3aed',
      accentRgb: '124, 58, 237',
      bgPrimary: '#1e1e2e',
      bgSecondary: '#252538',
    };
  }
  const bodyStyles = getComputedStyle(document.body);
  const accent = bodyStyles.getPropertyValue('--interactive-accent').trim() || '#7c3aed';
  const rawRgb = bodyStyles.getPropertyValue('--interactive-accent-rgb').trim();
  const accentRgb = rawRgb || parseRgb(accent, '124, 58, 237');
  const bgPrimary = bodyStyles.getPropertyValue('--background-primary').trim() || '#1e1e2e';
  const bgSecondary = bodyStyles.getPropertyValue('--background-secondary').trim() || '#252538';
  return { accent, accentRgb, bgPrimary, bgSecondary };
}

function buildFocusedDocument(
  variant: CharacterCarouselVariant,
  items?: CarouselItem[],
  sideCards: number = 5,
  orientation: string = "horizontal",
  cursorFollow: boolean = false,
  autoPlay: boolean = true,
  direction: string = 'left-right',
  curve: string = 'exponential',
  switchDuration: number = 0.5,
  holdDuration: number = 1.0,
  speed: number = 1.0,
  themeConfig?: { accent: string; accentRgb: string; bgPrimary: string; bgSecondary: string },
) {
  const { accent, accentRgb, bgPrimary, bgSecondary } = themeConfig || getObsidianTheme();

  const focusStyles = `<style data-character-carousel-focus>
:root {
  --character-carousel-scale: 1;
  --accent-color: ${accent};
  --accent-rgb: ${accentRgb};
  --bg-primary: ${bgPrimary};
  --bg-secondary: ${bgSecondary};
}
html, body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: var(--bg-primary) !important;
}
.stage {
  min-height: 0 !important;
  background:
    linear-gradient(90deg, rgba(var(--accent-rgb), 0.08) 1px, transparent 1px) 50% 0 / 25% 100%,
    repeating-linear-gradient(
      0deg,
      transparent 0,
      transparent 109px,
      rgba(var(--accent-rgb), 0.08) 110px,
      transparent 111px
    ),
    radial-gradient(circle at var(--pointer-x) 48%, rgba(var(--accent-rgb), 0.18), transparent 38%),
    radial-gradient(circle at 50% 50%, rgba(var(--accent-rgb), 0.08), transparent 75%),
    var(--bg-primary) !important;
}
.stage::before {
  opacity: 0.16 !important;
  background:
    repeating-radial-gradient(circle at 12% 18%, rgba(var(--accent-rgb), 0.2) 0 0.5px, transparent 0.7px 4px),
    repeating-radial-gradient(circle at 78% 71%, rgba(255, 255, 255, 0.4) 0 0.5px, transparent 0.8px 5px) !important;
  mix-blend-mode: normal !important;
}
.stage::after {
  background: linear-gradient(
    90deg,
    rgba(var(--accent-rgb), 0.14),
    transparent 15%,
    transparent 85%,
    rgba(var(--accent-rgb), 0.14)
  ) !important;
}
.deck {
  transform: scale(var(--character-carousel-scale));
  transform-origin: 50% 50%;
}
.card {
  border: 2px solid rgba(var(--accent-rgb), calc(0.45 + var(--focus) * 0.55)) !important;
  background: rgba(var(--accent-rgb), 0.15) !important;
  background: color-mix(in srgb, var(--accent-color) 20%, var(--bg-secondary, #252538)) !important;
  box-shadow:
    0 calc(10px + var(--focus) * 24px) calc(18px + var(--focus) * 36px)
      rgba(var(--accent-rgb), calc(0.2 + var(--focus) * 0.28)),
    inset 0 0 0 1.5px rgba(var(--accent-rgb), 0.45) !important;
}
.card::before {
  border: 1px solid rgba(var(--accent-rgb), calc(0.3 + var(--focus) * 0.45)) !important;
}
.card:focus-visible {
  box-shadow:
    0 26px 50px rgba(var(--accent-rgb), 0.35),
    0 0 0 4px rgba(var(--accent-rgb), 0.55) !important;
}
.card:hover {
  box-shadow:
    0 20px 48px rgba(var(--accent-rgb), 0.35),
    0 0 0 2.5px var(--accent-color) !important;
}
.index {
  border: 1.5px solid var(--accent-color) !important;
  color: var(--accent-color) !important;
}
.role {
  color: var(--accent-color) !important;
}
.footer {
  background: color-mix(in srgb, var(--accent-color) 12%, #171612) !important;
  border-top: 1px solid rgba(var(--accent-rgb), 0.25) !important;
}
</style>`;

  const itemsScript = items && items.length > 0
    ? `<script>window.__CHARACTER_CAROUSEL_ITEMS = ${JSON.stringify(items).replace(/</g, '\\u003c')};</script>`
    : '';

  const controls = `<script data-character-carousel-controls>
(function () {
  var nativeFrame = window.requestAnimationFrame.bind(window);
  var controls = window.__CHARACTER_CAROUSEL_CONTROLS = {
    speed: ${Number(speed) || 1},
    scale: 1,
    paused: false,
    autoPlay: ${Boolean(autoPlay)},
    direction: ${JSON.stringify(direction)},
    curve: ${JSON.stringify(curve)},
    switchDuration: ${Number(switchDuration) || 0.5},
    holdDuration: ${Number(holdDuration) ?? 1.0},
    sideCards: ${sideCards},
    orientation: ${JSON.stringify(orientation)},
    cursorFollow: ${Boolean(cursorFollow)}
  };
  window.__CHARACTER_CAROUSEL_NOW = function () {
    return performance.now();
  };
  window.requestAnimationFrame = function (callback) {
    function tick(realTime) {
      if (controls.paused) {
        return nativeFrame(tick);
      }
      callback(realTime);
    }
    return nativeFrame(tick);
  };
  window.addEventListener('message', function (event) {
    if (!event.data) return;
    if (event.data.type === 'character-carousel-controls') {
      var next = event.data.controls || {};
      if (Number.isFinite(next.speed)) controls.speed = Math.max(0.1, Math.min(3.0, next.speed));
      if (Number.isFinite(next.scale)) controls.scale = Math.max(0.5, Math.min(4.0, next.scale));
      if (Number.isFinite(next.sideCards)) controls.sideCards = Math.max(0, Math.min(10, next.sideCards));
      if (next.orientation) controls.orientation = next.orientation;
      if (typeof next.cursorFollow === 'boolean') controls.cursorFollow = next.cursorFollow;
      if (typeof next.autoPlay === 'boolean') controls.autoPlay = next.autoPlay;
      if (typeof next.direction === 'string') controls.direction = next.direction;
      if (typeof next.curve === 'string') controls.curve = next.curve;
      if (Number.isFinite(next.switchDuration)) controls.switchDuration = Math.max(0, next.switchDuration);
      if (Number.isFinite(next.holdDuration)) controls.holdDuration = Math.max(0, next.holdDuration);
      if (next.accentColor) {
        document.documentElement.style.setProperty('--accent-color', next.accentColor);
      }
      if (next.accentRgb) {
        document.documentElement.style.setProperty('--accent-rgb', next.accentRgb);
      }
      if (next.bgPrimary) {
        document.documentElement.style.setProperty('--bg-primary', next.bgPrimary);
      }
      if (next.bgSecondary) {
        document.documentElement.style.setProperty('--bg-secondary', next.bgSecondary);
      }
      controls.paused = Boolean(next.paused);
      document.documentElement.style.setProperty('--character-carousel-scale', String(controls.scale));
    }
  });
})();
</script>`;

  const focusedSource = (SOURCE_BY_VARIANT[variant] || characterFilmstripSource)
    .replaceAll("performance.now()", "window.__CHARACTER_CAROUSEL_NOW()");

  return focusedSource
    .replace(/<script[^>]+cloudflareinsights\.com[^>]*><\/script>/gi, "")
    .replace("</head>", `${focusStyles}${itemsScript}${controls}</head>`);
}

export function CharacterCarousel({
  variant = CHARACTER_CAROUSEL_DEFAULTS.variant,
  items,
  sideCards = 5,
  orientation = "horizontal",
  focusIndex,
  cursorFollow = false,
  autoPlay = CHARACTER_CAROUSEL_DEFAULTS.autoPlay,
  direction = CHARACTER_CAROUSEL_DEFAULTS.direction,
  curve = CHARACTER_CAROUSEL_DEFAULTS.curve,
  switchDuration = CHARACTER_CAROUSEL_DEFAULTS.switchDuration,
  holdDuration = CHARACTER_CAROUSEL_DEFAULTS.holdDuration,
  speed = CHARACTER_CAROUSEL_DEFAULTS.speed,
  scale = CHARACTER_CAROUSEL_DEFAULTS.scale,
  opacity = CHARACTER_CAROUSEL_DEFAULTS.opacity,
  hue = CHARACTER_CAROUSEL_DEFAULTS.hue,
  saturation = CHARACTER_CAROUSEL_DEFAULTS.saturation,
  brightness = CHARACTER_CAROUSEL_DEFAULTS.brightness,
  className = "",
  style,
  onCardClick,
  onCardDoubleClick,
  onActiveIndexChange,
}: CharacterCarouselProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [hostVisible, setHostVisible] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  const safeSpeed = clamp(speed, 0.1, 3.0);
  const safeScale = clamp(scale, 0.5, 4.0);
  const safeSideCards = Math.max(0, Math.min(10, sideCards));
  const paused = !hostVisible || !documentVisible;
  const itemsKey = useMemo(() => (items ? items.map(i => `${i.id}`).join(',') : ''), [items]);
  const currentTheme = getObsidianTheme();
  const source = useMemo(
    () => buildFocusedDocument(variant, items, safeSideCards, orientation, cursorFollow, autoPlay, direction, curve, switchDuration, holdDuration, safeSpeed, currentTheme),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variant, itemsKey, safeSideCards, orientation, cursorFollow, currentTheme.accent, currentTheme.accentRgb, currentTheme.bgPrimary, currentTheme.bgSecondary]
  );

  // Post only the playback controls (no items, no focus) — runs on every relevant change.
  const postControls = useCallback(() => {
    const theme = getObsidianTheme();
    iframeRef.current?.contentWindow?.postMessage({
      type: "character-carousel-controls",
      controls: {
        speed: safeSpeed,
        scale: safeScale,
        paused,
        autoPlay,
        direction,
        curve,
        switchDuration,
        holdDuration,
        sideCards: safeSideCards,
        orientation,
        cursorFollow,
        accentColor: theme.accent,
        accentRgb: theme.accentRgb,
        bgPrimary: theme.bgPrimary,
        bgSecondary: theme.bgSecondary,
      },
    }, "*");
  }, [paused, safeScale, safeSpeed, safeSideCards, orientation, autoPlay, direction, curve, switchDuration, holdDuration, cursorFollow]);

  // Post items — only when the items list itself changes, not on every controls update.
  const postItems = useCallback(() => {
    if (items && items.length > 0) {
      iframeRef.current?.contentWindow?.postMessage({
        type: "character-carousel-items",
        items,
      }, "*");
    }
  }, [items]);

  // Post focus — only when focusIndex explicitly changes.
  const postFocus = useCallback(() => {
    if (typeof focusIndex === "number") {
      iframeRef.current?.contentWindow?.postMessage({
        type: "character-carousel-focus",
        index: focusIndex,
      }, "*");
    }
  }, [focusIndex]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => setHostVisible(entry?.isIntersecting ?? true));
    observer.observe(iframe);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const update = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (!onCardClick) return undefined;
    const handler = (e: MessageEvent) => {
      if (!e.data) return;
      if (e.data.type === "character-carousel-card-click" && typeof e.data.index === "number") {
        onCardClick(e.data.index);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onCardClick]);

  useEffect(() => {
    if (!onCardDoubleClick) return undefined;
    const handler = (e: MessageEvent) => {
      if (!e.data) return;
      if (e.data.type === "character-carousel-card-dblclick") {
        onCardDoubleClick(e.data.index, e.data.src, e.data.name ?? "");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onCardDoubleClick]);

  useEffect(() => {
    if (!onActiveIndexChange) return undefined;
    const handler = (e: MessageEvent) => {
      if (!e.data) return;
      if (e.data.type === "character-carousel-active-index" && typeof e.data.index === "number") {
        onActiveIndexChange(e.data.index);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onActiveIndexChange]);

  // On initial load (source change), send everything: controls + items + focus.
  const postAll = useCallback(() => {
    postControls();
    postItems();
    postFocus();
  }, [postControls, postItems, postFocus]);

  useEffect(() => {
    postAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Controls change (pause, speed, autoplay, etc.) — send controls only, never items.
  useEffect(() => {
    postControls();
  }, [postControls]);

  // Items change — send items without resetting playback state.
  useEffect(() => {
    postItems();
  }, [postItems]);

  // focusIndex change — send focus without rebuilding cards.
  useEffect(() => {
    postFocus();
  }, [postFocus]);

  const isFilmstrip = variant === "filmstrip";

  return (
    <div
      className={`threeui-background character-carousel character-carousel--${variant}${className ? ` ${className}` : ""}`}
      style={{ background: "var(--background-primary)", pointerEvents: "auto", ...style }}
    >
      <iframe
        ref={iframeRef}
        title={isFilmstrip ? "Interactive character filmstrip" : "Interactive character wave"}
        srcDoc={source}
        sandbox="allow-scripts allow-same-origin"
        onLoad={postAll}
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          width: "100%",
          height: "100%",
          border: 0,
          background: "var(--background-primary)",
          opacity: clamp(opacity, 0.05, 1),
          filter: `hue-rotate(${clamp(hue, -180, 180)}deg) saturate(${clamp(saturation, 0, 2)}) brightness(${clamp(brightness, 0.35, 1.65)})`,
        }}
      />
    </div>
  );
}

export function CharacterFilmstrip(props: Omit<CharacterCarouselProps, "variant">) {
  return <CharacterCarousel {...props} variant="filmstrip" />;
}

export function CharacterWave(props: Omit<CharacterCarouselProps, "variant">) {
  return <CharacterCarousel {...props} variant="wave" />;
}
