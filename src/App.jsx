export default function App() {
  const services = [
    {
      title: "Domestic Bin Cleaning",
      text: "Keep household bins clean, hygienic, and odour-free with regular scheduled washing.",
    },
    {
      title: "Commercial Bin Cleaning",
      text: "Reliable cleaning for larger bins, shared waste areas, apartment blocks, and business premises.",
    },
    {
      title: "One-Off & Regular Plans",
      text: "Book a single clean or choose a repeat service to keep bins fresh all year round.",
    },
  ];

  const highlights = [
    "Commercial & Residential",
    "Fresh, hygienic bins",
    "Simple online booking",
  ];

  const pricing = [
    { title: "One-Off Clean", price: "£6", note: "Ideal for a one-time freshen up" },
    { title: "4 Weekly Plan", price: "£5", note: "Best value recurring clean" },
    { title: "Commercial Quote", price: "Custom", note: "Tailored for larger sites" },
  ];

  return (
    <div className="min-h-screen bg-[#eef7ff] pb-24 text-slate-900 md:pb-0">
      <header className="sticky top-0 z-20 border-b border-[#cfe7ff] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <img src="/logo.jpeg" alt="RefreshaBin logo" className="h-14 w-auto sm:h-16" />
          </div>

          <nav className="hidden items-center gap-8 text-sm font-semibold text-slate-700 md:flex">
            <a href="#services" className="transition hover:text-[#0b67c2]">Services</a>
            <a href="#pricing" className="transition hover:text-[#0b67c2]">Pricing</a>
            <a href="#areas" className="transition hover:text-[#0b67c2]">Areas</a>
            <a href="#book" className="transition hover:text-[#0b67c2]">Book</a>
          </nav>

          <a
            href="#book"
            className="rounded-full bg-gradient-to-r from-[#0d67c2] to-[#18a7f5] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-200"
          >
            Book Now
          </a>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(34,197,94,0.14),_transparent_20%),radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_30%)]" />

        <div className="relative mx-auto grid max-w-7xl gap-10 px-6 py-14 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:py-20">
          <div>
            <div className="inline-flex flex-wrap gap-2">
              {highlights.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-[#c8e6ff] bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm"
                >
                  {item}
                </span>
              ))}
            </div>

            <h1 className="mt-7 max-w-3xl text-5xl font-black tracking-tight text-[#0c2340] sm:text-6xl">
              Bin cleaning that looks professional and books like a real service business.
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              RefreshaBin provides commercial and residential bin cleaning across Co. Down.
              Keep bins cleaner, fresher, and more hygienic with one-off or regular scheduled cleans.
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
                View Services
              </a>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-[1.75rem] border border-[#cce8ff] bg-white p-5 shadow-sm">
                <div className="text-2xl font-black text-[#0d67c2]">Fresh</div>
                <div className="mt-1 text-sm text-slate-600">Cleaner bins and reduced odours</div>
              </div>
              <div className="rounded-[1.75rem] border border-[#d9efdc] bg-white p-5 shadow-sm">
                <div className="text-2xl font-black text-[#22a94f]">Reliable</div>
                <div className="mt-1 text-sm text-slate-600">One-off or regular scheduled visits</div>
              </div>
              <div className="rounded-[1.75rem] border border-[#cce8ff] bg-white p-5 shadow-sm">
                <div className="text-2xl font-black text-[#0d67c2]">Simple</div>
                <div className="mt-1 text-sm text-slate-600">Easy online booking for homes and businesses</div>
              </div>
            </div>
          </div>

          <div
            id="book"
            className="rounded-[2rem] border border-[#c9e7ff] bg-white p-6 shadow-[0_24px_70px_rgba(13,103,194,0.14)] sm:p-8"
          >
            <div className="mb-6">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#18a7f5]">Instant Booking</p>
              <h2 className="mt-2 text-3xl font-black text-[#0c2340]">Book your clean</h2>
              <p className="mt-2 text-sm text-slate-500">Domestic and commercial bookings made easy.</p>
            </div>

            <div className="space-y-4">
              <input
                type="text"
                placeholder="Enter postcode"
                className="w-full rounded-2xl border border-[#cbe7ff] px-4 py-4 outline-none placeholder:text-slate-400 focus:border-[#18a7f5]"
              />

              <select className="w-full rounded-2xl border border-[#cbe7ff] px-4 py-4 outline-none focus:border-[#18a7f5]">
                <option>General Waste Bin</option>
                <option>Recycling Bin</option>
                <option>Garden Bin</option>
                <option>Commercial Bin</option>
              </select>

              <select className="w-full rounded-2xl border border-[#cbe7ff] px-4 py-4 outline-none focus:border-[#18a7f5]">
                <option>One-Off Clean</option>
                <option>Every 4 Weeks</option>
                <option>Monthly</option>
                <option>Commercial Quote</option>
              </select>

              <input
                type="date"
                className="w-full rounded-2xl border border-[#cbe7ff] px-4 py-4 outline-none focus:border-[#18a7f5]"
              />

              <button className="w-full rounded-2xl bg-gradient-to-r from-[#0d67c2] via-[#0d83dc] to-[#18a7f5] py-4 text-sm font-semibold text-white shadow-lg shadow-sky-200">
                Continue Booking
              </button>
            </div>

            <div className="mt-5 rounded-2xl bg-[#eff8ff] p-4 text-sm text-slate-600">
              Serving homes, businesses, and shared waste areas with professional bin cleaning across Co. Down.
            </div>
          </div>
        </div>
      </section>

      <section id="services" className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#18a7f5]">What We Do</p>
          <h2 className="mt-3 text-4xl font-black text-[#0c2340]">Commercial & residential bin cleaning</h2>
          <p className="mx-auto mt-4 max-w-3xl text-slate-600">
            Built for the kind of information your original site already communicates well: who you serve, what you offer, and why customers should trust the service.
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
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#18a7f5]">Why RefreshaBin</p>
            <h2 className="mt-3 text-4xl font-black text-[#0c2340]">Better looking and better explained</h2>
            <ul className="mt-6 space-y-4 text-slate-600">
              <li>• Clear focus on commercial and residential customers</li>
              <li>• Cleaner layout that still keeps your original business identity</li>
              <li>• Better use of the blue and green from the logo</li>
              <li>• Booking front and centre without losing business information</li>
              <li>• Stronger sections for trust, pricing, and service areas</li>
            </ul>
          </div>

          <div
            id="areas"
            className="rounded-[2rem] border border-[#d9efdc] bg-gradient-to-br from-[#ffffff] to-[#f3fff6] p-8 shadow-sm"
          >
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#22a94f]">Coverage</p>
            <h2 className="mt-3 text-4xl font-black text-[#0c2340]">Refresh a bin in your area</h2>
            <p className="mt-5 leading-7 text-slate-600">
              Covering the following areas.
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
          <h2 className="mt-3 text-4xl font-black text-[#0c2340]">Simple pricing for homes and business enquiries</h2>
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


      {/* Mobile Bottom Contact Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/20 bg-white/95 p-3 shadow-[0_-10px_30px_rgba(0,0,0,0.08)] backdrop-blur md:hidden">
        <div className="grid grid-cols-2 gap-3">
          <a
            href="https://wa.me/447835843481"
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-[#22a94f] px-4 py-3 text-center text-sm font-bold text-white shadow-lg"
          >
            Chat
          </a>
          <a
            href="tel:+447835843481"
            className="rounded-full bg-gradient-to-r from-[#0d67c2] to-[#18a7f5] px-4 py-3 text-center text-sm font-bold text-white shadow-lg"
          >
            Call Us
          </a>
        </div>
      </div>
    </div>
  );
}
