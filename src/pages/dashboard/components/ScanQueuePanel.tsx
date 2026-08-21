import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addMainTopics,
  clearFinishedMainTopicQueueItems,
  configureMainTopicQueue,
  getMainTopicQueue,
  pauseMainTopicQueue,
  removeMainTopicQueueItem,
  retryMainTopicQueueItem,
  startMainTopicQueue,
  stopMainTopicQueueNow,
} from "@shared/api/scan-queue";
import { getAllTopicHistory } from "@shared/api/history";
import type {
  MainTopicQueueItemStatus,
  MainTopicQueueState,
  MainTopicQueueStatus,
} from "@shared/types";

const STATUS_LABELS: Record<MainTopicQueueStatus, string> = {
  idle: "Не запущена",
  running: "Работает",
  paused: "На паузе",
  blocked: "Остановлена Adobe",
  completed: "Завершена",
};

const ITEM_STATUS_LABELS: Record<MainTopicQueueItemStatus, string> = {
  pending: "Ожидает",
  running: "Сканируется",
  completed: "Готово",
  failed: "Ошибка",
  blocked: "Заблокировано",
};

function statusClass(status: MainTopicQueueItemStatus): string {
  if (status === "completed") return "text-success";
  if (status === "running") return "text-accent";
  if (status === "failed" || status === "blocked") return "text-error";
  return "text-text-muted";
}

function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

