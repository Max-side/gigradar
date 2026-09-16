# 交接文件 — 換電腦/換 session 接續開發前先看這份

寫於 2026-09-15，2026-09-16 更新至 M11 完成（過程中踩到一個真實的資料損毀事故，已經修好並在真實環境驗證過，見下方「M11 的重大發現」）。這份文件的目的：讓一個完全沒看過這個對話紀錄的人（包含未來的你，或另一台電腦上全新開的 Claude Code session）能在 5 分鐘內知道現在做到哪、能不能信任目前的程式碼、下一步該做什麼。

## 這是什麼專案

個人用的獨立/地下音樂演出雷達。**完整需求**看 [`GIGRADAR-SRS.md`](./GIGRADAR-SRS.md)，**技術架構與所有踩過的坑**看 [`GIGRADAR-SPEC.md`](./GIGRADAR-SPEC.md)——這兩份是唯一該信任的來源，這份 HANDOFF 只是導覽，內容有衝突以那兩份為準。

## 現在的狀態：M1~M11 完成，都在瀏覽器裡實測過，不是只寫完沒測（一個例外見下方 M9 那一列）；排程已重新打開並在真實 GitHub Actions 環境驗證過

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| M1 | 專案骨架、7 個頁面殼、`styles/tokens.css` 設計系統 | ✅ |
| M2 | KKTIX adapter（org 頁 + 全站搜尋兩種策略）＋ normalize | ✅ 實測抓到真實資料 |
| M3 | 拓元 adapter ＋ dedup 跨來源合併（含午/晚場不誤併） | ✅ 有單元測試 `scripts/dedup.test.mjs` |
| M4 | 時間表首頁讀真實 `data/events.json` 渲染 | ✅ |
| M5 | 收藏／排除規則／復原 toast／已隱藏管理頁 | ✅ |
| M6 | `diff.mjs` 產生 `digest.json`＋修正 `first_seen_at` 只在真的新事件才重設；新上架頁；順便把 FR-34「已更新」badge 接到收藏頁 | ✅ 有單元測試 `scripts/diff.test.mjs` |
| M7 | 手動新增場次實際存檔到 localStorage（決策 S1：不寫回 repo），跟 `events.json` 合併顯示，真的被抓到後自動去重 | ✅ 有跨環境雜湊一致性測試 `scripts/id-consistency.test.mjs` |
| M8 | 待整理頁讀真實 `data/needs-review.json`；「指派藝人」產生 YAML 片段供人工貼到 `artists.yml`（見下方說明，不是自動寫檔） | ✅ |
| M9 | Gist 同步（連接/斷開/雙向同步/離線 fallback）＋ FR-63/64 匯出匯入、設定頁的嚴格模式與靜音關鍵字順便一起接上 | ⚠️ 見下方說明 |
| M10 | 來源異常告警（GitHub issue）、設定頁來源狀態儀表、時間表異常 banner | ✅（真的開 issue 那段沒有跑過真實 CI，見下方說明） |
| M11 | GitHub Actions 排程上線 | ✅ 排程已重新打開，每天 08:00 CST 自動跑；過程中發現並修好一個真實的資料損毀問題，見下方「M11 的重大發現」 |
| M12 | 覆蓋率抽樣 | ❌ |

完整里程碑定義見 `GIGRADAR-SPEC.md` §11。

## 你打開這個 repo 應該先做的事

```bash
npm install          # cheerio, js-yaml 這些相依套件不會進 git
npm run serve         # 開本機伺服器
# 瀏覽器開 http://localhost:8000
```

想看爬蟲 pipeline 真的動起來：

```bash
npm run fetch          # 會打真的 KKTIX / 拓元網站，跑完會覆寫 data/*.json
npm test                # 跑全部單元測試（見下方「測試怎麼跑」）
```

