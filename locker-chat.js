'use strict';
const knowledge = require('./locker-support.js');

function registerLockerChat(app, options = {}) {
  const key = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
  const model = options.model ?? process.env.OPENAI_CHAT_MODEL ?? 'gpt-4.1-mini';
  const now = options.now ?? Date.now;
  const timeoutMs = Math.min(2800, Math.max(20, Number(options.timeoutMs ?? 2700)));
  const maxDaily = Math.max(1, Number(options.maxDaily ?? process.env.LOCKER_AI_MAX_DAILY ?? 100) || 100);
  const calls = new Map();
  const cache = new Map();
  let daily = {day:'', count:0};
  const fallback = reason => ({ok:true, source:'handoff', needs_support:true, reason, reply:'Câu hỏi này cần bộ phận chăm sóc khách hàng kiểm tra. Bạn có thể tạo yêu cầu hỗ trợ trong cửa sổ chat.'});
  const send = (res, data) => res.json(data);
  const cleanup = stamp => {
    for (const [ip, item] of calls) if (stamp-item.start>=600000) calls.delete(ip);
    for (const [id, item] of cache) if (stamp-item.at>=300000) cache.delete(id);
  };
  function takeQuota(ip) {
    const stamp=now(); cleanup(stamp);
    if(calls.size>5000)return false;
    const record=calls.get(ip)||{start:stamp, count:0};
    if(record.count>=12)return false;
    const day=new Date(stamp).toISOString().slice(0,10);
    if(daily.day!==day)daily={day,count:0};
    if(daily.count>=maxDaily)return false;
    record.count++;calls.set(ip,record);daily.count++;return true;
  }
  app.get('/api/locker-chat/config', (_req, res) => send(res, {ok:true, ai_enabled:Boolean(key), provider:key?'openai':null, reply_target_ms:4000, knowledge_version:knowledge.version}));
  app.post('/api/locker-chat', async (req, res) => {
    if(req.get('origin')!==options.publicOrigin)return res.status(403).json({ok:false,error:'Nguồn yêu cầu không hợp lệ.'});
    if(typeof req.body?.message!=='string'||!req.body.message.trim()||req.body.message.length>500)return res.status(400).json({ok:false,error:'Câu hỏi cần có 1–500 ký tự.'});
    const message=req.body.message.trim();
    if(knowledge.unsafe(message))return send(res,{ok:true,source:'scope',needs_support:false,reply:'Đừng gửi mật khẩu, PIN, số thẻ hay khóa API trong chat. Mình chỉ hỗ trợ thông tin mua đồ, ký gửi và Locker của Trạm.'});
    if(knowledge.outside(message))return send(res,{ok:true,source:'scope',needs_support:false,reply:knowledge.scopeReply});
    if(knowledge.needsHuman(message))return send(res,fallback('customer_service'));
    const direct=knowledge.answer(message);
    if(direct)return send(res,{ok:true,source:'knowledge',needs_support:false,reply:direct});
    if(!knowledge.inScope(message))return send(res,{ok:true,source:'scope',needs_support:false,reply:knowledge.scopeReply});
    if(!key)return send(res,{ok:true,source:'knowledge',needs_support:false,reason:'not_configured',reply:knowledge.clarification(message)});
    const history=Array.isArray(req.body.history)?req.body.history.slice(-6).filter(item=>item&&['user','assistant'].includes(item.role)&&typeof item.text==='string'&&!knowledge.unsafe(item.text)).map(item=>({role:item.role,content:item.text.slice(0,500)})):[];
    const cacheKey=JSON.stringify([message,history]);
    const cached=cache.get(cacheKey);
    if(cached&&now()-cached.at<300000)return send(res,{...cached.data,source:'openai-cache'});
    if(!takeQuota(req.ip||'unknown'))return send(res,fallback('rate_limit'));
    const controller=new AbortController();
    let timer;
    const request={
      model,store:false,instructions:knowledge.instructions,
      input:[...history,{role:'user',content:message}],max_output_tokens:320,temperature:0.2,
      text:{format:{type:'json_schema',name:'locker_help',strict:true,schema:{type:'object',properties:{reply:{type:'string'},needs_support:{type:'boolean'}},required:['reply','needs_support'],additionalProperties:false}}}
    };
    try {
      const task=(async()=>{
        if(options.transport)return options.transport(request,{signal:controller.signal});
        const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify(request),signal:controller.signal});
        if(!response.ok)throw new Error('upstream_unavailable');
        const data=await response.json();
        if(data.status&&data.status!=='completed')throw new Error('incomplete_response');
        const content=(data.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text).join('');
        return JSON.parse(content);
      })();
      const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('timeout'));},timeoutMs);});
      const result=await Promise.race([task,deadline]);
      if(typeof result?.reply!=='string'||typeof result.needs_support!=='boolean'||!result.reply.trim()||result.reply.length>1400||knowledge.unsafe(result.reply)||/https?:\/\//i.test(result.reply))throw new Error('invalid_response');
      const data={ok:true,source:'openai',needs_support:result.needs_support,reply:result.reply.trim()};
      if(!data.needs_support){if(cache.size>=200)cache.delete(cache.keys().next().value);cache.set(cacheKey,{at:now(),data});}
      return send(res,data);
    }catch(error){return send(res,fallback(error.message==='timeout'?'timeout':'unavailable'));}
    finally{clearTimeout(timer);controller.abort();}
  });
}
module.exports={registerLockerChat};
