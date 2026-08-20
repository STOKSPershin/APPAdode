import { BUILT_IN_PHOTO_DATE_ANCHORS } from "@shared/data/adobe-photo-date-anchors";
import type {
  DateCalibrationAnchor,
  DateCalibrationSummary,
} from "@shared/types";

const STORAGE_KEY = "topicHunter_photoDateAnchors";
const DAY_MS = 86_400_000;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_LINES = 10_000;

interface ModelPoint {
  id: number;
  timestamp: number;
  date: string;
}

export interface DateEstimate {
  uploadDate: string | null;
  errorDays: number | null;
  extrapolated: boolean;
}

export interface CalibrationModel {
  anchors: DateCalibrationAnchor[];
  points: ModelPoint[];
  summary: DateCalibrationSummary;
}

export interface CalibrationImportResult {
  anchors: DateCalibrationAnchor[];
  accepted: number;
  skipped: number;
}

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function parseIsoDate(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return timestamp;
}

function normalizeDate(value: string): string | null {
  const clean = value.trim().replace(/\s+/g, " ");
  const isoTimestamp = parseIsoDate(clean);
  if (isoTimestamp !== null) return isoDate(isoTimestamp);

  const slash = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const timestamp = Date.UTC(Number(slash[3]), Number(slash[1]) - 1, Number(slash[2]));
    const normalized = isoDate(timestamp);
    return parseIsoDate(normalized) === timestamp ? normalized : null;
  }

  const monthName = clean.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})$/i,
  );
  if (!monthName) return null;

  const months = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const timestamp = Date.UTC(
    Number(monthName[3]),
    months.indexOf(monthName[1].toLowerCase()),
    Number(monthName[2]),
  );
  return isoDate(timestamp);
}

function seedAnchors(): DateCalibrationAnchor[] {
  return BUILT_IN_PHOTO_DATE_ANCHORS.map(([assetId, uploadDate]) => ({
    assetId,
    uploadDate,
    source: "seed" as const,
  }));
}

async function readImportedAnchors(): Promise<DateCalibrationAnchor[]> {
  if (hasChromeStorage()) {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return Array.isArray(data[STORAGE_KEY])
      ? (data[STORAGE_KEY] as DateCalibrationAnchor[])
      : [];
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DateCalibrationAnchor[]) : [];
  } catch {
    return [];
  }
}

async function writeImportedAnchors(anchors: DateCalibrationAnchor[]): Promise<void> {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEY]: anchors });
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(anchors));
}

function dedupeAndValidate(anchors: DateCalibrationAnchor[]): DateCalibrationAnchor[] {
  const byId = new Map<string, DateCalibrationAnchor>();

  for (const anchor of anchors) {
    if (!/^\d{7,12}$/.test(anchor.assetId)) continue;
    const normalizedDate = normalizeDate(anchor.uploadDate);
    if (!normalizedDate) continue;

    const existing = byId.get(anchor.assetId);
    if (existing && existing.uploadDate !== normalizedDate) {
      throw new Error(`ID ${anchor.assetId} указан с двумя разными датами`);
    }

    byId.set(anchor.assetId, { ...anchor, uploadDate: normalizedDate });
  }

  const sorted = [...byId.values()].sort(
    (left, right) => Number(left.assetId) - Number(right.assetId),
  );

  for (let index = 1; index < sorted.length; index += 1) {
    const previousDate = parseIsoDate(sorted[index - 1].uploadDate);
    const currentDate = parseIsoDate(sorted[index].uploadDate);
    if (previousDate === null || currentDate === null || currentDate < previousDate) {
      throw new Error(
        `Нарушена монотонность около ID ${sorted[index - 1].assetId} и ${sorted[index].assetId}`,
      );
    }
  }

  return sorted;
}

function buildPoints(anchors: DateCalibrationAnchor[]): ModelPoint[] {
  const grouped = new Map<string, number[]>();

  for (const anchor of anchors) {
    const ids = grouped.get(anchor.uploadDate) ?? [];
    ids.push(Number(anchor.assetId));
    grouped.set(anchor.uploadDate, ids);
  }

  return [...grouped.entries()]
    .map(([date, ids]) => {
      const sortedIds = [...ids].sort((left, right) => left - right);
      const middle = Math.floor(sortedIds.length / 2);
      const median = sortedIds.length % 2 === 1
        ? sortedIds[middle]
        : Math.round((sortedIds[middle - 1] + sortedIds[middle]) / 2);

      return {
        id: median,
        timestamp: parseIsoDate(date) ?? 0,
        date,
      };
    })
    .sort((left, right) => left.id - right.id);
}

function interpolateTimestamp(id: number, left: ModelPoint, right: ModelPoint): number {
  if (right.id === left.id) return left.timestamp;
  const ratio = (id - left.id) / (right.id - left.id);
  return left.timestamp + ratio * (right.timestamp - left.timestamp);
}

function calculateErrors(points: ModelPoint[]): { p90: number | null; max: number | null } {
  if (points.length < 3) return { p90: null, max: null };

  const errors: number[] = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    const estimated = interpolateTimestamp(points[index].id, points[index - 1], points[index + 1]);
    errors.push(Math.abs(estimated - points[index].timestamp) / DAY_MS);
  }

  errors.sort((left, right) => left - right);
  const p90Index = Math.max(0, Math.ceil(errors.length * 0.9) - 1);
  return {
    p90: Number(errors[p90Index].toFixed(2)),
    max: Number(errors[errors.length - 1].toFixed(2)),
  };
}

