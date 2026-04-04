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
    { title: "One-Off Clean", price: "£6", note: "A convenient single clean for bins that need freshened up" },
    { title: "4 Weekly Service", price: "£5", note: "Our most popular regular cleaning option" },
    { title: "Commercial Quote", price: "Custom", note: "Tailored pricing for larger sites and business needs" },
  ];

  return (
    <div className="min-h-screen bg-[#eef7ff] pb-24 text-slate-900 md:pb-0">
      
      {/* HEADER */}
      <header className="sticky top-0 z-20 border-b border-[#cfe7ff] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <img src="/logo.jpeg" alt="RefreshaBin logo" className="h-14 sm:h-16" />

          <nav className="hidden items-center gap-8 text-sm font-semibold text-slate-700 md:flex">
            <a href="#services" className="hover:text-[#0b67c2]">Services</a>
            <a href="#pricing" className="hover:text-[#0b67c2]">Pricing</a>
            <a href="#areas" className="hover:text-[#0b67c2]">Areas</a>
            <a href="#book" className="hover:text-[#0b67c2]">Book</a>
          </nav>

          <a href="#book" className="rounded-full bg-gradient-to-r from-[#0d67c2] to-[#18a7f5] px-5 py-2.5 text-white">
            Book Now
          </a>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(34,197,94,0.14),_transparent_20%),radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_30%)]" />

        <div className="relative mx-auto grid max-w-7xl gap-10 px-6 py-14 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:py-20">
          
          <div>
            <div className="flex flex-wrap gap-2">
              {highlights.map((item) => (
                <span key={item} className="rounded-full border bg-white px-4 py-2 text-sm">
                  {item}
                </span>
              ))}
            </div>

            {/* 🔥 LOGO INSTEAD OF HEADING */}
            <img
              src="/logo.jpeg"
              alt="RefreshaBin logo"
              className="mt-7 w-full max-w-md sm:max-w-lg mx-auto lg:mx-0"
            />

            <p className="mt-6 max-w-2xl text-lg text-slate-600">
              Professional bin cleaning services across County Down. 
              Reliable one-off and 4-weekly cleans to keep your bins hygienic, fresh, and presentable.
            </p>

            <div className="mt-8 flex gap-4">
              <a href="#book" className="rounded-full bg-gradient-to-r from-[#0d67c2] to-[#18a7f5] px-7 py-3 text-white">
                Book Your Clean
              </a>
              <a href="#services" className="rounded-full border px-7 py-3">
                Our Services
              </a>
            </div>
          </div>

          {/* BOOKING CARD */}
          <div id="book" className="rounded-[2rem] border bg-white p-6 shadow-lg">
            <h2 className="text-2xl font-bold">Book your clean</h2>

            <div className="mt-4 space-y-4">
              <input className="w-full border rounded-xl p-3" placeholder="Enter postcode" />
              <select className="w-full border rounded-xl p-3">
                <option>General Waste Bin</option>
                <option>Recycling Bin</option>
              </select>
              <button className="w-full bg-blue-600 text-white py-3 rounded-xl">
                Continue Booking
              </button>
            </div>
          </div>

        </div>
      </section>

      {/* SERVICES */}
      <section id="services" className="max-w-7xl mx-auto px-6 py-12">
        <h2 className="text-3xl font-bold text-center mb-8">
          Our Services
        </h2>

        <div className="grid md:grid-cols-3 gap-6">
          {services.map((s) => (
            <div key={s.title} className="bg-white p-6 rounded-2xl shadow">
              <h3 className="text-xl font-bold">{s.title}</h3>
              <p className="mt-2 text-slate-600">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="max-w-7xl mx-auto px-6 py-12">
        <h2 className="text-3xl font-bold text-center mb-8">
          Pricing
        </h2>

        <div className="grid md:grid-cols-3 gap-6">
          {pricing.map((p) => (
            <div key={p.title} className="bg-white p-6 rounded-2xl shadow text-center">
              <h3 className="text-xl font-bold">{p.title}</h3>
              <div className="text-3xl font-bold mt-2">{p.price}</div>
              <p className="mt-2 text-slate-600">{p.note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* MOBILE BAR */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white p-3 shadow md:hidden">
        <div className="grid grid-cols-2 gap-3">
          <a
            href="https://wa.me/447835843481"
            target="_blank"
            className="bg-green-500 text-white text-center py-3 rounded-full font-bold"
          >
            Chat
          </a>
          <a
            href="tel:+447835843481"
            className="bg-blue-600 text-white text-center py-3 rounded-full font-bold"
          >
            Call Us
          </a>
        </div>
      </div>

    </div>
  );
}