export default function ScanQueuePanel() {
  const [queue, setQueue] = useState<MainTopicQueueState | null>(null);
  const [topicsText, setTopicsText] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [delayMin, setDelayMin] = useState(10);
  const [delayMax, setDelayMax] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const settingsInitializedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const state = await getMainTopicQueue();
      setQueue(state);
      if (!settingsInitializedRef.current) {
        settingsInitializedRef.current = true;
        setDelayMin(state.delayMinMinutes);
        setDelayMax(state.delayMaxMinutes);
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 2_500);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const counts = useMemo(() => {
    const items = queue?.items ?? [];
    return {
      pending: items.filter((item) => item.status === "pending").length,
      running: items.filter((item) => item.status === "running").length,
      completed: items.filter((item) => item.status === "completed").length,
      failed: items.filter((item) => item.status === "failed" || item.status === "blocked").length,
    };
  }, [queue]);

  const mutate = async (operation: () => Promise<MainTopicQueueState>) => {
    setBusy(true);
    setError("");
    try {
      setQueue(await operation());
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = () => {
    const topics = topicsText
      .split(/\r?\n|;/)
      .map((topic) => topic.trim())
      .filter(Boolean);
    if (topics.length === 0) return;
    void mutate(async () => {
      const state = await addMainTopics(topics);
      setTopicsText("");
      return state;
    });
  };

  const handleStart = () => {
    void mutate(async () => {
      await configureMainTopicQueue(delayMin, delayMax);
      return startMainTopicQueue(localInputToIso(scheduleAt));
    });
  };

  const handleAddFromHistory = () => {
    void mutate(async () => {
      const records = await getAllTopicHistory();
      const mainTopics = [...new Map(
        records
          .map((record) => record.mainTopic?.trim() ?? "")
          .filter(Boolean)
          .map((mainTopic) => [mainTopic.toLocaleLowerCase(), mainTopic]),
      ).values()];
      return addMainTopics(mainTopics);
    });
  };

  if (!queue) {
    return <div className="py-16 text-center text-sm text-text-muted">Загрузка очереди…</div>;
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-text-primary">Очередь главных тем</h2>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              queue.status === "running"
                ? "border-success/25 bg-success/10 text-success"
                : queue.status === "blocked"
                  ? "border-error/25 bg-error/10 text-error"
                  : "border-border bg-bg-card text-text-secondary"
            }`}>
              {STATUS_LABELS[queue.status]}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Ожидает: {counts.pending} · Готово: {counts.completed} · Ошибки: {counts.failed}
            {queue.nextRunAt && <> · Следующий запуск: {new Date(queue.nextRunAt).toLocaleString("ru-RU")}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {queue.status === "running" || counts.running > 0 ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void mutate(stopMainTopicQueueNow)}
                className="rounded-xl border border-error/30 bg-error/8 px-4 py-2 text-sm font-medium text-error cursor-pointer hover:bg-error/12 disabled:opacity-50"
              >
                Остановить сейчас
              </button>
              {queue.status === "running" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void mutate(pauseMainTopicQueue)}
                  className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-2 text-sm font-medium text-warning cursor-pointer disabled:opacity-50"
                >
                  Пауза после текущей
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              disabled={busy || counts.pending === 0}
              onClick={handleStart}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white cursor-pointer hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              Запустить очередь
            </button>
          )}
          <button
            type="button"
            disabled={busy || queue.items.length === 0}
            onClick={() => void mutate(clearFinishedMainTopicQueueItems)}
            className="rounded-xl border border-border bg-bg-input px-4 py-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary disabled:opacity-40"
          >
            Очистить готовые
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-warning/20 bg-warning/5 px-5 py-3 text-xs leading-relaxed text-warning">
        Очередь работает только в отдельном профиле Chrome без входа в Adobe. Оставьте вкладку Adobe Stock открытой. При 403, 429, DataDome, активной Adobe-сессии или деградации парсера очередь остановится.
      </div>

      {error && (
        <div className="rounded-xl border border-error/20 bg-error/8 px-4 py-3 text-sm text-error">{error}</div>
      )}
      {queue.lastError && !error && (
        <div className="rounded-xl border border-error/20 bg-error/8 px-4 py-3 text-sm text-error">{queue.lastError}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded-2xl border border-border bg-bg-card p-5">
          <label className="text-sm font-medium text-text-primary">Добавить главные темы</label>
          <p className="mt-1 text-xs text-text-muted">Одна тема на строку. Повторы среди ожидающих тем не добавляются.</p>
          <textarea
            value={topicsText}
            onChange={(event) => setTopicsText(event.target.value)}
            rows={6}
            placeholder={"romantic date\ntrail running\ncamp kids"}
            className="mt-3 w-full resize-y rounded-xl border border-border bg-bg-input px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || topicsText.trim().length === 0}
              onClick={handleAdd}
              className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-medium text-accent cursor-pointer hover:bg-accent/15 disabled:opacity-40"
            >
              Добавить в очередь
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleAddFromHistory}
              className="rounded-xl border border-border bg-bg-input px-4 py-2 text-sm font-medium text-text-secondary cursor-pointer hover:text-text-primary disabled:opacity-40"
            >
              Добавить главные из базы
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-bg-card p-5">
          <h3 className="text-sm font-medium text-text-primary">Расписание</h3>
          <label className="mt-3 block text-xs text-text-muted">Начать не раньше</label>
          <input
            type="datetime-local"
            value={scheduleAt}
            onChange={(event) => setScheduleAt(event.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
          />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs text-text-muted">
              Пауза от, мин.
              <input
                type="number"
                min={1}
                value={delayMin}
                onChange={(event) => setDelayMin(Number(event.target.value))}
                className="mt-1 w-full rounded-xl border border-border bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
              />
            </label>
            <label className="text-xs text-text-muted">
              Пауза до, мин.
              <input
                type="number"
                min={1}
                value={delayMax}
                onChange={(event) => setDelayMax(Number(event.target.value))}
                className="mt-1 w-full rounded-xl border border-border bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
              />
            </label>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
            По умолчанию между полными сканами главных тем выдерживается случайная пауза 10–20 минут.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-bg-card">
        <div className="grid grid-cols-[52px_minmax(220px,1fr)_140px_170px_110px] border-b border-border bg-bg-secondary px-4 py-3 text-[11px] uppercase tracking-wider text-text-muted">
          <span>#</span>
          <span>Главная тема</span>
          <span>Статус</span>
          <span>Последний запуск</span>
          <span className="text-right">Действия</span>
        </div>
        {queue.items.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-text-muted">Очередь пока пуста</div>
        ) : queue.items.map((item, index) => (
          <div
            key={item.id}
            className="grid grid-cols-[52px_minmax(220px,1fr)_140px_170px_110px] items-center border-b border-border/70 px-4 py-3 text-sm last:border-b-0"
          >
            <span className="text-xs text-text-muted">{index + 1}</span>
            <div className="min-w-0">
              <p className="truncate font-medium text-text-primary">{item.topic}</p>
              {item.error && <p className="mt-0.5 truncate text-[11px] text-error" title={item.error}>{item.error}</p>}
            </div>
            <span className={`text-xs font-medium ${statusClass(item.status)}`}>{ITEM_STATUS_LABELS[item.status]}</span>
            <span className="text-xs text-text-muted">
              {item.startedAt ? new Date(item.startedAt).toLocaleString("ru-RU") : "—"}
            </span>
            <div className="flex justify-end gap-2">
              {(item.status === "failed" || item.status === "blocked") && (
                <button
                  type="button"
                  title="Вернуть в ожидание"
                  onClick={() => void mutate(() => retryMainTopicQueueItem(item.id))}
                  className="rounded-lg border border-border bg-bg-input px-2 py-1 text-xs text-text-secondary cursor-pointer hover:text-text-primary"
                >
                  ↻
                </button>
              )}
              {item.status !== "running" && (
                <button
                  type="button"
                  title="Удалить из очереди"
                  onClick={() => void mutate(() => removeMainTopicQueueItem(item.id))}
                  className="rounded-lg border border-border bg-bg-input px-2 py-1 text-xs text-text-muted cursor-pointer hover:border-error/30 hover:text-error"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
