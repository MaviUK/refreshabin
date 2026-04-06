import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const data = JSON.parse(event.body || "{}");

    const {
      name,
      postcode,
      addressLine,
      phone,
      email,
      bins = [],
    } = data;

    if (
      !name?.trim() ||
      !postcode?.trim() ||
      !addressLine?.trim() ||
      !phone?.trim() ||
      !email?.trim() ||
      !Array.isArray(bins) ||
      bins.length === 0
    ) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required booking details" }),
      };
    }

    const binsHtml = bins
      .map(
        (bin, index) => `
          <tr>
            <td style="padding:8px;border:1px solid #dbeafe;">${index + 1}</td>
            <td style="padding:8px;border:1px solid #dbeafe;">${bin.binType || "-"}</td>
            <td style="padding:8px;border:1px solid #dbeafe;">${bin.cleanType || "-"}</td>
            <td style="padding:8px;border:1px solid #dbeafe;">${bin.quantity || "-"}</td>
            <td style="padding:8px;border:1px solid #dbeafe;">${bin.date || "-"}</td>
          </tr>
        `
      )
      .join("");

    const emailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:24px;background:#f8fbff;">
        <div style="background:#ffffff;border:1px solid #dbeafe;border-radius:18px;padding:24px;">
          <h1 style="margin:0 0 16px;color:#0c2340;">New RefreshaBin Booking</h1>
          
          <h2 style="margin:24px 0 10px;color:#0d67c2;font-size:18px;">Customer Details</h2>
          <p style="margin:6px 0;"><strong>Name:</strong> ${name}</p>
          <p style="margin:6px 0;"><strong>Address:</strong> ${addressLine}</p>
          <p style="margin:6px 0;"><strong>Postcode:</strong> ${postcode}</p>
          <p style="margin:6px 0;"><strong>Phone:</strong> ${phone}</p>
          <p style="margin:6px 0;"><strong>Email:</strong> ${email}</p>

          <h2 style="margin:24px 0 10px;color:#0d67c2;font-size:18px;">Bin Details</h2>
          <table style="width:100%;border-collapse:collapse;background:#fff;">
            <thead>
              <tr style="background:#eff6ff;">
                <th style="padding:8px;border:1px solid #dbeafe;text-align:left;">#</th>
                <th style="padding:8px;border:1px solid #dbeafe;text-align:left;">Bin Type</th>
                <th style="padding:8px;border:1px solid #dbeafe;text-align:left;">Clean Type</th>
                <th style="padding:8px;border:1px solid #dbeafe;text-align:left;">Quantity</th>
                <th style="padding:8px;border:1px solid #dbeafe;text-align:left;">Date</th>
              </tr>
            </thead>
            <tbody>
              ${binsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const customerHtml = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:24px;background:#f8fbff;">
        <div style="background:#ffffff;border:1px solid #dbeafe;border-radius:18px;padding:24px;">
          <h1 style="margin:0 0 16px;color:#0c2340;">Thanks for your booking</h1>
          <p style="margin:0 0 12px;">Hi ${name},</p>
          <p style="margin:0 0 12px;">
            Thanks for booking with RefreshaBin. We’ve received your enquiry and will be in touch shortly to confirm the details.
          </p>
          <p style="margin:0 0 12px;"><strong>Address:</strong> ${addressLine}, ${postcode}</p>
          <p style="margin:0 0 12px;"><strong>Contact Number:</strong> ${phone}</p>
          <p style="margin:0;">We appreciate your booking.</p>
        </div>
      </div>
    `;

    await resend.emails.send({
      from: "RefreshaBin <Newbooking@refreshabin.co.uk>",
      to: ["info@refreshabin.co.uk"],
      replyTo: email,
      subject: `New Booking from ${name}`,
      html: emailHtml,
    });

    await resend.emails.send({
      from: "RefreshaBin <bookings@yourdomain.co.uk>",
      to: [email],
      subject: "We’ve received your RefreshaBin booking",
      html: customerHtml,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error("sendBookingEmail error:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to send booking email",
        details: error?.message || "Unknown error",
      }),
    };
  }
}
