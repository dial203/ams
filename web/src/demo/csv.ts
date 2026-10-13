/**
 * CSV for the demo backend: an RFC 4180 reader (quoted fields, doubled quotes, CRLF or LF,
 * line breaks inside quotes) and a writer that quotes like Python's `csv.writer` (only
 * when a cell contains the delimiter, a quote or a line break), so exports look like the
 * API's.
 */

export type Delimiter = "," | ";" | "\t" | "|";
const DELIMITERS: readonly Delimiter[] = [",", ";", "\t", "|"];

/** Parses CSV text into rows of raw cells (no trimming). A leading BOM is dropped. */
export function parseCsv(text: string, delimiter: Delimiter = ","): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
      i++;
    } else if (ch === delimiter) {
      endCell();
      i++;
    } else if (ch === "\r" || ch === "\n") {
      endRow();
      i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
    } else {
      cell += ch;
      i++;
    }
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

/** The delimiter that splits the header line into the most columns (comma on a tie). */
export function sniffDelimiter(text: string): Delimiter {
  const firstLine = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/, 1)[0] ?? "";
  let best: Delimiter = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const n = parseCsv(firstLine, d)[0]?.length ?? 0;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

function quoteCell(value: string, delimiter: string): string {
  return value.includes(delimiter) || value.includes('"') || value.includes("\n") || value.includes("\r")
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/** Rows to CSV text, one `\n`-terminated line per row. */
export function writeCsv(rows: readonly (readonly string[])[], delimiter = ","): string {
  return rows.map((r) => r.map((c) => quoteCell(c, delimiter)).join(delimiter) + "\n").join("");
}
