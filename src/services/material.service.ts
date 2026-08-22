import OpenAI from "openai";
import { convert } from "officeparser";
import prisma from "../config/db.config";
import cloudinary from "../config/cloudinary.config";
import NotFoundError from "../errors/NotFoundError";
import ValidationError from "../errors/ValidationError";
import AppError from "../errors/AppError";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** How much extracted text we're willing to spend on prompt budget */
const MATERIAL_CHAR_BUDGET = 6000;

/**
 * Hard ceiling on any single file's extracted text. Well above the prompt budget,
 * far below the JSON body limit the client posts this text back through.
 */
const EXTRACT_CHAR_LIMIT = 20000;

const TRANSCRIBE_PROMPT =
  "Transcribe this course document verbatim. Preserve its structure — headings, " +
  "numbered topics, week labels, sub-points. If it is a syllabus or course outline, " +
  "list every topic in the order given. Do not summarise, explain, or add anything " +
  "that is not written in the document. Return plain text only.";

// ── File type helpers ────────────────────────────────────────────────────────

const OFFICE_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.oasis.opendocument.text", // odt
  "application/vnd.oasis.opendocument.presentation", // odp
  "application/vnd.oasis.opendocument.spreadsheet", // ods
  "application/rtf",
  "application/msword",
]);

export const isImage = (mimeType: string) => mimeType.startsWith("image/");
export const isPdf = (mimeType: string) => mimeType === "application/pdf";
const isOfficeDoc = (mimeType: string) => OFFICE_MIME_TYPES.has(mimeType);
const isPlainText = (mimeType: string) =>
  mimeType.startsWith("text/") || mimeType === "application/json";

export type UploadedFile = { url: string; publicId: string; resourceType: "image" | "raw" };

// ── Upload ───────────────────────────────────────────────────────────────────

/**
 * Cloudinary rejections sit outside the AppError hierarchy — untranslated, its size
 * refusal surfaces as a 500 with a stack trace. Multer should catch oversized files
 * first; this is the safety net for whatever slips past.
 */
const toUploadError = (error: any) => {
  const message = error?.message ?? "Upload failed";
  const isClientFixable = error?.http_code === 400 || /too large/i.test(message);
  return new AppError({
    message: isClientFixable ? message : "Upload failed. Please try again.",
    statusCode: isClientFixable ? 400 : 502,
    type: isClientFixable ? "VALIDATION_ERROR" : "UPLOAD_FAILED",
  });
};

/**
 * Streams a buffer to Cloudinary. Non-images must go up as `raw` — Cloudinary
 * rejects a DOCX offered as an image.
 */
export function uploadFile(
  buffer: Buffer,
  mimeType: string,
  folder = "studymate/materials",
): Promise<UploadedFile> {
  const resourceType: "image" | "raw" = isImage(mimeType) ? "image" : "raw";

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (error, result) => {
        if (error || !result) return reject(toUploadError(error));
        resolve({ url: result.secure_url, publicId: result.public_id, resourceType });
      },
    );
    stream.end(buffer);
  });
}

export async function destroyFile(publicId: string, mimeType: string): Promise<void> {
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: isImage(mimeType) ? "image" : "raw",
    });
  } catch (err) {
    // A failed cleanup shouldn't block the user's delete
    console.error("[material] cloudinary destroy failed:", err);
  }
}

// ── Text extraction ──────────────────────────────────────────────────────────

async function extractFromImage(url: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: TRANSCRIBE_PROMPT },
          { type: "image_url", image_url: { url } },
        ],
      },
    ],
  });
  return (completion.choices[0]?.message?.content ?? "").trim();
}

/**
 * PDFs go to OpenAI rather than a local parser so that scanned/photographed
 * PDFs — a syllabus photo saved as PDF is very common — work as well as text ones.
 */
async function extractFromPdf(buffer: Buffer, fileName: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: TRANSCRIBE_PROMPT },
          {
            type: "file",
            file: {
              filename: fileName || "document.pdf",
              file_data: `data:application/pdf;base64,${buffer.toString("base64")}`,
            },
          },
        ],
      },
    ],
  });
  return (completion.choices[0]?.message?.content ?? "").trim();
}

/**
 * Office formats are parsed locally — no AI call, no cost. Markdown output keeps
 * headings and slide/sheet structure, which matters once this text lands in a prompt.
 * OCR stays off: it would lazily fetch a WASM bundle mid-request, and scanned
 * documents are handled by the PDF/image paths instead.
 */
