exports.handler = async (event) => {
  try {
    const postcode = (event.queryStringParameters.postcode || "")
      .trim()
      .toUpperCase();

    if (!postcode) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Postcode is required" }),
      };
    }

    const apiKey = process.env.GETADDRESS_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing GETADDRESS_API_KEY" }),
      };
    }

    const url = `https://api.getAddress.io/find/${encodeURIComponent(
      postcode
    )}?api-key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    const rawText = await response.text();

    console.log("Lookup postcode:", postcode);
    console.log("Status:", response.status);
    console.log("Raw response:", rawText);

    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (parseError) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Address API did not return valid JSON",
          raw: rawText,
          status: response.status,
        }),
      };
    }

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify(data || { error: "Address lookup failed" }),
      };
    }

    const addresses = (data?.addresses || []).map((addr) => ({
      label: `${addr}, ${postcode}`,
      value: `${addr}, ${postcode}`,
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ addresses }),
    };
  } catch (error) {
    console.error("addressLookup error:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message || "Address lookup failed",
      }),
    };
  }
};
