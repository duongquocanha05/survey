'use strict';
const knowledge = require('./locker-support.js');

function registerLockerChat(app, options = {}) {
  // This deployment accepts Gemini only. OPENAI_API_KEY is deliberately unused.
  // Confirm the selected Google project has no linked billing account before enabling.
  const key = options.geminiApiKey ?? process.env.GEMINI_API_KEY ?? '';
  const freeTierConfirmed = options.freeTierConfirmed ?? (process.env.GEMINI_FREE_TIER_CONFIRMED === 'true');
  const enabled = Boolean(key && freeTierConfirmed === true);
  const model = 'gemini-3.5-flash-lite';
  const now = options.now ?? Date.now;
  const timeoutMs = Math.min(2800, Math.max(20, Number(options.timeoutMs ?? 2700)));
  const maxDaily = Math.max(1, Number(options.maxDaily ?? process.env.LOCKER_AI_MAX_DAILY ?? 20) || 20);
  const calls = new Map();
  const cache = new Map();
  let daily = {day:'', count:0};
  const fallback = reason => ({ok:true, source:'handoff', needs_support:true, reason, reply:'Câu hỏi này cần bộ phận chăm sóc khách hàng kiểm tra. Bạn có thể tạo yêu cầu hỗ trợ trong cửa sổ chat.'});
  const aiFallback = reason => ({ok:true,source:'knowledge',needs_support:false,offer_support:true,reason,reply:reason==='rate_limit'?'AI miễn phí đang hết hạn mức hoặc có nhiều người hỏi cùng lúc. Bạn chọn câu hỏi mẫu để xem hướng dẫn ngay, hoặc bấm gửi câu này tới CSKH.':'Mình chưa lấy được câu trả lời AI lúc này. Bạn chọn câu hỏi mẫu để xem hướng dẫn ngay, hoặc bấm gửi câu này tới CSKH.'});
  const sensitive = text => /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b0(?:\d[ .-]?){9}\b/i.test(String(text));
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
  app.get('/api/locker-chat/config', (_req, res) => send(res, {ok:true,ai_enabled:enabled,provider:enabled?'gemini':null,billing_mode:'free_only',setup_required:!key?'gemini_key':!freeTierConfirmed?'free_tier_confirmation':null,reply_target_ms:4000,knowledge_version:knowledge.version}));
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
    if(!enabled)return send(res,{ok:true,source:'knowledge',needs_support:false,reason:'not_configured',reply:knowledge.clarification(message)});
    if(sensitive(message))return send(res,{ok:true,source:'scope',needs_support:false,reply:'Bạn hãy bỏ email, số điện thoại và thông tin cá nhân khỏi câu hỏi trước khi gửi AI. Mình chỉ cần câu hỏi về Trạm để hướng dẫn.'});
    const history=Array.isArray(req.body.history)?req.body.history.slice(-6).filter(item=>item&&['user','assistant'].includes(item.role)&&typeof item.text==='string'&&!knowledge.unsafe(item.text)&&!sensitive(item.text)).map(item=>({role:item.role,content:item.text.slice(0,500)})):[];
    const cacheKey=JSON.stringify([message,history]);
    const cached=cache.get(cacheKey);
    if(cached&&now()-cached.at<300000)return send(res,{...cached.data,source:'gemini-cache'});
    if(!takeQuota(req.ip||'unknown'))return send(res,aiFallback('rate_limit'));
    const controller=new AbortController();
    let timer;
    const request={
      systemInstruction:{parts:[{text:knowledge.instructions}]},
      contents:[...history,{role:'user',content:message}].map(item=>({role:item.role==='assistant'?'model':'user',parts:[{text:item.content}]})),
      generationConfig:{maxOutputTokens:512,temperature:0.2,thinkingConfig:{thinkingLevel:'MINIMAL'},responseMimeType:'application/json',responseJsonSchema:{type:'object',properties:{reply:{type:'string'},needs_support:{type:'boolean'}},required:['reply','needs_support'],additionalProperties:false}}
    };
    try {
      const task=(async()=>{
        if(options.transport)return options.transport(request,{signal:controller.signal});
        const response=await (options.fetch ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(request),signal:controller.signal});
        if(response.status===429)throw new Error('rate_limit');
        if(!response.ok)throw new Error('provider_http_'+response.status);
        const data=await response.json();
        const candidate=data.candidates?.[0];
        if(!candidate||candidate.finishReason!=='STOP')throw new Error('incomplete_response');
        const content=(candidate.content?.parts||[]).filter(part=>!part.thought&&typeof part.text==='string').map(part=>part.text).join('');
        return JSON.parse(content);
      })();
      const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('timeout'));},timeoutMs);});
      const result=await Promise.race([task,deadline]);
      if(typeof result?.reply!=='string'||typeof result.needs_support!=='boolean'||!result.reply.trim()||result.reply.length>1400||knowledge.unsafe(result.reply)||/https?:\/\//i.test(result.reply))throw new Error('invalid_response');
      const data={ok:true,source:'gemini',needs_support:result.needs_support,reply:result.reply.trim().replace(/(?:Mình|Tôi|Trạm) sẽ chuyển[^.!?]*[.!?]?/gi,'Bạn có thể bấm “Gửi yêu cầu này tới CSKH” để nhân viên kiểm tra.').replace(/(?:Mình|Tôi) đã (?:chuyển|gửi)[^.!?]*[.!?]?/gi,'Bạn có thể bấm “Gửi yêu cầu này tới CSKH” để gửi câu hỏi cho nhân viên.')};
      if(!data.needs_support){if(cache.size>=200)cache.delete(cache.keys().next().value);cache.set(cacheKey,{at:now(),data});}
      return send(res,data);
    }catch(error){return send(res,aiFallback(['timeout','rate_limit'].includes(error.message)||/^provider_http_(400|401|403|404|500|502|503)$/.test(error.message)?error.message:'unavailable'));}
    finally{clearTimeout(timer);controller.abort();}
  });
}
module.exports={registerLockerChat};
