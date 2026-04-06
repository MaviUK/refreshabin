export async function handler(event) {
  try {
    const prefix = event.queryStringParameters?.prefix || "BT33";
    const suffix = event.queryStringParameters?.suffix || "OHR";

    const response = await fetch(
      "https://www.newrymournedown.org/weekly-bin-collection-and-calendar",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0",
          "Origin": "https://www.newrymournedown.org",
          "Referer":
            "https://www.newrymournedown.org/weekly-bin-collection-and-calendar",
        },
        body: new URLSearchParams({
          PostcodeBT: prefix,
          PostcodeEND: suffix,
          postback: "1",
          submit_btn: "SEARCH",
        }).toString(),
      }
    );

    const html = await response.text();

    const viewIndex = html.indexOf("View Schedule");
    const preview =
      viewIndex >= 0
        ? html.slice(Math.max(0, viewIndex - 2000), viewIndex + 4000)
        : html.slice(0, 6000);

    const hrefMatches = [...html.matchAll(/href="([^"]+)"/gi)]
      .map((m) => m[1])
      .filter((h) => /pdf|bin-collections|schedule/i.test(h))
      .slice(0, 50);

    const onclickMatches = [...html.matchAll(/onclick="([^"]+)"/gi)]
      .map((m) => m[1])
      .filter((h) => /pdf|bin-collections|schedule/i.test(h))
      .slice(0, 50);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        hasViewSchedule: viewIndex >= 0,
        viewIndex,
        hrefMatches,
        onclickMatches,
        preview,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
}
