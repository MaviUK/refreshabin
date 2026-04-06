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
        }),
      }
    );

    const html = await response.text();

    // Extract addresses + PDF links
    const results = [];

    const regex =
      /([0-9]+\s+[A-Z\s]+NEWCASTLE\s+BT33\s+[A-Z]{3})[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>View Schedule<\/a>/g;

    let match;

    while ((match = regex.exec(html)) !== null) {
      results.push({
        address: match[1].trim(),
        pdf: match[2].startsWith("http")
          ? match[2]
          : `https://www.newrymournedown.org${match[2]}`,
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        count: results.length,
        results,
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
