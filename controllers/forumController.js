import Question from "../models/Question.js";
import Answer from "../models/Answer.js";
import Vote from "../models/Vote.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { getActor, canModerateCourses } from "../utils/actor.js";

function toPublicQuestion(doc) {
  const q = doc.toObject ? doc.toObject() : doc;
  return {
    id: q._id,
    courseId: q.courseId,
    userId: q.userId,
    title: q.title,
    body: q.body,
    tags: q.tags,
    status: q.status,
    viewCount: q.viewCount,
    answerCount: q.answerCount,
    voteScore: q.voteScore,
    acceptedAnswerId: q.acceptedAnswerId,
    created_on: q.created_on,
  };
}

function toPublicAnswer(doc) {
  const a = doc.toObject ? doc.toObject() : doc;
  return {
    id: a._id,
    questionId: a.questionId,
    userId: a.userId,
    body: a.body,
    isAccepted: a.isAccepted,
    voteScore: a.voteScore,
    created_on: a.created_on,
  };
}

/** Staff-only fields (moderation reason/actor) are stripped for regular members. */
function withModeration(payload, doc, actor) {
  if (canModerateCourses(actor)) {
    payload.moderation = doc.moderation;
  }
  return payload;
}

export async function createQuestion(req, res, next) {
  try {
    const actor = getActor(req);
    const { courseId, title, body, tags } = req.body;

    const question = await Question.create({
      tenantId: req.tenantId,
      courseId: courseId || null,
      userId: actor.id,
      title,
      body,
      tags: tags || [],
    });

    return res
      .status(201)
      .send(prepareResponseMsg({ question: toPublicQuestion(question) }, true, "Question posted", 201));
  } catch (err) {
    return next(err);
  }
}

