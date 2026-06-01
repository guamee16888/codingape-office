import {
  buildOperatorConsolePageHtml,
  createConsoleAgent,
  createConsoleProject,
  createConsoleSampleRun,
} from "../../lib/operator-console-page.mjs";
import { updateLearningRuleStatus } from "../../lib/learning-rules.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const html = await buildOperatorConsolePageHtml({
      projectId: url.searchParams.get("project") || undefined,
      reportId: url.searchParams.get("report") || undefined,
      date: url.searchParams.get("date") || undefined,
      locale: url.searchParams.get("locale") || "zh-CN",
      generate: url.searchParams.get("generate") === "1",
      targetAutonomyLevel: url.searchParams.get("target") || undefined,
    });

    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return new Response(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Console Error</title></head><body><h1>控制台加载失败</h1><pre>${message.replaceAll("<", "&lt;")}</pre></body></html>`,
      {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      }
    );
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const intent = String(form.get("intent") || "");
    if (intent === "create_project") {
      const created = createConsoleProject({
        name: String(form.get("name") || "AI Worker Project"),
        description: String(form.get("description") || ""),
      });
      const html = await buildOperatorConsolePageHtml({
        projectId: created.project_id,
        locale: "zh-CN",
        flash: {
          title: "项目已创建",
          message: `项目 ${created.project_id} 已创建。下一步创建 Agent，然后把 run 发到 /api/runs。`,
          ingestion_api_key: created.ingestion_api_key,
        },
      });
      return new Response(html, {
        status: 201,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (intent === "create_agent") {
      const created = createConsoleAgent({
        project_id: String(form.get("project_id") || ""),
        name: String(form.get("name") || "Support Agent"),
        environment: String(form.get("environment") || "production"),
      });
      const html = await buildOperatorConsolePageHtml({
        projectId: created.project_id,
        locale: "zh-CN",
        flash: {
          title: "Agent 已创建",
          message: `Agent ${created.agent_id} 已创建。现在可以用项目的 ingestion key 提交 run。`,
        },
      });
      return new Response(html, {
        status: 201,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (intent === "create_sample_run") {
      const created = await createConsoleSampleRun({
        project_id: String(form.get("project_id") || ""),
        agent_id: String(form.get("agent_id") || ""),
        input: String(form.get("input") || "User asks for refund status."),
        output: String(form.get("output") || "Tool returned empty result; agent should ask for human review instead of inventing status."),
      });
      const html = await buildOperatorConsolePageHtml({
        projectId: created.project_id,
        reportId: created.report_id,
        locale: "zh-CN",
        flash: {
          title: "测试 Run 已提交",
          message: `测试 run ${created.run_id} 已写入黑匣子，并生成报告 ${created.report_id}。`,
        },
      });
      return new Response(html, {
        status: 201,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (intent !== "learning_rule_review") {
      return new Response("Unsupported console action", { status: 400 });
    }

    const learningRuleId = String(form.get("learning_rule_id") || "");
    const status = String(form.get("status") || "");
    const note = String(form.get("note") || "Console reviewer decision.");
    if (!learningRuleId || !status) {
      return new Response("learning_rule_id and status are required", { status: 400 });
    }

    const result = updateLearningRuleStatus(learningRuleId, {
      status,
      note,
      evidence: {
        source: "next_console",
        mutates_policy: false,
        mutates_prompt: false,
        grants_autonomy: false,
        enables_policy_enforcement: false,
      },
      actor_type: "console_operator",
      actor_id: "local",
    });

    return Response.redirect(
      new URL(`/console?project=${encodeURIComponent(result.learning_rule.project_id)}#learning-rules`, request.url),
      303
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return new Response(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Console Error</title></head><body><h1>控制台操作失败</h1><pre>${message.replaceAll("<", "&lt;")}</pre><p><a href="/console">返回控制台</a></p></body></html>`,
      {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      }
    );
  }
}
