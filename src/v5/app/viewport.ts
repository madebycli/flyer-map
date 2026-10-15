/**
 * The visible part of the screen. A touch keyboard covers the lower part of the page without shrinking it (iPad, iOS, and Android Chrome by default),
 * so anything pinned to the bottom ends up behind the keys. The visual viewport knows better: `--vvh` is its height and `--kb` the height of what
 * covers the bottom, both in px on `<html>`; `data-kb` is set while a keyboard is up. Sheets use them to sit above the keys and never grow past
 * the visible area, so the field a person types into stays on screen.
 */
export function watchViewport(): () => void {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const apply = () => {
    const height = vv?.height ?? window.innerHeight;
    const covered = Math.max(0, Math.round(window.innerHeight - (vv ? vv.height + vv.offsetTop : window.innerHeight)));
    root.style.setProperty('--vvh', `${Math.round(height)}px`);
    root.style.setProperty('--kb', `${covered}px`);
    if (covered > 120) root.setAttribute('data-kb', ''); else root.removeAttribute('data-kb');
  };
  apply();
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  window.addEventListener('resize', apply);
  return () => { vv?.removeEventListener('resize', apply); vv?.removeEventListener('scroll', apply); window.removeEventListener('resize', apply); };
}
