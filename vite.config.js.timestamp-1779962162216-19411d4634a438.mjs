// vite.config.js
import { defineConfig } from "file:///D:/Dev/myAI/node_modules/vite/dist/node/index.js";
import { svelte } from "file:///D:/Dev/myAI/node_modules/@sveltejs/vite-plugin-svelte/src/index.js";
import sveltePreprocess from "file:///D:/Dev/myAI/node_modules/svelte-preprocess/dist/index.js";
var vite_config_default = defineConfig({
  plugins: [
    svelte({
      preprocess: sveltePreprocess()
    })
  ],
  build: {
    outDir: "public/dist",
    emptyOutDir: true,
    lib: {
      entry: "src/main.ts",
      name: "MyAIFrontend",
      formats: ["iife"],
      fileName: () => "bundle.js"
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxEZXZcXFxcbXlBSVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRDpcXFxcRGV2XFxcXG15QUlcXFxcdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0Q6L0Rldi9teUFJL3ZpdGUuY29uZmlnLmpzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgeyBzdmVsdGUgfSBmcm9tICdAc3ZlbHRlanMvdml0ZS1wbHVnaW4tc3ZlbHRlJztcbmltcG9ydCBzdmVsdGVQcmVwcm9jZXNzIGZyb20gJ3N2ZWx0ZS1wcmVwcm9jZXNzJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW1xuICAgIHN2ZWx0ZSh7XG4gICAgICBwcmVwcm9jZXNzOiBzdmVsdGVQcmVwcm9jZXNzKClcbiAgICB9KVxuICBdLFxuICBidWlsZDoge1xuICAgIG91dERpcjogJ3B1YmxpYy9kaXN0JyxcbiAgICBlbXB0eU91dERpcjogdHJ1ZSxcbiAgICBsaWI6IHtcbiAgICAgIGVudHJ5OiAnc3JjL21haW4udHMnLFxuICAgICAgbmFtZTogJ015QUlGcm9udGVuZCcsXG4gICAgICBmb3JtYXRzOiBbJ2lpZmUnXSxcbiAgICAgIGZpbGVOYW1lOiAoKSA9PiAnYnVuZGxlLmpzJ1xuICAgIH1cbiAgfVxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXlOLFNBQVMsb0JBQW9CO0FBQ3RQLFNBQVMsY0FBYztBQUN2QixPQUFPLHNCQUFzQjtBQUU3QixJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxZQUFZLGlCQUFpQjtBQUFBLElBQy9CLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFDQSxPQUFPO0FBQUEsSUFDTCxRQUFRO0FBQUEsSUFDUixhQUFhO0FBQUEsSUFDYixLQUFLO0FBQUEsTUFDSCxPQUFPO0FBQUEsTUFDUCxNQUFNO0FBQUEsTUFDTixTQUFTLENBQUMsTUFBTTtBQUFBLE1BQ2hCLFVBQVUsTUFBTTtBQUFBLElBQ2xCO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
