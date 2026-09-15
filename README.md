# GigRadar

個人用的獨立/地下音樂演出雷達。詳細需求見 [`GIGRADAR-SRS.md`](./GIGRADAR-SRS.md)，技術架構見 [`GIGRADAR-SPEC.md`](./GIGRADAR-SPEC.md)。

## 目前進度

M1（專案骨架）進行中：頁面殼 + 設計 token 已建立，畫面上的資料都是寫死的假資料。實際的爬蟲 pipeline（`scripts/`）與前端動態渲染（`src/app.js` 讀取 `data/events.json`）尚未實作，詳見 `GIGRADAR-SPEC.md` §11 的里程碑清單。

## 本機開發

不需要打包工具（D14）。直接開一個本機伺服器看畫面：

```bash
npm run serve
# 或
python3 -m http.server 8000
```

再打開 `http://localhost:8000`。

## 目錄結構

見 `GIGRADAR-SPEC.md` §2。
