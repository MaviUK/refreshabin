import React, { useState } from "react";

export default function App() {
  const services = [
    {
      title: "Domestic Bin Cleaning",
      text: "Professional cleaning for household bins to help keep them hygienic, fresh, and free from unpleasant odours.",
    },
    {
      title: "Commercial Bin Cleaning",
      text: "Reliable cleaning services for commercial bins, shared waste areas, apartment developments, and business premises.",
    },
    {
      title: "One-Off & Scheduled Cleans",
      text: "Choose a one-off clean or a regular service plan to keep your bins maintained throughout the year.",
    },
  ];

  const highlights = [
    "Domestic & Commercial",
    "Hygienic, Fresh Bins",
    "Reliable Scheduled Service",
  ];

  const pricing = [
    { title: "One-Off Clean", price: "£15", note: "A convenient single clean for bins that need freshened up" },
    { title: "4 Weekly Service", price: "£5", note: "Our most popular regular cleaning option" },
    { title: "Commercial Quote", price: "Custom", note: "Tailored pricing for larger sites and business needs" },
  ];

  const [bookingDraft, setBookingDraft] = useState({
    postcode: "",
    bins: [
      {
        binType: "General Waste Bin",
        cleanType: "One-Off Clean",
        quantity: 1,
      },
    ],
    date: "",
  });

  const [showBookingModal, setShowBookingModal] = useState(false);

  const handleContinueBooking = (e) => {
    e.preventDefault();

    if (
      !bookingDraft.postcode.trim() ||
      !bookingDraft.bins[0].binType ||
      !bookingDraft.bins[0].cleanType ||
      !bookingDraft.date
    ) {
      alert("Please complete postcode, bin type, clean type, and date.");
      return;
    }

    setShowBookingModal(true);
  };

  return (
    <div className="min-h-screen bg-[#eef7ff] pb-24 text-slate-900 md:pb-0">
      <header className="sticky top-0 z-20 border-b border-[#cfe7ff] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <img src="/logo.jpeg" alt="RefreshaBin logo" className="h-14 w-full sm:h-16" />
          </div>

          <nav className="hidden items-center gap-8 text-sm font-semibold text-slate-700 md:flex">
            <a href="#services" className="transition hover:text-[#0b67c2]">Services</a>
            <a href="#pricing" className="transition hover:text-[#0b67c2]">Pricing</a>
            <a href="#areas" className="transition hover:text-[#0b67c2]">Areas We Cover</a>
            <a href="#book" className="transition hover:text-[#0b67c2]">Book Now</a>
          </nav>

          <a
            href="#book"
            className="hidden rounded-full bg-gradient-to-r from-[#0d67c2] to-[#18a7f5] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-200 md:inline-flex"
          >
            Book Now
          </a>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(34,197,94,0.14),_transparent_20%),radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_30%)]" />

        <div className="relative mx-auto grid max-w-7xl gap-10 px-6 py-14 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:py-20">
          <div>
            <div className="hidden md:inline-flex flex-wrap gap-2">
              {highlights.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-[#c8e6ff] bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm"
                >
                  {item}
                </span>
              ))}
            </div>

            <img
              src="/logo.jpeg"
              alt="RefreshaBin logo"
              className="mt-0 mx-auto w-full max-w-2xl"
            />

            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              RefreshaBin provides reliable domestic and commercial bin cleaning throughout County Down.
              We offer one-off cleans and regular 4-weekly services to help keep bins hygienic, fresh, and presentable.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="#book"
                className="rounded-full bg-gradient-to-r from-[#0d67c2] to-[#18a7f5] px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-sky-200"
              >
                Book Your Clean
              </a>
              <a
                href="#services"
                className="rounded-full border border-[#bfe1ff] bg-white px-7 py-3.5 text-sm font-semibold text-[#0c2340] shadow-sm"
              >
                Our Services
              </a>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-[1.75rem] border border-[#cce8ff] bg-white p-5 shadow-sm">
                <div className="text-2xl font-black text-[#0d67c2]">Hygienic</div>
                <div className="mt-1 text-sm text-slate-600">Helping reduce odours, bacteria, and bin build-up</div>
              </div>
              <div className="rounded-[1.75rem] border border-[#d9efdc] bg-white p-5 shadow-sm">
                <div className="text-2xl font-black text-[#22a94f]">Reliable</div>
                <div className="mt-1 text-sm text-slate-600">Dependable one-off and scheduled cleaning services</div>
              </div>
              <div className="rounded-[1.75rem] border border-[#cce8ff] bg-white p-5 shadow-sm">
                <div className="text-2xl font-black text-[#0d67c2]">Professional</div>
                <div className="mt-1 text-sm text-slate-600">A trusted service for homes, businesses, and shared areas</div>
              </div>
            </div>
          </div>

          <div
            id="book"
            className="rounded-[2rem] border border-[#c9e7ff] bg-white p-6 shadow-[0_24px_70px_rgba(13,103,194,0.14)] sm:p-8"
          >
            <div className="mb-6">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#18a7f5]">Quick Booking</p>
              <h2 className="mt-2 text-3xl font-black text-[#0c2340]">Book your bin clean</h2>
              <p className="mt-2 text-sm text-slate-500">Arrange a domestic or commercial clean in just a few steps.</p>
            </div>

            <form className="space-y-4" onSubmit={handleContinueBooking}>
              <input
                type="text"
                placeholder="Enter your postcode"
                value={bookingDraft.postcode}
                onChange={(e) =>
                  setBookingDraft((prev) => ({
                    ...prev,
                    postcode: e.target.value.toUpperCase(),
                  }))
                }
                className="w-full rounded-2xl border border-[#cbe7ff] px-4 py-4 uppercase outline-none placeholder:text-slate-400 focus:border-[#18a7f5]"
              />

              <select
                value={bookingDraft.bins[0].binType}
                onChange={(e) =>
                  setBookingDraft((prev) => ({
                    ...prev,
                    bins: [
                      {
                        ...prev.bins[0],
                        binType: e.target.value,
                      },
                    ],
                  }))
                }
                className="w-full rounded-2xl border border-[#cbe7ff] px-4 py-4 outline-none focus:border-[#18a7f5]"
              >
                <option>General Waste Bin</option>
                <option>Recycling Bin</option>
                <option>Garden Bin</option>
                <option>Commercial Bin</option>
              </select>

              <select
                value={bookingDraft.bins[0].cleanType}
                onChange={(e) =>
                  setBookingDraft((prev) => ({
                    ...prev,
                    bins: [
                      {
                        ...prev.bins[0],
                        cleanType: e.target.value,
                      },
                    ],
                  }))
                }
                className="w-full rounded-2xl border border-[#cbe7ff] px-4 py-4 outline-none focus:border-[#18a7f5]"
              >
                <option>One-Off Clean</option>
                <option>Every 4 Weeks</option>
                <option>Monthly Service</option>
                <option>Commercial Quote Request</option>
              </select>

              <input
                type="date"
                value={bookingDraft.date}
                onChange={(e) =>
                  setBookingDraft((prev) => ({
                    ...prev,
                    date: e.target.value,
                  }))
                }
                className="w-full rounded-2xl border border-[#cbe7ff] px-4 py-4 outline-none focus:border-[#18a7f5]"
              />

              <button
                type="submit"
                className="w-full rounded-2xl bg-gradient-to-r from-[#0d67c2] via-[#0d83dc] to-[#18a7f5] py-4 text-sm font-semibold text-white shadow-lg shadow-sky-200"
              >
                Continue Booking
              </button>
            </form>

            <div className="mt-5 rounded-2xl bg-[#eff8ff] p-4 text-sm text-slate-600">
              Professional bin cleaning for homes, businesses, apartment blocks, and shared waste areas across County Down.
            </div>
          </div>
        </div>
      </section>

      <section id="services" className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#18a7f5]">Our Services</p>
          <h2 className="mt-3 text-4xl font-black text-[#0c2340]">Domestic and commercial bin cleaning</h2>
          <p className="mx-auto mt-4 max-w-3xl text-slate-600">
            We provide professional bin cleaning services for households, commercial sites, shared bin stores, and residential developments.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {services.map((item, index) => (
            <div
              key={item.title}
              className={`rounded-[2rem] border bg-white p-8 shadow-sm ${
                index === 1 ? "border-[#d9efdc]" : "border-[#cce8ff]"
              }`}
            >
              <div
                className={`inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] ${
                  index === 1 ? "bg-[#ecfaef] text-[#22964a]" : "bg-[#eef8ff] text-[#0d67c2]"
                }`}
              >
                {index === 1 ? "Commercial" : "Service"}
              </div>
              <h3 className="mt-5 text-2xl font-bold text-[#0c2340]">{item.title}</h3>
              <p className="mt-4 leading-7 text-slate-600">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[2rem] border border-[#cce8ff] bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#18a7f5]">Why Choose RefreshaBin</p>
            <h2 className="mt-3 text-4xl font-black text-[#0c2340]">A professional service you can rely on</h2>
            <ul className="mt-6 space-y-4 text-slate-600">
              <li>• Professional cleaning for domestic and commercial bins</li>
              <li>• Reliable one-off and 4-weekly cleaning options</li>
              <li>• Helps keep bins cleaner, fresher, and more hygienic</li>
              <li>• Suitable for homes, businesses, apartment blocks, and shared bin areas</li>
              <li>• Straightforward booking and friendly local service</li>
            </ul>
          </div>

          <div
            id="areas"
            className="rounded-[2rem] border border-[#d9efdc] bg-gradient-to-br from-[#ffffff] to-[#f3fff6] p-8 shadow-sm"
          >
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#22a94f]">Areas We Cover</p>
            <h2 className="mt-3 text-4xl font-black text-[#0c2340]">Bin cleaning across local towns and surrounding areas</h2>
            <p className="mt-5 leading-7 text-slate-600">
              We proudly provide professional bin cleaning services across the following areas:
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {[
                "Ardglass",
                "Killough",
                "Strangford",
                "Downpatrick",
                "Crossgar",
                "Ballynahinch",
                "Newcastle",
                "Castlewellan",
                "Killcoo",
                "Surrounding Areas",
              ].map((area) => (
                <span
                  key={area}
                  className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#0c2340] shadow-sm ring-1 ring-[#d6efe0]"
                >
                  {area}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-7xl px-6 py-4 pb-16">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#18a7f5]">Pricing</p>
          <h2 className="mt-3 text-4xl font-black text-[#0c2340]">Straightforward pricing for homes and businesses</h2>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {pricing.map((item, index) => (
            <div
              key={item.title}
              className={`rounded-[2rem] border bg-white p-8 text-center shadow-sm ${
                index === 1 ? "border-[#22c55e] ring-2 ring-[#dff6e8]" : "border-[#cce8ff]"
              }`}
            >
              <h3 className="text-2xl font-bold text-[#0c2340]">{item.title}</h3>
              <div className={`mt-5 text-5xl font-black ${index === 1 ? "text-[#22a94f]" : "text-[#0d67c2]"}`}>
                {item.price}
              </div>
              <p className="mt-4 text-slate-600">{item.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 pb-16">
        <div className="mx-auto max-w-7xl rounded-[2rem] bg-gradient-to-r from-[#0c63ba] via-[#1188de] to-[#19a9f4] p-10 text-white shadow-[0_24px_70px_rgba(13,103,194,0.2)]">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <h2 className="text-4xl font-black">Ready to book your bin clean?</h2>
              <p className="mt-4 max-w-2xl text-white/90">
                Choose a one-off clean or set up a regular service to keep your bins looking cleaner, smelling fresher, and maintained all year round.
              </p>
            </div>
            <a
              href="#book"
              className="inline-flex items-center justify-center rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-[#0d67c2] shadow-lg"
            >
              Start Booking
            </a>
          </div>
        </div>
      </section>

      {showBookingModal && (
        <BookingModal
          draft={bookingDraft}
          onClose={() => setShowBookingModal(false)}
        />
      )}

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/20 bg-white/95 p-2 shadow-[0_-10px_30px_rgba(0,0,0,0.08)] backdrop-blur md:hidden">
        <div className="grid grid-cols-3 gap-2">
          <a
            href="#book"
            className="rounded-full bg-gradient-to-r from-[#0d67c2] to-[#18a7f5] px-2 py-3 text-center text-xs font-bold text-white shadow-lg"
          >
            Book Now
          </a>
          <a
            href="https://wa.me/447835843481"
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-[#22a94f] px-2 py-3 text-center text-xs font-bold text-white shadow-lg"
          >
            Chat
          </a>
          <a
            href="tel:+447835843481"
            className="rounded-full bg-gradient-to-r from-[#0d67c2] to-[#18a7f5] px-2 py-3 text-center text-xs font-bold text-white shadow-lg"
          >
            Call Us
          </a>
        </div>
      </div>
    </div>
  );
}

function BookingModal({ draft, onClose }) {
  const [termsOpened, setTermsOpened] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [sending, setSending] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    postcode: draft.postcode,
    addressLine: "",
    phone: "",
    email: "",
    date: draft.date,
    bins: draft.bins,
  });

  const updateBin = (index, field, value) => {
    setFormData((prev) => ({
      ...prev,
      bins: prev.bins.map((bin, i) =>
        i === index ? { ...bin, [field]: value } : bin
      ),
    }));
  };

  const addAnotherBin = () => {
    setFormData((prev) => ({
      ...prev,
      bins: [
        ...prev.bins,
        {
          binType: "General Waste Bin",
          cleanType: prev.bins[0]?.cleanType || "One-Off Clean",
          quantity: 1,
        },
      ],
    }));
  };

  const removeBin = (index) => {
    setFormData((prev) => ({
      ...prev,
      bins: prev.bins.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!termsAccepted) return;

    if (!formData.addressLine.trim()) {
      alert("Please enter your full address.");
      return;
    }

    setSending(true);

    try {
      await fetch("/.netlify/functions/sendBookingEmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      alert("Booking sent successfully.");
      onClose();
    } catch (error) {
      console.error(error);
      alert("Something went wrong sending your booking.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="relative w-full max-w-md rounded-[2rem] bg-white p-5 shadow-2xl sm:p-6">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-xl text-slate-500 hover:text-slate-800"
        >
          ×
        </button>

        <h2 className="mb-5 text-center text-3xl font-black text-[#0c2340]">
          Book a Bin Clean
        </h2>

        <div
          className="max-h-[75vh] overflow-y-auto pr-2 popup-scroll"
          style={{
            scrollbarWidth: "thin",
            scrollbarColor: "#94a3b8 transparent",
          }}
        >
          <form className="space-y-4" onSubmit={handleSubmit}>
            <input
              type="text"
              placeholder="Your Name"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              className="w-full rounded-2xl border border-slate-300 px-4 py-3"
            />

            {formData.bins.map((bin, index) => (
              <div key={index} className="space-y-3 rounded-2xl border border-slate-200 p-3">
                <div className="grid grid-cols-[1fr_90px] gap-3">
                  <select
                    value={bin.binType}
                    onChange={(e) => updateBin(index, "binType", e.target.value)}
                    className="rounded-2xl border border-slate-300 px-4 py-3"
                  >
                    <option>General Waste Bin</option>
                    <option>Recycling Bin</option>
                    <option>Garden Bin</option>
                    <option>Commercial Bin</option>
                  </select>

                  <input
                    type="number"
                    min="1"
                    value={bin.quantity}
                    onChange={(e) => updateBin(index, "quantity", Number(e.target.value))}
                    className="rounded-2xl border border-slate-300 px-4 py-3"
                  />
                </div>

                <select
                  value={bin.cleanType}
                  onChange={(e) => updateBin(index, "cleanType", e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3"
                >
                  <option>One-Off Clean</option>
                  <option>Every 4 Weeks</option>
                  <option>Monthly Service</option>
                  <option>Commercial Quote Request</option>
                </select>

                {formData.bins.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeBin(index)}
                    className="text-sm font-semibold text-red-600"
                  >
                    Remove Bin
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={addAnotherBin}
              className="text-sm font-semibold text-[#22a94f]"
            >
              + Add Another Bin
            </button>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Postcode
              </label>
              <input
                type="text"
                value={formData.postcode}
                readOnly
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 uppercase"
              />
            </div>

            <input
              type="text"
              placeholder="Full Address"
              value={formData.addressLine}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, addressLine: e.target.value }))
              }
              className="w-full rounded-2xl border border-slate-300 px-4 py-3"
            />

            <input
              type="tel"
              placeholder="Contact Number"
              value={formData.phone}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, phone: e.target.value }))
              }
              className="w-full rounded-2xl border border-slate-300 px-4 py-3"
            />

            <input
              type="email"
              placeholder="Email Address"
              value={formData.email}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, email: e.target.value }))
              }
              className="w-full rounded-2xl border border-slate-300 px-4 py-3"
            />

            <input
              type="date"
              value={formData.date}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, date: e.target.value }))
              }
              className="w-full rounded-2xl border border-slate-300 px-4 py-3"
            />

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <button
                type="button"
                onClick={() => setTermsOpened(true)}
                className="text-sm font-semibold text-[#0d67c2] underline"
              >
                View Terms & Conditions
              </button>

              {termsOpened && (
                <div className="mt-4 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
                  <p className="mb-3 font-semibold text-slate-800">Terms & Conditions</p>
                  <p>Bookings are subject to availability.</p>
                  <p>Customers must ensure bins are accessible on the agreed date.</p>
                  <p>Missed appointments may require rebooking.</p>
                  <p>Service pricing may vary if the selected booking details are changed.</p>
                  <p>By booking, you agree to the service terms and contact regarding your booking.</p>
                </div>
              )}

              <label className="mt-4 flex items-start gap-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  disabled={!termsOpened}
                  className="mt-1"
                />
                <span>I have read and agree to the Terms & Conditions.</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={!termsAccepted || sending}
              className={`w-full rounded-2xl py-4 text-sm font-semibold text-white ${
                !termsAccepted || sending
                  ? "cursor-not-allowed bg-slate-300"
                  : "bg-gradient-to-r from-[#0d67c2] via-[#0d83dc] to-[#18a7f5]"
              }`}
            >
              {sending ? "Sending..." : "Send Booking"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
