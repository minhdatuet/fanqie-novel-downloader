import JSZip from "jszip";
import { createHash } from "node:crypto";

import type { BookInfo, StoredChapter } from "../types.js";
import { buildDescriptionHtml, textToXhtmlFragment } from "./text.js";

const EPUB_NAMESPACE = Uint8Array.from([
    0x6b, 0xa7, 0xb8, 0x10, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8
]);

interface EpubOptions
{
    book: BookInfo;
    description?: string;
    translated: boolean;
}

export async function buildEpubBuffer(
    options: EpubOptions,
    chapters: readonly StoredChapter[]
): Promise<Buffer>
{
    const zip = new JSZip();
    const language = options.translated ? "vi" : "zh";
    const hasIntro = Boolean(options.description?.trim());
    const introTitle = language === "vi" ? "Giới thiệu" : "简介";

    zip.file("mimetype", "application/epub+zip", {
        compression: "STORE"
    });

    const uuid = createStableUuid(options.book.bookId);
    const title = options.translated ? `${options.book.title} - Bản dịch` : options.book.title;
    const chapterFiles: string[] = [];

    if (hasIntro)
    {
        zip.file("OEBPS/intro.xhtml", buildIntroDocument(title, options.description ?? "", language), {
            compression: "DEFLATE"
        });
    }

    for (let index = 0; index < chapters.length; index += 1)
    {
        const chapter = chapters[index];

        if (!chapter)
        {
            continue;
        }

        const fileName = `OEBPS/chapter_${String(index + 1).padStart(4, "0")}.xhtml`;
        chapterFiles.push(fileName);

        zip.file(fileName, buildChapterDocument(chapter.title, chapter.content, language), {
            compression: "DEFLATE"
        });
    }

    zip.file("META-INF/container.xml", buildContainerXml(), {
        compression: "DEFLATE"
    });

    zip.file("OEBPS/nav.xhtml", buildNavDocument(title, introTitle, hasIntro, chapters, language), {
        compression: "DEFLATE"
    });

    zip.file("OEBPS/toc.ncx", buildTocDocument(title, uuid, introTitle, hasIntro, chapters), {
        compression: "DEFLATE"
    });

    zip.file("OEBPS/content.opf", buildOpfDocument({
        book: options.book,
        chapterFiles,
        description: options.description ?? "",
        hasIntro,
        language,
        introTitle,
        title,
        uuid
    }), {
        compression: "DEFLATE"
    });

    zip.file("OEBPS/styles/book.css", buildStylesheet(), {
        compression: "DEFLATE"
    });

    return Buffer.from(await zip.generateAsync({
        type: "uint8array",
        compression: "DEFLATE",
        mimeType: "application/epub+zip"
    }));
}

