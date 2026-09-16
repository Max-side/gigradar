/**
 * Shared entry point loaded by every page. Each page marks its own root
 * container with a data-page attribute; this file only acts on the ones it
 * knows how to render, so it's safe to load on every page unconditionally.
 *
 * M4: 時間表 (index.html) reads data/events.json for real.
 * M5: favorites + exclude rules (US-06~14) — star/✕ on cards, the exclude
 *   bottom-sheet, undo toast, block-confirmation dialog (FR-48), 已隱藏管理.
 * M6: 新上架 (new.html) reads first_seen_at (via diff.mjs's reconciliation in
 *   events.json) instead of a separate digest fetch — digest.json exists for
 *   the pipeline's own bookkeeping, but the frontend only needs what's
 *   already on each event. Also wires FR-34's "已更新" badge on favorites,
 *   now that diff.mjs actually sets updated_fields.
 * M7: 手動新增場次 (add.html) actually saves to localStorage and shows up
 *   everywhere else — loadEvents() merges in state.js's manual events,
 *   dropping any whose id a real scrape has since produced (AC-17).
 * M8 (current): 待整理頁 (review.html) reads data/needs-review.json for
 *   real. "指派藝人"/"忽略" never write artists.yml themselves (there's no
 *   backend to write to) — they generate a YAML snippet for the user to
 *   paste in by hand and commit, and locally dismiss the item from the queue.
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
  loadManualEvents,
  addManualEvent,
  loadReviewDismissed,
  dismissReviewItem,
} from "./state.js";
import { renderEventList, renderFavoritesList, renderNewArrivalsList, renderEmptyList } from "./render.js";
import { splitDate, daysSince } from "./format.js";
import {
  openExcludeMenu,
  confirmBlockArtist,
  showUndoToast,
  openAssignArtistDialog,
  showYamlSnippetDialog,
} from "./interactions.js";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadEvents() {
  // no-store: events.json is overwritten daily by the Actions job (SPEC §4.2);
  // without this, a browser tab left open — or even just repeat navigations
  // within the same session — can keep serving a stale cached copy (caught
  // during M7 testing: a newly-scraped event didn't replace its manual
  // stand-in until this was added).
  const res = await fetch("./data/events.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`GET data/events.json -> ${res.status}`);
  const data = await res.json();
  const realEvents = data.events ?? [];
  const realIds = new Set(realEvents.map((e) => e.id));
  // AC-17: once a real scrape produces a matching id, the manual copy is
  // dropped. Check every id a future scrape of this show could produce
  // (possible_real_ids), not just the manual event's own bare id — a show
  // that turns out to have both a matinee and evening real listing gets
  // bucket-suffixed ids from dedup.mjs that the manual copy must also match.
  const manualEvents = loadManualEvents().filter((e) => {
    const candidates = e.possible_real_ids ?? [e.id];
    return !candidates.some((id) => realIds.has(id));
  });
  return [...realEvents, ...manualEvents];
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

/** Only http(s) may be opened — escapeHtml stops attribute breakout, but never checked scheme, so a "javascript:" ticket_url (bad scrape, or an unvalidated manual entry) could otherwise execute on click. */
function isSafeUrl(url) {
  return /^https?:\/\//i.test(url);
}

function wireTicketButtons(container) {
  container.querySelectorAll("[data-ticket-url]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.dataset.ticketUrl;
      if (isSafeUrl(url)) window.open(url, "_blank", "noopener");
    });
  });
}

function wireFavoriteToggle(container, render) {
  container.querySelectorAll("[data-favorite-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleFavorite(btn.dataset.favoriteToggle);
      render();
    });
  });
}

/** Shared by 時間表 and 新上架 — both show the full ✕ exclude menu on cards. */
function wireExcludeMenu(container, events, render) {
  container.querySelectorAll("[data-exclude-menu]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const event = events.find((e) => e.id === btn.dataset.excludeMenu);
      if (event) openMenuFor(event, events, render);
    });
  });
}

function openMenuFor(event, events, render) {
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

    wireTicketButtons(container);
    wireFavoriteToggle(container, render);
    wireExcludeMenu(container, events, render);
    updateHiddenBar(hiddenByRules);
  }

  render();
}

async function initNewArrivals(container) {
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

    const withAge = visible
      .map((item) => ({ ...item, ageDays: daysSince(item.event.first_seen_at) }))
      .filter((item) => item.ageDays <= 7);
    withAge.sort((a, b) => a.ageDays - b.ageDays);

    const today = withAge.filter((item) => item.ageDays <= 0);
    const pastWeek = withAge.filter((item) => item.ageDays > 0);

    const summary = document.getElementById("new-summary");
    if (summary) summary.textContent = `今日新增 ${today.length} 筆 · 近 7 日共 ${withAge.length} 筆`;

    container.innerHTML =
      withAge.length === 0
        ? renderEmptyList("最近 7 天沒有新場次公布。")
        : renderNewArrivalsList(today, pastWeek);

    wireTicketButtons(container);
    wireFavoriteToggle(container, render);
    wireExcludeMenu(container, events, render);
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

    wireTicketButtons(container);
    wireFavoriteToggle(container, render);

    container.querySelectorAll("[data-updated-fields]").forEach((link) => {
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        alert(`更新內容：${link.dataset.updatedFields}`);
      });
    });
  }

  render();
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

function reviewReasonLabel(reason) {
  if (reason === "artist_unrecognized") return "無法辨識藝人是否已建檔";
  if (reason === "normalize_error") return "解析失敗（欄位格式異常）";
  return reason;
}

function yamlEntryFor({ canonical, aliases, tagsOrigin }) {
  const aliasList = aliases.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(", ");
  return `- canonical: ${canonical}\n  aliases: [${aliasList}]\n  tags_origin_default: ${tagsOrigin}`;
}

