import { Router } from "express";
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

router.get("/", requireClerkAuth, handleGetCourses);
router.post("/", requireClerkAuth, handleCreateCourse);
router.post("/generate", requireClerkAuth, handleGenerateTopics);
router.get("/:id", requireClerkAuth, handleGetCourse);
router.patch("/:id", requireClerkAuth, handleUpdateCourse);
router.delete("/:id", requireClerkAuth, handleDeleteCourse);

// Topics
router.post("/:id/topics", requireClerkAuth, handleAddTopic);
router.put("/:id/topics/reorder", requireClerkAuth, handleReorderTopics);
router.patch("/:id/topics/:topicId", requireClerkAuth, handleUpdateTopic);
router.delete("/:id/topics/:topicId", requireClerkAuth, handleDeleteTopic);
router.post("/:id/topics/:topicId/complete", requireClerkAuth, handleCompleteTopic);

// Learning objectives
router.get("/:courseId/topics/:topicId/objectives", requireClerkAuth, handleGetObjectives);
router.post("/:courseId/topics/:topicId/objectives", requireClerkAuth, handleAddObjective);
router.post("/:courseId/topics/:topicId/objectives/generate", requireClerkAuth, handleGenerateObjectives);
router.post("/:courseId/topics/:topicId/objectives/evaluate", requireClerkAuth, handleEvaluateObjectives);
router.patch("/:courseId/topics/:topicId/objectives/:objectiveId", requireClerkAuth, handleUpdateObjective);
router.delete("/:courseId/topics/:topicId/objectives/:objectiveId", requireClerkAuth, handleDeleteObjective);

// Quiz
router.post("/:courseId/topics/:topicId/quiz/generate", requireClerkAuth, handleGenerateQuiz);

export default router;
