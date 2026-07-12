import { Router, type IRouter, type Response } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import type { AuthedRequest } from "../../middlewares/requireAuth";

const router: IRouter = Router();

const MAX_PROMPT = 1000;

// Generate a single square pattern image from a text prompt and return it as a
// data URL. Used by the Dressing Room assistant + wardrobe UI to texture the
// procedural voxel character (head wraps, clothing prints). Auth is enforced by
// the parent openai router; the body is validated inline (no zod dep here).
router.post("/openai/generate-image", async (req: AuthedRequest, res: Response) => {
  const raw = (req.body as { prompt?: unknown } | undefined)?.prompt;
  const prompt = typeof raw === "string" ? raw.trim() : "";
  if (!prompt || prompt.length > MAX_PROMPT) {
    res.status(400).json({ error: "Invalid prompt" });
    return;
  }
  try {
    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      n: 1,
    });
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) {
      res.status(502).json({ error: "No image returned" });
      return;
    }
    res.json({ dataUrl: `data:image/png;base64,${b64}` });
  } catch (err) {
    req.log.error({ err }, "Image generation failed");
    res.status(502).json({ error: "Image generation failed" });
  }
});

export default router;
