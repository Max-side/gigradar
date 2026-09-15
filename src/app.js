/**
 * Shared entry point loaded by every page. Each page marks its own root
 * container with a data-page attribute; this file only acts on the ones it
 * knows how to render, so it's safe to load on every page unconditionally.
 *
 * M4: 時間表 (index.html) reads data/events.json for real.
 * M5 (current): favorites + exclude rules (US-06~14) wired on top of that —
 *   star/✕ buttons on cards, the exclude bottom-sheet, undo toast, and the
 *   block-confirmation dialog for artists with favorited events (FR-48).
 * M6 will add: new.html reading data/digest.json.
 */

import { partitionEvents } from "./filter.js";
import {
  loadPrefs,
  toggleFavorite,
  excludeEvent,
  unexcludeEvent,
  excludeArtist,
  unexcludeArtist,
  excludeType,
  unexcludeType,
  countFavoritedByArtist,
  countHiddenByArtist,
  countHiddenByType,
} from "./state.js";
import { renderEventList, renderFavoritesList, renderEmptyList } from "./render.js";
import { splitDate } from "./format.js";
import { openExcludeMenu, confirmBlockArtist, showUndoToast } from "./interactions.js";

async function loadEvents() {
  const res = await fetch("./data/events.json");
  if (!res.ok) throw new Error(`GET data/events.json -> ${res.status}`);
  const data = await res.json();
  return data.events ?? [];
}

function groupByDate(items) {
  const groups = [];
  for (const item of items) {
    const { groupLabel } = splitDate(item.event.date);
    let group = groups.find((g) => g.dateLabel === groupLabel);
    if (!group) {
      group = { dateLabel: groupLabel, cards: [] };
      groups.push(group);
    }
    group.cards.push(item);
  }
  return groups;
}

function updateHiddenBar(hiddenByRules) {
  const bar = document.getElementById("hidden-bar");
  const count = document.getElementById("hidden-count");
  if (!bar || !count) return;
  if (hiddenByRules > 0) {
    count.textContent = String(hiddenByRules);
    bar.hidden = false;
  } else {
    bar.hidden = true;
  }
}

async function initTimeline(container) {
  let events;
  try {
    events = await loadEvents();
  } catch (err) {
    console.error("Failed to load events.json:", err);
    container.innerHTML = renderEmptyList("資料載入失敗，請稍後再試。");
    return;
  }

  function render() {
    const prefs = loadPrefs();
    const { visible, hiddenByRules } = partitionEvents(events, prefs, {});

    visible.sort((a, b) => {
      if (a.event.date !== b.event.date) return a.event.date < b.event.date ? -1 : 1;
      return (a.event.time ?? "99:99").localeCompare(b.event.time ?? "99:99");
    });

    container.innerHTML =
      visible.length === 0
        ? renderEmptyList("目前沒有符合條件的演出，明天再回來看看。")
        : renderEventList(groupByDate(visible));

    wireCardActions();
    updateHiddenBar(hiddenByRules);
  }

  function wireCardActions() {
    container.querySelectorAll("[data-ticket-url]").forEach((btn) => {
      btn.addEventListener("click", () => window.open(btn.dataset.ticketUrl, "_blank", "noopener"));
    });

    container.querySelectorAll("[data-favorite-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        toggleFavorite(btn.dataset.favoriteToggle);
        render();
      });
    });

    container.querySelectorAll("[data-exclude-menu]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const event = events.find((e) => e.id === btn.dataset.excludeMenu);
        if (event) openMenuFor(event);
      });
    });
  }

  function openMenuFor(event) {
    const headliner = event.headliners[0] ?? event.title_raw;
    const type = event.tags_type[0];

    openExcludeMenu(event, {
      onHideEvent() {
        excludeEvent(event.id);
        render();
        showUndoToast(`已排除「${headliner}」`, () => {
          unexcludeEvent(event.id);
          render();
        });
      },
      onBlockArtist() {
        const doBlock = () => {
          excludeArtist(headliner);
          render();
          showUndoToast(`已封鎖演出者「${headliner}」`, () => {
            unexcludeArtist(headliner);
            render();
          });
        };
        const prefs = loadPrefs();
        const favoritedCount = countFavoritedByArtist(headliner, events, prefs);
        if (favoritedCount > 0) {
          confirmBlockArtist(headliner, favoritedCount, doBlock);
        } else {
          doBlock();
        }
      },
      onBlockType() {
        if (!type) return;
        excludeType(type);
        render();
        showUndoToast(`已封鎖類型「${type}」`, () => {
          unexcludeType(type);
          render();
        });
      },
    });
  }

  render();
}

