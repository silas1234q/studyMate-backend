import { Request, Response } from "express";
import { createHash } from "crypto";
import OpenAI from "openai";
import { getAuth } from "@clerk/express";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory cache: prompt hash → image URL
const cache = new Map<string, string>();

export async function generateIllustration(req: Request, res: Response) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { prompt } = req.body as { prompt?: string };
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    res.status(400).json({ message: "prompt is required" });
    return;
  }

  const cacheKey = createHash("sha256").update(prompt.trim()).digest("hex");
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json({ imageUrl: cached });
    return;
  }

  try {
    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: prompt.trim(),
      n: 1,
      size: "1024x1024",
      quality: "standard",
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) {
      res.status(500).json({ message: "No image returned" });
      return;
    }

    cache.set(cacheKey, imageUrl);
    res.json({ imageUrl });
  } catch (err) {
    console.error("Illustration generation error:", err);
    res.status(500).json({ message: "Failed to generate illustration" });
  }
}
