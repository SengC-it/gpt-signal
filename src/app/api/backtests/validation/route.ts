import { NextResponse } from "next/server";
import { getSupabaseAdmin, hasSupabaseServerEnv } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const configuredSecret = process.env.BACKTEST_VALIDATION_SECRET;
  if (configuredSecret && request.headers.get("x-backtest-validation-secret") !== configuredSecret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!hasSupabaseServerEnv()) {
    return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  }

  const body = await request.json() as Record<string, unknown>;
  const report = body.report && typeof body.report === "object" ? body.report as Record<string, unknown> : body;
  const coverage = record(report.coverage);
  const execution = record(report.execution);
  const walkForward = record(report.walkForward);
  const holdout = record(walkForward.finalHoldout);
  const holdoutSummary = record(holdout.summary);
  const oos = record(report.oos);
  const selected = record(holdout.selected);
  const selectedVersion = typeof holdout.selected === "string"
    ? holdout.selected
    : typeof selected.main === "string"
      ? selected.main
      : null;
  const symbols = Array.isArray(coverage.symbols) ? coverage.symbols.map(String) : [];

  const { data, error } = await getSupabaseAdmin()
    .from("gpt_backtest_runs")
    .insert({
      strategy_version: selectedVersion,
      symbols,
      start_time: typeof coverage.start === "string" ? coverage.start : null,
      end_time: typeof coverage.end === "string" ? coverage.end : null,
      validation_mode: "walk_forward",
      cost_model: {
        feeRatePerSide: execution.feeRatePerSide ?? null,
        slippageRatePerSide: execution.slippageRatePerSide ?? null
      },
      execution_policy: execution,
      result_summary: {
        validation: report.validation ?? null,
        codeVersion: report.codeVersion ?? null,
        sourceDirs: report.sourceDirs ?? null,
        oos,
        holdout: holdoutSummary,
        walkForward,
        candidateComparisons: report.candidateComparisons ?? null,
        gate: report.gate ?? null,
        deploymentAllowed: report.deploymentAllowed ?? false
      },
      validation_passed: report.gate && typeof report.gate === "object"
        ? (report.gate as Record<string, unknown>).passed === true
        : false
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data?.id ?? null });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