⚠️ **`npm run fetch` 目前一定會讓 `data/events.json` 變回空的**——不是 bug，是因為 `data/artists.yml` 現在只有兩筆示範資料（深海系樂團、ABC Band），跟真實抓到的樂團名字對不上，所有場次都會被歸類到「待整理」而不是正式清單。如果你想在畫面上看到真的資料流動，兩個選項：
1. 打開 `data/needs-review.json` 看看今天抓到哪些真實藝人，挑幾個手動加進 `data/artists.yml`，再跑一次 `npm run fetch`。
2. 或直接把假資料寫進 `data/events.json` 測 UI（我在做 M4/M5 時就是這樣測的，格式照抄現有的 `events` 陣列結構就好，測完記得換回 `npm run fetch` 產生的真資料，不要把假資料 commit 上去）。

## 開發時踩過、別再踩一次的坑

1. **絕對不要在一個 `export async function fetch()` 的檔案裡呼叫裸的 `fetch(...)`**——會遮蔽全域 Fetch API，變成無窮遞迴呼叫自己（花了很久才抓出來）。一律用 `globalThis.fetch(...)`。見 `scripts/adapters/kktix.mjs` 開頭的註解。
2. **拓元 tixcraft 的活動詳情頁抓不到**——有 JS 反爬蟲挑戰，一般 fetch 會被擋（`{"response":"identify"}`）。目前拓元 adapter 只抓列表頁（標題/日期/場館，沒有價格）。這是刻意的取捨（見 SPEC D16），不是沒做完。
3. **本機測試用瀏覽器開發時，如果改了 `.js` 檔案但畫面沒反應**，通常是瀏覽器快取住舊的 module 檔案，換個 port（例如 `python3 -m http.server 8001`）重開就會抓到新的，比硬重整可靠。
4. **背景執行長時間指令時，Node 的 `console.log` 在 stdout 被導向檔案時是全緩衝的**，不會即時寫入，會看起來像卡住。要看即時進度得用 `fs.appendFileSync` 寫檔（`scripts/progress-log.mjs` 已經這樣做了，看 `fetch-progress.log`，這個檔案不會進 git）。
5. **前端 `fetch("./data/events.json")` 一定要加 `{ cache: "no-store" }`**——不加的話瀏覽器分頁開著、或同一個 session 內重複導覽，會一直吃到舊的快取版本，即使檔案內容已經在磁碟上更新了。M7 測「手動新增場次被真實抓到後應該消失」時就是被這個絆住，才發現這個問題，已經修在 `src/app.js` 的 `loadEvents()`。
6. **日期比較不要用 `new Date(dateStr) > new Date()`**——`new Date("2026-10-15")` 會被當成 UTC 午夜，跟本地/台灣時間的「現在」比較時，同一天的場次在某些時段會被誤判成「已過期」。`scripts/normalize.mjs` 的 `statusFromTickets` 和 `src/filter.js` 的 `isPast()` 都踩過這個坑，兩處都已經改成用日期字串（`YYYY-MM-DD`）直接比較，不要再改回 Date 物件比較。
7. **`normalize()`（或任何 per-item 的 pipeline 處理函式）處理陣列時一定要包 try/catch**——單一筆原始資料格式異常就丟例外的話，會讓整個 pipeline run 中斷，當天完全不會更新，而不是只把那一筆丟進待整理。`scripts/fetch.mjs` 已經修好，之後新增 per-item 處理邏輯要延續這個模式。

## M11 的重大發現：GitHub Actions 的 IP 會被來源網站部分擋掉（已修好）

