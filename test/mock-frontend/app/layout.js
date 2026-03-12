import "./globals.css";
import ClientLayout from "./client-layout";

export const metadata = {
  title: "AnlticsHeat Mock Test Site",
  description: "Four-page mock site for analytics and heatmap testing.",
};

const ANLTICSHEAT_TRACKER_SITE_ID = "veoilanna-53de67";
const ANLTICSHEAT_TRACKER_SRC =
  "http://localhost:8080/t.js?id=veoilanna-53de67&snapshot_origin=http%3A%2F%2Flocalhost%3A3000&replay=1&replay_sample=1&spa=1&err=1&perf=1&replay_mask_text=0";

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          src={ANLTICSHEAT_TRACKER_SRC}
          data-site={ANLTICSHEAT_TRACKER_SITE_ID}
          data-snapshots="true"
          data-replay="true"
          data-replay-sample-rate="1"
          data-spa="true"
          data-errors="true"
          data-performance="true"
          data-replay-mask-text="false"
          defer
        />
      </head>
      <body>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
