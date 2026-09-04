import { useEffect, useRef, useState } from "react";
import "./funny-focus-video.css";

const HOLD_TO_ACTIVATE_MS = 5_000;
const VIDEO_ID = "RbVMiu4ubT0";
const VIDEO_URL = `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&mute=1&controls=0&loop=1&playlist=${VIDEO_ID}&playsinline=1&rel=0&modestbranding=1&disablekb=1&fs=0&iv_load_policy=3`;

function menuButtonFromEvent(event: Event) {
  const target = event.target;
  return target instanceof Element ? target.closest(".platform-grid-button") : null;
}

export function FunnyFocusVideo() {
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState(false);
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
        setSelected(false);
        setVisible(true);
        navigator.vibrate?.(35);
      }, HOLD_TO_ACTIVATE_MS);
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

  if (!visible) return null;

  const selectVideo = () => setSelected(true);

  return (
    <aside
      className={`funny-focus-video ${selected ? "is-selected" : ""}`}
      aria-label="Lokales Fokus-Video"
    >
      <div
        className="funny-focus-video__surface"
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={selected ? "Fokus-Video ausgewählt" : "Fokus-Video auswählen"}
        onClick={selectVideo}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          selectVideo();
        }}
      >
        <iframe
          src={VIDEO_URL}
          title="Fokus-Video"
          allow="autoplay; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
        />
        <span className="funny-focus-video__badge" aria-hidden="true">
          {selected ? "ausgewählt" : "brainrot mode"}
        </span>
      </div>

      {selected ? (
        <button
          className="funny-focus-video__delete"
          type="button"
          onClick={() => {
            setSelected(false);
            setVisible(false);
          }}
        >
          Video löschen
        </button>
      ) : null}
    </aside>
  );
}
