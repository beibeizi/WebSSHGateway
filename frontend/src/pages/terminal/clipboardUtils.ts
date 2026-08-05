export type ClipboardWriteText = (value: string) => Promise<void>;
export type ClipboardFallbackCopy = (value: string) => boolean;

export async function copyTextToClipboard(
  text: string,
  writeText: ClipboardWriteText | undefined,
  fallbackCopy: ClipboardFallbackCopy
): Promise<boolean> {
  if (!text) {
    return false;
  }

  if (writeText) {
    try {
      await writeText(text);
      return true;
    } catch {
      // Clipboard API 在非安全上下文或权限被拒绝时回退到 execCommand。
    }
  }

  try {
    return fallbackCopy(text);
  } catch {
    return false;
  }
}
