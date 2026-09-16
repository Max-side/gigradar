import { test } from "node:test";
import assert from "node:assert/strict";
import { isPast, partitionEvents } from "./filter.js";

function makeEvent(overrides = {}) {
  return {
    id: "a",
    headliners: ["Test Artist"],
    lineup: ["Test Artist"],
    date: "2026-10-15",
    time: "19:30",
    tags_type: [],
    title_raw: "Test Event",
    ...overrides,
  };
}

function defaultPrefs(overrides = {}) {
  return {
    favorites: [],
    excluded_events: [],
    excluded_artists: [],
    excluded_types: [],
    mute_keywords: [],
    strict_mode: false,
    ...overrides,
  };
}

test("isPast fix: today's own date is never past, regardless of time-of-day the check runs", () => {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  assert.equal(isPast(todayStr), false);
});

test("isPast: yesterday is past, tomorrow is not", () => {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  assert.equal(isPast(fmt(yesterday)), true);
  assert.equal(isPast(fmt(tomorrow)), false);
});

test("partitionEvents: a today-dated event is not silently bucketed as ended", () => {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const event = makeEvent({ date: todayStr });

  const { visible, ended } = partitionEvents([event], defaultPrefs());

  assert.equal(ended.length, 0);
  assert.equal(visible.length, 1);
});
