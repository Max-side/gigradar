import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySourceRun } from "./source-status.mjs";

test("AC-11: a failed run keeps the previous last_success/last_count instead of nulling them out", () => {
  const previous = { last_success: "2026-09-10T00:00:00Z", last_count: 42 };
  const { entry, anomaly } = classifySourceRun("KKTIX", { error: "timeout", rawCount: 0 }, previous);

  assert.equal(entry.status, "error");
  assert.equal(entry.last_success, "2026-09-10T00:00:00Z", "must keep the last known-good success time");
  assert.equal(entry.last_count, 42, "must keep the last known-good count");
  assert.equal(entry.last_error, "timeout");
  assert.deepEqual(anomaly, { reason: "error", detail: "timeout", lastCount: 42 });
});

test("AC-14/R1: 0 results right after a previous run had some is flagged as an anomaly, not a healthy 0-count day", () => {
  const previous = { last_success: "2026-09-15T00:00:00Z", last_count: 42 };
  const { entry, anomaly } = classifySourceRun("拓元", { error: null, rawCount: 0 }, previous);

  assert.equal(entry.status, "anomaly");
  assert.equal(entry.last_count, 42, "keeps the old count instead of resetting to 0");
  assert.equal(entry.last_error, null);
  assert.ok(entry.last_success, "still records that the request itself succeeded");
  assert.deepEqual(anomaly, { reason: "anomaly", detail: "抓到 0 筆，上次成功 42 筆", lastCount: 42 });
});

test("anomaly stays flagged on a second consecutive 0-count day (doesn't self-heal after one run)", () => {
  const afterFirstAnomaly = { last_success: "2026-09-16T00:00:00Z", last_count: 42, status: "anomaly" };
  const { entry, anomaly } = classifySourceRun("拓元", { error: null, rawCount: 0 }, afterFirstAnomaly);

  assert.equal(entry.status, "anomaly");
  assert.ok(anomaly, "must still notify on the second broken day, not just the first");
});

test("0 results with no previous count (first-ever run, or previous run was also 0) is NOT an anomaly", () => {
  const { entry, anomaly } = classifySourceRun("manual", { error: null, rawCount: 0 }, undefined);

  assert.equal(entry.status, "ok");
  assert.equal(anomaly, null);
});

test("a normal successful run with results reports ok and updates last_count", () => {
  const previous = { last_success: "2026-09-15T00:00:00Z", last_count: 40 };
  const { entry, anomaly } = classifySourceRun("KKTIX", { error: null, rawCount: 45 }, previous);

  assert.equal(entry.status, "ok");
  assert.equal(entry.last_count, 45);
  assert.equal(entry.last_error, null);
  assert.equal(anomaly, null);
});
