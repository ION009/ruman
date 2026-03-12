export default function ContactPage() {
  return (
    <>
      <section className="hero" data-track-id="contact-hero">
        <div className="scan-line" />
        <h2>CONTACT_UPLINK.SH</h2>
        <p>
          &gt; Field-focus, submit-click, and scroll-depth test route. Every
          keystroke, tab-focus, and interaction event is captured and streamed
          to the analytics engine.
        </p>
      </section>

      <section className="section" data-track-id="contact-form">
        <h2>// REQUEST_WALKTHROUGH</h2>
        <label>
          WORK_EMAIL
          <input
            type="email"
            placeholder="> operator@company.io"
            data-track-id="contact-email"
          />
        </label>
        <label>
          TEAM_SIZE
          <input
            type="text"
            placeholder="> e.g. 25"
            data-track-id="contact-size"
          />
        </label>
        <label>
          OPERATOR_ROLE
          <select data-track-id="contact-role" defaultValue="">
            <option value="" disabled>
              &gt; SELECT_ROLE...
            </option>
            <option value="engineering">ENGINEERING</option>
            <option value="product">PRODUCT</option>
            <option value="design">DESIGN</option>
            <option value="marketing">MARKETING</option>
            <option value="other">OTHER</option>
          </select>
        </label>
        <label>
          MESSAGE_PAYLOAD
          <textarea
            placeholder="> Describe your optimization target..."
            data-track-id="contact-message"
          />
        </label>
        <div className="button-row">
          <button className="btn btn-primary" data-track-id="contact-submit">
            TRANSMIT →
          </button>
          <button className="btn btn-outline" data-track-id="contact-save-draft">
            SAVE_DRAFT
          </button>
        </div>
      </section>

      <section className="section" data-track-id="contact-info">
        <h2>// SECONDARY_UPLINK</h2>
        <p>
          &gt; Direct channel: <strong style={{ color: "var(--neon-cyan)" }}>hello@anlticsheat.dev</strong>
          {" "} — Or patch into the community Discord node for async comms.
        </p>
      </section>
    </>
  );
}
