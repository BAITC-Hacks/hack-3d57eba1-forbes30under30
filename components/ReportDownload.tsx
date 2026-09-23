"use client";

import { useRef, useState } from "react";
import { buildMarkdownReport, type MarkdownReportInput } from "@/lib/markdown-report";
import { calculationSchema } from "@/lib/result-schema";

export default function ReportDownload(props: MarkdownReportInput & { disabled?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [presentationError, setPresentationError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const generatingRef = useRef(false);

  async function downloadPresentation() {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setIsGenerating(true);
    setPresentationError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      // The existing report props do not include swaps. Fetch them for this
      // exact scenario without another AI request or changes to the page/API.
      const response = await fetch("/api/calc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions: props.decisions, eventId: props.activeEvent?.id }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Не удалось получить данные презентации.");
      const calculation = calculationSchema.parse(await response.json());
      clearTimeout(timeout);
      // This lazy module owns pptxgenjs; neither is evaluated during SSR.
      const { buildPresentation } = await import("@/lib/presentation");
      const presentation = buildPresentation({
        ...props,
        suggestions: calculation.suggestions,
        bestKnownScore: calculation.bestKnownScore,
      });
      const filename = (props.name.trim() || "Сценарий Астаны").replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 80);
      await presentation.writeFile({ fileName: `${filename || "scenario"}-presentation.pptx`, compression: true });
    } catch {
      setPresentationError(controller.signal.aborted
        ? "Подготовка презентации заняла слишком много времени. Повторите попытку."
        : "Не удалось создать презентацию. Проверьте соединение и повторите попытку.");
    } finally {
      clearTimeout(timeout);
      generatingRef.current = false;
      setIsGenerating(false);
    }
  }

  function download() {
    let url: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      setError(null);
      const text = buildMarkdownReport(props);
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
      url = URL.createObjectURL(blob);
      link = document.createElement("a");
      link.href = url;
      const filename = (props.name.trim() || "Сценарий Астаны").replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 80);
      link.download = `${filename || "scenario"}.md`;
      document.body.appendChild(link);
      link.click();
    } catch {
      setError("Не удалось скачать отчёт. Повторите попытку.");
    } finally {
      link?.remove();
      if (url) {
        const completedUrl = url;
        setTimeout(() => URL.revokeObjectURL(completedUrl), 1_000);
      }
    }
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={download} disabled={props.disabled}
          className="rounded-lg border border-indigo-200 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50">
          Скачать отчёт (Markdown)
        </button>
        <button type="button" onClick={() => void downloadPresentation()} disabled={isGenerating} aria-busy={isGenerating}
          className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50">
          {isGenerating ? "Готовим презентацию…" : "Скачать презентацию (PPTX)"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
      {presentationError && <p role="alert" className="mt-2 text-sm text-rose-700">{presentationError}</p>}
    </div>
  );
}
