import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages はリポジトリ名を含む URL で配信されるため、ビルド時に
  // そのパスを付ける。ローカル開発時は従来どおりルート配信にする。
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  build: {
    target: "es2022"
  }
});

