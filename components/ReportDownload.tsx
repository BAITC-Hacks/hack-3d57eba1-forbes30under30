"use client";

import { useState } from "react";
import { buildMarkdownReport, type MarkdownReportInput } from "@/lib/markdown-report";

export default function ReportDownload(props: MarkdownReportInput & { disabled?: boolean }) {
  const [error, setError] = useState<string | null>(null);
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
      <button type="button" onClick={download} disabled={props.disabled}
        className="rounded-lg border border-indigo-200 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50">
        Скачать отчёт (Markdown)
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
    </div>
  );
}
