export interface ParsedAdobeSaleRow {
  rowNumber: number;
  soldAt: string;
  assetId: string;
  title: string;
  licenseType: string;
  revenue: number;
  contentType: string;
  fileName: string;
  contributor: string;
  size: string;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV повреждён: не закрыта кавычка");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.trim().length > 0)) rows.push(row);
  }
  return rows;
}

function isHeader(row: string[]): boolean {
  const values = row.map((value) => value.trim().toLocaleLowerCase());
  return values.some((value) => value === "id" || value.includes("asset id"))
    && values.some((value) => value === "date" || value.includes("sold"));
}

function parseRevenue(value: string, rowNumber: number): number {
  let normalized = value.trim().replace(/[^0-9,.-]/g, "");
  if (normalized.includes(".") && normalized.includes(",")) {
    normalized = normalized.replace(/,/g, "");
  } else {
    normalized = normalized.replace(",", ".");
  }
  const revenue = Number(normalized);
  if (!Number.isFinite(revenue) || revenue < 0) {
    throw new Error(`Строка ${rowNumber}: некорректный доход «${value}»`);
  }
  return revenue;
}

export function parseAdobeSalesCsv(text: string): ParsedAdobeSaleRow[] {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (rows.length === 0) throw new Error("CSV пуст");
  const dataRows = isHeader(rows[0]) ? rows.slice(1) : rows;

  return dataRows.map((row, index) => {
    const rowNumber = index + (dataRows === rows ? 1 : 2);
    if (row.length !== 9) {
      throw new Error(`Строка ${rowNumber}: ожидалось 9 колонок, найдено ${row.length}`);
    }
    const [rawDate, rawAssetId, rawTitle, rawLicense, rawRevenue, rawType, rawFile, rawContributor, rawSize] = row;
    const assetId = rawAssetId.trim();
    if (!/^\d{7,16}$/.test(assetId)) {
      throw new Error(`Строка ${rowNumber}: некорректный Asset ID «${rawAssetId}»`);
    }
    const timestamp = Date.parse(rawDate.trim());
    if (!Number.isFinite(timestamp)) {
      throw new Error(`Строка ${rowNumber}: некорректная дата «${rawDate}»`);
    }
    const title = rawTitle.trim();
    if (!title) throw new Error(`Строка ${rowNumber}: отсутствует название работы`);

    return {
      rowNumber,
      soldAt: new Date(timestamp).toISOString(),
      assetId,
      title,
      licenseType: rawLicense.trim(),
      revenue: parseRevenue(rawRevenue, rowNumber),
      contentType: rawType.trim(),
      fileName: rawFile.trim(),
      contributor: rawContributor.trim(),
      size: rawSize.trim(),
    };
  });
}