function addOneCalendarMonth(date: string): string {
  const timestamp = parseIsoDate(date);
  if (timestamp === null) return date;
  const value = new Date(timestamp);
  value.setUTCMonth(value.getUTCMonth() + 1);
  return isoDate(value.getTime());
}

function calibrationStatus(validUntil: string | null, now: Date): DateCalibrationSummary["status"] {
  if (!validUntil) return "invalid";
  const validUntilTimestamp = parseIsoDate(validUntil);
  if (validUntilTimestamp === null) return "invalid";

  const daysLeft = Math.ceil((validUntilTimestamp - now.getTime()) / DAY_MS);
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 7) return "due_soon";
  return "current";
}

export async function loadCalibrationAnchors(): Promise<DateCalibrationAnchor[]> {
  const imported = await readImportedAnchors();
  return dedupeAndValidate([...seedAnchors(), ...imported]);
}

export function buildCalibrationModel(
  anchors: DateCalibrationAnchor[],
  now = new Date(),
): CalibrationModel {
  const validAnchors = dedupeAndValidate(anchors);
  const points = buildPoints(validAnchors);
  const errors = calculateErrors(points);
  const earliestDate = points[0]?.date ?? null;
  const latestDate = points.at(-1)?.date ?? null;
  const validUntil = latestDate ? addOneCalendarMonth(latestDate) : null;

  return {
    anchors: validAnchors,
    points,
    summary: {
      anchorCount: validAnchors.length,
      datePointCount: points.length,
      earliestDate,
      latestDate,
      validUntil,
      p90ErrorDays: errors.p90,
      maxErrorDays: errors.max,
      modelVersion: `photo-id-v1:${validAnchors.length}:${latestDate ?? "none"}`,
      status: points.length >= 2 ? calibrationStatus(validUntil, now) : "invalid",
    },
  };
}

export async function loadCalibrationModel(now = new Date()): Promise<CalibrationModel> {
  return buildCalibrationModel(await loadCalibrationAnchors(), now);
}

export function estimateDateFromId(model: CalibrationModel, assetId: string): DateEstimate {
  const id = Number(assetId);
  const { points } = model;
  if (!Number.isSafeInteger(id) || points.length < 2) {
    return { uploadDate: null, errorDays: null, extrapolated: false };
  }

  let left = points[0];
  let right = points[1];
  let extrapolated = id < left.id;

  if (id >= points.at(-1)!.id) {
    left = points[points.length - 2];
    right = points[points.length - 1];
    extrapolated = id > right.id;
  } else if (id >= left.id) {
    for (let index = 1; index < points.length; index += 1) {
      if (id <= points[index].id) {
        left = points[index - 1];
        right = points[index];
        break;
      }
    }
  }

  const timestamp = interpolateTimestamp(id, left, right);
  const baseError = Math.max(1, Math.ceil(model.summary.p90ErrorDays ?? 1));
  const boundary = id < points[0].id ? points[0] : points.at(-1)!;
  const extrapolationDays = extrapolated
    ? Math.ceil(Math.abs(timestamp - boundary.timestamp) / DAY_MS)
    : 0;

  return {
    uploadDate: isoDate(timestamp),
    errorDays: baseError + extrapolationDays,
    extrapolated,
  };
}

export function parseCalibrationText(text: string): CalibrationImportResult {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    throw new Error("Файл слишком большой. Максимум 2 МБ");
  }

  const lines = text.split(/\r?\n/);
  if (lines.length > MAX_IMPORT_LINES) {
    throw new Error("Слишком много строк. Максимум 10 000");
  }

  const importedAt = new Date().toISOString();
  const anchors: DateCalibrationAnchor[] = [];
  let skipped = 0;

  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;
    if (/\b(videos?|illustrations?)\b/i.test(clean)) {
      skipped += 1;
      continue;
    }

    const idMatch = clean.match(/(?:FILE\s*#?\s*)?(\d{7,12})/i);
    const dateMatch = clean.match(
      /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4})/i,
    );
    const date = dateMatch ? normalizeDate(dateMatch[1]) : null;

    if (!idMatch || !date) {
      skipped += 1;
      continue;
    }

    anchors.push({
      assetId: idMatch[1],
      uploadDate: date,
      source: "import",
      importedAt,
    });
  }

  if (anchors.length === 0) {
    throw new Error("Не найдено ни одной строки с корректными ID и датой");
  }

  const validated = dedupeAndValidate(anchors);
  return { anchors: validated, accepted: validated.length, skipped };
}

export async function importCalibrationText(text: string): Promise<CalibrationImportResult> {
  const parsed = parseCalibrationText(text);
  const existing = await readImportedAnchors();
  const mergedAll = dedupeAndValidate([...seedAnchors(), ...existing, ...parsed.anchors]);
  const importedOnly = mergedAll.filter((anchor) => anchor.source === "import");
  await writeImportedAnchors(importedOnly);
  return parsed;
}
