import { describe, expect, it } from "vitest";
import { createTerminalBufferSnapshot } from "./terminalUtils";

type FakeLine = {
  isWrapped: boolean;
  translateToString: (trimRight?: boolean) => string;
};

function line(text: string, isWrapped = false): FakeLine {
  return {
    isWrapped,
    translateToString: () => text,
  };
}

function buffer(
  lines: Array<FakeLine | undefined>,
  position: { baseY?: number; viewportY?: number } = {}
) {
  return {
    length: lines.length,
    baseY: position.baseY ?? 0,
    viewportY: position.viewportY ?? 0,
    getLine: (index: number) => lines[index],
  };
}

describe("createTerminalBufferSnapshot", () => {
  it("合并 wrapped 行并保留中文", () => {
    const result = createTerminalBufferSnapshot(
      buffer([
        line("deploy "),
        line("成功", true),
        line("next"),
      ])
    );

    expect(result).toEqual({
      text: "deploy 成功\nnext",
      loadedLines: 3,
      truncated: false,
      initialScrollRatio: 0,
    });
  });

  it("移除末尾空行但保留已读取行数", () => {
    const result = createTerminalBufferSnapshot(
      buffer([
        line("command output"),
        line(""),
        line(""),
      ])
    );

    expect(result).toEqual({
      text: "command output",
      loadedLines: 3,
      truncated: false,
      initialScrollRatio: 0,
    });
  });

  it("只保留行数预算内的最新输出", () => {
    const result = createTerminalBufferSnapshot(
      buffer([
        line("old"),
        line("middle"),
        line("中文-newest"),
      ]),
      { maxLines: 1, maxChars: 1024 }
    );

    expect(result).toEqual({
      text: "中文-newest",
      loadedLines: 1,
      truncated: true,
      initialScrollRatio: 0,
    });
  });

  it("从 wrapped 逻辑行中段开始时回溯到逻辑行起点", () => {
    const result = createTerminalBufferSnapshot(
      buffer([
        line("prefix "),
        line("continued ", true),
        line("tail", true),
        line("newest"),
      ]),
      { maxLines: 3, maxChars: 1024 }
    );

    expect(result).toEqual({
      text: "prefix continued tail\nnewest",
      loadedLines: 4,
      truncated: false,
      initialScrollRatio: 0,
    });
  });

  it("字符预算优先保留最新输出", () => {
    const result = createTerminalBufferSnapshot(
      buffer([
        line("old-output"),
        line("new"),
      ]),
      { maxLines: 10, maxChars: 4 }
    );

    expect(result).toEqual({
      text: "new",
      loadedLines: 1,
      truncated: true,
      initialScrollRatio: 0,
    });
  });

  it("单个超长行截断时不拆分 UTF-16 代理对", () => {
    const result = createTerminalBufferSnapshot(
      buffer([line("A😀B")]),
      { maxLines: 10, maxChars: 2 }
    );

    expect(result).toEqual({
      text: "B",
      loadedLines: 1,
      truncated: true,
      initialScrollRatio: 0,
    });
  });

  it("跳过缺失的 buffer 行且不抛出异常", () => {
    const result = createTerminalBufferSnapshot(
      buffer([
        line("first"),
        undefined,
        line("last"),
      ])
    );

    expect(result).toEqual({
      text: "first\nlast",
      loadedLines: 2,
      truncated: false,
      initialScrollRatio: 0,
    });
  });

  it("空 buffer 返回空快照", () => {
    expect(createTerminalBufferSnapshot(buffer([]))).toEqual({
      text: "",
      loadedLines: 0,
      truncated: false,
      initialScrollRatio: 0,
    });
  });

  it("终端位于底部时将初始滚动比例映射到末尾", () => {
    const result = createTerminalBufferSnapshot(
      buffer(Array.from({ length: 10 }, (_, index) => line(String(index))), {
        baseY: 6,
        viewportY: 6,
      })
    );

    expect(result.initialScrollRatio).toBe(1);
  });

  it("终端位于历史中间时保留近似 viewport 比例", () => {
    const result = createTerminalBufferSnapshot(
      buffer(Array.from({ length: 10 }, (_, index) => line(String(index))), {
        baseY: 8,
        viewportY: 4,
      })
    );

    expect(result.initialScrollRatio).toBe(0.5);
  });

  it("viewport 位于已截断快照之前时定位到快照顶部", () => {
    const result = createTerminalBufferSnapshot(
      buffer(Array.from({ length: 10 }, (_, index) => line(String(index))), {
        baseY: 8,
        viewportY: 4,
      }),
      { maxLines: 4 }
    );

    expect(result.initialScrollRatio).toBe(0);
  });

  it("没有 scrollback 时使用顶部且不产生 NaN", () => {
    const result = createTerminalBufferSnapshot(
      buffer([line("screen")], { baseY: 0, viewportY: 0 })
    );

    expect(result.initialScrollRatio).toBe(0);
    expect(Number.isFinite(result.initialScrollRatio)).toBe(true);
  });
});
