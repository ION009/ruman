export default function PricingPage() {
  const plans = [
    {
      name: "STARTER",
      price: "$29",
      period: "/ mo",
      detail: "Entry node. Ideal for small product teams initiating heatmap capture.",
      featured: false,
      icon: "🌱",
    },
    {
      name: "GROWTH",
      price: "$99",
      period: "/ mo",
      detail: "Primary node. Full analytics stack, session replay, and AI insights.",
      featured: true,
      icon: "🚀",
    },
    {
      name: "ENTERPRISE",
      price: "CUSTOM",
      period: "",
      detail: "High-volume node. Regulated environments with dedicated SLA support.",
      featured: false,
      icon: "🏢",
    },
  ];

  return (
    <>
      <section className="hero" data-track-id="pricing-hero">
        <div className="scan-line" />
        <h2>PRICING_NODE.CFG</h2>
        <p>
          &gt; Select a plan tier to generate high-intent hotspots for funnel
          diagnostics. All interactions are tracked and streamed to the
          heatmap engine.
        </p>
      </section>

      <section className="grid">
        {plans.map(({ name, price, period, detail, featured, icon }) => (
          <article
            key={name}
            className={`card${featured ? " card-featured" : ""}`}
            data-track-id={`pricing-${name.toLowerCase()}`}
          >
            <div className="card-icon">{icon}</div>
            <h3>{name}</h3>
            <p>
              <span className="card-price">{price}</span>
              {period && <span className="card-price-period">{period}</span>}
            </p>
            <p>{detail}</p>
            <button
              className={`btn ${featured ? "btn-secondary" : "btn-outline"}`}
              data-track-id={`pricing-select-${name.toLowerCase()}`}
              style={{ width: "100%", marginTop: "0.5rem" }}
            >
              SELECT_{name} →
            </button>
          </article>
        ))}
      </section>

      <section className="section" data-track-id="pricing-addon-zone">
        <h2>// ADD-ON_MODULES</h2>
        <label>
          SEAT_COUNT
          <select data-track-id="pricing-seats-select" defaultValue="10">
            <option value="5">5 seats</option>
            <option value="10">10 seats</option>
            <option value="20">20 seats</option>
            <option value="50">50 seats</option>
          </select>
        </label>
        <label>
          INTEGRATION_NOTES
          <textarea
            placeholder="> Describe your integration stack..."
            data-track-id="pricing-notes"
          />
        </label>
        <div className="button-row">
          <button className="btn btn-accent" data-track-id="pricing-calc-quote">
            CALC_QUOTE →
          </button>
          <button className="btn btn-outline" data-track-id="pricing-compare">
            DIFF_ALL_FEATURES
          </button>
        </div>
      </section>
    </>
  );
}
