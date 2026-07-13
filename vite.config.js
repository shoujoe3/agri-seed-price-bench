import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ⚠️ IMPORTANT for GitHub Pages "project sites":
// `base` MUST equal "/<your-repo-name>/" (keep both slashes).
// If your repo is github.com/janedoe/seed-prices  ->  base: '/seed-prices/'
// If you later use a custom domain or a <user>.github.io repo, set base: '/'
export default defineConfig({
  plugins: [react()],
  base: '/agri-seed-price-bench/',
})