async function initFavorites(container) {
  let events;
  try {
    events = await loadEvents();
  } catch (err) {
    console.error("Failed to load events.json:", err);
    container.innerHTML = renderEmptyList("資料載入失敗，請稍後再試。");
    return;
  }

  function render() {
    const prefs = loadPrefs();
    const { visible } = partitionEvents(events, prefs, {});
    const favorited = visible.filter((item) => item.pinned).map((item) => item.event);
    favorited.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const summary = document.getElementById("fav-summary");
    if (summary) summary.textContent = `共 ${favorited.length} 場 · 依日期排序`;

    container.innerHTML =
      favorited.length === 0
        ? renderEmptyList("還沒有收藏任何場次，去時間表逛逛吧。")
        : renderFavoritesList(favorited);

    container.querySelectorAll("[data-ticket-url]").forEach((btn) => {
      btn.addEventListener("click", () => window.open(btn.dataset.ticketUrl, "_blank", "noopener"));
    });
    container.querySelectorAll("[data-favorite-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        toggleFavorite(btn.dataset.favoriteToggle);
        render();
      });
    });
  }

  render();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function initHiddenManagement(container) {
  let events;
  try {
    events = await loadEvents();
  } catch (err) {
    console.error("Failed to load events.json:", err);
    container.innerHTML = renderEmptyList("資料載入失敗，請稍後再試。");
    return;
  }

  function render() {
    const prefs = loadPrefs();
    const rules = [];

    for (const name of prefs.excluded_artists) {
      rules.push({
        kind: "artist",
        label: "演出者",
        title: name,
        count: countHiddenByArtist(name, events, prefs),
        unhide: () => {
          unexcludeArtist(name);
          render();
        },
      });
    }
    for (const tag of prefs.excluded_types) {
      rules.push({
        kind: "type",
        label: "類型",
        title: tag,
        count: countHiddenByType(tag, events, prefs),
        unhide: () => {
          unexcludeType(tag);
          render();
        },
      });
    }
    for (const eventId of prefs.excluded_events) {
      const event = events.find((e) => e.id === eventId);
      rules.push({
        kind: "event",
        label: "單場次",
        title: event ? event.headliners.join(" / ") : eventId,
        count: 1,
        note: "不影響同演出者其他場次",
        unhide: () => {
          unexcludeEvent(eventId);
          render();
        },
      });
    }

    const totalHidden = rules.reduce((sum, r) => sum + r.count, 0);
    const summary = document.getElementById("rule-summary");
    if (summary) summary.textContent = `共 ${rules.length} 條規則 · 隱藏 ${totalHidden} 場未來場次`;

    container.innerHTML =
      rules.length === 0
        ? renderEmptyList("目前沒有任何排除規則。")
        : rules
            .map(
              (r, i) => `
        <div class="card" style="flex-direction:row;align-items:center;justify-content:space-between;">
          <div style="display:flex;flex-direction:column;gap:5px;min-width:0;">
            <span class="tag-perf" style="align-self:flex-start;">${escapeHtml(r.label)}</span>
            <div class="event-title" style="font-size:15px;">${r.kind === "artist" ? "封鎖：" : r.kind === "event" ? "隱藏：" : "封鎖類型："}${escapeHtml(r.title)}</div>
            <div style="font-size:12px;color:var(--muted);font-weight:700;">隱藏 ${r.count} 場未來場次${r.note ? `（${escapeHtml(r.note)}）` : ""}</div>
          </div>
          <button class="btn-dark" style="padding:9px 16px;font-size:12px;flex:0 0 auto;" data-unhide-index="${i}">解除</button>
        </div>
      `
            )
            .join("");

    container.querySelectorAll("[data-unhide-index]").forEach((btn) => {
      btn.addEventListener("click", () => rules[Number(btn.dataset.unhideIndex)].unhide());
    });
  }

  render();
}

const timelineContainer = document.querySelector('[data-page="timeline"]');
if (timelineContainer) {
  initTimeline(timelineContainer);
}

const favoritesContainer = document.querySelector('[data-page="favorites"]');
if (favoritesContainer) {
  initFavorites(favoritesContainer);
}

const hiddenContainer = document.querySelector('[data-page="hidden"]');
if (hiddenContainer) {
  initHiddenManagement(hiddenContainer);
}
