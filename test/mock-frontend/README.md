Reusable Next.js mock frontend for tracker/heatmap testing.

Run:

```bash
pnpm dev:test-site
```

Open:

`http://localhost:3007`

Tracker scripts are preconfigured to:

```html
<script
  src="http://localhost:3002/api/script.js"
  data-site-id="284c29631f62"
  defer
></script>

<script
  defer
  src="http://localhost:8080/t.js?id=veoilanna-53de67&snapshot_origin=http%3A%2F%2Flocalhost%3A3000&replay=1&replay_sample=0.1"
  data-site="veoilanna-53de67"
  data-snapshots="true"
></script>
```

Routes:

- `/`
- `/features`
- `/pricing`
- `/contact`
