import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

// Every page renders on request from the D1 database; nothing is prebuilt.
// Links start loading when hovered, so pages open almost instantly.
export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
});
