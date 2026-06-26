import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import {
  handleGetCourses,
  handleGetCourse,
  handleCreateCourse,
  handleGenerateTopics,
  handleCompleteTopic,
  handleUpdateCourse,
  handleDeleteCourse,
  handleAddTopic,
  handleUpdateTopic,
  handleDeleteTopic,
  handleReorderTopics,
  handleSaveTopicOverview,
} from "../controllers/course.controller";
import {
  handleGetObjectives,
  handleGenerateObjectives,
  handleEvaluateObjectives,
  handleGenerateQuiz,
  handleAddObjective,
  handleUpdateObjective,
  handleDeleteObjective,
} from "../controllers/objectives.controller";

const router = Router();

// Strict rate limit for AI-powered endpoints: 10 requests per minute per IP
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many AI requests, please slow down." },
});

router.get("/", requireClerkAuth, handleGetCourses);
router.post("/", requireClerkAuth, handleCreateCourse);
router.post("/generate", requireClerkAuth, aiLimiter, handleGenerateTopics);
router.get("/:id", requireClerkAuth, handleGetCourse);
router.patch("/:id", requireClerkAuth, handleUpdateCourse);
router.delete("/:id", requireClerkAuth, handleDeleteCourse);

// Topics
router.post("/:id/topics", requireClerkAuth, handleAddTopic);
router.put("/:id/topics/reorder", requireClerkAuth, handleReorderTopics);
router.patch("/:id/topics/:topicId", requireClerkAuth, handleUpdateTopic);
router.delete("/:id/topics/:topicId", requireClerkAuth, handleDeleteTopic);
router.post("/:id/topics/:topicId/complete", requireClerkAuth, handleCompleteTopic);
router.put("/:id/topics/:topicId/overview", requireClerkAuth, handleSaveTopicOverview);

// Learning objectives
router.get("/:courseId/topics/:topicId/objectives", requireClerkAuth, handleGetObjectives);
router.post("/:courseId/topics/:topicId/objectives", requireClerkAuth, handleAddObjective);
router.post("/:courseId/topics/:topicId/objectives/generate", requireClerkAuth, aiLimiter, handleGenerateObjectives);
router.post("/:courseId/topics/:topicId/objectives/evaluate", requireClerkAuth, aiLimiter, handleEvaluateObjectives);
router.patch("/:courseId/topics/:topicId/objectives/:objectiveId", requireClerkAuth, handleUpdateObjective);
router.delete("/:courseId/topics/:topicId/objectives/:objectiveId", requireClerkAuth, handleDeleteObjective);

// Quiz
router.post("/:courseId/topics/:topicId/quiz/generate", requireClerkAuth, aiLimiter, handleGenerateQuiz);

export default router;
