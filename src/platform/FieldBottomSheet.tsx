import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./field-bottom-sheet.css";

export type FieldSheetSnap = "compact" | "expanded" | "full";

export type FieldSheetHeaderControls = {
  reveal: () => void;
  retract: () => void;
  toggle: () => void;
  isRetracted: boolean;
};

const SNAP_RATIOS: Record<FieldSheetSnap, number> = {
  compact: 0.34,
  expanded: 0.62,
  full: 0.88,
};
const SNAP_ORDER: FieldSheetSnap[] = ["compact", "expanded", "full"];
const MIN_DRAG_PX = 8;

function viewportHeight() {
  return Math.max(320, window.visualViewport?.height ?? window.innerHeight);
}

function snapHeight(snap: FieldSheetSnap, viewport: number) {
  return Math.round(viewport * SNAP_RATIOS[snap]);
}

function nearestSnap(height: number, viewport: number): FieldSheetSnap {
  return SNAP_ORDER.reduce((best, candidate) => {
    const bestDistance = Math.abs(height - snapHeight(best, viewport));
    const candidateDistance = Math.abs(height - snapHeight(candidate, viewport));
    return candidateDistance < bestDistance ? candidate : best;
  }, "expanded" as FieldSheetSnap);
}

function clampHeight(height: number, viewport: number, allowRetracted = false) {
  const minimum = allowRetracted ? 4.5 * 16 : snapHeight("compact", viewport);
  return Math.max(minimum, Math.min(snapHeight("full", viewport), height));
}

function retractedDragThreshold(viewport: number) {
  return Math.max(4.5 * 16, snapHeight("compact", viewport) * 0.72);
}

