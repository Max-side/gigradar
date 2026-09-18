# 交接文件 — 換電腦/換 session 接續開發前先看這份

寫於 2026-09-15，2026-09-17 更新。M1~M12 全部跑完一輪，覆蓋率抽樣（M12）結果不好，過程中還發現 KKTIX 的搜尋策略被 Cloudflare 擋住。**同一天稍晚，Max 帶了一份參考實作過來（另一個 Claude 對話產出、已經有人實際跑起來的 Python/Flask 版本），示範了用 Playwright 真瀏覽器繞過 Cloudflare、外加幾個新來源的做法，因此：(1) 資料抓取改成純手動觸發（決策 S5，取消 GitHub Actions 排程），(2) 新增 iNDIEVOX、FANSI GO、Ticket Plus 三個 adapter（Max 一開始要求的完整來源清單全部做完了），(3) 用 Playwright 真的修好了 KKTIX 搜尋策略被 Cloudflare 擋住的問題，覆蓋率抽樣從 3.4% 一路推到 51.7%**——看下方各來源對應章節跟 `reports/coverage-sample-2026-09-17.md` 的完整過程。這份文件的目的：讓一個完全沒看過這個對話紀錄的人（包含未來的你，或另一台電腦上全新開的 Claude Code session）能在 5 分鐘內知道現在做到哪、能不能信任目前的程式碼、下一步該做什麼。

## 這是什麼專案

個人用的獨立/地下音樂演出雷達。**完整需求**看 [`GIGRADAR-SRS.md`](./GIGRADAR-SRS.md)，**技術架構與所有踩過的坑**看 [`GIGRADAR-SPEC.md`](./GIGRADAR-SPEC.md)——這兩份是唯一該信任的來源，這份 HANDOFF 只是導覽，內容有衝突以那兩份為準。

## 現在的狀態：M1~M12 全部完成，都在瀏覽器裡實測過，不是只寫完沒測（一個例外見下方 M9 那一列）；抓取一律手動觸發（決策 S5，沒有自動排程），五個來源（KKTIX/拓元/iNDIEVOX/FANSI GO/Ticket Plus，Max 要求的完整清單）都在運作，覆蓋率抽樣 51.7%，離 80% 目標更近了但還沒到

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
| M12 | 覆蓋率抽樣 | ✅ 抽樣做完了，結果不理想（見下方），但這正是 G4 這一步該做的事——找出真正的缺口 |

完整里程碑定義見 `GIGRADAR-SPEC.md` §11。

## 你打開這個 repo 應該先做的事

```bash
npm install                       # cheerio, js-yaml, playwright 這些相依套件不會進 git
npx playwright install chromium    # 只需要跑一次；下載約 280MB 到 ~/Library/Caches/ms-playwright，也不進 git
npm run serve                      # 開本機伺服器（scripts/dev-server.mjs，2026-09-17 起不是 python http.server 了）
# 瀏覽器開 http://localhost:8000
```

⚠️ 忘記跑 `npx playwright install chromium` 的話，`npm run fetch`／設定頁的「重新抓取」按鈕會在 KKTIX 或 FANSI GO 那步直接噴錯（`browserType.launch: Executable doesn't exist...`）——這不是程式碼的 bug，是瀏覽器引擎沒下載，照錯誤訊息裡的指令跑一次就好。

`npm run serve` 現在是一個小型 Node 伺服器（決策 S5），不只是靜態檔案伺服器——設定頁的「🔄 重新抓取最新演出」按鈕只有透過它才會動作（呼叫 `POST /api/fetch` 執行 `fetch.mjs`）。**這個按鈕只在本機用 `npm run serve` 開的時候有效**，部署在 GitHub Pages 上的正式網站沒有後端，按了會顯示「無法連線到本機伺服器」的提示，這是預期行為不是 bug。

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

## M11 的重大發現：GitHub Actions 的 IP 會被來源網站部分擋掉（已修好，且 2026-09-17 起這個問題本身不再相關）

⚠️ **2026-09-17 更新**：決策 S5 把資料抓取改成手動觸發（設定頁按鈕，見上面「你打開這個 repo 應該先做的事」），不再依賴 GitHub Actions 排程，所以下面這個「GitHub Actions IP 被擋」的問題已經**不會再發生**（因為根本不會再從 GitHub Actions 的 IP 發出抓取請求）。保留這段記錄是因為：(1) `scripts/source-fallback.mjs` 這個資料安全網仍然有用，本機手動抓取一樣可能遇到 KKTIX 搜尋被 Cloudflare 擋（見下面 KKTIX 搜尋策略那段），一樣需要它防止資料被洗掉；(2) 了解這段歷史有助於理解為什麼會有 S5 這個決策。

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