2026-09-16 手動觸發了一次 `workflow_dispatch`（在真的 GitHub Actions 環境跑，不是本機），結果：
- **拓元直接 403**（`GET https://tixcraft.com/activity -> 403`）——`notify.mjs` 正確地自動開了 [issue #1](https://github.com/Max-side/gigradar/issues/1)，這不是誤判，是真的被擋。
- **KKTIX 的全站搜尋策略（4 個場館：Legacy Taipei/Taichung、Revolver、Clapper Studio）也全部 403**，只有 org 頁策略還抓得到東西。

最可能的原因：這兩個網站的反爬蟲機制會擋掉常見的雲端/機房 IP 段（GitHub Actions runner 的 IP 就是這種），但放行一般家用/公司網路的 IP——這正好解釋了為什麼本機一直測都正常，只有在 Actions 上才出事。這個封鎖本身**沒有解決**，往後每次排程執行拓元和 KKTIX 搜尋大概率都還是會失敗，這是要接受的現實，不是一次性的意外。

**造成的損害**：因為 `fetch.mjs` 當時來源失敗時不會沿用舊資料（SPEC §4.2 步驟 3 那個已知缺口，原本以為只是「還沒做」，這次證實是「真的會出事」），那次執行直接把 `needs-review.json` 的 79 筆真實資料洗成 4 筆，而且自動 commit 推上了 `main`。已經用 `git revert`（583fe35）復原。

**已經修好的部分**：新增 `scripts/source-fallback.mjs`——來源異常時，把上一輪屬於這個來源的 `events.json`/`needs-review.json` 資料重新餵回這輪的處理流程（而不是讓它們憑空消失），再讓 `dedupe()` 用同一套邏輯跟其他來源這輪抓到的新資料合併。**已經在真實 GitHub Actions 環境重跑一次驗證**：同樣的 403 又發生了，但這次 needs-review 維持在 79 筆，commit 只改了 6 行 metadata，不再洗掉真實資料（對照組：修好前 vs 修好後的兩次真實執行紀錄都在 [Actions 頁面](https://github.com/Max-side/gigradar/actions/workflows/daily-update.yml)上）。排程已經重新打開。

**這個 fallback 解決的是「不要洗掉資料」，不是「解決封鎖」本身**——拓元/KKTIX 搜尋策略只要一直被擋，`needs-review.json`/`events.json` 就會一直停在 2026-09-16 這批舊資料，不會有新場次進來，只是不會再變得比現在更差。如果之後想真的解決封鎖（換執行環境、代理、或接受混合模式改成本機手動跑那兩個來源），是下一個獨立的產品/架構決定，不算 M11 的範圍。

## M10 的告警：本機不會打 API，但已經在真實 GitHub Actions 上驗證過

`scripts/notify.mjs`（FR-14/AC-14，來源抓到 0 筆但上次 >0，或直接 fetch 失敗時開 GitHub issue）只在有 `GITHUB_TOKEN`＋`GITHUB_REPOSITORY` 環境變數時才會真的打 API，本機 `npm run fetch` 沒有這兩個變數，所以永遠是「印一行 log 就跳過」，這是刻意設計成不會擋住本機開發。已經驗證過的：
- `scripts/source-status.mjs`（純函式，決定 sources.json 每個來源的 `status`/`last_success`/`last_count` 該怎麼算）有完整單元測試，包含「連續兩天都抓到 0 筆要一直維持異常，不能第一天過後自己「痊癒」」這條容易漏掉的規則。
- 前端兩處讀 `sources.json` 的地方（時間表的異常 banner、設定頁的來源狀態儀表）都在瀏覽器裡塞了假的 `ok`/`anomaly`/`error` 三種狀態實測過，畫面正確。
- M11 實際觸發真實 GitHub Actions 執行時，`notify.mjs` 真的成功開了 [issue #1](https://github.com/Max-side/gigradar/issues/1)，第二次執行時也正確認出 issue 已存在、沒有重複開新的——這部分已經不是「沒測到」了，見下方「M11 的重大發現」。

## M9 沒有真的用 GitHub PAT 測過

沒有可以用的 real token，所以 Gist 同步的「連接→抓現有 gist 或建立新的→雙向同步」整條路徑**沒有打過真的 GitHub API**。已經在瀏覽器裡實測、行為正確的部分：
- 貼假的/失效的 token 按「連接同步」→ 收到 401 → 顯示失敗提示 → 本機的收藏/排除/靜音關鍵字/嚴格模式**完全沒被清空或覆蓋**（這是 AC-65 的負向測試，最重要的一條）。
- 沒連接時（`gist_id` 是 `null`），`reconcileGistSync()` 在每個頁面載入時是純同步的 early return，完全不會發網路請求——不會拖慢或弄壞現有頁面。
- FR-63 匯出／匯入：匯出時會即時抓 `localStorage` 目前的 prefs，模擬「換一台空白瀏覽器」匯入後 favorites/excluded_artists/excluded_types/mute_keywords/strict_mode 全部正確還原（AC-63）。

**沒測到的**：真的拿一組 GitHub PAT 連接、在兩台裝置間實際互推/互拉一次。如果你要驗證這塊，去 GitHub Settings → Developer settings → Personal access tokens 開一個只有 `gist` 權限的 token，貼到設定頁試連接；連上後第二台裝置貼**同一組 token**應該會自動找到同一個 gist（用 description 比對，見 `GIGRADAR-SPEC.md` §8 實作備註）。

## M8「指派藝人」為什麼不會真的寫 `artists.yml`

這是刻意的（SPEC §11 M8 那一列寫得很明白：「本機開發時手動 commit，非使用者操作」）。這個專案是純靜態前端（決策 D14），沒有後端可以接受寫檔請求，瀏覽器本身也不能直接改動 repo 裡的檔案。所以 `review.html` 的「指派藝人」按鈕做的事情是：跳出一個小表單（正式藝人名稱／別名／來源地），送出後產生一段格式跟 `data/artists.yml` 一致的 YAML 片段，顯示在可複製的文字框裡——由你自己貼進檔案、存檔、commit。按下「指派藝人」或「忽略」都會把該筆記錄從畫面上的待整理佇列裡移除（存在 `localStorage` 的 `gigradar:review_dismissed`，只影響這個瀏覽器，不會跨裝置同步，也不會改到 `needs-review.json` 本身——那個檔案要等下一次 `npm run fetch` 讀到更新後的 `artists.yml` 才會自然瘦身）。

## 測試怎麼跑

```bash
npm test    # 等同 node --test scripts/*.test.mjs src/*.test.js
```

目前 23 個測試全過。`scripts/*.test.mjs` 測 pipeline（dedup/normalize/diff/id 一致性），`src/*.test.js` 測前端純邏輯（目前只有 `filter.js`）——兩邊都用 Node 內建的 `node:test`，沒有額外測試框架依賴。新增前端純函式時比照 `src/filter.test.js` 加測試就好。

## 決策紀錄在哪裡

所有「為什麼這樣做」的決定都寫在 `GIGRADAR-SPEC.md` 對應章節，不要用猜的或憑記憶——尤其是：
- §5.1 KKTIX 兩種抓取策略（org 頁 vs 全站搜尋）的原因
- §5.3 拓元只抓列表頁不抓詳情頁的原因（D16）
- §7 手動新增場次為什麼只存 Gist 不寫回 repo（S1）
- §12 三個開發前拍板的決策（S1/S2/S3）

## 設計稿

見 `README.md` 裡的連結（Claude Design 畫布，跟帳號綁定，不是本機檔案）。

## 建議下一步

M12（覆蓋率抽樣）是最後一個里程碑。不過更值得優先做的是上面提到的「拓元/KKTIX 搜尋長期被 GitHub Actions 擋」這個根本問題還沒解——現在資料不會再被洗掉，但也不會有新資料流入這兩個來源，等於實質上停止更新。建議先做 M8 提到的「補幾筆 artists.yml」讓已經抓到的 4 筆 KKTIX org 頁資料能正常顯示，同時觀察排程接下來幾天的 `data/sources.json`，確認封鎖是不是每天都發生、還是偶發的，再決定要不要投入解決封鎖本身。
