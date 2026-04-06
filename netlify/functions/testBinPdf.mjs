export default async () => {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.js");

    const pdfUrl =
      "https://www.newrymournedown.org/bin-collections/FRI-Z1.pdf?v=5";

    const response = await fetch(pdfUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    let fullText = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(" ");
      fullText += ` ${pageText}`;
    }

    const normalizedText = fullText.replace(/\s+/g, " ").trim();

    const match = normalizedText.match(/collection day is\s+([A-Za-z]+)/i);
    const collectionDay = match ? match[1] : "Not found";

    return new Response(
      JSON.stringify({
        success: true,
        collectionDay,
        match: match ? match[0] : null,
        preview: normalizedText.slice(0, 1500),
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  } catch (error) {
    console.error("testBinPdf error:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || "Unknown error",
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      }
    );
  }
};
