import MentorProfile from "../models/MentorProfile.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { getActor } from "../utils/actor.js";

function toPublicProfile(doc) {
  const p = doc.toObject ? doc.toObject() : doc;
  return {
    id: p._id,
    userId: p.userId,
    bio: p.bio,
    expertiseTags: p.expertiseTags,
    yearsExperience: p.yearsExperience,
    isActive: p.isActive,
  };
}

/** Create or edit the caller's own mentor listing. */
export async function upsertMentorProfile(req, res, next) {
  try {
    const actor = getActor(req);
    const { bio, expertiseTags, yearsExperience, isActive } = req.body;

    const profile = await MentorProfile.findOneAndUpdate(
      { userId: actor.id, tenantId: req.tenantId },
      {
        $set: {
          bio: bio ?? "",
          expertiseTags: expertiseTags ?? [],
          yearsExperience: yearsExperience ?? 0,
          isActive: isActive ?? true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res
      .status(200)
      .send(prepareResponseMsg({ profile: toPublicProfile(profile) }, true, "Mentor profile saved", 200));
  } catch (err) {
    return next(err);
  }
}

/** Directory of active mentors — used both to browse mentors and to match a ticket's topic tags. */
export async function listMentors(req, res, next) {
  try {
    const { expertise } = req.query;
    const filter = { tenantId: req.tenantId, isActive: true };
    if (expertise) filter.expertiseTags = expertise;

    const profiles = await MentorProfile.find(filter).populate("userId", "name email");
    const data = profiles.map((p) => ({ ...toPublicProfile(p), user: p.userId }));

    return res.status(200).send(prepareResponseMsg(data, true, "Mentors fetched", 200));
  } catch (err) {
    return next(err);
  }
}

export async function getMyMentorProfile(req, res, next) {
  try {
    const actor = getActor(req);
    const profile = await MentorProfile.findOne({ userId: actor.id, tenantId: req.tenantId });
    if (!profile) return sendError(res, "MENTOR_PROFILE_NOT_FOUND", 404);

    return res.status(200).send(prepareResponseMsg({ profile: toPublicProfile(profile) }, true, "Profile fetched", 200));
  } catch (err) {
    return next(err);
  }
}
