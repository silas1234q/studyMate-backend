import { Router } from "express";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import {
  handleGetCourses,
  handleGetCourse,
  handleCreateCourse,
  handleGenerateTopics,
  handleCompleteTopic,
} from "../controllers/course.controller";
import {
  handleGetObjectives,
  handleGenerateObjectives,
  handleEvaluateObjectives,
  handleGenerateQuiz,
} from "../controllers/objectives.controller";

const router = Router();

router.get("/", requireClerkAuth, handleGetCourses);
router.post("/", requireClerkAuth, handleCreateCourse);
router.post("/generate", requireClerkAuth, handleGenerateTopics);
router.get("/:id", requireClerkAuth, handleGetCourse);
router.post("/:id/topics/:topicId/complete", requireClerkAuth, handleCompleteTopic);

// Learning objectives
router.get("/:courseId/topics/:topicId/objectives", requireClerkAuth, handleGetObjectives);
router.post("/:courseId/topics/:topicId/objectives/generate", requireClerkAuth, handleGenerateObjectives);
router.post("/:courseId/topics/:topicId/objectives/evaluate", requireClerkAuth, handleEvaluateObjectives);

// Quiz
router.post("/:courseId/topics/:topicId/quiz/generate", requireClerkAuth, handleGenerateQuiz);

export default router;
