const dotenv = require(dotenv);
const axios = require(axios);
(function run(){
  dotenv.config({ path: __dirname + /.env });
  const get=(k,d)=>process.env[k]||d;
  const base = get(WORKINPILOT_MAIL_API_URL) || get(WORKINPILOT_STALWART_API_URL) || (get(STALWART_URL)? get(STALWART_URL).replace(/\/$/,)+/api : https://mailqa.workinpilot.cloud/api);
  const token = get(WORKINPILOT_MAIL_API_TOKEN) || get(STALWART_API_KEY_AUTH_BEARER_TOKEN);
  if(!token){ console.log(JSON.stringify({ error:MISSING_TOKEN },null,2)); process.exit(3); }
  const auth={ Authorization: `Bearer ${token}` };
  const http=axios.create({ baseURL: base, validateStatus:()=>true });
  const intDom = get(WORKINPILOT_INTERNAL_EMAIL_DOMAIN,workinpilot.space);
  const name = `wip-proof-${Date.now()}`;
  const email = `${name}@${intDom}`;
  (async()=>{
    try{
      let out=[]; let r;
      r = await http.get(/principal, { headers: auth }); out.push({ step:LIST, status:r.status });
      r = await http.post(/principal, { type:individual, name, email }, { headers: { ...auth, Content-Type:application/json }}); out.push({ step:CREATE, status:r.status });
      r = await http.get(`/principal/${encodeURIComponent(name)}`, { headers: auth }); out.push({ step:FETCH, status:r.status });
      r = await http.delete(`/principal/${encodeURIComponent(name)}`, { headers: auth }); out.push({ step:DELETE, status:r.status });
      r = await http.get(`/principal/${encodeURIComponent(name)}`, { headers: auth }); out.push({ step:CONFIRM, status:r.status });
      process.env.WORKINPILOT_MAIL_PROVIDER=stalwart;
      process.env.WORKINPILOT_MAIL_API_URL=base;
      process.env.WORKINPILOT_MAIL_API_TOKEN=token;
      const svc=require(./services/email/mail-service-abstraction);
      const delRes=await svc.deleteMailbox(email);
      out.push({ step:DELETE_ABSTRACTION, result: delRes });
      console.log(JSON.stringify({ base, email, out }, null, 2));
      process.exit(0);
    }catch(e){ console.log(JSON.stringify({ error:e.message },null,2)); process.exit(1); }
  })();
})();
