/**
 * theme——CM6 主题（接收区 darkTheme / 发送区 sendTheme）：颜色全走 CSS 变量，切主题自动响应。
 * 判据：类名 → token 名**逐条**（硬约束 1：禁硬编码 hex）；darkTheme 带 dark 旗标、sendTheme 不带；
 *      全部颜色声明必须落在 `var(--…)` 或 `color-mix(…)` 上。
 *
 * ⚠️ 反射断言口径：不建真视口、不碰 DOM——`EditorView.theme()` 返回的是
 *    [前缀 facet, StyleModule, (dark 旗标)]，本测试直接读 StyleModule 的 `getRules()`
 *    拿到**即将注入的 CSS 文本**（真视图注入的就是它）。
 */
import { describe, it, expect } from "vitest";
import { darkTheme, sendTheme } from "../cm6/theme";

type Provider = { value?: unknown };

/** 从主题扩展里取出 CSS 文本（StyleModule.getRules()） */
function cssOf(theme: unknown): string {
  const providers = Array.isArray(theme) ? (theme as Provider[]) : [theme as Provider];
  const styleModule = providers
    .map((p) => p.value)
    .find((v): v is { getRules: () => string } => typeof (v as { getRules?: unknown })?.getRules === "function");
  if (!styleModule) throw new Error("主题扩展里没有 StyleModule——CM6 主题形态变了");
  return styleModule.getRules();
}

type Rule = { selector: string; body: string };

function rulesOf(css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2].trim() }));
}

/** 按「选择器末段」精确匹配——⛔ 不能用 includes：`.cm-activeLine` 是 `.cm-activeLineGutter` 的子串，
 *  子串匹配会串到隔壁规则上（CM6 注入的选择器带 `.ͼX ` 前缀，故取「末段结尾相等」而不是全等）。 */
function ruleMatching(css: string, classSuffix: string): Rule | undefined {
  return rulesOf(css).find((r) =>
    r.selector
      .split(",")
      .map((s) => s.trim())
      .some((s) => s.endsWith(classSuffix))
  );
}

/** 颜色类声明（值必须走 token / color-mix） */
const COLOR_PROP = /^(background|color|border|border-?[a-z-]*|outline|outline-?[a-z-]*|fill|stroke)/;

describe("darkTheme（接收区：主栏 + HEX 栏共用）", () => {
  const css = cssOf(darkTheme);

  it("带 dark 旗标（CM6 内置暗色规则靠它生效）", () => {
    expect(Array.isArray(darkTheme)).toBe(true);
    const providers = darkTheme as Provider[];
    expect(providers).toHaveLength(3);
    expect(providers[2].value).toBe(true);
  });

  it("根节点：背景与文字都走 token", () => {
    const root = rulesOf(css).find((r) => /^\.[^\s{]+$/.test(r.selector));
    expect(root).toBeDefined();
    expect(root!.body).toContain("var(--bg-card)");
    expect(root!.body).toContain("var(--text-primary)");
  });

  it("逐条：类名 → token 名对齐（改错任一条都会红）", () => {
    const expectations: Array<[string, string]> = [
      [".cm-gutters", "var(--bg-window)"],
      [".cm-gutters", "var(--separator)"],
      [".cm-gutters", "var(--text-muted)"],
      [".cm-activeLineGutter", "var(--bg-card)"],
      [".cm-activeLine", "var(--text-primary)"],
      [".cm-cursor", "var(--text-primary)"],
      [".cm-selectionBackground", "var(--accent)"],
      [".cm-selectionMatch", "var(--accent)"],
      [".cm-searchMatch", "var(--warning)"],
      [".cm-line-sent", "var(--sent-echo)"],
      [".cm-line-system", "var(--system-log)"],
      [".cm-timestamp", "var(--cm-timestamp"],
      [".cm-timestamp", "var(--text-muted)"],
      [".cm-search-match", "var(--warning)"],
      [".cm-search-current", "var(--warning)"],
    ];

    for (const [selector, token] of expectations) {
      const rule = ruleMatching(css, selector);
      expect(rule, `缺少规则 ${selector}`).toBeDefined();
      expect(rule!.body, `${selector} 未走 ${token}`).toContain(token);
    }
  });

  it("三色行类名齐备（received 走默认文字色，故只有 sent/system 两条规则）", () => {
    expect(ruleMatching(css, ".cm-line-sent")).toBeDefined();
    expect(ruleMatching(css, ".cm-line-system")).toBeDefined();
    expect(ruleMatching(css, ".cm-line-received")).toBeUndefined();
  });

  it("搜索两套类名都在（CM6 原生 cm-searchMatch 与自绘 cm-search-match/cm-search-current）", () => {
    expect(ruleMatching(css, ".cm-searchMatch")).toBeDefined();
    expect(ruleMatching(css, ".cm-search-match")).toBeDefined();
    expect(ruleMatching(css, ".cm-search-current")).toBeDefined();
  });
});

describe("sendTheme（发送区专用）", () => {
  const css = cssOf(sendTheme);

  it("不带 dark 旗标（避免与 CM6 内置暗色主题注入冲突）", () => {
    expect(Array.isArray(sendTheme)).toBe(true);
    expect(sendTheme as Provider[]).toHaveLength(2);
  });

  it("逐条：类名 → token 名对齐", () => {
    const expectations: Array<[string, string]> = [
      [".cm-cursor", "var(--text-primary)"],
      [".cm-activeLine", "var(--text-primary)"],
      [".cm-selectionBackground", "var(--accent)"],
    ];

    for (const [selector, token] of expectations) {
      const rule = ruleMatching(css, selector);
      expect(rule, `缺少规则 ${selector}`).toBeDefined();
      expect(rule!.body, `${selector} 未走 ${token}`).toContain(token);
    }
  });

  it("光标用 borderLeft 简写（宽度/样式/颜色齐全——只给颜色会丢光标）", () => {
    const rule = ruleMatching(css, ".cm-cursor");
    expect(rule).toBeDefined();
    expect(rule!.selector).toContain(".cm-cursor-primary");
    expect(rule!.body).toMatch(/border-left:\s*2px solid var\(--text-primary\)/);
    expect(rule!.body).toMatch(/margin-left:\s*-1px/);
  });
});

describe("两个主题共同的硬约束", () => {
  for (const [name, theme] of [["darkTheme", darkTheme], ["sendTheme", sendTheme]] as const) {
    it(`${name}：全部颜色声明走 var() / color-mix()——无裸色值（硬约束 1）`, () => {
      const css = cssOf(theme);
      const decls = [...css.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((m) => ({ prop: m[1], value: m[2].trim() }));
      const colorDecls = decls.filter((d) => COLOR_PROP.test(d.prop));

      expect(colorDecls.length).toBeGreaterThan(0);
      for (const d of colorDecls) {
        expect(d.value, `${d.prop}: ${d.value} 未走 token`).toMatch(/var\(--|color-mix\(/);
      }
    });

    it(`${name}：CSS 文本里没有 hex / rgb / hsl 字面量`, () => {
      const css = cssOf(theme);

      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css).not.toMatch(/\brgba?\(/);
      expect(css).not.toMatch(/\bhsla?\(/);
    });
  }
});
