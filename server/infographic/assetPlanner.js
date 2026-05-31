import { generateImages, getWorkerHealth } from "../imageGeneration/imageProvider.js";
import { saveAsset } from "../imageGeneration/imageAssets.js";

// Plans and generates the decorative image assets for an infographic (advanced
// mode only). Numbers/charts/citations stay in the SVG renderer; the image model
// only produces backgrounds and icons. Generation failures degrade gracefully —
// the spec still renders without the missing asset.

const BACKGROUND_SIZE = { width: 1024, height: 576 };
const ICON_SIZE = { width: 256, height: 256 };

/**
 * Ensure the spec has a visualAssets plan. If the LLM produced none, derive a
 * single subtle background prompt from the title/subtitle.
 */
export function planVisualAssets(spec) {
  const existing = Array.isArray(spec?.visualAssets) ? spec.visualAssets : [];
  if (existing.length) return existing;
  const title = String(spec?.title || "").trim();
  const subtitle = String(spec?.subtitle || "").trim();
  const topic = [title, subtitle].filter(Boolean).join(" — ") || "public sector report";
  return [
    {
      id: "asset-bg",
      type: "generated_background",
      prompt: `clean minimal public-sector infographic background for "${topic}", soft muted palette, abstract subtle shapes, no text`,
      placement: "background",
      opacity: 0.14,
      assetId: null
    }
  ];
}

/**
 * Generate images for each planned visual asset and attach the resulting assetId.
 * Mutates and returns the asset array. Adds a warning string to `warnings` on
 * failure. No-op (with warning) when the worker is unavailable.
 */
export async function generateAssetsForSpec(spec, { signal, warnings = [] } = {}) {
  const assets = planVisualAssets(spec);
  spec.visualAssets = assets;

  const health = await getWorkerHealth();
  if (!health?.ok) {
    warnings.push("image_assets_unavailable");
    return assets;
  }

  for (const asset of assets) {
    if (signal?.aborted) break;
    if (asset.assetId) continue;
    const size = asset.type === "generated_background" ? BACKGROUND_SIZE : ICON_SIZE;
    const stylePreset = asset.type === "generated_icon" ? "icon" : "illustration";
    try {
      const result = await generateImages(
        { prompt: asset.prompt, stylePreset, width: size.width, height: size.height, batch: 1 },
        { signal }
      );
      const b64 = result?.images?.[0];
      if (!b64) throw new Error("no image returned");
      const saved = await saveAsset(b64, result.meta || {});
      asset.assetId = saved.assetId;
    } catch (error) {
      warnings.push(`asset_failed:${asset.id}`);
    }
  }
  return assets;
}