function buildContainerXml(): string
{
    return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

function buildOpfDocument(params: {
    book: BookInfo;
    chapterFiles: readonly string[];
    description: string;
    hasIntro: boolean;
    language: "vi" | "zh";
    introTitle: string;
    title: string;
    uuid: string;
}): string
{
    const manifestItems = [
        `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
        `<item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
        `<item id="css" href="styles/book.css" media-type="text/css"/>`,
        ...(params.hasIntro ? [`<item id="intro" href="intro.xhtml" media-type="application/xhtml+xml"/>`] : []),
        ...params.chapterFiles.map((fileName, index) =>
        {
            const id = `chapter-${index + 1}`;
            return `<item id="${id}" href="${basename(fileName)}" media-type="application/xhtml+xml"/>`;
        })
    ];
    const spineItems = [
        ...(params.hasIntro ? [`<itemref idref="intro"/>`] : []),
        ...params.chapterFiles.map((_, index) => `<itemref idref="chapter-${index + 1}"/>`)
    ].join("\n    ");
    const creator = escapeXml(params.book.author ?? "");
    const description = escapeXml(params.description.trim());
    const tags = params.book.tags.join(", ");

    return `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${params.uuid}</dc:identifier>
    <dc:title>${escapeXml(params.title)}</dc:title>
    <dc:language>${params.language}</dc:language>
    ${creator ? `<dc:creator>${creator}</dc:creator>` : ""}
    ${tags ? `<dc:subject>${escapeXml(tags)}</dc:subject>` : ""}
    ${description ? `<dc:description>${description}</dc:description>` : ""}
    <meta property="dcterms:modified">${formatUtcTimestamp(new Date())}</meta>
    <meta name="generator" content="Tomato Downloader"/>
  </metadata>
  <manifest>
    ${manifestItems.join("\n    ")}
  </manifest>
  <spine toc="toc">
    ${spineItems}
  </spine>
</package>
`;
}

function buildNavDocument(
    title: string,
    introTitle: string,
    hasIntro: boolean,
    chapters: readonly StoredChapter[],
    language: "vi" | "zh"
): string
{
    const tocItems = [
        ...(hasIntro ? [`<li><a href="intro.xhtml">${escapeXml(introTitle)}</a></li>`] : []),
        ...chapters
            .map((chapter, index) =>
            {
                const href = `chapter_${String(index + 1).padStart(4, "0")}.xhtml`;
                return `<li><a href="${href}">${escapeXml(chapter.title)}</a></li>`;
            })
    ]
        .join("\n      ");

    return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}">
  <head>
    <title>${escapeXml(title)}</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>${escapeXml(title)}</h1>
      <ol>
      ${tocItems}
      </ol>
    </nav>
  </body>
</html>
`;
}

function buildTocDocument(
    title: string,
    uuid: string,
    introTitle: string,
    hasIntro: boolean,
    chapters: readonly StoredChapter[]
): string
{
    const navPoints = [
        ...(hasIntro
            ? [`    <navPoint id="navPoint-0" playOrder="1">
      <navLabel><text>${escapeXml(introTitle)}</text></navLabel>
      <content src="intro.xhtml"/>
    </navPoint>`]
            : []),
        ...chapters
            .map((chapter, index) =>
            {
                const playOrder = hasIntro ? index + 2 : index + 1;
                const href = `chapter_${String(index + 1).padStart(4, "0")}.xhtml`;
                return `    <navPoint id="navPoint-${playOrder}" playOrder="${playOrder}">
      <navLabel><text>${escapeXml(chapter.title)}</text></navLabel>
      <content src="${href}"/>
    </navPoint>`;
            })
    ]
        .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(uuid)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>
`;
}

function buildChapterDocument(title: string, content: string, language: "vi" | "zh"): string
{
    const body = textToXhtmlFragment(content);
    const escapedTitle = escapeXml(title);

    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${language}">
  <head>
    <title>${escapedTitle}</title>
    <link rel="stylesheet" type="text/css" href="styles/book.css"/>
  </head>
  <body>
    <h1>${escapedTitle}</h1>
    ${body}
  </body>
</html>
`;
}

function buildIntroDocument(title: string, description: string, language: "vi" | "zh"): string
{
    const body = buildDescriptionHtml(description);

    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${language}">
  <head>
    <title>${escapeXml(title)}</title>
    <link rel="stylesheet" type="text/css" href="styles/book.css"/>
  </head>
  <body>
    <h1>${escapeXml(title)}</h1>
    <h2>${language === "vi" ? "Giới thiệu" : "简介"}</h2>
    ${body}
  </body>
</html>
`;
}

function buildStylesheet(): string
{
    return `body {
  font-family: serif;
  line-height: 1.6;
  color: #000;
}

h1 {
  font-size: 1.35em;
  margin: 0 0 1em;
}

p {
  margin: 0 0 0.9em;
  text-indent: 2em;
}

p.no-indent {
  text-indent: 0;
}
`;
}

function createStableUuid(bookId: string): string
{
    const namespace = Buffer.from(EPUB_NAMESPACE);
    const name = Buffer.from(bookId, "utf8");
    const hash = createHash("sha1").update(namespace).update(name).digest();
    const bytes = Buffer.from(hash.subarray(0, 16));

    const byte6 = bytes[6] ?? 0;
    const byte8 = bytes[8] ?? 0;
    bytes[6] = (byte6 & 0x0f) | 0x50;
    bytes[8] = (byte8 & 0x3f) | 0x80;

    const hex = bytes.toString("hex");
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32)
    ].join("-");
}

function formatUtcTimestamp(date: Date): string
{
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function basename(path: string): string
{
    return path.split(/[\\/]/).pop() ?? path;
}

function escapeXml(input: string): string
{
    return input
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&apos;");
}
