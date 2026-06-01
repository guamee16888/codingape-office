const DEFAULT_TIMEOUT_MS = 2500;

function normalizeProvider(value = "") {
  const provider = String(value || "").trim().toLowerCase();
  if (["ollama", "openai_compatible", "lmstudio", "lm_studio"].includes(provider)) {
    return provider === "lmstudio" || provider === "lm_studio" ? "openai_compatible" : provider;
  }
  return provider || "disabled";
}

function trimText(value, max = 1800) {
  const text = String(value || "").replace(/\0/g, "").trim();
  return text.length > max ? `${text.slice(0, max)}\n...[已截断]` : text;
}

function safeArray(value, max = 8) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, max) : [];
}

export function localLlmConfig(env = process.env) {
  const provider = normalizeProvider(env.CODEX_OFFICE_LOCAL_LLM_PROVIDER);
  const enabled = provider !== "disabled" && provider !== "off" && provider !== "none";
  const openAiCompatible = provider === "openai_compatible";
  const baseUrl = String(
    env.CODEX_OFFICE_LOCAL_LLM_BASE_URL ||
      (openAiCompatible ? "http://127.0.0.1:1234/v1" : "http://127.0.0.1:11434")
  ).replace(/\/+$/, "");
  const model = String(
    env.CODEX_OFFICE_LOCAL_LLM_MODEL ||
      (openAiCompatible ? "local-model" : "qwen2.5-coder:7b")
  );
  const timeoutMs = Math.max(
    300,
    Math.min(45000, Number(env.CODEX_OFFICE_LOCAL_LLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS))
  );

  return {
    enabled,
    provider: enabled ? provider : "disabled",
    baseUrl,
    model,
    timeoutMs
  };
}

export function buildJudgeReviewPrompt(task = {}, evidence = {}, proposal = {}) {
  const commands = safeArray(evidence.commands?.map((item) => `${item.command}: ${item.status || item.ok || "unknown"}`), 10);
  const diffStat = trimText(proposal.diffStat || "", 1200);
  const changedFiles = safeArray(proposal.changedFiles || [], 12);
  const observations = safeArray(proposal.observations || [], 8);
  const steps = safeArray(proposal.recommendedSteps || [], 8);

  return [
    "你是 Coding猿 Office 的 Judge猿，负责审查本地 AI 编程任务。",
    "请只基于下面证据给出安全、可审计、人工闸门优先的审查意见。",
    "不要建议自动写入、自动部署、自动重启、自动交易或绕过人工审批。",
    "请输出 JSON，不要 Markdown，字段为 summary、verdict、risks、recommendations。",
    "",
    `任务：${trimText(task.title || "", 500)}`,
    `项目：${trimText(task.projectName || task.projectId || "", 240)}`,
    `风险：${trimText(proposal.risk || task.risk || "low", 80)}`,
    `变更文件：${changedFiles.join(", ") || "无"}`,
    `证据命令：${commands.join("; ") || "无"}`,
    `差异统计：${diffStat || "暂无差异统计"}`,
    `规则观察：${observations.join("；") || "无"}`,
    `规则建议：${steps.join("；") || "无"}`,
    "",
    "输出示例：",
    "{\"summary\":\"一句中文审查结论\",\"verdict\":\"approve|caution|rework|blocked\",\"risks\":[\"风险1\"],\"recommendations\":[\"建议1\"]}"
  ].join("\n");
}

function parseReviewText(text = "") {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      summary: trimText(parsed.summary || "本地模型已完成审查。", 360),
      verdict: trimText(parsed.verdict || "caution", 48),
      risks: safeArray(parsed.risks, 6),
      recommendations: safeArray(parsed.recommendations, 6)
    };
  } catch {
    return {
      summary: trimText(cleaned || "本地模型返回了审查文本，但不是标准 JSON。", 420),
      verdict: "caution",
      risks: [],
      recommendations: ["请由操作员复核模型文本，并继续保留人工闸门。"]
    };
  }
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function requestOllamaReview(config, prompt, fetchImpl) {
  const response = await fetchWithTimeout(fetchImpl, `${config.baseUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      prompt,
      stream: false,
      format: "json",
      options: {
        temperature: 0.1,
        num_predict: 700
      }
    })
  }, config.timeoutMs);
  if (!response.ok) throw new Error(`Ollama 返回 ${response.status}`);
  const data = await response.json();
  return parseReviewText(data.response || "");
}

async function requestOpenAiCompatibleReview(config, prompt, fetchImpl) {
  const response = await fetchWithTimeout(fetchImpl, `${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content: "你是谨慎的 AI Agent 审核员。只输出 JSON。"
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  }, config.timeoutMs);
  if (!response.ok) throw new Error(`OpenAI-compatible 返回 ${response.status}`);
  const data = await response.json();
  return parseReviewText(data.choices?.[0]?.message?.content || "");
}

export async function requestLocalJudgeReview({ task = {}, evidence = {}, proposal = {} } = {}, options = {}) {
  const config = options.config || localLlmConfig(options.env || process.env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (!config.enabled) {
    return {
      ok: false,
      skipped: true,
      provider: "disabled",
      model: "",
      error: "未启用本地模型审查"
    };
  }

  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      skipped: true,
      provider: config.provider,
      model: config.model,
      error: "当前 Node 运行时没有 fetch 能力"
    };
  }

  try {
    const prompt = buildJudgeReviewPrompt(task, evidence, proposal);
    const review = config.provider === "ollama"
      ? await requestOllamaReview(config, prompt, fetchImpl)
      : await requestOpenAiCompatibleReview(config, prompt, fetchImpl);

    return {
      ok: true,
      skipped: false,
      provider: config.provider,
      model: config.model,
      review
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      provider: config.provider,
      model: config.model,
      error: trimText(error?.message || "本地模型审查失败", 220)
    };
  }
}

export async function testLocalJudgeConnection(options = {}) {
  const config = options.config || localLlmConfig(options.env || process.env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (!config.enabled) {
    return {
      ok: false,
      skipped: true,
      provider: "disabled",
      model: "",
      status: "disabled",
      error: "未启用本地模型审查"
    };
  }

  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      skipped: true,
      provider: config.provider,
      model: config.model,
      status: "unavailable",
      error: "当前 Node 运行时没有 fetch 能力"
    };
  }

  try {
    const url = config.provider === "ollama"
      ? `${config.baseUrl}/api/tags`
      : `${config.baseUrl}/models`;
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "GET",
      headers: { accept: "application/json" }
    }, Math.min(config.timeoutMs, 5000));

    if (!response.ok) throw new Error(`本地模型服务返回 ${response.status}`);
    const data = await response.json();
    const models = config.provider === "ollama"
      ? safeArray(data.models?.map((item) => item.name || item.model), 12)
      : safeArray(data.data?.map((item) => item.id), 12);

    return {
      ok: true,
      skipped: false,
      provider: config.provider,
      model: config.model,
      status: models.includes(config.model) || !models.length ? "connected" : "model_not_listed",
      models,
      error: ""
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      provider: config.provider,
      model: config.model,
      status: "failed",
      models: [],
      error: trimText(error?.message || "本地模型连接失败", 220)
    };
  }
}
