import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMonthGrid, addMonths } from "./calendar.js";

test("buildMonthGrid: September 2026 starts on Tuesday, padded with leading/trailing nulls to full weeks", () => {
  const weeks = buildMonthGrid(2026, 9);
  assert.equal(weeks[0][0], null); // Sunday
  assert.equal(weeks[0][1], null); // Monday
  assert.deepEqual(weeks[0][2], { day: 1, date: "2026-09-01" }); // Tuesday, the 1st
  assert.equal(weeks[0].length, 7);
  weeks.forEach((week) => assert.equal(week.length, 7));
  // 30 days in September, ends on a Wednesday (2026-09-30) — last real cell.
  const flat = weeks.flat();
  const lastReal = [...flat].reverse().find((c) => c !== null);
  assert.deepEqual(lastReal, { day: 30, date: "2026-09-30" });
});

test("buildMonthGrid: February in a non-leap year has 28 days", () => {
  const weeks = buildMonthGrid(2026, 2);
  const flat = weeks.flat().filter(Boolean);
  assert.equal(flat.length, 28);
  assert.equal(flat[flat.length - 1].date, "2026-02-28");
});

test("addMonths: steps forward within a year", () => {
  assert.deepEqual(addMonths(2026, 9, 1), { year: 2026, month: 10 });
});

test("addMonths: wraps forward across a year boundary", () => {
  assert.deepEqual(addMonths(2026, 12, 1), { year: 2027, month: 1 });
});

test("addMonths: wraps backward across a year boundary", () => {
  assert.deepEqual(addMonths(2026, 1, -1), { year: 2025, month: 12 });
});
