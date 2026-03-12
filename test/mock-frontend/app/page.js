import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <section className="hero" data-track-id="home-hero">
        <div className="scan-line" />
        <h2>INTERACTION_SANDBOX.EXE</h2>
        <p>
          &gt; This node is interaction-heavy. Clicks, hovers, and scroll depth
          are captured and streamed to the heatmap engine in real time.
          Engage with all sectors below.
        </p>
        <div className="button-row">
          <button className="btn btn-primary" data-track-id="home-cta-start">
            INIT_TRIAL
          </button>
          <button className="btn btn-secondary" data-track-id="home-cta-demo">
            REQ_DEMO
          </button>
          <Link href="/pricing" className="btn btn-outline" data-track-id="home-nav-pricing">
            VIEW_PRICING
          </Link>
        </div>
      </section>

      <section className="grid">
        <article className="card" data-track-id="home-card-performance">
          <div className="card-icon">⚡</div>
          <h3>PERFORMANCE</h3>
          <p>Inspect hover/engagement weight in the top-left sector. High-frequency interaction node.</p>
          <span className="tag">ANALYTICS</span>
          <br /><br />
          <button className="btn" data-track-id="home-card-performance-open">
            OPEN_PANEL →
          </button>
        </article>
        <article className="card" data-track-id="home-card-growth">
          <div className="card-icon">📈</div>
          <h3>GROWTH</h3>
          <p>Mid-page click cluster. Use for heatmap validation and funnel diagnostic calibration.</p>
          <span className="tag">INSIGHTS</span>
          <br /><br />
          <button className="btn" data-track-id="home-card-growth-open">
            EXPLORE →
          </button>
        </article>
        <article className="card" data-track-id="home-card-guide">
          <div className="card-icon">📡</div>
          <h3>DEEP_TRACE</h3>
          <p>Scroll coverage route. Generates scroll-depth telemetry across the full page length.</p>
          <span className="tag">TESTING</span>
          <br /><br />
          <a href="#deep-scroll" data-track-id="home-jump-deep">
            JUMP_TO_DEPTH ↓
          </a>
        </article>
      </section>

      <section className="section" data-track-id="home-hover-zone">
        <h2>// HOVER ZONE</h2>
        <p>
          &gt; Dwell cursor here for 2–3 seconds to generate attention metrics.
          Signal is recorded as thermal intensity on the engagement heatmap overlay.
        </p>
      </section>

      <div id="deep-scroll" className="spacer" data-track-id="home-deep-scroll" />

      <section className="section" data-track-id="home-footer-cta">
        <h2>// BOTTOM_CTA</h2>
        <p>
          &gt; Post-scroll conversion zone. Validates scroll-depth vs click-rate
          correlation. Engage both controls to populate funnel exit data.
        </p>
        <br />
        <div className="button-row">
          <button className="btn btn-accent" data-track-id="home-bottom-checkout">
            EXECUTE_CHECKOUT →
          </button>
          <button className="btn btn-outline" data-track-id="home-bottom-compare">
            COMPARE_PLANS
          </button>
        </div>
      </section>
    </>
  );
}
