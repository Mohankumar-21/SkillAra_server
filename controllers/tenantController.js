import Tenant from "../models/Tenant.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { getMessage } from "../core/message.js";
//cretae new tenant
const createTenant = async ( req, res) =>{
    try {
        const { tenant_name, domain, sub_domain, email, logo, status}= req.body;
        const tenantData = await Tenant.create({
            tenant_name, 
            domain, 
            sub_domain, 
            email, 
            logo, 
            status
        });
        const message = getMessage(100); 
        let resp = prepareResponseMsg(tenantData, true, message, 100);
        res.status(200).send(resp);
        return;
    }
    catch(err){
        console.log(err);
        const message = getMessage(175);
        let resp = prepareResponseMsg({}, false, message, 100);
        res.status(500).send(resp);
        return;
    }
};
export default createTenant;