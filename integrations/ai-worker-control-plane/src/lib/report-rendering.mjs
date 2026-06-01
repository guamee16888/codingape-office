import { getReport } from "./reports.mjs";
import { isChineseLocale, reportMarkdownForLocale } from "./i18n.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function inlineMarkdown(value) {
  return escapeHtml(value).replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function markdownToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let inList = false;

  function closeList() {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  }

  for (const line of lines) {
    if (line.startsWith("- ")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(line.slice(2))}</li>`);
      continue;
    }

    closeList();

    if (!line.trim()) {
      continue;
    }

    if (line.startsWith("### ")) {
      html.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      html.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      html.push(`<h1>${inlineMarkdown(line.slice(2))}</h1>`);
    } else {
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }

  closeList();
  return html.join("\n");
}

export function renderReportHtml(report, options = {}) {
  const locale = options.locale || report.locale || "en";
  const title = isChineseLocale(locale) ? "AI Agent 夜间体检报告" : "AI Agent Nightly Health Report";
  const body = markdownToHtml(reportMarkdownForLocale(report, locale));

  return [
    "<!doctype html>",
    `<html lang="${isChineseLocale(locale) ? "zh-CN" : "en"}">`,
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `<title>${escapeHtml(title)}</title>`,
    "<style>",
    ":root{color-scheme:light;--ink:#17202a;--muted:#566573;--line:#d5dde5;--band:#f6f8fa;--accent:#0f6b6e;}",
    "body{margin:0;background:#fff;color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;}",
    "main{max-width:880px;margin:0 auto;padding:32px 20px 48px;}",
    "h1{font-size:28px;line-height:1.2;margin:0 0 18px;border-bottom:2px solid var(--line);padding-bottom:14px;}",
    "h2{font-size:19px;margin:30px 0 10px;color:#102a43;}",
    "h3{font-size:15px;margin:20px 0 8px;color:var(--accent);}",
    "p{margin:7px 0;color:var(--muted);}",
    "ul{margin:8px 0 16px;padding:12px 18px;background:var(--band);border:1px solid var(--line);border-radius:8px;}",
    "li{margin:5px 0;}",
    "code{background:#eef2f6;border:1px solid #d9e2ec;border-radius:4px;padding:1px 4px;font-size:0.92em;}",
    "@media (max-width:640px){main{padding:24px 14px 40px;}h1{font-size:24px;}ul{padding-left:16px;}}",
    "</style>",
    "</head>",
    "<body>",
    "<main>",
    body,
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
}

export function getReportHtml(reportId, options = {}) {
  const report = getReport(reportId, options);
  if (!report) {
    return null;
  }

  return {
    report,
    html: renderReportHtml(report, options),
  };
}
