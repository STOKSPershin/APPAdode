import { useState } from "react";
import {
  MAX_BACKUP_FILE_SIZE,
  downloadFullBackup,
  importFullBackup,
  parseBackupFile,
  previewBackup,
} from "@shared/api/backup";
import type { BackupPreview, FullBackupFile } from "@shared/api/backup";

function errorText(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback;
}

export default function BackupPanel() {
  const [selectedBackup, setSelectedBackup] = useState<FullBackupFile | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleExport = async () => {
    setIsExporting(true);
    setMessage("");
    setError("");
    try {
      const exported = await downloadFullBackup();
      setMessage(
        `Резервная копия скачана: ${exported.sessions.toLocaleString("ru-RU")} поисков, `
        + `${exported.topicSnapshots.toLocaleString("ru-RU")} снимков тем.`,
      );
    } catch (value: unknown) {
      setError(errorText(value, "Не удалось создать резервную копию"));
    } finally {
      setIsExporting(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    setSelectedBackup(null);
    setPreview(null);
    setConfirmImport(false);
    setMessage("");
    setError("");
    if (!file) return;

    try {
      const backup = await parseBackupFile(file);
      setSelectedBackup(backup);
      setPreview(previewBackup(backup));
    } catch (value: unknown) {
      setError(errorText(value, "Не удалось проверить резервную копию"));
    }
  };

  const handleImport = async () => {
    if (!selectedBackup) return;
    if (!confirmImport) {
      setConfirmImport(true);
      return;
    }

    setIsImporting(true);
    setMessage("");
    setError("");
    try {
      const result = await importFullBackup(selectedBackup);
      setMessage(
        `База перенесена: ${result.sessions.toLocaleString("ru-RU")} поисков, `
        + `${result.topics.toLocaleString("ru-RU")} снимков тем. Очередь поставлена на паузу.`,
      );
      window.setTimeout(() => window.location.reload(), 1_200);
    } catch (value: unknown) {
      setError(errorText(value, "Не удалось импортировать резервную копию"));
      setConfirmImport(false);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <section className="rounded-2xl border border-border bg-bg-card p-5">
        <h2 className="text-base font-semibold text-text-primary">Полный перенос локальной базы</h2>
        <p className="mt-1 max-w-4xl text-sm leading-6 text-text-muted">
          Один JSON-файл содержит все сохранённые поиски, top-100 и asset ID, избранное,
          калибровку дат, импорт продаж, настройки, кэши и очередь главных тем.
        </p>
        <div className="mt-4 rounded-xl border border-warning/25 bg-warning/8 px-4 py-3 text-xs leading-5 text-warning">
          Ключ OpenAI и другие секретные значения в файл не записываются. На виртуалке ключ нужно
          ввести отдельно. После импорта очередь останется на паузе до ручного запуска.
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-bg-card p-5">
          <h3 className="text-sm font-semibold text-text-primary">1. Экспорт на этом компьютере</h3>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            Дождитесь завершения текущего сканирования, затем скачайте файл и перенесите его на виртуальную машину.
          </p>
          <button
            type="button"
            disabled={isExporting || isImporting}
            onClick={() => void handleExport()}
            className="mt-5 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white cursor-pointer hover:bg-accent-hover disabled:cursor-wait disabled:opacity-50"
          >
            {isExporting ? "Собираем всю базу…" : "Скачать полную резервную копию"}
          </button>
        </section>

        <section className="rounded-2xl border border-border bg-bg-card p-5">
          <h3 className="text-sm font-semibold text-text-primary">2. Импорт на виртуальной машине</h3>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            Импорт заменит локальную базу этого профиля Chrome. Максимальный размер файла — {Math.round(MAX_BACKUP_FILE_SIZE / 1024 / 1024)} МБ.
          </p>

          <label className="mt-5 inline-flex rounded-xl border border-border bg-bg-input px-4 py-2.5 text-sm font-medium text-text-secondary cursor-pointer hover:border-border-hover hover:text-text-primary">
            Выбрать JSON-бэкап
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              disabled={isImporting}
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </label>

          {preview && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Создан" value={new Date(preview.createdAt).toLocaleString("ru-RU")} />
                <Stat label="Версия" value={preview.extensionVersion || "—"} />
                <Stat label="Поисков" value={preview.sessions.toLocaleString("ru-RU")} />
                <Stat label="Снимков тем" value={preview.topicSnapshots.toLocaleString("ru-RU")} />
                <Stat label="Ключей данных" value={(preview.storageKeys + preview.localStorageKeys).toLocaleString("ru-RU")} />
                <Stat label="Тем в очереди" value={preview.queueItems.toLocaleString("ru-RU")} />
              </div>

              {preview.ignoredSecretKeys.length > 0 && (
                <p className="text-[11px] leading-5 text-text-muted">
                  Секретные поля не импортируются: {preview.ignoredSecretKeys.join(", ")}.
                </p>
              )}

              {confirmImport && (
                <p className="rounded-xl border border-error/25 bg-error/8 px-3 py-2 text-xs leading-5 text-error">
                  Подтвердите замену: текущие сканы и настройки этого профиля будут заменены данными из файла.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={() => void handleImport()}
                  className={`rounded-xl border px-4 py-2.5 text-sm font-semibold cursor-pointer disabled:cursor-wait disabled:opacity-50 ${
                    confirmImport
                      ? "border-error/40 bg-error/12 text-error hover:bg-error/18"
                      : "border-border bg-bg-input text-text-primary hover:border-border-hover"
                  }`}
                >
                  {isImporting
                    ? "Импортируем и проверяем…"
                    : confirmImport
                      ? "Подтвердить замену базы"
                      : "Импортировать и заменить"}
                </button>
                {confirmImport && !isImporting && (
                  <button
                    type="button"
                    onClick={() => setConfirmImport(false)}
                    className="rounded-xl px-3 py-2 text-xs text-text-muted cursor-pointer hover:text-text-primary"
                  >
                    Отмена
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {message && <p className="rounded-xl border border-success/20 bg-success/8 px-4 py-3 text-sm text-success">{message}</p>}
      {error && <p className="rounded-xl border border-error/20 bg-error/8 px-4 py-3 text-sm text-error">{error}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-bg-input/60 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-1 truncate text-xs font-semibold tabular-nums text-text-primary" title={value}>{value}</p>
    </div>
  );
}
