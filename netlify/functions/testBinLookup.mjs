import * as cheerio from "cheerio";

export default async (request) => {
  try {
    const url = new URL(request.url);
    const prefix = (url.searchParams.get("prefix") || "").toUpperCase();
    const suffix = (url.searchParams.get("suffix") || "").toUpperCase();

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

    const html = await response.text();
    const $ = cheerio.load(html);

    const hasViewScheduleText = /view schedule/i.test(html);
    const hasPdfLink = /\.pdf/i.test(html);
    const hasTully = /TULLYBRANNIGAN/i.test(html);

    const anchors = [];
    $("a").each((_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      const href = $(el).attr("href") || "";
      if (/view schedule/i.test(text) || /\.pdf/i.test(href)) {
        anchors.push({ text, href });
      }
    });

    const lines = html
      .split(/\r?\n/)
      .filter(
        (line) =>
          /view schedule/i.test(line) ||
          /\.pdf/i.test(line) ||
          /TULLYBRANNIGAN/i.test(line) ||
          /BT33 0HR/i.test(line)
      )
      .slice(0, 50);

    return new Response(
      JSON.stringify(
        {
          success: true,
          hasViewScheduleText,
          hasPdfLink,
          hasTully,
          anchorCount: anchors.length,
          anchors: anchors.slice(0, 20),
          matchingLines: lines,
        },
        null,
        2
      ),
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
