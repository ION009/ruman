export default function FeaturesPage() {
  const features = [
    ["🎬", "SESSION_REPLAY", "Watch exact user journey paths frame-by-frame."],
    ["🔥", "HEATMAP_SEGS", "Compare mobile, tablet, and desktop attention maps."],
    ["🤖", "AI_INSIGHTS", "Anomaly detection + fix recommendations, automated."],
    ["📊", "EVENT_STREAMS", "Trace conversion milestones in real-time telemetry."],
    ["🔔", "ALERT_SYS", "Push issue alerts to Slack, email, or webhooks."],
    ["🌐", "DATA_RESIDENCY", "Anchor all analytics data to your preferred region."],
  ];

  return (
    <>
      <section className="hero" data-track-id="features-hero">
        <div className="scan-line" />
        <h2>FEATURE_MATRIX.DAT</h2>
        <p>
          &gt; Per-path DOM snapshots and click clusters verified across card-grid
          layout. Each node is a distinct interaction zone. Engage to populate
          heatmap data streams.
        </p>
        <div className="button-row">
          <button className="btn btn-primary" data-track-id="features-hero-cta">
            ENABLE_PACK
          </button>
          <button className="btn btn-secondary" data-track-id="features-hero-secondary">
            CONTACT_ENG
          </button>
        </div>
      </section>

      <section className="grid">
        {features.map(([icon, title, description]) => (
          <article
            key={title}
            className="card"
            data-track-id={`feature-card-${title.toLowerCase().replace(/[_\s]+/g, "-")}`}
          >
            <div className="card-icon">{icon}</div>
            <h3>{title}</h3>
            <p>{description}</p>
            <button
              className="btn"
              data-track-id={`feature-open-${title.toLowerCase().replace(/[_\s]+/g, "-")}`}
            >
              EXPAND →
            </button>
          </article>
        ))}
      </section>

      <section className="section" data-track-id="features-comparison">
        <h2>// WHY_ANLTICSHEAT</h2>
        <p>
          &gt; Other tools give numbers. AnlticsHeat gives spatial awareness.
          Map where users look, linger, rage-click, and abandon — overlaid
          directly onto the live page grid.
        </p>
      </section>
    </>
  );
}
