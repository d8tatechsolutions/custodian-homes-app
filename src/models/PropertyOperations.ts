import mongoose, { type InferSchemaType, model, Schema } from "mongoose";

/**
 * Per-property maintenance settings, kept apart from the large shared
 * `Property` schema: the cost-approval threshold and the property's named
 * common areas (gate, lift, borehole…).
 */
const propertyOperationsSchema = new Schema(
  {
    propertyId: { type: String, required: true, trim: true },
    ownerId: { type: String, required: true, trim: true },
    /**
     * Quotes ABOVE this amount (KES) need approval before work starts.
     * null = no threshold set, so every quote needs approval.
     */
    approvalThreshold: { type: Number, min: 0, default: null },
    commonAreas: {
      type: [
        new Schema(
          {
            name: { type: String, required: true, trim: true, maxlength: 80 },
            isActive: { type: Boolean, default: true },
          },
          { _id: true },
        ),
      ],
      default: [],
    },
    updatedBy: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

propertyOperationsSchema.index({ propertyId: 1 }, { unique: true });

export type PropertyOperationsDocument = InferSchemaType<typeof propertyOperationsSchema>;

export const PropertyOperations =
  mongoose.models.PropertyOperations ||
  model<PropertyOperationsDocument>("PropertyOperations", propertyOperationsSchema);
