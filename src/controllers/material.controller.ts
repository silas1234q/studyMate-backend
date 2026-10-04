import { getAuth } from "@clerk/express";
import { catchAsync } from "../utils/catchAsync";
import AuthError from "../errors/AuthError";
import ValidationError from "../errors/ValidationError";
import {
  addMaterial,
  deleteMaterial,
  listMaterials,
  uploadAndExtract,
  uploadFile,
} from "../services/material.service";
import { checkChatImageAccess, checkMaterialAccess } from "../services/subscription.service";

type UploadedRequest = { file?: Express.Multer.File };

function requireFile(req: UploadedRequest) {
  if (!req.file) throw new ValidationError("a file is required");
  return {
    buffer: req.file.buffer,
    mimeType: req.file.mimetype,
    fileName: req.file.originalname || "upload",
  };
}

/**
 * Free for everyone: reads a syllabus before the course exists, so the user can
 * review the text and topic generation can be grounded in it.
 */
export const handleExtractOutline = catchAsync(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) throw new AuthError("user not authenticated");

  const { buffer, mimeType, fileName } = requireFile(req);
  const { url, extractedText } = await uploadAndExtract(buffer, mimeType, fileName);

  res.status(201).json({ fileUrl: url, fileName, mimeType, extractedText });
});

export const handleAddMaterial = catchAsync(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) throw new AuthError("user not authenticated");
  await checkMaterialAccess(userId);

  const courseId = req.params.courseId as string;
  const { buffer, mimeType, fileName } = requireFile(req);
  const topicId = typeof req.body?.topicId === "string" && req.body.topicId ? req.body.topicId : null;

  const material = await addMaterial(userId, courseId, buffer, mimeType, fileName, topicId);
  res.status(201).json(material);
});

export const handleListMaterials = catchAsync(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) throw new AuthError("user not authenticated");

  const courseId = req.params.courseId as string;
  const topicId = typeof req.query.topicId === "string" ? req.query.topicId : null;

  const materials = await listMaterials(userId, courseId, topicId);
  res.json(materials);
});

export const handleDeleteMaterial = catchAsync(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) throw new AuthError("user not authenticated");
  await checkMaterialAccess(userId);

  const courseId = req.params.courseId as string;
  const materialId = req.params.materialId as string;
  const result = await deleteMaterial(userId, courseId, materialId);
  res.json(result);
});

/**
 * Pro only: a one-off file attached to a single chat message, in either topic
 * chat or quick chat. Text is extracted now so non-PDF documents can be injected
 * as text at chat time rather than re-uploaded to the model.
 */
export const handleChatAttachmentUpload = catchAsync(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) throw new AuthError("user not authenticated");
  await checkChatImageAccess(userId);

  const { buffer, mimeType, fileName } = requireFile(req);

  // Images go to the model natively at chat time, so they only need uploading.
  // Every other format is read once here and injected as text on each send.
  if (mimeType.startsWith("image/")) {
    // storedMimeType, not the uploaded one: an iOS HEIC is converted to JPEG on
    // the way up, and the client must be told what it actually got.
    const { url, mimeType: storedMimeType } = await uploadFile(
      buffer,
      mimeType,
      "studymate/chat",
    );
    res.status(201).json({
      attachmentUrl: url,
      attachmentName: fileName,
      attachmentType: storedMimeType,
      extractedText: "",
    });
    return;
  }

  const { url, extractedText } = await uploadAndExtract(buffer, mimeType, fileName);
  res.status(201).json({
    attachmentUrl: url,
    attachmentName: fileName,
    attachmentType: mimeType,
    extractedText,
  });
});
