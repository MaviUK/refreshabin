import * as cheerio from "cheerio";

const DAY_MAP = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
  SUN: "Sunday",
};

function extractCollectionDay(pdfUrl) {
  const match = pdfUrl.match(/\/([A-Z]{3})-[^/]+\.pdf/i);
  const code = match ? match[1].toUpperCase() : null;
  return code ? DAY_MAP[code] || code : null;
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const prefix = (url.searchParams.get("prefix") || "").toUpperCase();
    const suffix = (url.searchParams.get("suffix") || "").toUpperCase();

    if (!prefix || !suffix) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing prefix or suffix. Example: ?prefix=BT33&suffix=0HR",
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        }
      );
    }

    const form = new URLSearchParams();
    form.set("postcode1", prefix);
    form.set("postcode2", suffix);
    form.set("search", "SEARCH");

    const response = await fetch(
      "https://www.newrymournedown.org/weekly-bin-collection-and-calendar#search",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      }
    );

    if (!response.ok) {
      throw new Error(`Council lookup failed: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const results = [];

    $("a").each((_, el) => {
      const linkText = $(el).text().trim();
      const href = $(el).attr("href") || "";

      if (!/view schedule/i.test(linkText) || !/\.pdf/i.test(href)) return;

      const rowText = $(el).closest("tr").text().replace(/\s+/g, " ").trim();
      const addressText =
        rowText.replace(/view schedule/i, "").trim() ||
        $(el).parent().prev().text().replace(/\s+/g, " ").trim();

      const pdfUrl = href.startsWith("http")
        ? href
        : `https://www.newrymournedown.org${href.startsWith("/") ? "" : "/"}${href}`;

      results.push({
        address: addressText,
        pdfUrl,
        collectionDay: extractCollectionDay(pdfUrl),
      });
    });

    return new Response(
  JSON.stringify({
    success: true,
    preview: html.slice(0, 3000), // first 3000 chars
  }),
  {
    status: 200,
    headers: { "content-type": "application/json" },
  }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      }
    );
  }
};
