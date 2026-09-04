import { useEffect, useRef, useState } from "react";
import "./funny-focus-video.css";

const HOLD_TO_TOGGLE_MS = 5_000;
const VIDEO_IDS = ["RbVMiu4ubT0", "91aqFhjxWB4"] as const;

function videoUrl(videoId: string) {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${videoId}&playsinline=1&rel=0&modestbranding=1&disablekb=1&fs=0&iv_load_policy=3`;
}

function menuButtonFromEvent(event: Event) {
  const target = event.target;
  return target instanceof Element ? target.closest(".platform-grid-button") : null;
}

export function FunnyFocusVideo() {
  const [visible, setVisible] = useState(false);
  const [videoIndex, setVideoIndex] = useState(-1);
  const holdTimer = useRef<number | null>(null);
  const consumeNextMenuClick = useRef(false);

  useEffect(() => {
    const clearHoldTimer = () => {
      if (holdTimer.current === null) return;
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuButtonFromEvent(event)) return;
      clearHoldTimer();
      consumeNextMenuClick.current = false;
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        consumeNextMenuClick.current = true;
        setVisible((currentlyVisible) => {
          if (currentlyVisible) return false;
          setVideoIndex((current) => (current + 1) % VIDEO_IDS.length);
          return true;
        });
        navigator.vibrate?.(35);
      }, HOLD_TO_TOGGLE_MS);
    };

    const handlePointerEnd = () => {
      clearHoldTimer();
    };

    const handleMenuClickCapture = (event: MouseEvent) => {
      if (!consumeNextMenuClick.current || !menuButtonFromEvent(event)) return;
      consumeNextMenuClick.current = false;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (!menuButtonFromEvent(event)) return;
      if (holdTimer.current !== null || consumeNextMenuClick.current) event.preventDefault();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointerup", handlePointerEnd, true);
    document.addEventListener("pointercancel", handlePointerEnd, true);
    document.addEventListener("click", handleMenuClickCapture, true);
    document.addEventListener("contextmenu", handleContextMenu, true);

    return () => {
      clearHoldTimer();
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointerup", handlePointerEnd, true);
      document.removeEventListener("pointercancel", handlePointerEnd, true);
      document.removeEventListener("click", handleMenuClickCapture, true);
      document.removeEventListener("contextmenu", handleContextMenu, true);
    };
  }, []);

  if (!visible || videoIndex < 0) return null;

  const videoId = VIDEO_IDS[videoIndex];

  return (
    <aside className="funny-focus-video" aria-label="Lokales Fokus-Video">
      <div className="funny-focus-video__surface">
        <iframe
          src={videoUrl(videoId)}
          title="Fokus-Video"
          allow="autoplay; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
          tabIndex={-1}
        />
        <span className="funny-focus-video__badge" aria-hidden="true">brainrot mode</span>
      </div>
    </aside>
  );
}
