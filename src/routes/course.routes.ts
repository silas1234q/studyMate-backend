import { Router } from "express";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import {
  handleGetCourses,
  handleGetCourse,
  handleCreateCourse,
  handleGenerateTopics,
  handleCompleteTopic,
} from "../controllers/course.controller";

const router = Router();

router.get("/", requireClerkAuth, handleGetCourses);
router.post("/", requireClerkAuth, handleCreateCourse);
router.post("/generate", requireClerkAuth, handleGenerateTopics);
router.get("/:id", requireClerkAuth, handleGetCourse);
router.post("/:id/topics/:topicId/complete", requireClerkAuth, handleCompleteTopic);

export default router;
