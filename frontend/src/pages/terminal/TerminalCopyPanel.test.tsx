import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TerminalCopyPanel } from "./TerminalCopyPanel";

const t = (zh: string) => zh;

describe("TerminalCopyPanel", () => {
  it("以只读原生文本区展示终端快照和复制操作", () => {
    const markup = renderToStaticMarkup(
      <TerminalCopyPanel
        snapshot={{ text: "第一行\nsecond line", loadedLines: 2, truncated: false, initialScrollRatio: 0 }}
        isDark
        t={t}
        onCopy={async () => true}
        onClose={() => undefined}
      />
    );

    expect(markup).toContain("readonly=\"\"");
    expect(markup).toContain("第一行\nsecond line");
    expect(markup).toContain("复制所选");
    expect(markup).toContain("复制全部");
    expect(markup).toContain("aria-label=\"关闭选择复制\"");
    expect(markup).toContain("min-h-11");
  });

  it("在快照被限制时明确展示最近输出范围", () => {
    const markup = renderToStaticMarkup(
      <TerminalCopyPanel
        snapshot={{ text: "latest", loadedLines: 10000, truncated: true, initialScrollRatio: 0 }}
        isDark={false}
        t={t}
        onCopy={async () => true}
        onClose={() => undefined}
      />
    );

    expect(markup).toContain("最近 10000 行");
    expect(markup).toContain("已截断");
  });

  it("空快照禁用两个复制按钮", () => {
    const markup = renderToStaticMarkup(
      <TerminalCopyPanel
        snapshot={{ text: "", loadedLines: 0, truncated: false, initialScrollRatio: 0 }}
        isDark
        t={t}
        onCopy={async () => true}
        onClose={() => undefined}
      />
    );

    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).toContain("暂无可复制的终端输出");
  });
});
