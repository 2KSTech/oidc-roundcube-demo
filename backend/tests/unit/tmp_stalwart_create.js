const dotenv=require("dotenv");
const axios=require("axios");
(async()=>{try{
  dotenv.config({ path: __dirname + "/.env" });
  const get=(k,d)=>process.env[k]||d;
  const base = get("WORKINPILOT_MAIL_API_URL") || get("WORKINPILOT_STALWART_API_URL") || (get("STALWART_URL")? get("STALWART_URL").replace(/\/$/,"")+"/api" : "https://mailqa.workinpilot.cloud/api");
  const token = get("WORKINPILOT_MAIL_API_TOKEN") || get("STALWART_API_KEY_AUTH_BEARER_TOKEN");
  const intDom = get("WORKINPILOT_INTERNAL_EMAIL_DOMAIN","mailqa.workinpilot.cloud");
  if(!token){ console.log(JSON.stringify({ error:"MISSING_TOKEN" },null,2)); process.exit(3); }
  const http=axios.create({ baseURL: base, validateStatus:()=>true, headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" } });
  const name = `wip-proof-${Date.now()}`;
  const email = `${name}@${intDom}`;
  const createRes = await http.post("/principal", { type:"individual", name, emails:[email] });
  const fetchRes = await http.get(`/principal/${encodeURIComponent(name)}`);
  console.log(JSON.stringify({ base, name, email, create:{status:createRes.status, data:createRes.data}, fetch:{status:fetchRes.status, data:fetchRes.data} }, null, 2));
  process.exit(0);
}catch(e){ console.log(JSON.stringify({ error:e.message },null,2)); process.exit(1);} })();
