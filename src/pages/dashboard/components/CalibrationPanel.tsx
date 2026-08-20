import { useCallback, useEffect, useState } from "react";
import {
  importCalibrationText,
  loadCalibrationModel,
} from "@shared/api/date-calibration";
import type { DateCalibrationSummary } from "@shared/types";

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".csv", ".tsv", ".txt"];

function statusLabel(status: DateCalibrationSummary["status"]): string {
  switch (status) {
    case "current": return "Актуальна";
    case "due_soon": return "Скоро обновить";
    case "expired": return "Нужно обновить";
    default: return "Недостаточно данных";
  }
}

function statusClass(status: DateCalibrationSummary["status"]): string {
  if (status === "current") return "text-success bg-success/10 border-success/20";
  if (status === "due_soon") return "text-warning bg-warning/10 border-warning/20";
  return "text-error bg-error/10 border-error/20";
}

export default function CalibrationPanel() {
  const [summary, setSummary] = useState<DateCalibrationSummary | null>(null);
  const [text, setText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const model = await loadCalibrationModel();
    setSummary(model.summary);
    setDaysLeft(calculateDaysLeft(model.summary.validUntil));
  }, []);

  useEffect(() => {
    let active = true;
    loadCalibrationModel()
      .then((model) => {
        if (!active) return;
        setSummary(model.summary);
        setDaysLeft(calculateDaysLeft(model.summary.validUntil));
      })
      .catch((value: unknown) => {
        if (!active) return;
        setError(value instanceof Error ? value.message : "Не удалось загрузить калибровку");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, []);

  const handleImport = async (sourceText: string) => {
    setError("");
    setMessage("");
    try {
      const result = await importCalibrationText(sourceText);
      await refresh();
      setMessage(`Добавлено точек: ${result.accepted}. Пропущено строк: ${result.skipped}.`);
      setText("");
    } catch (value: unknown) {
      setError(value instanceof Error ? value.message : "Ошибка импорта");
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const lowerName = file.name.toLocaleLowerCase();
    const validExtension = ALLOWED_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
    if (!validExtension) {
      setError("Поддерживаются только .csv, .tsv и .txt");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("Файл слишком большой. Максимум 2 МБ");
      return;
    }
    await handleImport(await file.text());
  };

  if (isLoading) {
    return <div className="py-20 text-center text-sm text-text-muted">Загрузка калибровки…</div>;
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="bg-bg-card border border-border rounded-2xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Калибровка ID → дата</h2>
            <p className="mt-1 text-sm text-text-muted max-w-2xl">
              Даты top-100 всегда оцениваются по photo asset ID. Точные даты из импорта используются только как опорные точки модели.
            </p>
          </div>
          {summary && (
            <span className={`px-3 py-1.5 rounded-xl border text-xs font-semibold ${statusClass(summary.status)}`}>
              {statusLabel(summary.status)}
            </span>
          )}
        </div>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-5">
            <Stat label="Точных ID" value={summary.anchorCount.toLocaleString("ru-RU")} />
            <Stat label="Дней с точками" value={summary.datePointCount.toLocaleString("ru-RU")} />
            <Stat label="Последняя дата" value={summary.latestDate ?? "—"} />
            <Stat label="P90 ошибка" value={summary.p90ErrorDays === null ? "—" : `±${summary.p90ErrorDays} дн.`} />
            <Stat
              label="До обновления"
              value={daysLeft === null ? "—" : daysLeft < 0 ? `просрочено ${Math.abs(daysLeft)} дн.` : `${daysLeft} дн.`}
            />
          </div>
        )}
      </div>

      <div className="bg-bg-card border border-border rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Ежемесячное обновление</h3>
          <p className="mt-1 text-xs text-text-muted">
            Формат строки: <code className="text-text-secondary">2156518163, 2026-08-14</code>. Также принимаются даты вида 8/14/2026 и August 14, 2026.
          </p>
        </div>

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={7}
          placeholder={"2156518163\tPhotos\t8/14/2026\n2154249534\tPhotos\t8/12/2026"}
          className="w-full rounded-xl border border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent resize-y"
        />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!text.trim()}
            onClick={() => void handleImport(text)}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Добавить из текста
          </button>

          <label className="px-4 py-2 rounded-xl text-sm font-medium border border-border bg-bg-input text-text-secondary hover:border-border-hover hover:text-text-primary cursor-pointer">
            Загрузить CSV / TSV / TXT
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              className="hidden"
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>

        {message && <p className="text-sm text-success">{message}</p>}
        {error && <p className="text-sm text-error">{error}</p>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-input/60 px-3 py-3">
      <p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-text-primary tabular-nums">{value}</p>
    </div>
  );
}

function calculateDaysLeft(validUntil: string | null): number | null {
  if (!validUntil) return null;
  const diff = Date.parse(`${validUntil}T23:59:59Z`) - Date.now();
  return Math.ceil(diff / 86_400_000);
}