/** M8 (FR-16/61, US-16): 待整理頁 reads the real needs-review.json queue. */
async function initReview(container) {
  let items;
  try {
    const res = await fetch("./data/needs-review.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`GET data/needs-review.json -> ${res.status}`);
    const data = await res.json();
    items = data.items ?? [];
  } catch (err) {
    console.error("Failed to load needs-review.json:", err);
    container.innerHTML = renderEmptyList("資料載入失敗，請稍後再試。");
    return;
  }

  function render() {
    const dismissed = new Set(loadReviewDismissed());
    const pending = items.filter((item) => !dismissed.has(item.raw_id));

    const heading = document.getElementById("review-heading");
    if (heading) heading.textContent = `未識別藝人／日期（${pending.length}）`;

    container.innerHTML =
      pending.length === 0
        ? renderEmptyList("目前沒有待整理的場次，做得好。")
        : pending
            .map(
              (item, i) => `
        <div class="card">
          <div style="font-size:12px;color:var(--muted);font-family:ui-monospace,monospace;background:var(--surface-2);border-radius:10px;padding:9px 11px;">
            原始標題：「${escapeHtml(item.title_raw ?? "（無標題）")}」
          </div>
          <div style="font-size:11px;color:var(--muted);">
            來源：${escapeHtml(item.source)}　問題：${escapeHtml(reviewReasonLabel(item.reason))}${item.detail ? `（${escapeHtml(item.detail)}）` : ""}
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn-dark" style="flex:1;padding:9px;font-size:12px;" data-assign="${i}">指派藝人</button>
            <button class="btn-ghost" style="flex:1;padding:9px;font-size:12px;" data-ignore="${i}">忽略</button>
          </div>
        </div>
      `
            )
            .join("");

    container.querySelectorAll("[data-assign]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = pending[Number(btn.dataset.assign)];
        openAssignArtistDialog(item, (fields) => {
          showYamlSnippetDialog(yamlEntryFor(fields));
          dismissReviewItem(item.raw_id);
          render();
        });
      });
    });
    container.querySelectorAll("[data-ignore]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = pending[Number(btn.dataset.ignore)];
        dismissReviewItem(item.raw_id);
        render();
      });
    });
  }

  render();
}

function wireChipGroup(group) {
  group.querySelectorAll(".chip-selectable").forEach((chip) => {
    chip.addEventListener("click", () => {
      const pressed = chip.getAttribute("aria-pressed") === "true";
      chip.setAttribute("aria-pressed", pressed ? "false" : "true");
    });
  });
}

function selectedChips(group) {
  return Array.from(group.querySelectorAll('.chip-selectable[aria-pressed="true"]')).map((c) => c.textContent.trim());
}

function initManualAdd(form) {
  document.querySelectorAll("[data-chip-group]").forEach(wireChipGroup);

  const headlinerField = document.getElementById("f-headliner");
  const addCoartistBtn = document.getElementById("add-coartist");
  const coArtistInputs = [];

  addCoartistBtn?.addEventListener("click", () => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;align-items:center;";
    const input = document.createElement("input");
    input.className = "field-input";
    input.type = "text";
    input.placeholder = "共演者名稱";
    input.style.flex = "1";
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "✕";
    removeBtn.style.cssText = "flex:0 0 auto;border:none;background:transparent;color:var(--muted);font-size:14px;";
    removeBtn.addEventListener("click", () => {
      row.remove();
      const idx = coArtistInputs.indexOf(input);
      if (idx !== -1) coArtistInputs.splice(idx, 1);
    });
    row.append(input, removeBtn);
    addCoartistBtn.before(row);
    coArtistInputs.push(input);
    input.focus();
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const ticketUrl = document.getElementById("f-url").value.trim();
      if (ticketUrl && !isSafeUrl(ticketUrl)) {
        alert("售票／資訊連結必須是 http:// 或 https:// 開頭的網址。");
        submitBtn.disabled = false;
        return;
      }

      const headliners = [headlinerField.value.trim(), ...coArtistInputs.map((i) => i.value.trim())].filter(Boolean);
      await addManualEvent({
        date: document.getElementById("f-date").value,
        time: document.getElementById("f-time").value || null,
        headliners,
        venue: document.getElementById("f-venue").value.trim(),
        city: document.getElementById("f-city").value.trim(),
        ticketUrl,
        tagsType: selectedChips(document.querySelector('[data-chip-group="tags_type"]')),
        tagsOrigin: selectedChips(document.querySelector('[data-chip-group="tags_origin"]')),
        note: document.getElementById("f-note").value.trim(),
      });
      window.location.href = "./index.html";
    } catch (err) {
      console.error("Failed to save manual event:", err);
      alert("儲存失敗，請再試一次。");
      submitBtn.disabled = false;
    }
  });
}

const timelineContainer = document.querySelector('[data-page="timeline"]');
if (timelineContainer) {
  initTimeline(timelineContainer);
}

const newArrivalsContainer = document.querySelector('[data-page="new-arrivals"]');
if (newArrivalsContainer) {
  initNewArrivals(newArrivalsContainer);
}

const favoritesContainer = document.querySelector('[data-page="favorites"]');
if (favoritesContainer) {
  initFavorites(favoritesContainer);
}

const hiddenContainer = document.querySelector('[data-page="hidden"]');
if (hiddenContainer) {
  initHiddenManagement(hiddenContainer);
}

const addForm = document.getElementById("add-form");
if (addForm) {
  initManualAdd(addForm);
}

const reviewContainer = document.querySelector('[data-page="review"]');
if (reviewContainer) {
  initReview(reviewContainer);
}
