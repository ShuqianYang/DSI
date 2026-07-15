#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

const input = process.argv[2];

if (!input) {
  console.error("Usage: node profile-csv.mjs <file.csv>");
  process.exit(2);
}

const filePath = path.resolve(process.cwd(), input);
const content = await readFile(filePath, "utf8");
const rows = parseCsv(content.trim());

if (rows.length === 0) {
  console.log(JSON.stringify({ file: input, rows: 0, columns: [] }, null, 2));
  process.exit(0);
}

const headers = rows[0].map((header, index) => header.trim() || `column_${index + 1}`);
const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== ""));
const columns = headers.map((name, index) => {
  const values = dataRows.map((row) => row[index] ?? "");
  const missing = values.filter((value) => value.trim() === "").length;
  const samples = Array.from(new Set(values.filter((value) => value.trim() !== "").slice(0, 5)));
  return { name, missing, samples };
});

console.log(
  JSON.stringify(
    {
      file: input,
      rows: dataRows.length,
      columns: columns.length,
      profile: columns,
    },
    null,
    2,
  ),
);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}