async function extractFromOfficeDoc(buffer: Buffer): Promise<string> {
  const result = await convert(buffer, "md", { parseConfig: { ocr: false } });
  const text = typeof result === "string" ? result : (result?.value ?? "");
  // officeparser emits Pandoc-style heading anchors — noise inside a prompt
  return text.replace(/\s*\{#[^}]*\}/g, "").trim();
}

/** Marked, not silent — the user reads this text in the material preview. */
const capText = (text: string) =>
  text.length > EXTRACT_CHAR_LIMIT
    ? `${text.slice(0, EXTRACT_CHAR_LIMIT)}\n\n[…truncated]`
    : text;

/** Routes to the cheapest strategy that can read this file type. */
export async function extractText(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  uploadedUrl?: string,
): Promise<string> {
  try {
    let text = "";
    if (isImage(mimeType)) {
      text = uploadedUrl ? await extractFromImage(uploadedUrl) : "";
    } else if (isPdf(mimeType)) {
      text = await extractFromPdf(buffer, fileName);
    } else if (isOfficeDoc(mimeType)) {
      text = await extractFromOfficeDoc(buffer);
    } else if (isPlainText(mimeType)) {
      text = buffer.toString("utf8").trim();
    }
    // One cap on the way out, so every branch — and any added later — stays bounded.
    // The office parser in particular has no ceiling of its own; the AI paths are
    // capped only incidentally, by max_tokens.
    return capText(text);
  } catch (err) {
    // A parse failure shouldn't lose the upload — the file is still attached,
    // it just won't ground any prompts. The UI shows the empty text.
    console.error(`[material] extraction failed for ${mimeType}:`, err);
    return "";
  }
}

/** Upload + extract in one step. Used by both the outline and material routes. */
export async function uploadAndExtract(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<UploadedFile & { extractedText: string }> {
  const file = await uploadFile(buffer, mimeType);
  const extractedText = await extractText(buffer, mimeType, fileName, file.url);
  return { ...file, extractedText };
}

// ── Material context ─────────────────────────────────────────────────────────

/**
 * The text injected into prompts: everything attached to the course, plus anything
 * attached to this specific topic. Course-level material is added first so that a
 * syllabus survives truncation ahead of a single lecture's notes.
 */
export async function buildMaterialContext(
  courseId: string,
  topicId?: string | null,
): Promise<string | null> {
  const materials = await prisma.courseMaterial.findMany({
    where: {
      courseId,
      OR: [{ topicId: null }, ...(topicId ? [{ topicId }] : [])],
    },
    orderBy: [{ topicId: "asc" }, { createdAt: "asc" }], // nulls (course-level) first
    select: { topicId: true, fileName: true, extractedText: true },
  });

  if (materials.length === 0) return null;

  const sections = materials
    .filter((m) => m.extractedText.trim().length > 0)
    .map(
      (m) =>
        `[${m.topicId ? "Topic material" : "Course-wide material"}: ${m.fileName}]\n` +
        m.extractedText.trim(),
    );

  if (sections.length === 0) return null;

  const joined = sections.join("\n\n---\n\n");
  return joined.length > MATERIAL_CHAR_BUDGET
    ? `${joined.slice(0, MATERIAL_CHAR_BUDGET)}\n\n[…material truncated]`
    : joined;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

async function getDbUser(clerkId: string) {
  const user = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } });
  if (!user) throw new NotFoundError("user");
  return user;
}

/** Confirms the user is enrolled in the course before they can touch its materials. */
async function verifyCourseAccess(clerkId: string, courseId: string) {
  const user = await getDbUser(clerkId);
  const enrollment = await prisma.enrollment.findFirst({
    where: { userId: user.id, courseId },
    select: { id: true },
  });
  if (!enrollment) throw new NotFoundError("course");
  return user;
}

export async function addMaterial(
  clerkId: string,
  courseId: string,
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  topicId?: string | null,
) {
  const user = await verifyCourseAccess(clerkId, courseId);

  if (topicId) {
    const topic = await prisma.topic.findFirst({
      where: { id: topicId, courseId },
      select: { id: true },
    });
    if (!topic) throw new ValidationError("topic does not belong to this course");
  }

  const { url, publicId, extractedText } = await uploadAndExtract(buffer, mimeType, fileName);

  return prisma.courseMaterial.create({
    data: {
      courseId,
      topicId: topicId ?? null,
      userId: user.id,
      kind: "material",
      fileUrl: url,
      fileName,
      mimeType,
      publicId,
      extractedText,
    },
  });
}

export async function listMaterials(
  clerkId: string,
  courseId: string,
  topicId?: string | null,
) {
  await verifyCourseAccess(clerkId, courseId);

  return prisma.courseMaterial.findMany({
    where: {
      courseId,
      // no topicId filter → everything; with one → course-wide plus that topic's
      ...(topicId ? { OR: [{ topicId: null }, { topicId }] } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteMaterial(clerkId: string, courseId: string, materialId: string) {
  await verifyCourseAccess(clerkId, courseId);

  const material = await prisma.courseMaterial.findFirst({
    where: { id: materialId, courseId },
  });
  if (!material) throw new NotFoundError("material");

  await prisma.courseMaterial.delete({ where: { id: material.id } });
  await destroyFile(material.publicId, material.mimeType);

  return { success: true };
}
