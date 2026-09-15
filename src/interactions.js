/**
 * Vanilla-DOM overlay widgets shared across pages (SPEC §6.4 / SRS US-09~14):
 * the exclude bottom-sheet, the block-confirmation dialog, and the undo toast.
 * Each renders into a dedicated <div id="overlay-root"> every page must have.
 */

function overlayRoot() {
  let root = document.getElementById("overlay-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "overlay-root";
    document.body.appendChild(root);
  }
  return root;
}

function clearOverlay() {
  overlayRoot().innerHTML = "";
}

const ICON_EVENT = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 15l6-6M9 9h6v6"/></svg>`;
const ICON_ARTIST = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5"/></svg>`;
const ICON_TYPE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h7l2-3h4l2 3h3v13H3z"/><path d="M12 11v5"/></svg>`;
const ICON_CHEVRON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--muted)" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>`;
const ICON_UNDO = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 10a8 8 0 1 1 2 5"/><path d="M4 4v6h6"/></svg>`;

/**
 * @param {object} event
 * @param {{ onHideEvent(): void, onBlockArtist(): void, onBlockType(): void }} handlers
 */
export function openExcludeMenu(event, handlers) {
  const headliner = event.headliners[0] ?? event.title_raw;
  const type = event.tags_type[0];

  const html = `
    <div class="overlay-scrim" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div class="sheet-header__title">${escapeHtml(headliner)}</div>
        <div class="sheet-header__sub">${escapeHtml(event.date)} · ${escapeHtml(event.venue)}</div>
      </div>
      <button class="sheet-option" data-action="hide-event">
        <span class="sheet-option__icon">${ICON_EVENT}</span>
        <span class="sheet-option__label">只隱藏這一場</span>
        ${ICON_CHEVRON}
      </button>
      <button class="sheet-option" data-action="block-artist">
        <span class="sheet-option__icon sheet-option__icon--accent">${ICON_ARTIST}</span>
        <span class="sheet-option__label">封鎖此演出者：${escapeHtml(headliner)}</span>
        ${ICON_CHEVRON}
      </button>
      ${
        type
          ? `<button class="sheet-option" data-action="block-type">
              <span class="sheet-option__icon">${ICON_TYPE}</span>
              <span class="sheet-option__label">封鎖此類型：${escapeHtml(type)}</span>
              ${ICON_CHEVRON}
            </button>`
          : ""
      }
      <button class="btn-ghost" data-close style="margin:14px 22px 0;width:calc(100% - 44px);">取消</button>
    </div>
  `;

  overlayRoot().innerHTML = html;
  const root = overlayRoot();
  root.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", clearOverlay));
  root.querySelector('[data-action="hide-event"]')?.addEventListener("click", () => {
    clearOverlay();
    handlers.onHideEvent();
  });
  root.querySelector('[data-action="block-artist"]')?.addEventListener("click", () => {
    clearOverlay();
    handlers.onBlockArtist();
  });
  root.querySelector('[data-action="block-type"]')?.addEventListener("click", () => {
    clearOverlay();
    handlers.onBlockType();
  });
}

/** FR-48: shown before blocking an artist who has favorited events. */
export function confirmBlockArtist(artistName, favoritedCount, onConfirm) {
  const html = `
    <div class="overlay-scrim" data-close></div>
    <div class="dialog-box" role="dialog" aria-modal="true">
      <div class="dialog-box__title">封鎖此演出者？</div>
      <div class="dialog-box__body">
        「${escapeHtml(artistName)}」目前有 <b style="color:var(--text);">${favoritedCount} 場已收藏</b>的場次。封鎖後這些場次仍會照常顯示（收藏優先於排除規則），只是該演出者未來的其他新場次將不再出現。
      </div>
      <div style="display:flex;gap:10px;">
        <button class="btn-ghost" data-close style="flex:1;">取消</button>
        <button class="btn-primary" data-confirm style="flex:1;">仍要封鎖</button>
      </div>
    </div>
  `;
  overlayRoot().innerHTML = html;
  const root = overlayRoot();
  root.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", clearOverlay));
  root.querySelector("[data-confirm]")?.addEventListener("click", () => {
    clearOverlay();
    onConfirm();
  });
}

let toastTimer = null;

/** FR-45/US-12: 5-second undo toast. Calling this again replaces any toast still showing. */
export function showUndoToast(message, onUndo) {
  clearTimeout(toastTimer);
  const existing = document.getElementById("undo-toast");
  existing?.remove();

  const toast = document.createElement("div");
  toast.id = "undo-toast";
  toast.className = "toast";
  toast.innerHTML = `
    <div class="toast__row">
      <span>${escapeHtml(message)}</span>
      <button class="toast__undo">${ICON_UNDO}復原</button>
    </div>
    <div class="toast__bar"><div class="toast__bar-fill"></div></div>
  `;
  document.body.appendChild(toast);

  toast.querySelector(".toast__undo").addEventListener("click", () => {
    clearTimeout(toastTimer);
    toast.remove();
    onUndo();
  });

  toastTimer = setTimeout(() => toast.remove(), 5000);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
