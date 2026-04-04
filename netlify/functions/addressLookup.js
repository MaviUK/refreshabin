exports.handler = async (event) => {
  try {
    const postcode = (event.queryStringParameters.postcode || "").trim();

    if (!postcode) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Postcode is required" }),
      };
    }

    const apiKey = process.env.GETADDRESS_API_KEY;

    const response = await fetch(
      `https://api.getAddress.io/find/${encodeURIComponent(
        postcode
      )}?api-key=${apiKey}`
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify(data),
      };
    }

    const addresses = (data.addresses || []).map((addr) => ({
      label: `${addr}, ${postcode.toUpperCase()}`,
      value: `${addr}, ${postcode.toUpperCase()}`,
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ addresses }),
    };
  } catch (error) {
    console.error(error);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Address lookup failed" }),
    };
  }
};