## M12 覆蓋率抽樣結果：3.4%，遠低於 80% 目標——但根因很明確

完整報告在 [`reports/coverage-sample-2026-09-17.md`](./reports/coverage-sample-2026-09-17.md)。方法：拿獨立的彙整站
[Artists.tw](https://www.artists.tw/gigs) 當基準（SRS 決策 D11），抽最近期 29 場音樂演出人工比對，只中了 1 場。

**根因不是 adapter 壞掉，是追蹤的場館清單本來就只有 9 個**（The Wall、海邊的卡夫卡、pipelivemusic、Emerge Livehouse ×2、Legacy Taipei、Legacy Taichung、Revolver、Clapper Studio），而 Artists.tw 光是「近期至少 3 場演出」的場館就有 44 個——女巫店、Zepp、Blue Note、SUB Live House、FINAL、文昌號、Legacy TERA、野地方、凝聚力等等全部不在清單裡，抓不到完全是預期中的事，不是 bug。

## KKTIX 搜尋策略現況更新（2026-09-17）：比 M11 記錄的還嚴重

嘗試擴充場館清單時發現：`kktix.com/events?search=...` 這個全站搜尋端點**現在會被 Cloudflare 的機器人驗證擋下（403 + JS challenge 頁）**，而且用跟 adapter 完全一樣的 `fetch()` 方式、換上真的瀏覽器 User-Agent，**在本機也一樣被擋**——不是像 M11 記錄的那樣「只有 GitHub Actions 的機房 IP 才會被擋」，是這個端點本身現在對所有非瀏覽器的 HTTP 請求都擋。

**代表現有的 4 個 `SEARCH_VENUES`（Legacy Taipei、Legacy Taichung、Revolver、Clapper Studio）現在其實完全抓不到新資料，不分執行環境**，跟 `ORG_PAGE_VENUES`（The Wall 那 5 個）用的是完全不同、目前還正常的端點（`<org>.kktix.cc/`，plain fetch 直接 200）。

這對「擴充場館」這件事的影響：新場館如果是像 Zepp、Blue Note 那種「租場地給不同主辦方」的類型（親自查證過 Blue Note 一場演出的主辦帳號是 `romanticoffice`，不是 Blue Note 自己），本來就得靠現在壞掉的搜尋策略才能抓，**目前技術上就是抓不到，不是清單沒加**。唯一還可行的擴充路徑是找「自己開 KKTIX 帳號、自己辦自己所有場次」的自營場館（跟 The Wall 同一類），但連這條路都不保證——例如查證過女巫店雖然在 KKTIX 上有帳號，但帳號完全沒有活動（「目前沒有公開活動」），代表它主要根本不是用 KKTIX 賣票。

要真的修好搜尋策略，得考慮換成能執行 JS、通過 Cloudflare 驗證的做法（例如 headless 瀏覽器），這是比「加場館」更大的架構改動，也要考慮這樣做算不算在鑽網站反爬蟲機制的漏洞——**沒有在這次順手做，留給你決定要不要投入**。

## 追蹤名單巡檢怎麼運作（FR-19 的免費/手動版本，2026-09-17 起）

跟自動化 pipeline 分開的另一條路：`data/watchlist.yml` 存你想追蹤的藝人/場館/主辦名字，但**這份檔案不會被任何程式自動讀取**——用法是你直接在 Claude Code 對話裡跟我說「照追蹤名單查一次」，我就會像做 M12 抽樣時一樣，用瀏覽器工具實際去搜尋、瀏覽、彙整每個名字最近的台灣演出公告給你看。

這個模式完全免費（用你既有的 Claude 方案，不需要另外申請 API key），但代價是**不會自動發生**——沒有排程會自己每天幫你查，你要記得主動開口。跟 FR-19 原本設計的「每週自動巡檢」不同，是刻意的取捨：自動化那個版本需要串一個會計費的 AI API，這個手動版本不用，細節見這次對話紀錄裡跟 Max 討論的權衡（GitHub Actions 排程 vs 自己常駐機器 vs 手動觸發，三種都不能讓 AI 搜尋本身免費，只有「你在對話裡主動問」才不用另外付費）。

## 參考實作：另一個 Claude 對話產出的 Python/Flask 版本（2026-09-17）

Max 帶來一份別人已經實際用起來的參考專案（zip 檔，內容不在這個 repo 裡，只用來借鏡技巧）。跟現在的 GigRadar 比，功能簡單很多（沒有 PWA、沒有跨裝置同步、沒有 artist 正規化/去重、單機 Flask app），但解決了兩個關鍵技術問題：

1. **用 Playwright（真的 Chromium 引擎）繞過 Cloudflare**——對 KKTIX、FANSI GO 用真瀏覽器載入頁面，讓 Cloudflare 的驗證正常跑完，跟 `fetch()`/`curl` 完全不同層級。理論上可以拿來修好現在壞掉的 `SEARCH_VENUES`。
2. **多兩個沒有 Cloudflare、覆蓋率很高的來源**：
   - **iNDIEVOX**——伺服器端直接渲染，plain fetch 就能抓，不需要 Playwright，全站抓不用像 KKTIX 一樣一個場館一個場館試。
   - **FANSI GO**（go.fansi.me）——需要 Playwright（Cloudflare + 前端渲染），但涵蓋不少 GigRadar現在碰不到的場館。

實測：拿它跑出來的 98 筆資料對照 M12 的 29 場覆蓋率樣本，**直接多中 5 場**（Suming@SUB Live House、P!SCO-16@Legacy Taichung、乙水@LIVE WAREHOUSE、虎小島@野地方、《https://》@百樂門酒館），覆蓋率估計可以從 10.3% 推到 27.6%——比繼續一個一個查證 KKTIX 自營場館的投報率高很多。

## iNDIEVOX 完成了（2026-09-17）

新增 `scripts/adapters/indievox.mjs`，沒有 Cloudflare、plain fetch 直接可用。實測一次真的跑了 75 筆場次進 `needs-review.json`（意料中的事——`artists.yml` 只有 2 筆示範資料，這些都還沒被辨識，等你補 artists.yml 或用待整理頁指派後才會變成正式場次）。

**過程中修的幾個真實 bug（都在 `normalize.mjs` 的 `parseIndievoxDate`）**：iNDIEVOX 的日期是主辦方自己貼的自由格式文字，不是固定欄位，實測到至少三種寫法要分別處理（`2026.09.19`、`2026 / 10 / 2` 帶空白、`2026年10月3日` 純中文單位），還有一個有趣的坑：某些活動頁面除了介紹文字的日期，下面訂購表單還有第二個「日期：9/19」（沒有年份），原本的 regex 會不小心抓到後者，改成「解析結果必須含 4 位數年份才採用，不然退回列表頁的日期」才穩定。細節見 `GIGRADAR-SPEC.md` §5.4，測試在 `scripts/normalize.test.mjs`。

場館/城市：多數活動有「場館名稱（地址）」可以直接判斷城市；少數只寫裸名稱的（例如「野地方 Wildlab」）退回 `data/venues.yml` 查表；個位數活動完全沒填地點，只能留空，不強求。價格解析沒做（跟拓元一樣的取捨，D16 精神），`price_min/max` 一律 `null`。

## FANSI GO 完成了，KKTIX 搜尋策略也真的修好了（同日稍晚）

新增 `scripts/adapters/fansi.mjs` + 共用的 `scripts/browser.mjs`（Playwright 啟動/關閉邏輯，`kktix.mjs` 也在用）。FANSI GO 是純 client-side render（Next.js），伺服器回應的 HTML 完全沒有場次資料，跟 Cloudflare 無關，一定要真的執行 JS——這跟 KKTIX 的情況不一樣，但解法一樣（真瀏覽器）。沒有任何結構化場館欄位，用列表卡片的「organizer」欄位頂替 venue（常常是真的場館，但有時是廠牌/主辦方名稱），跟拓元共用同一套 `parseTixcraftDate`/`parseTixcraftVenue`（格式剛好一樣：`YYYY/MM/DD` 無時間、裸場館名稱查 `venues.yml`）。

**順便把 KKTIX 的 `SEARCH_VENUES`（M11/M12 記錄的 Cloudflare 擋爬蟲問題）也改用 Playwright 修好了**——`fetchSearchResultUrls` 現在透過 `scripts/browser.mjs` 的 `withPage()` 執行，實測 4 個搜尋場館（Legacy Taipei/Taichung、Revolver、Clapper Studio）**這次全部成功，0 個失敗**，不是像之前複查覆蓋率時那樣「這次剛好沒被擋」的運氣。`fetchOrgListing`／`fetchEventDetail` 沒有改，這兩個端點本來就沒被擋，維持 plain fetch。

用同一份 M12 的 29 場覆蓋率樣本再測一次：**8/29 ≈ 27.6%**，而且這次每一場都是穩定可重現的結果。完整記錄見 `reports/coverage-sample-2026-09-17.md` 的「再次追蹤」段落。

**新增相依套件注意**：`npm install` 之後還要跑一次 `npx playwright install chromium`（見上面「你打開這個 repo 應該先做的事」），忘記跑的話 KKTIX/FANSI GO 那兩步會直接報錯說找不到瀏覽器執行檔。

## Ticket Plus 也完成了——五個來源全部做完（同日晚上）

新增 `scripts/adapters/ticketplus.mjs`。**這是五個來源裡資料品質最好的一個**：整個平台是靠一個公開、不需要登入/API key 的 JSON API 運作（`apis.ticketplus.com.tw/config/api/v1/getS3?path=...`），`date`/`time`/`location`/`address` 全部是乾淨的結構化欄位，不用像 iNDIEVOX/FANSI GO 那樣解析自由格式文字，也不用 Playwright。`location`/`address` 兩個欄位組成的字串跟 KKTIX 的 `venue_raw` 格式完全一樣，直接重用 `parseKktixVenue`；日期新寫了 `parseTicketPlusDate`。細節見 `GIGRADAR-SPEC.md` §5.6。

**這次追加對覆蓋率的貢獻最大**：用同一份 29 場樣本再測一次，**15/29 ≈ 51.7%**（原始 3.4% 一路推到現在），單是加入 Ticket Plus 就多命中 7 場（溫室雜草、Mili、呂杰達、RUSH BALL ×2、巴賴、JIAHN），因為它剛好覆蓋了女巫店、Zepp New Taipei、The Wall 這幾個先前五個來源都碰不到的場館——這些場館主要就是透過 Ticket Plus 賣票。完整記錄見 `reports/coverage-sample-2026-09-17.md`「第三次追蹤」段落。

至此 **Max 一開始要求的完整來源清單（KKTIX、拓元、iNDIEVOX、FANSI GO、Ticket Plus）全部做完了**。

## artists.yml 第一批補完——events.json 從 0 筆變成 244 筆（同日深夜）

`data/artists.yml` 原本只有 2 筆示範資料，342 筆待整理裡幾乎全部卡在「無法辨識藝人」，`events.json` 一直是 0 筆。照 D15 的精神（AI 先草擬，人工確認）做了第一批補完：

- 逐一看過全部 342 筆原始標題，手動判斷每一筆的主秀藝人，草稿先寫進 `data/artists.yml`（沒有直接 commit，讓 Max 用 `git diff` 審過一輪）加了約 230 筆新條目。
- **同時發現並排除了混進資料裡的非音樂雜訊**——拓元／Ticket Plus 什麼票都賣，`needs-review.json` 裡混了棒球票（福岡軟銀鷹、北海道日本火腿鬥士隊）、籃球季票（TPBL 新竹攻城獅）、按摩課程（Feedback Fascial Tools，出現 13 次！）、角色展覽（CHIIKAWA DAYS）、紋身藝術節、甚至一顆蛋黃酥（「陳耀訓・麵包埠」）。這些**故意沒有**加進 `artists.yml`——加了也不該被辨識成音樂演出，它們會繼續留在待整理頁，用「忽略」按鈕手動清掉就好，不需要改程式。
- 過程中用 `matchArtists()` 直接對照全部 342 筆原始標題驗證（不用真的重新爬網），抓到**一個真實的 bug**：加的「IVE」（韓國女團）當 canonical 太短，會是英文單字「LIVE」的子字串，造成 36 筆完全不相關的場次被誤判成也有 IVE 參演（例如「Kiefer LIVE IN TAIPEI」）——改成用更完整的「IVE WORLD TOUR」修好。這是子字串比對這種簡單機制的通病，往後新增短的英文藝人名字（3-4 個字母內）都要小心做這種交叉檢查。
- 真的跑一次 pipeline 驗證：**`events.json` 從 0 筆變成 244 筆**，`needs-review.json` 從 342 筆降到 64 筆（剩下的大多是上面提到的非音樂雜訊，或拼盤演出真的看不出主秀是誰的情況）。

**過程中又抓到第二個真實 bug（跟 artists.yml 無關，是既有的城市判斷邏輯）**：`normalize.mjs` 的 `CITY_NAMES` 只認「台北/台中/台南/台東」的簡化字，Ticket Plus 的地址欄位卻一律用「臺北/臺中/臺南/臺東」正體字，導致將近 40% 促銷成正式場次的活動 `city` 變成「未知」——跟 M12 追場館時在 `kktix.mjs` 修過的同一種坑，這次改成在 `normalize.mjs` 集中修（`CITY_NAMES` 從純字串陣列改成 `{match正規表示式, city}`），KKTIX/iNDIEVOX/Ticket Plus 都吃得到這個修正，不用每個來源各修一次。順便修了地址前面帶郵遞區號（例如「100台北市中正區...」）也認不出來的問題。修完後 `city: 未知` 的比例從 96/243 降到 50/244——剩下的大多是 FANSI GO 用主辦方/廠牌名稱頂替場館（例如「夢迴夜行有限公司」「兜圈策展工作室」，這些真的不是場館，查不到城市是預期中的事）跟少數場館名稱在 `venues.yml` 裡還沒收錄，兩者都不是新 bug，是已知、可以之後再慢慢補的缺口。

**這一批標了 ⚠️ 的短字/常見字 canonical 值得之後留意**（在 `data/artists.yml` 裡搜尋 `⚠️` 可以找到），例如 `Cowman`、`yeti`、`Kaya`、`SIGH`、`王立`——目前在這批資料裡沒有造成誤判，但如果之後新抓到的場次標題剛好包含這些字，要留意是不是又是一次 IVE/LIVE 那種假陽性。

## artists.yml 補完後重新 review 一次，抓到 10 個問題，全部修掉了（2026-09-17 再晚一點）

補完 230 筆藝人資料、程式碼量變大之後，Max 要求「再重頭 review 一次看有沒有 bug」——用 `code-review` skill 高強度模式（8 個角度平行找、逐一驗證）過一次目前還沒 commit 的變更，抓到 10 個問題，確認後全部修掉：

- **真的又有一組 IVE/LIVE 等級的子字串誤判**：canonical `ASCA` 是 `派偉俊` 的別名 `Patrick Brasca` 的子字串（不分大小寫："brASCA" 包含 "asca"）。實測 `matchArtists('派偉俊《愛火山的人》PATRICK BRASCA 專場', ...)` 真的多標了一個不該有的 `ASCA` tag。修法：直接把 `Patrick Brasca` 這個別名拿掉——現有 342 筆原始資料沒有任何一筆真的需要它，是我當初憑常識加的，不是照實際資料加的。
- **`venues.yml` 完全沒吃到台/臺正體字修正**：M12 那次的修法只改了 `normalize.mjs` 的 `cityFromAddress`（給地址欄位判斷城市用），`parseTixcraftVenue()` 拿 `venue_raw` 去對 `venues.yml` 的比對邏輯完全沒改到——`parseTixcraftVenue('臺北小巨蛋', venuesYml)` 實測還是回傳 `city: null`。連帶發現同一套正體字問題其實散落在三個地方各自維護一份（`normalize.mjs` 的 `CITY_NAMES`、`kktix.mjs` 的 `SEARCH_VENUES`、`venues.yml` 的比對邏輯），維護成本會越來越高。**重構成一個共用函式** `normalizeTraditionalChars()`（`scripts/normalize.mjs` 匯出），三個地方都改成呼叫它，`venues.yml` 裡原本重複的「臺北大巨蛋」條目也一併刪掉。
- **郵遞區號拆分沒處理連字號格式**：`address.replace(/^\d+/, "")` 抓不到 Ticket Plus 較新的「100-01台北市...」這種帶連字號的郵遞區號格式，改成 `/^\d+(-\d+)?/`。
- **`matchArtists()` 回傳順序是資料檔順序，不是標題裡真正的出場順序**：`headliners[0]` 在其他地方被當成「主秀藝人」使用（排除選單顯示、`tags_origin` 預設值、`dedup.mjs` 算 id），但只有 2 筆資料時這個問題不明顯，補完到 230 筆之後多主秀拼盤場次變得常見，「主秀」變成看誰在資料檔裡宣告得早，而不是誰在標題裡真的排第一。修法：`matchArtists()` 改成依照每個命中字串在標題裡的字元位置排序，不是依資料檔順序。
- **`tags_origin` 只取 `headliners[0]` 一個人的出身地區，多主秀場次會漏掉其他人的**：改成對所有辨識到的 headliners 取出身地區的聯集（去重）。
- 補了一個系統性防護測試（`scripts/normalize.test.mjs`）：把 `data/artists.yml` 全部 232 筆的 canonical/alias 兩兩交叉比對，只要有任何一組出現不分大小寫的子字串包含關係就直接測試失敗——目前是 0 筆，之後新增資料如果不小心又造出一組 IVE/LIVE 或 ASCA/Brasca 這種組合，`npm test` 會直接抓到，不用等到真的抓資料才發現。
- 其餘幾個屬於整理/簡化類（重複邏輯、過度工程化的修法），跟上面的正體字重構是同一套一起解決的。

修完後跑了 `npm test` 跟一次完整的五來源真實 pipeline 驗證，結果又抓到**第三個真實案例的同類 bug**：canonical `FLOW`（真實存在的日本搖滾樂團）比對到 LE SSERAFIM《PUREFLOW》巡演標題裡的「PUREFLOW」——跟 IVE/LIVE、ASCA/Brasca 是一模一樣的問題，這次是直接在真實抓到的資料裡當場發生，不是憑空想到才發現的。

三次同一種 bug 出現，說明問題出在 `matchArtists()` 用 `.includes()` 做純子字串比對這個機制本身，不是每個名字剛好「運氣不好」——逐一改名字（IVE→IVE WORLD TOUR）不會 scale。這次改成**從根本修**：純英文/數字（ASCII）的 canonical 或別名比對時要求前後是「字邊界」（前後字元不能也是英文字母/數字），中文/混合字元的名字維持原本的純子字串比對（中文本來就沒有空白分詞，字邊界這個概念套不上，而且中文名字被包在更長標題字串裡本來就是正常、正確的情況）。

修好後拿現在真實抓到的全部 309 筆標題（`events.json` + `needs-review.json`）把所有 4 個字以內的純英文 canonical/別名（`FKJ`、`DOMi`、`BTS`、`QWER`、`ASCA`、`FLOW`... 等 23 個）都跑過一次 `matchArtists()`，逐一核對比對到的場次真的是那個藝人本人的演出，沒有一個是誤判，確認這次修法有效解決整個問題類別，不是又補一個特例。

`npm test` 全過（50 個測試，含新增的 5 個：headliners 排序、tags_origin 聯集、系統性 collision 防護、FLOW 字邊界修正、中文名字不受字邊界影響）。

## 打開網頁肉眼檢查，又抓到兩個真實的場館判斷 bug（2026-09-18）

`artists.yml` 補完、code review 修完、都 commit 之後，第一次真的啟動 `npm run serve` 打開瀏覽器滑一輪時間表、待整理、設定頁（用的是 `.claude/launch.json`，這個檔案原本還停在 S5 之前的 `python3 -m http.server` 舊設定，已經一併更新成 `npm run serve`）。畫面渲染大致正常（多主秀標籤、指派藝人對話框、來源狀態都對），但肉眼掃過場館/城市欄位時抓到兩個真實資料 bug：

1. **「台北流行音樂中心表演廳」被標成 `city: 高雄`**——`venues.yml` 的「流行音樂中心」比對條目太籠統，同時撞到台北跟高雄兩座流行音樂中心，卻寫死城市是高雄。拆成「台北流行音樂中心」「高雄流行音樂中心」兩筆更明確的條目修好。
2. **三個場館完全沒收錄進 `venues.yml`**（台北國際會議中心TICC、新北市工商展覽中心、桃園陽光劇場），變成 `city: 未知`——這幾個場館名稱本身就寫著城市名，用一個小腳本比對「venue 文字裡提到的城市」跟「實際判定的 city」找出來的，不是逐筆肉眼看。補上後 `city: 未知` 從 50 筆降到 42 筆。

修完重跑一次真實 pipeline 驗證過（`npm test` 50 個測試全過，畫面上 LEE YOUNGJI／鼓鼓／派偉俊那幾場台北流行音樂中心的場次都改顯示台北了）。

**同時發現一個跟這次改動無關、範圍更大的既有缺口**：首頁上方「全部城市」「10月」「價格」三個篩選 chip（`index.html` 的 `.filter-row`）是完全沒接上任何邏輯的靜態裝飾，點下去沒有任何反應。底層的篩選邏輯其實已經寫好也測過——`src/filter.js` 的 `passesViewFilters(event, viewFilters)` 支援 `city`/`month`/`priceMax`——但 `app.js` 從來沒有把任何 UI 互動接到這個函式的 `viewFilters` 參數上。Max 確認要做，已經補上（見下一節）。

## 補上首頁的城市/月份/價格篩選 chip（2026-09-18 再晚一點）

三個 chip 現在都是真的 `<button>`，點下去彈出跟既有排除選單同一套視覺的 bottom sheet（`src/interactions.js` 新增 `openFilterSheet()`），單選、點了立刻套用並關閉：

- **城市／月份選項是動態算出來的**，不是寫死清單，而且**只看還沒結束的場次**——一開始沒濾掉已結束場次時，選項清單會出現「7月」「8月」這種選了保證是空清單的死選項（今天是 9/18，7、8 月的場次全部已經過去了），這是實作時自己測出來、當場改掉的，不是等使用者回報。
- **價格**是固定 4 個級距（NT$500/1,000/2,000/3,000 以下）+「不限價格」，沒有價格資料的場次（iNDIEVOX/FANSI GO 大宗）不管選哪個級距都照樣顯示——這是 `passesViewFilters()` 本來就有的設計（`price_min` 是 `null` 時一律放行），不是這次新加的行為。
- 篩選狀態存 `localStorage`（`gigradar:view_filters`），重新整理頁面會記得上次選的；**刻意不放進 Gist 同步的 `UserPrefs`**——這是「當下在看什麼」的畫面狀態，不是像封鎖藝人那種要跨裝置生效的規則。
- 三個篩選可以同時疊加（例如台北 + 10月 + NT$500以下），實測過確認會一起生效。

`npm test` 沒有新增測試（這次是純前端 DOM 互動，跟既有的 `openExcludeMenu()`／`openAssignArtistDialog()` 一樣沒有寫測試，用瀏覽器實測代替），但有打開瀏覽器逐一測過三個 chip 單獨、疊加、reload 後還記得選擇、選到空清單時的空狀態訊息。

## 補上頂部的搜尋功能（2026-09-18，Max 打開瀏覽器點了放大鏡才發現又是一個死裝飾）

跟上面的篩選 chip 一樣的情況——頂部搜尋按鈕原本完全沒接邏輯，Max 打開瀏覽器點下去沒反應才發現的。這次要求「搜藝人或標題就好，搜尋後切到獨立的搜尋頁」，做法：

- 新增 `search.html`（跟 `review.html`/`add.html` 同一種「有返回鍵、沒有底部導覽列」的子頁面樣式），`src/app.js` 新增 `initSearch()`。
- 輸入框即時比對（不用按 Enter），比對 `title_raw` 跟 `lineup`（所有辨識到的演出者，不只 headliners），不分英文大小寫。
- 套用跟時間表一樣的排除規則（`partitionEvents`）——搜尋不會讓已封鎖的藝人繞過規則跑出來；但**不**套用城市/月份/價格畫面篩選，也**不**搜尋已結束的場次，這是獨立的「找東西」功能。
- `index.html`/`new.html`/`favorites.html` 頂部的搜尋圖示從無動作的 `<button>` 改成純連結 `<a href="./search.html">`。

實測過：輸入「RUSH BALL」正確抓到 3 場（含拼盤場次）、輸入「派偉俊」正確抓到 1 場、輸入不存在的關鍵字顯示正確的空狀態訊息、在搜尋結果卡片上收藏/取消收藏正常運作、返回鍵正確回到時間表頁。`npm test` 50 個測試全過（純前端功能，沒有新增測試，跟篩選 chip 那次一樣用瀏覽器實測代替）。

## 補上票價：Max 發現票價其實都寫在「節目介紹」自由格式文字裡（2026-09-18，還在同一天）

Max 打開真實網頁發現拓元/iNDIEVOX/Ticket Plus/FANSI GO 的票價其實都寫在自由格式的介紹文字裡，要求連這個也一起抓出來。查證後四個來源真的都有，只是格式差很多：拓元「🎫 票價：NT$3,380起至NT$7,980」、iNDIEVOX「9900元 / 3500元」（沒有 $ 符號）、Ticket Plus「$1,000/ $1,800」、FANSI GO 甚至用全形字「ＮＴ＄５００」或純冒號「預售票：600」（沒有任何貨幣符號）。

寫了一個共用的 `parsePriceFromText()`（`scripts/normalize.mjs`）處理這些差異：先找「票價」/「門票」標籤，只在那一行裡找 `$`/`NT$` 開頭或「元」結尾的數字（刻意只在那一行找，不掃整頁，才不會把後面「系統服務費200元」這種不相關的數字也算進去）；找不到標籤的話（FANSI GO 完全沒有），退而求其次找「預售/現場/單人/雙人/ADV/DOOR」這類字眼旁邊的數字。全形字先轉半形再比對。57 個測試全過，含 6 個直接用四個來源真實文字寫的案例。

三個來源取得成本不一樣：
- **iNDIEVOX、Ticket Plus 幾乎零成本**——iNDIEVOX 票價就在本來就會抓的同一個詳情頁裡，多抓一行字而已；Ticket Plus 多打一個一樣公開、不用登入的 JSON API（`event/{id}/event.json` 的 `info` 欄位）。
- **拓元、FANSI GO 要多開一次瀏覽器分頁**——這兩個來源的價格藏在需要 JS 渲染的內容裡，只能多一次 Playwright 分頁載入才拿得到，是真的會拉長抓取時間的部分。

**過程中抓到一個自己寫的真實 bug**：第一次真的跑起來，拓元跟 FANSI GO 的票價命中率是 **0%**——原因是 `page.$eval()` 在頁面剛載入完 DOM 的當下就去讀元素，但票價所在的區塊（`#intro`/`.prose`）是網站自己用 JS 晚一點才塞進去的內容，`$eval` 不會等，直接抓不到就整個失敗，而且失敗被我自己寫的 `.catch(() => "")` 悄悄吞掉，看起來像「執行成功但沒資料」而不是報錯。改成先 `waitForSelector` 等元素真的出現、拿掉那個吞錯誤的 catch 之後，重新整個抓一次，覆蓋率從錯誤版本的 53.1%（127/239）修到 **80.0%（192/240）**：拓元 51/59、iNDIEVOX 42/58、FANSI GO 13/19、Ticket Plus 66/84、KKTIX 20/20（本來就 100%，沒受影響）。

**代價：抓取時間變長，而且拓元這次抓起來比預期久很多**。修 bug 前第一次整個 pipeline 跑了約 14 分鐘（比之前的 6 分鐘基準線多了一倍以上）；修掉 Ticket Plus 多餘的延遲之後，第二次重跑總共花了約 **19 分半**（03:27:30 開始，03:47:00 結束），但拆開來看**拓元這次自己就花了 9 分鐘**（79 場，只有 2 場因為等 `#intro` 出現超時 20 秒失敗）——比第一次修 bug 前的 1 分57秒版本慢了非常多（雖然那個版本其實是全部靜默失敗、沒有真的等到內容，所以那個時間本來就是假的、不能拿來比）。這個「拓元詳情頁到底要多久」目前還沒有一個穩定、可預期的數字，值得之後再觀察幾次真實執行，不排除是網站當下的回應速度、還是瀏覽器分頁重複開關的資源競爭問題——先如實記錄，還沒有結論。

Max 因此提出「重新抓取要在 30 秒內」的目標，討論後確認純靠即時抓 5 個外部網站不可能做到（就算拿掉票價、拿掉所有延遲，iNDIEVOX 一個來源就要對自己的網站發 75 次以上請求）。討論到兩個方向：(1) 五個來源改成平行抓取而非依序排隊，可以把總時間從十幾分鐘壓到大概 2-4 分鐘，這個風險小、不改架構，Max 已經要求開始做；(2) 換成「定期預先抓好存資料庫、網頁只讀資料庫」的架構（Max 提了 Neon Postgres），這樣讀取可以在 1 秒內完成，但排程爬蟲要在哪裡跑會重新踩到 M11 那個 GitHub Actions IP 被封鎖的老問題，且會讓「零後端純靜態網頁」這個從一開始的決策（D14）整個改掉——這個方向還在討論，不確定要不要走，Max 還沒回覆最後決定。

## 建議下一步

剩下 67 筆待整理，大多是非音樂雜訊（用「忽略」按鈕清掉即可）或真的看不出主秀的拼盤場次，不需要特別處理。52% 左右的覆蓋率抽樣可以視為現階段用免費工具、五個來源都做完後的實際天花板，再往上要嘛擴大追蹤場館清單（投報率遞減，前面查證過大多數自營小場館很難批次找到），要嘛是接受這個範圍——不建議現在就投入。

架構上目前仍是：**抓取一律手動觸發（決策 S5），不做自動排程**，`.github/workflows/daily-update.yml` 的 `schedule` 已經拿掉，只留 `workflow_dispatch`。**這個決策正在被重新討論**（見上一節最後一段）——Max 嫌手動按一次要等太久，正在考慮要不要換成「排程自動預先抓好存資料庫」的架構，但排程要在哪裡跑會重新踩到 M11 那個 IP 被封鎖的老問題，還沒有結論，先不要假設會維持現狀。
