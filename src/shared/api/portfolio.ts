import type { OwnPortfolioAsset, OwnSaleEvent } from "@shared/types";

const ASSETS_KEY = "topicHunter_ownPortfolioAssets";
const SALES_KEY = "topicHunter_ownSaleEvents";

let writeQueue: Promise<void> = Promise.resolve();

function validIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function queuedWrite(operation: () => Promise<void>): Promise<void> {
  const result = writeQueue.then(operation);
  writeQueue = result.catch(() => undefined);
  return result;
}

export async function getOwnPortfolioAssets(): Promise<OwnPortfolioAsset[]> {
  const data = await chrome.storage.local.get(ASSETS_KEY);
  const assets = Array.isArray(data[ASSETS_KEY])
    ? (data[ASSETS_KEY] as OwnPortfolioAsset[])
    : [];
  return [...assets].sort((left, right) => Date.parse(right.uploadedAt) - Date.parse(left.uploadedAt));
}

export async function getOwnSaleEvents(): Promise<OwnSaleEvent[]> {
  const data = await chrome.storage.local.get(SALES_KEY);
  const sales = Array.isArray(data[SALES_KEY])
    ? (data[SALES_KEY] as OwnSaleEvent[])
    : [];
  return [...sales].sort((left, right) => Date.parse(right.soldAt) - Date.parse(left.soldAt));
}

export function saveOwnPortfolioAsset(input: {
  assetId: string;
  topic: string;
  uploadedAt: string;
  isAi: boolean;
}): Promise<void> {
  const assetId = input.assetId.trim();
  const topic = input.topic.trim();
  if (!/^\d{7,12}$/.test(assetId)) throw new Error("Asset ID должен состоять из 7–12 цифр");
  if (!topic || topic.length > 200) throw new Error("Укажите тему длиной до 200 символов");
  if (!validIsoDate(input.uploadedAt)) throw new Error("Некорректная дата загрузки");

  return queuedWrite(async () => {
    const assets = await getOwnPortfolioAssets();
    const existing = assets.find((asset) => asset.assetId === assetId);
    const next: OwnPortfolioAsset = existing
      ? { ...existing, topic, uploadedAt: input.uploadedAt, isAi: input.isAi }
      : {
          id: crypto.randomUUID(),
          assetId,
          topic,
          uploadedAt: input.uploadedAt,
          isAi: input.isAi,
          createdAt: new Date().toISOString(),
        };
    await chrome.storage.local.set({
      [ASSETS_KEY]: [next, ...assets.filter((asset) => asset.assetId !== assetId)],
    });
  });
}

export function saveOwnSaleEvent(input: {
  assetId: string;
  soldAt: string;
  revenue: number | null;
  note: string;
}): Promise<void> {
  const assetId = input.assetId.trim();
  const note = input.note.trim();
  if (!/^\d{7,12}$/.test(assetId)) throw new Error("Выберите корректный Asset ID");
  if (!validIsoDate(input.soldAt)) throw new Error("Некорректная дата продажи");
  if (input.revenue !== null && (!Number.isFinite(input.revenue) || input.revenue < 0 || input.revenue > 1_000_000)) {
    throw new Error("Некорректная сумма");
  }
  if (note.length > 500) throw new Error("Комментарий слишком длинный");

  return queuedWrite(async () => {
    const sales = await getOwnSaleEvents();
    const event: OwnSaleEvent = {
      id: crypto.randomUUID(),
      assetId,
      soldAt: input.soldAt,
      revenue: input.revenue,
      note,
      createdAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ [SALES_KEY]: [event, ...sales] });
  });
}

export async function removeOwnPortfolioAsset(id: string): Promise<void> {
  return queuedWrite(async () => {
    const assets = await getOwnPortfolioAssets();
    await chrome.storage.local.set({ [ASSETS_KEY]: assets.filter((asset) => asset.id !== id) });
  });
}

export async function removeOwnSaleEvent(id: string): Promise<void> {
  return queuedWrite(async () => {
    const sales = await getOwnSaleEvents();
    await chrome.storage.local.set({ [SALES_KEY]: sales.filter((sale) => sale.id !== id) });
  });
}
