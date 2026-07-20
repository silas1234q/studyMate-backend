import "dotenv/config";
import fs from "fs";
import path from "path";
import cloudinary from "../src/config/cloudinary.config";
import prisma from "../src/config/db.config";

async function seed() {
  const existing = await prisma.categoryImage.count();
  if (existing > 0) {
    console.log(`Already seeded (${existing} rows). Skipping.`);
    return;
  }

  const baseDir = path.resolve(__dirname, "../../course-images");
  const categories = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  console.log(`Found ${categories.length} categories`);
  let total = 0;

  for (const category of categories) {
    const catDir = path.join(baseDir, category);
    const files = fs
      .readdirSync(catDir)
      .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));

    for (const file of files) {
      const filePath = path.join(catDir, file);
      console.log(`Uploading ${category}/${file}...`);

      const safeCategory = category.replace(/&/g, "and");
      const result = await cloudinary.uploader.upload(filePath, {
        folder: `studymate/course-categories/${safeCategory}`,
        resource_type: "image",
      });

      await prisma.categoryImage.create({
        data: {
          category,
          imageUrl: result.secure_url,
        },
      });

      total++;
    }
  }

  console.log(`Seeded ${total} category images.`);
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
