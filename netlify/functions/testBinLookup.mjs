export async function handler(event) {
  try {
    const prefix = event.queryStringParameters?.prefix || "BT33";
    const suffix = event.queryStringParameters?.suffix || "OHR";

    const pageUrl =
      "https://www.newrymournedown.org/weekly-bin-collection-and-calendar";

    // 1) First load page to get session cookies
    const firstResponse = await fetch(pageUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      },
    });

    const setCookie = firstResponse.headers.get("set-cookie") || "";

    // Keep only cookie name=value parts
    const cookieHeader = setCookie
      .split(/,(?=\s*[A-Za-z0-9_\-]+=)/)
      .map((cookie) => cookie.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    // 2) Submit search with same session
    const formBody = new URLSearchParams({
      PostcodeBT: prefix,
      PostcodeEND: suffix,
      postback: "1",
      submit_btn: "SEARCH",
    }).toString();

    const response = await fetch(pageUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
        "Origin": "https://www.newrymournedown.org",
        "Referer": pageUrl,
        "Cookie": cookieHeader,
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      },
      body: formBody,
    });

    const html = await response.text();

    // Temporary debug
    const hasViewSchedule = html.includes("View Schedule");
    const hasPdf = /\.pdf/i.test(html);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        cookieHeader,
        hasViewSchedule,
        hasPdf,
        preview: html.slice(0, 8000),
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
