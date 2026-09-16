/**
 * FR-14/AC-14 (SPEC §4.2 step 4, §10): opens a GitHub issue when a source
 * looks broken. Only actually calls the GitHub API inside GitHub Actions,
 * where GITHUB_TOKEN/GITHUB_REPOSITORY are set automatically (SPEC §10 — no
 * extra secret needed). Running `npm run fetch` locally has neither, so this
 * just logs and returns — a dev machine without repo-admin rights should
 * never be required to have a token just to run the pipeline.
 */

const GITHUB_API = "https://api.github.com";
const LABEL = "source-anomaly";

function issueTitleFor(sourceName) {
  return `[來源異常] ${sourceName} 抓取異常`;
}

function bodyFor(anomaly) {
  if (anomaly.reason === "anomaly") {
    return `來源「${anomaly.name}」這次抓到 0 筆，但上次成功抓到 ${anomaly.lastCount} 筆——很可能是網站改版讓 parser 靜默失效（SRS 風險 R1），不是當天真的沒有場次。請檢查 \`scripts/adapters/\` 對應的 adapter 選擇器是否還對得上網站的 HTML 結構。`;
  }
  return `來源「${anomaly.name}」抓取失敗：\n\n\`\`\`\n${anomaly.detail}\n\`\`\``;
}

async function findOpenAnomalyIssue(token, repo, title) {
  const res = await globalThis.fetch(`${GITHUB_API}/repos/${repo}/issues?state=open&labels=${LABEL}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return null; // best-effort de-dup only — a listing failure shouldn't block opening the issue
  const issues = await res.json();
  return issues.find((issue) => issue.title === title) ?? null;
}

/**
 * @param {{ name: string, reason: "error"|"anomaly", detail: string, lastCount: number }} anomaly
 */
export async function notifySourceAnomaly(anomaly) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY; // "owner/repo"
  const title = issueTitleFor(anomaly.name);

  if (!token || !repo) {
    console.log(`[notify] (skipped, no GITHUB_TOKEN/GITHUB_REPOSITORY) ${title}: ${anomaly.detail}`);
    return { skipped: true };
  }

  // Don't open a fresh issue every single day a source stays broken — that
  // defeats "每週維護時間 < 15 分鐘" (G5). One open issue per source is enough;
  // whoever fixes the adapter closes it, and the next real anomaly reopens one.
  const existing = await findOpenAnomalyIssue(token, repo, title);
  if (existing) {
    console.log(`[notify] issue already open for ${anomaly.name}: #${existing.number}`);
    return { skipped: true, issueNumber: existing.number };
  }

  const res = await globalThis.fetch(`${GITHUB_API}/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ title, body: bodyFor(anomaly), labels: [LABEL] }),
  });
  if (!res.ok) throw new Error(`GitHub issues API -> ${res.status}`);
  const created = await res.json();
  console.log(`[notify] opened issue #${created.number} for ${anomaly.name}`);
  return { issueNumber: created.number };
}
