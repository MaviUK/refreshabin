import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export async function handler() {
  try {
    const pdfUrl =
      "https://www.newrymournedown.org/bin-collections/FRI-Z1.pdf?v=5";

    const response = await fetch(pdfUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(" ");
      fullText += ` ${pageText}`;
    }

    const normalizedText = fullText.replace(/\s+/g, " ").trim();

    const sentenceMatch = normalizedText.match(
      /Your .*? collection day is ([A-Za-z]+)/i
    );

    const collectionDay = sentenceMatch ? sentenceMatch[1] : "Not found";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        collectionDay,
        match: sentenceMatch ? sentenceMatch[0] : null,
        preview: normalizedText.slice(0, 1500),
      }),
    };
  } catch (error) {
    console.error("testBinPdf error:", error);

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
      }),
    };
  }
}
