import { describe, it, expect } from "vitest";
import { parse } from "../src/deadline.js";

// deadline_parser 单测（test_parser.py 的 TS 移植：Python 版 13 用例 + 时刻点 11 用例）
// 固定 now=2026-08-28（周五），全部断言确定性。

const NOW = new Date(2026, 7, 28, 10, 0);        // 周五 10:00
const NOW_PM = new Date(2026, 7, 28, 13, 0);

const dayEnd = (m: number, d: number) => new Date(2026, m - 1, d, 23, 59);
const at = (m: number, d: number, h: number, mi: number) => new Date(2026, m - 1, d, h, mi);

describe("日期词（Python 版 13 用例回归）", () => {
  it("今天/明天/大后天", () => {
    expect(parse("今天", NOW)).toEqual(dayEnd(8, 28));
    expect(parse("明天", NOW)).toEqual(dayEnd(8, 29));
    expect(parse("大后天", NOW)).toEqual(dayEnd(8, 31));
  });
  it("N天后", () => expect(parse("3天后", NOW)).toEqual(dayEnd(8, 31)));
  it("下周一/下周日", () => {
    expect(parse("下周一", NOW)).toEqual(dayEnd(8, 31));
    expect(parse("下周日", NOW)).toEqual(dayEnd(9, 6));
  });
  it("周X：同日指今天；未来取最近", () => {
    expect(parse("周五", NOW)).toEqual(dayEnd(8, 28));
    expect(parse("周日", NOW)).toEqual(dayEnd(8, 30));
  });
  it("X号：本月/已过滚次月/31号", () => {
    expect(parse("31号", NOW)).toEqual(dayEnd(8, 31));
    expect(parse("5号", NOW)).toEqual(dayEnd(9, 5));
  });
  it("月底 + 后缀剥离", () => {
    expect(parse("月底", NOW)).toEqual(dayEnd(8, 31));
    expect(parse("周五前", NOW)).toEqual(parse("周五", NOW));
  });
  it("非法输入返回 null", () => {
    expect(parse("尽快", NOW)).toBeNull();
    expect(parse("", NOW)).toBeNull();
    expect(parse(null, NOW)).toBeNull();
  });
});

describe("时刻点（时刻点Deadline解析Spec）", () => {
  it("纯时刻点：未来今天，已过明天", () => {
    expect(parse("12点56分", NOW)).toEqual(at(8, 28, 12, 56));
    expect(parse("12点56分", NOW_PM)).toEqual(at(8, 29, 12, 56));
  });
  it("半点/冒号/时段折算", () => {
    expect(parse("12点半", NOW)).toEqual(at(8, 28, 12, 30));
    expect(parse("14:30", NOW)).toEqual(at(8, 28, 14, 30));
    expect(parse("下午3点", NOW)).toEqual(at(8, 28, 15, 0));
    expect(parse("晚上8点半", NOW)).toEqual(at(8, 28, 20, 30));
  });
  it("日期+时刻组合", () => {
    expect(parse("明天下午3点", NOW)).toEqual(at(8, 29, 15, 0));
    expect(parse("周五下午2点前", NOW)).toEqual(at(8, 28, 14, 0));
    expect(parse("31号上午10点", NOW)).toEqual(at(8, 31, 10, 0));
    expect(parse("今晚8点", NOW)).toEqual(at(8, 28, 20, 0));
  });
  it("非法时刻回退", () => {
    expect(parse("25点", NOW)).toBeNull();
  });
});
