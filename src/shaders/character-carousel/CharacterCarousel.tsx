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
) {
  const focusStyles = `<style data-character-carousel-focus>
:root { --character-carousel-scale: 1; }
html, body, .stage { width: 100%; height: 100%; margin: 0; overflow: hidden; }
.stage { min-height: 0 !important; }
.deck { transform: scale(var(--character-carousel-scale)); transform-origin: 50% 50%; }
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
  const source = useMemo(
    () => buildFocusedDocument(variant, items, safeSideCards, orientation, cursorFollow, autoPlay, direction, curve, switchDuration, holdDuration, safeSpeed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variant, itemsKey, safeSideCards, orientation, cursorFollow]
  );

  // Post only the playback controls (no items, no focus) — runs on every relevant change.
  const postControls = useCallback(() => {
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
      style={{ background: isFilmstrip ? "#d8c9ad" : "#121212", pointerEvents: "auto", ...style }}
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
          background: isFilmstrip ? "#d8c9ad" : "#121212",
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
