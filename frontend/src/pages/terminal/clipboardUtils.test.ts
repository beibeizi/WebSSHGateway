import { describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./clipboardUtils";

describe("copyTextToClipboard", () => {
  it("Clipboard API 成功时不调用降级复制", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const fallbackCopy = vi.fn(() => true);

    await expect(copyTextToClipboard("output", writeText, fallbackCopy)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("output");
    expect(fallbackCopy).not.toHaveBeenCalled();
  });

  it("Clipboard API 拒绝时使用降级复制", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const fallbackCopy = vi.fn(() => true);

    await expect(copyTextToClipboard("output", writeText, fallbackCopy)).resolves.toBe(true);
    expect(fallbackCopy).toHaveBeenCalledWith("output");
  });

  it("没有 Clipboard API 时直接使用降级复制", async () => {
    const fallbackCopy = vi.fn(() => true);

    await expect(copyTextToClipboard("output", undefined, fallbackCopy)).resolves.toBe(true);
    expect(fallbackCopy).toHaveBeenCalledWith("output");
  });

  it("两条复制路径均失败时返回 false", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const fallbackCopy = vi.fn(() => false);

    await expect(copyTextToClipboard("output", writeText, fallbackCopy)).resolves.toBe(false);
  });

  it("空文本不会调用任何复制路径", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const fallbackCopy = vi.fn(() => true);

    await expect(copyTextToClipboard("", writeText, fallbackCopy)).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(fallbackCopy).not.toHaveBeenCalled();
  });
});
