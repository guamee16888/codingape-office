function normalizeDiffPath(path) {
  return String(path || "")
    .replace(/^(---|\+\+\+)\s+/, "")
    .replace(/^[ab]\//, "")
    .trim();
}

export function classifyUnifiedDiffLine(line) {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+++") || line.startsWith("---")) return "file";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  if (!line.trim()) return "empty";
  return "context";
}

export function summarizeUnifiedDiff(diff = "") {
  const summary = {
    added: 0,
    files: [],
    hunks: 0,
    isEmpty: !String(diff || "").trim(),
    removed: 0
  };
  let currentFile = null;

  for (const line of String(diff || "").split("\n")) {
    if (line.startsWith("--- ")) {
      currentFile = {
        added: 0,
        after: "",
        before: normalizeDiffPath(line),
        hunks: 0,
        removed: 0
      };
      continue;
    }

    if (line.startsWith("+++ ")) {
      if (!currentFile) {
        currentFile = { added: 0, after: "", before: "", hunks: 0, removed: 0 };
      }
      currentFile.after = normalizeDiffPath(line);
      summary.files.push(currentFile);
      continue;
    }

    if (line.startsWith("@@")) {
      summary.hunks += 1;
      if (currentFile) currentFile.hunks += 1;
      continue;
    }

    if (line.startsWith("+")) {
      summary.added += 1;
      if (currentFile) currentFile.added += 1;
      continue;
    }

    if (line.startsWith("-")) {
      summary.removed += 1;
      if (currentFile) currentFile.removed += 1;
    }
  }

  return summary;
}

export function diffFileChangeKind(file = {}) {
  if (!file.before || file.before === "/dev/null") return "added";
  if (!file.after || file.after === "/dev/null") return "removed";
  if (file.added && !file.removed) return "expanded";
  if (file.removed && !file.added) return "reduced";
  return "modified";
}

export function diffReviewRisk(file = {}) {
  const churn = Number(file.added || 0) + Number(file.removed || 0);
  if (churn >= 80 || Number(file.hunks || 0) >= 8) return "high";
  if (churn >= 24 || Number(file.hunks || 0) >= 3) return "medium";
  return "low";
}

export function unifiedDiffRows(diff = "", limit = 180) {
  return String(diff || "")
    .split("\n")
    .slice(0, limit)
    .map((line, index) => ({
      content: line,
      lineNumber: index + 1,
      type: classifyUnifiedDiffLine(line)
    }));
}

export function unifiedDiffSections(diff = "", limit = 180) {
  const sections = [];
  let current = null;
  let rendered = 0;
  const lines = String(diff || "").split("\n");

  const ensureSection = () => {
    if (!current) {
      current = {
        added: 0,
        after: "",
        before: "",
        hunks: 0,
        removed: 0,
        rows: [],
        truncated: false
      };
    }
    return current;
  };

  const pushCurrent = () => {
    if (!current) return;
    if (current.before || current.after || current.rows.length) {
      sections.push(current);
    }
    current = null;
  };

  lines.forEach((line, index) => {
    if (line.startsWith("--- ")) {
      pushCurrent();
      current = {
        added: 0,
        after: "",
        before: normalizeDiffPath(line),
        hunks: 0,
        removed: 0,
        rows: [],
        truncated: false
      };
      return;
    }

    if (line.startsWith("+++ ")) {
      ensureSection().after = normalizeDiffPath(line);
      return;
    }

    if (!line && !current) return;

    const section = ensureSection();
    const type = classifyUnifiedDiffLine(line);
    if (type === "added") section.added += 1;
    if (type === "removed") section.removed += 1;
    if (type === "hunk") section.hunks += 1;

    if (rendered < limit) {
      section.rows.push({
        content: line,
        lineNumber: index + 1,
        type
      });
    } else {
      section.truncated = true;
    }
    rendered += 1;
  });

  pushCurrent();
  return sections;
}
