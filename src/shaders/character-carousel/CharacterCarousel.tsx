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
  speed?: number;
  scale?: number;
  opacity?: number;
  hue?: number;
  saturation?: number;
  brightness?: number;
  className?: string;
  style?: CSSProperties;
};

export const CHARACTER_CAROUSEL_DEFAULTS = {
  variant: "filmstrip",
  speed: 1,
  scale: 1,
  opacity: 1,
  hue: 0,
  saturation: 1,
  brightness: 1,
} as const satisfies Required<Pick<CharacterCarouselProps, "variant" | "speed" | "scale" | "opacity" | "hue" | "saturation" | "brightness">>;

const SOURCE_BY_VARIANT: Record<CharacterCarouselVariant, string> = {
  filmstrip: characterFilmstripSource,
  wave: characterWaveSource,
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function buildFocusedDocument(variant: CharacterCarouselVariant, items?: CarouselItem[], sideCards: number = 5, orientation: string = "horizontal", cursorFollow: boolean = false) {
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
  var clock = { real: null, virtual: null };
  var controls = window.__CHARACTER_CAROUSEL_CONTROLS = { speed: 1, scale: 1, paused: false, sideCards: ${sideCards}, orientation: ${JSON.stringify(orientation)}, cursorFollow: ${Boolean(cursorFollow)} };
  window.__CHARACTER_CAROUSEL_NOW = function () {
    return clock.virtual === null ? performance.now() : clock.virtual;
  };
  window.requestAnimationFrame = function (callback) {
    function tick(realTime) {
      if (clock.real === null) {
        clock.real = realTime;
        clock.virtual = realTime;
      } else {
        if (!controls.paused) clock.virtual += (realTime - clock.real) * controls.speed;
        clock.real = realTime;
      }
      if (controls.paused) {
        return nativeFrame(tick);
      }
      callback(clock.virtual);
    }
    return nativeFrame(tick);
  };
  window.addEventListener('message', function (event) {
    if (!event.data) return;
    if (event.data.type === 'character-carousel-controls') {
      var next = event.data.controls || {};
      if (Number.isFinite(next.speed)) controls.speed = Math.max(0, Math.min(2.5, next.speed));
      if (Number.isFinite(next.scale)) controls.scale = Math.max(0.7, Math.min(1.3, next.scale));
      if (Number.isFinite(next.sideCards)) controls.sideCards = Math.max(0, Math.min(10, next.sideCards));
      if (next.orientation) controls.orientation = next.orientation;
      if (typeof next.cursorFollow === 'boolean') controls.cursorFollow = next.cursorFollow;
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
  speed = CHARACTER_CAROUSEL_DEFAULTS.speed,
  scale = CHARACTER_CAROUSEL_DEFAULTS.scale,
  opacity = CHARACTER_CAROUSEL_DEFAULTS.opacity,
  hue = CHARACTER_CAROUSEL_DEFAULTS.hue,
  saturation = CHARACTER_CAROUSEL_DEFAULTS.saturation,
  brightness = CHARACTER_CAROUSEL_DEFAULTS.brightness,
  className = "",
  style,
}: CharacterCarouselProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [hostVisible, setHostVisible] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  const safeSpeed = clamp(speed, 0, 2.5);
  const safeScale = clamp(scale, 0.7, 1.3);
  const safeSideCards = Math.max(0, Math.min(10, sideCards));
  const paused = !hostVisible || !documentVisible || safeSpeed === 0;
  const source = useMemo(() => buildFocusedDocument(variant, items, safeSideCards, orientation, cursorFollow), [variant, items, safeSideCards, orientation, cursorFollow]);

  const postControls = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({
      type: "character-carousel-controls",
      controls: { speed: safeSpeed, scale: safeScale, paused, sideCards: safeSideCards, orientation, cursorFollow },
    }, "*");
    if (items && items.length > 0) {
      iframeRef.current?.contentWindow?.postMessage({
        type: "character-carousel-items",
        items,
      }, "*");
    }
    if (typeof focusIndex === "number") {
      iframeRef.current?.contentWindow?.postMessage({
        type: "character-carousel-focus",
        index: focusIndex,
      }, "*");
    }
  }, [paused, safeScale, safeSpeed, items, safeSideCards, orientation, focusIndex]);

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
    postControls();
  }, [postControls, source]);

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
        onLoad={postControls}
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
