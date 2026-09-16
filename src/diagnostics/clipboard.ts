export type ClipboardCopyMethod = "clipboard-api" | "exec-command" | "failed";

export type ClipboardCopyResult = {
  ok: boolean;
  method: ClipboardCopyMethod;
};

type ClipboardWriter = {
  writeText(value: string): Promise<void>;
};

type CopyEnvironment = {
  clipboard?: ClipboardWriter | null;
  legacyCopy?: (value: string) => boolean;
};

type RuntimeNavigator = {
  clipboard?: ClipboardWriter;
};

type RuntimeDocument = Document & {
  execCommand?: (commandId: string, showUI?: boolean, value?: string) => boolean;
};

export function clipboardApiAvailable() {
  if (typeof navigator === "undefined") return false;
  return typeof (navigator as unknown as RuntimeNavigator).clipboard?.writeText === "function";
}

export function legacyCopyAvailable() {
  if (typeof document === "undefined") return false;
  return typeof (document as RuntimeDocument).execCommand === "function";
}

function browserClipboard(): ClipboardWriter | null {
  if (!clipboardApiAvailable()) return null;
  return (navigator as unknown as RuntimeNavigator).clipboard ?? null;
}

export function legacyCopyText(value: string) {
  if (typeof document === "undefined" || !document.body || !legacyCopyAvailable()) {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  const previousActiveElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;

  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;
  try {
    const execCommand = (document as RuntimeDocument).execCommand;
    copied = execCommand ? execCommand.call(document, "copy") : false;
  } catch {
    copied = false;
  } finally {
    textarea.remove();
    try {
      previousActiveElement?.focus({ preventScroll: true });
    } catch {
      previousActiveElement?.focus();
    }
  }
  return copied;
}

export async function copyTextToClipboard(
  value: string,
  environment: CopyEnvironment = {},
): Promise<ClipboardCopyResult> {
  const clipboard = Object.prototype.hasOwnProperty.call(environment, "clipboard")
    ? environment.clipboard ?? null
    : browserClipboard();

  if (clipboard) {
    try {
      await clipboard.writeText(value);
      return { ok: true, method: "clipboard-api" };
    } catch {
      // iOS/Safari can reject Clipboard API writes despite a user gesture.
      // Fall through to the synchronous selection-based path.
    }
  }

  const legacyCopy = environment.legacyCopy ?? legacyCopyText;
  try {
    if (legacyCopy(value)) return { ok: true, method: "exec-command" };
  } catch {
    // The caller gets an explicit failure and can expose selectable text.
  }

  return { ok: false, method: "failed" };
}
