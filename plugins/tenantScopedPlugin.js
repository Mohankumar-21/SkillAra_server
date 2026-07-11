import mongoose from "mongoose";

/**
 * Attach to any tenant-scoped Mongoose schema to enforce tenantId is required and indexed.
 *
 * @example
 * const courseSchema = new mongoose.Schema({ title: String });
 * courseSchema.plugin(tenantScopedPlugin);
 */
export function tenantScopedPlugin(schema, options = {}) {
  const fieldName = options.fieldName || "tenantId";

  if (!schema.path(fieldName)) {
    schema.add({
      [fieldName]: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Tenant",
        required: true,
        index: true,
      },
    });
  } else {
    schema.path(fieldName).required(true);
    if (!schema.path(fieldName).options.index) {
      schema.path(fieldName).index(true);
    }
  }

  schema.index({ [fieldName]: 1 });
}

export default tenantScopedPlugin;