export async function listQuestions(req, res, next) {
  try {
    const actor = getActor(req);
    const { courseId, tag, search, page = 1, limit = 20 } = req.query;

    const filter = { tenantId: req.tenantId };
    if (!canModerateCourses(actor)) filter["moderation.isHidden"] = { $ne: true };
    if (courseId) filter.courseId = courseId;
    if (tag) filter.tags = tag;
    if (search) filter.$text = { $search: String(search) };

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(50, Math.max(1, Number(limit) || 20));

    const [questions, totalCount] = await Promise.all([
      Question.find(filter)
        .populate("userId", "name email")
        .sort({ created_on: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Question.countDocuments(filter),
    ]);

    const data = questions.map((q) => withModeration(toPublicQuestion(q), q, actor));
    return res
      .status(200)
      .send(prepareResponseMsg(data, true, "Questions fetched", 200, limitNum, totalCount));
  } catch (err) {
    return next(err);
  }
}

export async function getQuestion(req, res, next) {
  try {
    const actor = getActor(req);
    const question = await Question.findOne({ _id: req.params.id, tenantId: req.tenantId }).populate(
      "userId",
      "name email"
    );
    if (!question) return sendError(res, "QUESTION_NOT_FOUND", 404);
    if (question.moderation?.isHidden && !canModerateCourses(actor)) {
      return sendError(res, "QUESTION_NOT_FOUND", 404);
    }

    Question.updateOne({ _id: question._id }, { $inc: { viewCount: 1 } }).catch(() => {});

    const answerFilter = { questionId: question._id, tenantId: req.tenantId };
    if (!canModerateCourses(actor)) answerFilter["moderation.isHidden"] = { $ne: true };

    const answers = await Answer.find(answerFilter)
      .populate("userId", "name email")
      .sort({ isAccepted: -1, voteScore: -1, created_on: 1 });

    return res.status(200).send(
      prepareResponseMsg(
        {
          question: withModeration(toPublicQuestion(question), question, actor),
          answers: answers.map((a) => withModeration(toPublicAnswer(a), a, actor)),
        },
        true,
        "Question fetched",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}

export async function deleteQuestion(req, res, next) {
  try {
    const actor = getActor(req);
    const question = await Question.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!question) return sendError(res, "QUESTION_NOT_FOUND", 404);

    const isOwner = String(question.userId) === String(actor.id);
    if (!isOwner && !canModerateCourses(actor)) return sendError(res, "GENERAL_FORBIDDEN", 403);

    await Answer.deleteMany({ questionId: question._id });
    await Vote.deleteMany({ targetType: "QUESTION", targetId: question._id });
    await question.deleteOne();

    return res.status(200).send(prepareResponseMsg({ ok: true }, true, "Question deleted", 200));
  } catch (err) {
    return next(err);
  }
}

export async function createAnswer(req, res, next) {
  try {
    const actor = getActor(req);
    const question = await Question.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!question) return sendError(res, "QUESTION_NOT_FOUND", 404);
    if (question.status === "CLOSED") return sendError(res, "QUESTION_CLOSED", 409);

    const answer = await Answer.create({
      tenantId: req.tenantId,
      questionId: question._id,
      userId: actor.id,
      body: req.body.body,
    });

    await Question.updateOne({ _id: question._id }, { $inc: { answerCount: 1 } });

    return res
      .status(201)
      .send(prepareResponseMsg({ answer: toPublicAnswer(answer) }, true, "Answer posted", 201));
  } catch (err) {
    return next(err);
  }
}

export async function deleteAnswer(req, res, next) {
  try {
    const actor = getActor(req);
    const answer = await Answer.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!answer) return sendError(res, "ANSWER_NOT_FOUND", 404);

    const isOwner = String(answer.userId) === String(actor.id);
    if (!isOwner && !canModerateCourses(actor)) return sendError(res, "GENERAL_FORBIDDEN", 403);

    await Vote.deleteMany({ targetType: "ANSWER", targetId: answer._id });
    await answer.deleteOne();
    await Question.updateOne(
      { _id: answer.questionId, answerCount: { $gt: 0 } },
      { $inc: { answerCount: -1 } }
    );
    if (answer.isAccepted) {
      await Question.updateOne({ _id: answer.questionId }, { $set: { acceptedAnswerId: null } });
    }

    return res.status(200).send(prepareResponseMsg({ ok: true }, true, "Answer deleted", 200));
  } catch (err) {
    return next(err);
  }
}

/** Only the question's own author may mark an answer as the accepted one. */
export async function acceptAnswer(req, res, next) {
  try {
    const actor = getActor(req);
    const answer = await Answer.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!answer) return sendError(res, "ANSWER_NOT_FOUND", 404);

    const question = await Question.findOne({ _id: answer.questionId, tenantId: req.tenantId });
    if (!question) return sendError(res, "QUESTION_NOT_FOUND", 404);
    if (String(question.userId) !== String(actor.id)) return sendError(res, "GENERAL_FORBIDDEN", 403);

    await Answer.updateMany({ questionId: question._id }, { $set: { isAccepted: false } });
    answer.isAccepted = true;
    await answer.save();
    question.acceptedAnswerId = answer._id;
    await question.save();

    return res.status(200).send(prepareResponseMsg({ answer: toPublicAnswer(answer) }, true, "Answer accepted", 200));
  } catch (err) {
    return next(err);
  }
}

async function castVote({ tenantId, actor, targetType, targetId, value, Model }) {
  const target = await Model.findOne({ _id: targetId, tenantId });
  if (!target) return null;

  const existing = await Vote.findOne({ userId: actor.id, targetType, targetId });
  let delta;
  if (!existing) {
    await Vote.create({ tenantId, userId: actor.id, targetType, targetId, value });
    delta = value;
  } else if (existing.value === value) {
    // Voting the same direction again retracts the vote.
    await existing.deleteOne();
    delta = -value;
  } else {
    existing.value = value;
    await existing.save();
    delta = value * 2;
  }

  target.voteScore += delta;
  await target.save();
  return target;
}

export async function voteQuestion(req, res, next) {
  try {
    const actor = getActor(req);
    const question = await castVote({
      tenantId: req.tenantId,
      actor,
      targetType: "QUESTION",
      targetId: req.params.id,
      value: req.body.value,
      Model: Question,
    });
    if (!question) return sendError(res, "QUESTION_NOT_FOUND", 404);

    return res.status(200).send(prepareResponseMsg({ voteScore: question.voteScore }, true, "Vote recorded", 200));
  } catch (err) {
    return next(err);
  }
}

export async function voteAnswer(req, res, next) {
  try {
    const actor = getActor(req);
    const answer = await castVote({
      tenantId: req.tenantId,
      actor,
      targetType: "ANSWER",
      targetId: req.params.id,
      value: req.body.value,
      Model: Answer,
    });
    if (!answer) return sendError(res, "ANSWER_NOT_FOUND", 404);

    return res.status(200).send(prepareResponseMsg({ voteScore: answer.voteScore }, true, "Vote recorded", 200));
  } catch (err) {
    return next(err);
  }
}

export async function moderateQuestion(req, res, next) {
  try {
    const actor = getActor(req);
    const question = await Question.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!question) return sendError(res, "QUESTION_NOT_FOUND", 404);

    const { isHidden, reason } = req.body;
    question.moderation = { isHidden, reason: reason || "", by: actor.id, at: new Date() };
    await question.save();

    return res.status(200).send(prepareResponseMsg({ question: toPublicQuestion(question) }, true, "Moderation updated", 200));
  } catch (err) {
    return next(err);
  }
}

export async function moderateAnswer(req, res, next) {
  try {
    const actor = getActor(req);
    const answer = await Answer.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!answer) return sendError(res, "ANSWER_NOT_FOUND", 404);

    const { isHidden, reason } = req.body;
    answer.moderation = { isHidden, reason: reason || "", by: actor.id, at: new Date() };
    await answer.save();

    return res.status(200).send(prepareResponseMsg({ answer: toPublicAnswer(answer) }, true, "Moderation updated", 200));
  } catch (err) {
    return next(err);
  }
}
