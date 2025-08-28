import mongoose from "mongoose";
const tenantSchema = new mongoose.Schema(
    {
        tenant_name: {
            type: String,
            required: true,
            unique: true,
        },
        domain:{
            type: String,
            required: true,
            unique: true,
        },
        sub_domain:{
            type: String,
            required: true,
            unique: true,
        },
        email:{
            type: String,
            required: true,
            unique: true,
        },
        status:{
            type: Boolean,
            default: true,
        }, 
        logo:{
            type:Object,
            default:{
                status:false,
                mime_type: "",
                image_name: "no-data",
                image_blob: "",
            }
        },
        user_count:{
            type: Number,
            default:0,
        },
        created_by: {
        type: String,
        default: "system", // or "admin"
        },
        updated_by: {
        type: String,
        default: "system",
        }


    },
    {
        timestamps:{createdAt:"created_on", updatedAt:"updated_on"},
        collection: "Tenant"
    }
);
const Tenant = mongoose.model("Tenant", tenantSchema);
export default Tenant;