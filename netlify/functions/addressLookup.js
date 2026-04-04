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

    const url =
      `https://api.getAddress.io/autocomplete/${encodeURIComponent(postcode)}` +
      `?api-key=${encodeURIComponent(apiKey)}&all=true&show-postcode=true`;

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify(data),
      };
    }

    const addresses = (data.suggestions || []).map((item) => ({
      id: item.id,
      label: item.address,
      value: item.address,
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ addresses }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Address lookup failed" }),
    };
  }
};
