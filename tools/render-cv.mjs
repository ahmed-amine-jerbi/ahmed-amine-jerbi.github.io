// Renders cv/source/cv-*.html to the PDFs the site links to.
// Usage (from the repo root): npm install && npm run cv
// Uses the installed Microsoft Edge, so no Playwright browser download is needed.
//
// Edge stamps every PDF with Creator "Mozilla/5.0 ... HeadlessChrome ... Edg/..." and Producer
// "Skia/PDF". cleanMetadata() rewrites the document information so it holds only the title, the
// author and the dates.
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versions = [
  { source: "cv/source/cv-en.html", output: "cv/Ahmed-Amine-Jerbi-CV-EN.pdf" },
  { source: "cv/source/cv-fr.html", output: "cv/Ahmed-Amine-Jerbi-CV-FR.pdf" },
];

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();

for (const { source, output } of versions) {
  await page.goto(pathToFileURL(path.join(root, source)).href, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const author = await page.evaluate(() => document.querySelector('meta[name="author"]')?.content ?? "");

  const printed = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true });
  const pdf = cleanMetadata(printed, author);
  await writeFile(path.join(root, output), pdf);

  const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  console.log(`Wrote ${output} (${pageCount} page${pageCount === 1 ? "" : "s"}, ${Math.round(pdf.length / 1024)} KB)`);
  if (pageCount > 1) {
    console.warn(`  ${source} runs past one A4 page. Trim it before sending.`);
  }
}

await browser.close();

// Replaces the PDF's document information dictionary with Title, Author, CreationDate and
// ModDate (dropping Creator and Producer), then shifts the cross-reference offsets to match.
// Handles the layout Edge writes: one classic xref table and an uncompressed Info object.
function cleanMetadata(buffer, author) {
  const pdf = buffer.toString("latin1");
  const trailerAt = pdf.lastIndexOf("trailer");
  const infoRef = /\/Info (\d+) 0 R/.exec(pdf.slice(trailerAt));
  const xrefAt = pdf.lastIndexOf("\nxref\n") + 1;
  if (trailerAt < 0 || !infoRef || xrefAt === 0 || pdf.indexOf("\nxref\n") + 1 !== xrefAt) {
    throw new Error("Unexpected PDF layout: expected one xref table and an Info entry in the trailer.");
  }

  const objStart = pdf.indexOf(`\n${infoRef[1]} 0 obj\n`) + 1;
  const objEnd = pdf.indexOf("endobj", objStart) + "endobj".length;
  if (objStart === 0 || objEnd > xrefAt) {
    throw new Error(`Info object ${infoRef[1]} not found before the xref table.`);
  }

  const oldInfo = pdf.slice(objStart, objEnd);
  const field = (key) => new RegExp(`/${key} (\\((?:\\\\.|[^\\\\)])*\\))`).exec(oldInfo)?.[1];
  const entries = [
    ["Title", field("Title")],
    ["Author", author && `(${author.replace(/[\\()]/g, "\\$&")})`],
    ["CreationDate", field("CreationDate")],
    ["ModDate", field("ModDate")],
  ].filter(([, value]) => value);
  const newInfo = `${infoRef[1]} 0 obj\n<<${entries.map(([key, value]) => `/${key} ${value}`).join("\n")}>>\nendobj`;
  const shift = newInfo.length - oldInfo.length;

  const xref = pdf.slice(xrefAt, trailerAt).replace(/^(\d{10}) (\d{5}) n/gm, (entry, offset, generation) => {
    const value = Number(offset);
    return value > objStart ? `${String(value + shift).padStart(10, "0")} ${generation} n` : entry;
  });
  const tail = pdf.slice(trailerAt).replace(/startxref\s+(\d+)/, (_, offset) => `startxref\n${Number(offset) + shift}`);

  return Buffer.from(pdf.slice(0, objStart) + newInfo + pdf.slice(objEnd, xrefAt) + xref + tail, "latin1");
}
