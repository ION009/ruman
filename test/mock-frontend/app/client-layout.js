"use client";

import Link from "next/link";

export default function ClientLayout({ children }) {
  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="header-left">
          <div className="header-logo">AH</div>
          <div>
            <p className="eyebrow">// anlticsheat_test_site</p>
            <h1>MOCK CONVERSION FLOW</h1>
          </div>
        </div>
        <div className="header-right">
          <nav className="site-nav">
            <Link href="/">[ HOME ]</Link>
            <Link href="/features">[ FEATURES ]</Link>
            <Link href="/pricing">[ PRICING ]</Link>
            <Link href="/contact">[ CONTACT ]</Link>
          </nav>
        </div>
      </header>
      <main className="site-content">{children}</main>
      <footer className="site-footer">
        &gt; ANLTICSHEAT_MOCK_SITE :: ANALYTICS &amp; HEATMAP TESTING MODULE :: ACTIVE
      </footer>
    </div>
  );
}
