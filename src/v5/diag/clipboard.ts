export type CopyMethod = 'clipboard' | 'legacy' | 'failed';

/** Clipboard API first (needs a secure context and a user gesture), a hidden textarea as the fallback for older browsers. */
export async function copyText(text: string): Promise<CopyMethod> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return 'clipboard'; }
  } catch { /* fall through */ }
  try {
    const area = document.createElement('textarea');
    area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok ? 'legacy' : 'failed';
  } catch { return 'failed'; }
}

export function downloadText(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
