import path from "node:path";
import fs from "node:fs/promises";
import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Packer,
  ImageRun,
  BorderStyle,
  Table,
  TableCell,
  TableRow,
  WidthType,
  VerticalAlign,
  PageOrientation,
} from "docx";
import type { DailyReportOutput } from "./dailyReportTypes.js";
import { generateChartPng } from "../chartRenderData/chartPngGenerator.js";

export interface DailyReportDownloadResult {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

function filenameFor(report: DailyReportOutput, suffix: string): string {
  return `${report.date}_${report.report_type}_${suffix}`;
}

function markdownToDocxParagraphs(markdown: string): Array<Paragraph | Table> {
  const paragraphs: Array<Paragraph | Table> = [];
  const lines = markdown.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trim();
    if (!line) {
      paragraphs.push(new Paragraph({ text: "" }));
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const headingMap: Record<number, string> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6,
      };
      paragraphs.push(
        new Paragraph({
          text,
          heading: headingMap[level] as typeof HeadingLevel.HEADING_1,
        })
      );
      continue;
    }

    // Divider
    if (/^---+$/.test(line)) {
      paragraphs.push(
        new Paragraph({
          border: {
            bottom: { color: "3A3A4E", space: 1, style: BorderStyle.SINGLE, size: 6 },
          },
        })
      );
      continue;
    }

    // Markdown tables
    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith("|")) {
        tableLines.push((lines[index] ?? "").trim());
        index += 1;
      }
      index -= 1;

      const table = markdownTableToDocx(tableLines);
      if (table) {
        paragraphs.push(table);
        paragraphs.push(new Paragraph({ text: "", spacing: { after: 120 } }));
      }
      continue;
    }

    // Bold / italic runs (simple inline ** and *)
    const runs = parseInlineFormatting(line);
    paragraphs.push(new Paragraph({ children: runs }));
  }

  return paragraphs;
}

function markdownTableToDocx(lines: string[]): Table | undefined {
  const rows = lines
    .filter((line) => !/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(line))
    .map(parseMarkdownTableRow)
    .filter((cells) => cells.length > 0);

  if (rows.length === 0) return undefined;

  const columnCount = Math.max(...rows.map((row) => row.length));
  const widthPercent = Math.floor(100 / Math.max(columnCount, 1));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, rowIndex) =>
      new TableRow({
        children: Array.from({ length: columnCount }, (_, columnIndex) => {
          const text = row[columnIndex] ?? "";
          return new TableCell({
            width: { size: widthPercent, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            margins: {
              top: 120,
              bottom: 120,
              left: 120,
              right: 120,
            },
            shading: rowIndex === 0 ? { fill: "EAF2FF" } : undefined,
            children: [
              new Paragraph({
                children: parseInlineFormatting(text),
                alignment: AlignmentType.CENTER,
              }),
            ],
          });
        }),
      })
    ),
  });
}

function parseMarkdownTableRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseInlineFormatting(line: string): TextRun[] {
  const runs: TextRun[] = [];
  const pattern = /(\*\*|\*|`)(.+?)\1/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun(line.slice(lastIndex, match.index)));
    }

    const marker = match[1];
    const content = match[2];
    if (marker === "**") {
      runs.push(new TextRun({ text: content, bold: true }));
    } else if (marker === "*") {
      runs.push(new TextRun({ text: content, italics: true }));
    } else {
      runs.push(new TextRun({ text: content, font: "Courier New" }));
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < line.length) {
    runs.push(new TextRun(line.slice(lastIndex)));
  }

  if (runs.length === 0) {
    runs.push(new TextRun(line));
  }

  return runs;
}

export interface GenerateDailyReportDocxInput {
  report: DailyReportOutput;
  taskId: string;
  outputDir: string;
  cachedCharts?: Map<string, Buffer>;
}

export async function generateDailyReportDocx(
  input: GenerateDailyReportDocxInput
): Promise<DailyReportDownloadResult> {
  const { report, taskId, outputDir, cachedCharts = new Map() } = input;

  await fs.mkdir(outputDir, { recursive: true });

  const children: Array<Paragraph | Table> = [];

  // Title
  const reportTitle =
    report.report_type === "all"
      ? "边防总体日报"
      : report.report_type === "buckle"
        ? "卡口往来日报"
        : "预警事态日报";

  children.push(
    new Paragraph({
      text: reportTitle,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
    })
  );

  children.push(
    new Paragraph({
      text: `统计日期：${report.date}`,
      alignment: AlignmentType.CENTER,
    })
  );

  children.push(new Paragraph({ text: "" }));

  // Process markdown content: split by chart placeholders and render images
  const content = report.report_content || "";
  const chartPlaceholderPattern = /!\[([^\]]*)\]\(chart:\/\/([^)]+)\)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const usedChartIds = new Set<string>();

  while ((match = chartPlaceholderPattern.exec(content)) !== null) {
    const beforeChart = content.slice(lastIndex, match.index);
    children.push(...markdownToDocxParagraphs(beforeChart));

    const chartId = match[2];
    const chart = report.charts.find((c) => c.chart_id === chartId);

    if (chart) {
      usedChartIds.add(chartId);
      let pngBuffer = cachedCharts.get(chartId);
      if (!pngBuffer) {
        pngBuffer = await generateChartPng(chart);
        cachedCharts.set(chartId, pngBuffer);
      }

      const imageName = filenameFor(report, `${taskId}_${chartId}.png`);
      const imagePath = path.join(outputDir, imageName);
      await fs.writeFile(imagePath, pngBuffer);

      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: pngBuffer,
              transformation: { width: 520, height: 312 },
              type: "png",
            }),
          ],
          alignment: AlignmentType.CENTER,
        })
      );

      if (chart.title) {
        children.push(
          new Paragraph({
            text: chart.title,
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
          })
        );
      }
    }

    lastIndex = chartPlaceholderPattern.lastIndex;
  }

  // Remaining markdown after last chart
  if (lastIndex < content.length) {
    children.push(...markdownToDocxParagraphs(content.slice(lastIndex)));
  }

  // Append unused charts at the end
  for (const chart of report.charts) {
    if (usedChartIds.has(chart.chart_id)) continue;

    let pngBuffer = cachedCharts.get(chart.chart_id);
    if (!pngBuffer) {
      pngBuffer = await generateChartPng(chart);
      cachedCharts.set(chart.chart_id, pngBuffer);
    }

    const imageName = filenameFor(report, `${taskId}_${chart.chart_id}.png`);
    const imagePath = path.join(outputDir, imageName);
    await fs.writeFile(imagePath, pngBuffer);

    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: pngBuffer,
            transformation: { width: 520, height: 312 },
            type: "png",
          }),
        ],
        alignment: AlignmentType.CENTER,
      })
    );

    if (chart.title) {
      children.push(
        new Paragraph({
          text: chart.title,
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
        })
      );
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Microsoft YaHei",
            size: 22,
          },
          paragraph: {
            spacing: { line: 320, after: 120 },
          },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            size: 34,
            bold: true,
            color: "1F4E79",
          },
          paragraph: {
            spacing: { before: 240, after: 180 },
          },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            size: 28,
            bold: true,
            color: "2F5597",
          },
          paragraph: {
            spacing: { before: 220, after: 140 },
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.PORTRAIT,
            },
            margin: {
              top: 1080,
              right: 1080,
              bottom: 1080,
              left: 1080,
            },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);

  const docxName = filenameFor(report, `${taskId}.docx`);
  const docxPath = path.join(outputDir, docxName);
  await fs.writeFile(docxPath, buffer);

  return {
    buffer,
    filename: docxName,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

export async function readCachedDailyReportDocx(
  outputDir: string,
  filename: string
): Promise<Buffer | null> {
  const filePath = path.join(outputDir, filename);
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}
