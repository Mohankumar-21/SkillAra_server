import Course from "../models/Course.js";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import { prepareResponseMsg } from "../utils/helper.js";

async function getOwnedCourse(courseId, tenantId, user) {
  const course = await Course.findOne({ _id: courseId, tenantId });
  if (!course) return null;

  if (user.role === "TUTOR" && String(course.instructorId) !== String(user._id)) {
    return "forbidden";
  }
  return course;
}

export async function listCourses(req, res, next) {
  try {
    const { status, search, tag } = req.query;
    const filter = req.user?.role === "SUPER_ADMIN" ? {} : { tenantId: req.tenant._id };

    if (status) filter.status = status;
    if (tag) filter.tags = tag;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    if (!req.user || req.user.role === "STUDENT") {
      filter.status = "PUBLISHED";
    }

    const courses = await Course.find(filter)
      .populate("instructorId", "name email")
      .sort({ created_on: -1 });

    return res
      .status(200)
      .send(prepareResponseMsg(courses, true, "Courses fetched successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function createCourse(req, res, next) {
  try {
    const { title, description, thumbnail, price, tags, status } = req.body;
    const course = await Course.create({
      tenantId: req.tenant._id,
      title,
      description,
      instructorId: req.user._id,
      thumbnail,
      price,
      tags,
      status: status || "DRAFT",
      created_by: req.user.email,
    });

    return res
      .status(201)
      .send(prepareResponseMsg(course, true, "Course created successfully", 201));
  } catch (err) {
    return next(err);
  }
}

export async function getCourse(req, res, next) {
  try {
    const filter = { _id: req.params.id };
    if (req.user?.role !== "SUPER_ADMIN") {
      filter.tenantId = req.tenant._id;
      if (!req.user || req.user.role === "STUDENT") filter.status = "PUBLISHED";
    }

    const course = await Course.findOne(filter).populate({
      path: "modules",
      populate: { path: "lessons" },
    });

    if (!course) {
      return res.status(404).send(prepareResponseMsg({}, false, "Course not found", 404));
    }

    return res
      .status(200)
      .send(prepareResponseMsg(course, true, "Course fetched successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function updateCourse(req, res, next) {
  try {
    const course = await getOwnedCourse(req.params.id, req.tenant._id, req.user);
    if (course === "forbidden") {
      return res.status(403).send(prepareResponseMsg({}, false, "Forbidden", 403));
    }
    if (!course) {
      return res.status(404).send(prepareResponseMsg({}, false, "Course not found", 404));
    }

    const allowed = ["title", "description", "thumbnail", "price", "tags", "status"];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.updated_by = req.user.email;

    const updated = await Course.findByIdAndUpdate(course._id, { $set: updates }, { new: true });
    return res
      .status(200)
      .send(prepareResponseMsg(updated, true, "Course updated successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function deleteCourse(req, res, next) {
  try {
    const course = await getOwnedCourse(req.params.id, req.tenant._id, req.user);
    if (course === "forbidden") {
      return res.status(403).send(prepareResponseMsg({}, false, "Forbidden", 403));
    }
    if (!course) {
      return res.status(404).send(prepareResponseMsg({}, false, "Course not found", 404));
    }

    await Course.updateOne({ _id: course._id }, { $set: { status: "ARCHIVED" } });
    return res
      .status(200)
      .send(prepareResponseMsg({ ok: true }, true, "Course archived successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function addModule(req, res, next) {
  try {
    const course = await getOwnedCourse(req.params.id, req.tenant._id, req.user);
    if (course === "forbidden") {
      return res.status(403).send(prepareResponseMsg({}, false, "Forbidden", 403));
    }
    if (!course) {
      return res.status(404).send(prepareResponseMsg({}, false, "Course not found", 404));
    }

    const { title, description, order } = req.body;
    const module = await Module.create({ courseId: course._id, title, description, order });
    course.modules.push(module._id);
    await course.save();

    return res
      .status(201)
      .send(prepareResponseMsg(module, true, "Module added successfully", 201));
  } catch (err) {
    return next(err);
  }
}

export async function updateModule(req, res, next) {
  try {
    const module = await Module.findById(req.params.moduleId);
    if (!module) {
      return res.status(404).send(prepareResponseMsg({}, false, "Module not found", 404));
    }

    const course = await getOwnedCourse(module.courseId, req.tenant._id, req.user);
    if (course === "forbidden") {
      return res.status(403).send(prepareResponseMsg({}, false, "Forbidden", 403));
    }
    if (!course) {
      return res.status(404).send(prepareResponseMsg({}, false, "Course not found", 404));
    }

    const updates = {};
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.order !== undefined) updates.order = req.body.order;

    const updated = await Module.findByIdAndUpdate(module._id, { $set: updates }, { new: true });
    return res
      .status(200)
      .send(prepareResponseMsg(updated, true, "Module updated successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function deleteModule(req, res, next) {
  try {
    const module = await Module.findById(req.params.moduleId);
    if (!module) {
      return res.status(404).send(prepareResponseMsg({}, false, "Module not found", 404));
    }

    const course = await getOwnedCourse(module.courseId, req.tenant._id, req.user);
    if (course === "forbidden") {
      return res.status(403).send(prepareResponseMsg({}, false, "Forbidden", 403));
    }
    if (!course) {
      return res.status(404).send(prepareResponseMsg({}, false, "Course not found", 404));
    }

    await Lesson.deleteMany({ moduleId: module._id });
    await Course.updateOne({ _id: course._id }, { $pull: { modules: module._id } });
    await Module.deleteOne({ _id: module._id });

    return res
      .status(200)
      .send(prepareResponseMsg({ ok: true }, true, "Module deleted successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function addLesson(req, res, next) {
  try {
    const module = await Module.findById(req.params.moduleId);
    if (!module) {
      return res.status(404).send(prepareResponseMsg({}, false, "Module not found", 404));
    }

    const course = await getOwnedCourse(module.courseId, req.tenant._id, req.user);
    if (course === "forbidden") {
      return res.status(403).send(prepareResponseMsg({}, false, "Forbidden", 403));
    }
    if (!course) {
      return res.status(404).send(prepareResponseMsg({}, false, "Course not found", 404));
    }

    const { title, content, videoUrl, type, order, duration, assignmentInstructions } = req.body;
    const lesson = await Lesson.create({
      moduleId: module._id,
      title,
      content,
      videoUrl,
      type,
      order,
      duration,
      assignmentInstructions,
    });

    module.lessons.push(lesson._id);
    await module.save();

    return res
      .status(201)
      .send(prepareResponseMsg(lesson, true, "Lesson added successfully", 201));
  } catch (err) {
    return next(err);
  }
}

export async function updateLesson(req, res, next) {
  try {
    const lesson = await Lesson.findById(req.params.lessonId);
    if (!lesson) {
      return res.status(404).send(prepareResponseMsg({}, false, "Lesson not found", 404));
    }

    const module = await Module.findById(lesson.moduleId);
    const course = await getOwnedCourse(module.courseId, req.tenant._id, req.user);
    if (course === "forbidden") {
      return res.status(403).send(prepareResponseMsg({}, false, "Forbidden", 403));
    }
    if (!course) {
      return res.status(404).send(prepareResponseMsg({}, false, "Course not found", 404));
    }

    const allowed = [
      "title",
      "content",
      "videoUrl",
      "type",
      "order",
      "duration",
      "assignmentInstructions",
      "attachments",
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const updated = await Lesson.findByIdAndUpdate(lesson._id, { $set: updates }, { new: true });
    return res
      .status(200)
      .send(prepareResponseMsg(updated, true, "Lesson updated successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function deleteLesson(req, res, next) {
  try {
    const lesson = await Lesson.findById(req.params.lessonId);
    if (!lesson) {
      return res.status(404).send(prepareResponseMsg({}, false, "Lesson not found", 404));
    }

    const module = await Module.findById(lesson.moduleId);
    const course = await getOwnedCourse(module.courseId, req.tenant._id, req.user);
    if (course === "forbidden") {
      return res.status(403).send(prepareResponseMsg({}, false, "Forbidden", 403));
    }
    if (!course) {
      return res.status(404).send(prepareResponseMsg({}, false, "Course not found", 404));
    }

    await Module.updateOne({ _id: module._id }, { $pull: { lessons: lesson._id } });
    await Lesson.deleteOne({ _id: lesson._id });

    return res
      .status(200)
      .send(prepareResponseMsg({ ok: true }, true, "Lesson deleted successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function uploadFile(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).send(prepareResponseMsg({}, false, "No file uploaded", 400));
    }

    const url = `/uploads/${req.file.filename}`;
    return res.status(201).send(
      prepareResponseMsg(
        {
          url,
          name: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
        },
        true,
        "File uploaded successfully",
        201
      )
    );
  } catch (err) {
    return next(err);
  }
}
