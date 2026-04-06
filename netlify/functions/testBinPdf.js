import pdf from "pdf-parse";

export async function handler() {
  try {
    const pdfUrl =
      "https://www.newrymournedown.org/bin-collections/FRI-Z1.pdf?v=5";

    const response = await fetch(pdfUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const data = await pdf(buffer);
    const text = data.text || "";

    const match = text.match(/collection day is\s+([A-Za-z]+)/i);
    const collectionDay = match ? match[1] : "Not found";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        collectionDay,
        preview: text.slice(0, 1200),
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
      }),
    };
  }
}
