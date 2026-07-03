import { Router } from "express";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import {
  handleCreateSchedule,
  handleGetAllSchedules,
  handleGetScheduleForCourse,
  handleUpdateSchedule,
  handleDeleteSchedule,
} from "../controllers/schedule.controller";

const router = Router();

router.post("/", requireClerkAuth, handleCreateSchedule);
router.get("/", requireClerkAuth, handleGetAllSchedules);
router.get("/course/:courseId", requireClerkAuth, handleGetScheduleForCourse);
router.patch("/:id", requireClerkAuth, handleUpdateSchedule);
router.delete("/:id", requireClerkAuth, handleDeleteSchedule);

export default router;