export function FieldBottomSheet({
  open,
  title,
  kicker,
  headerAside,
  headerActions,
  showClose = true,
  onClose,
  onTitleClick,
  overlayClassName = "",
  initialSnap = "expanded",
  retractable = false,
  initialRetracted = false,
  className = "",
  children,
  footer,
}: {
  open: boolean;
  title: string;
  kicker?: string;
  headerAside?: ReactNode;
  headerActions?: (controls: FieldSheetHeaderControls) => ReactNode;
  showClose?: boolean;
  onClose: () => void;
  onTitleClick?: () => void;
  overlayClassName?: string;
  initialSnap?: FieldSheetSnap;
  retractable?: boolean;
  initialRetracted?: boolean;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [snap, setSnap] = useState<FieldSheetSnap>(initialSnap);
  const [viewport, setViewport] = useState(() => viewportHeight());
  const [userSized, setUserSized] = useState(false);
  const [retracted, setRetracted] = useState(initialRetracted);
  const suppressHandleClick = useRef(false);
  const drag = useRef<{ pointerId: number; startY: number; startHeight: number; sheet: HTMLElement } | null>(null);
  const reveal = useCallback(() => setRetracted(false), []);
  const retract = useCallback(() => {
    setSnap(initialSnap);
    setUserSized(false);
    setRetracted(true);
  }, [initialSnap]);
  const toggleRetracted = useCallback(() => setRetracted((current) => !current), []);

  useEffect(() => {
    if (open) {
      setSnap(initialSnap);
      setUserSized(false);
      setRetracted(initialRetracted);
    }
  }, [initialRetracted, initialSnap, open]);

  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setViewport(viewportHeight());
    window.addEventListener("resize", update);
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
    };
  }, []);

  const committedHeight = useMemo(() => snapHeight(snap, viewport), [snap, viewport]);

  const finishDrag = useCallback((height: number, moved: boolean, shouldRetract: boolean) => {
    const activeDrag = drag.current;
    if (!activeDrag) return;
    if (!moved) {
      activeDrag.sheet.classList.remove("field-sheet-dragging");
      drag.current = null;
      return;
    }
    if (shouldRetract) {
      activeDrag.sheet.style.removeProperty("--field-sheet-height");
      activeDrag.sheet.classList.remove("field-sheet-dragging");
      setSnap(initialSnap);
      setUserSized(false);
      setRetracted(true);
      drag.current = null;
      return;
    }
    const nextSnap = nearestSnap(height, viewport);
    activeDrag.sheet.style.setProperty("--field-sheet-height", snapHeight(nextSnap, viewport) + "px");
    activeDrag.sheet.classList.remove("field-sheet-dragging");
    setSnap(nextSnap);
    setUserSized(true);
    drag.current = null;
  }, [initialSnap, viewport]);

  if (!open) return null;

  return (
    <div
      className={`field-sheet-overlay ${overlayClassName}`.trim()}
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className={`field-bottom-sheet ${userSized ? "" : "field-sheet-auto"} ${retractable ? "field-sheet-retractable" : ""} ${retracted ? "field-sheet-retracted" : ""} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-snap={snap}
        style={{ "--field-sheet-height": committedHeight + "px" } as CSSProperties}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="field-sheet-handle-button"
          type="button"
          aria-label={retractable ? (retracted ? "Fenster öffnen" : "Fenster einfahren") : "Fensterhöhe ändern"}
          aria-expanded={retractable ? !retracted : undefined}
          aria-valuetext={snap === "compact" ? "Kompakt" : snap === "expanded" ? "Erweitert" : "Fast Vollbild"}
          onClick={() => {
            if (!retractable || suppressHandleClick.current) {
              suppressHandleClick.current = false;
              return;
            }
            toggleRetracted();
          }}
          onPointerDown={(event) => {
            suppressHandleClick.current = false;
            const sheet = event.currentTarget.closest<HTMLElement>(".field-bottom-sheet");
            if (!sheet) return;
            const startHeight = sheet.getBoundingClientRect().height;
            drag.current = { pointerId: event.pointerId, startY: event.clientY, startHeight, sheet };
            sheet.style.setProperty("--field-sheet-height", startHeight + "px");
            sheet.classList.add("field-sheet-dragging");
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current || drag.current.pointerId !== event.pointerId) return;
            event.preventDefault();
            const next = clampHeight(
              drag.current.startHeight + drag.current.startY - event.clientY,
              viewport,
              retractable,
            );
            drag.current.sheet.style.setProperty("--field-sheet-height", next + "px");
          }}
          onPointerUp={(event) => {
            if (!drag.current || drag.current.pointerId !== event.pointerId) return;
            const activeDrag = drag.current;
            if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
            const rawHeight = activeDrag.startHeight + activeDrag.startY - event.clientY;
            const next = clampHeight(rawHeight, viewport, retractable);
            const moved = Math.abs(event.clientY - activeDrag.startY) >= MIN_DRAG_PX;
            suppressHandleClick.current = moved;
            finishDrag(next, moved, retractable && rawHeight <= retractedDragThreshold(viewport));
          }}
          onPointerCancel={() => {
            const activeDrag = drag.current;
            if (activeDrag) activeDrag.sheet.classList.remove("field-sheet-dragging");
            suppressHandleClick.current = false;
            drag.current = null;
          }}
          onKeyDown={(event) => {
            const index = SNAP_ORDER.indexOf(snap);
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setUserSized(true);
              setSnap(SNAP_ORDER[Math.min(SNAP_ORDER.length - 1, index + 1)]);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setUserSized(true);
              setSnap(SNAP_ORDER[Math.max(0, index - 1)]);
            } else if (event.key === "Home") {
              event.preventDefault();
              setUserSized(true);
              setSnap("compact");
            } else if (event.key === "End") {
              event.preventDefault();
              setUserSized(true);
              setSnap("full");
            }
          }}
        >
          <span className="field-sheet-handle" aria-hidden="true" />
        </button>
        <header className="field-sheet-header">
          <div>
            {kicker ? <span>{kicker}</span> : null}
            {onTitleClick ? (
              <button
                className="field-sheet-title-button"
                type="button"
                onClick={onTitleClick}
                aria-label={`${title} bearbeiten`}
              >
                <strong>{title}</strong>
              </button>
            ) : (
              <strong>{title}</strong>
            )}
          </div>
          {headerAside ? <div className="field-sheet-header-aside">{headerAside}</div> : null}
          {headerActions ? (
            <div className="field-sheet-header-actions">
              {headerActions({ reveal, retract, toggle: toggleRetracted, isRetracted: retracted })}
            </div>
          ) : null}
          {showClose ? <button className="field-sheet-close-button" type="button" onClick={onClose} aria-label={`${title} schließen`}>×</button> : null}
        </header>
        <div className="field-sheet-body">{children}</div>
        {footer ? <footer className="field-sheet-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}

export function useLegacyFieldSheetDragBridge(active = true) {
  useEffect(() => {
    if (!active) return;
    let dragState: {
      pointerId: number;
      handle: HTMLElement;
      sheet: HTMLElement;
      startY: number;
      startHeight: number;
      moved: boolean;
    } | null = null;
    let blockClickUntil = 0;

    const applyEnhancement = () => {
      const viewport = viewportHeight();
      document.documentElement.style.setProperty("--field-sheet-viewport-height", `${viewport}px`);
      document.querySelectorAll<HTMLElement>(".bottom-sheet").forEach((sheet) => {
        if (!sheet.classList.contains("field-sheet-enhanced")) {
          sheet.classList.add("field-sheet-enhanced");
          sheet.scrollTop = 0;
        }
        const savedSnap = sheet.dataset.fieldSnap as FieldSheetSnap | undefined;
        if (savedSnap && SNAP_ORDER.includes(savedSnap)) {
          sheet.style.setProperty("--field-sheet-height", `${snapHeight(savedSnap, viewport)}px`);
        }
      });
    };

    const observer = new MutationObserver(applyEnhancement);
    observer.observe(document.body, { childList: true, subtree: true });
    applyEnhancement();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".sheet-handle-button") : null;
      const sheet = target?.closest<HTMLElement>(".bottom-sheet");
      if (!target || !sheet) return;
      const currentHeight = sheet.getBoundingClientRect().height;
      dragState = {
        pointerId: event.pointerId,
        handle: target,
        sheet,
        startY: event.clientY,
        startHeight: currentHeight,
        moved: false,
      };
      target.setPointerCapture?.(event.pointerId);
      sheet.classList.add("field-sheet-dragging");
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const delta = dragState.startY - event.clientY;
      if (Math.abs(delta) >= MIN_DRAG_PX) dragState.moved = true;
      if (!dragState.moved) return;
      event.preventDefault();
      const viewport = viewportHeight();
      const next = clampHeight(dragState.startHeight + delta, viewport);
      dragState.sheet.style.setProperty("--field-sheet-height", `${next}px`);
    };

    const finish = (event: PointerEvent) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const current = dragState.sheet.getBoundingClientRect().height;
      const viewport = viewportHeight();
      const targetSnap = nearestSnap(current, viewport);
      dragState.sheet.style.setProperty("--field-sheet-height", `${snapHeight(targetSnap, viewport)}px`);
      dragState.sheet.dataset.fieldSnap = targetSnap;
      dragState.sheet.classList.remove("field-sheet-dragging");
      if (dragState.moved) blockClickUntil = performance.now() + 350;
      dragState = null;
    };

    const onClickCapture = (event: MouseEvent) => {
      if (performance.now() > blockClickUntil) return;
      const handle = event.target instanceof Element ? event.target.closest(".sheet-handle-button") : null;
      if (!handle) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      blockClickUntil = 0;
    };

    const onViewport = () => applyEnhancement();
    const vv = window.visualViewport;
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
    document.addEventListener("pointerup", finish, true);
    document.addEventListener("pointercancel", finish, true);
    document.addEventListener("click", onClickCapture, true);
    window.addEventListener("resize", onViewport);
    vv?.addEventListener("resize", onViewport);
    vv?.addEventListener("scroll", onViewport);

    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", finish, true);
      document.removeEventListener("pointercancel", finish, true);
      document.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("resize", onViewport);
      vv?.removeEventListener("resize", onViewport);
      vv?.removeEventListener("scroll", onViewport);
    };
  }, [active]);
}
