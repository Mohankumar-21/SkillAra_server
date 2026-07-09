import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";

export async function getCourseLessonIds(courseId) {
  const modules = await Module.find({ courseId }).select("lessons");
  const lessonIds = modules.flatMap((m) => m.lessons.map(String));
  return lessonIds;
}

export async function getCourseLessonCount(courseId) {
  const modules = await Module.find({ courseId }).select("lessons");
  return modules.reduce((sum, m) => sum + m.lessons.length, 0);
}

export function calculateMastery(completedCount, totalLessons) {
  if (!totalLessons) return 0;
  return Math.round((completedCount / totalLessons) * 100);
}

export async function recalculateMastery(progress, courseId) {
  const totalLessons = await getCourseLessonCount(courseId);
  const completedCount = progress.completedLessons?.length || 0;
  const mastery = calculateMastery(completedCount, totalLessons);
  progress.overallMasery = mastery;
  return progress;
}
