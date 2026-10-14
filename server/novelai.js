// Ember's own NovelAI provider adapter. Never import this module into browser code.
// Credentials are supplied by a future authenticated Ember-side encrypted vault.
import { boundCompletedReply } from "./reply-boundary.js";
export const NOVELAI_MODELS = Object.freeze(["xialong-v1","glm-4-6"]);
export class EmberProviderError extends Error {
  constructor(status,code,message) {
    super(message);
    this.status=status;
    this.code=code;
  }
}
const stops = ["\nPLAYER:","\nPLAYER (","\nUSER:","\n<|user|>","\nSystem:","\nAnalysis:","\nThinking:"];
function resultText(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.choices)) return "";
  const choice=value.choices[0];
  if (!choice || typeof choice !== "object") return "";
  const candidates=[choice.text,choice.parsedContent,choice.parsed_content,choice.message?.content];
  const selected=candidates.find(text=>typeof text==="string" && text.trim());
  return typeof selected==="string" ? selected.trim() : "";
}
export async function generateNovelAI({
  token,model,prompt,fetchFn=globalThis.fetch,timeoutMs=90000,
  maxTokens=384,maxWords=135,temperature=0.82,
}={}) {
  if (typeof token!=="string" || token.length < 10 || token.length > 4096)
    throw new EmberProviderError(409,"NOVELAI_NOT_CONFIGURED","Configure a NovelAI key in Ember provider settings.");
  if (!NOVELAI_MODELS.includes(model))
    throw new EmberProviderError(409,"NOVELAI_MODEL_UNSUPPORTED","Choose a supported NovelAI model.");
  if (typeof prompt!=="string" || !prompt.trim() || prompt.length>50000)
    throw new EmberProviderError(400,"EMBER_INVALID_CONTEXT","Ember's story context is missing or too long.");
  if (!Number.isInteger(maxTokens) || maxTokens<64 || maxTokens>2048 || !Number.isInteger(maxWords) || maxWords<30 || maxWords>400 || !Number.isFinite(temperature) || temperature<0 || temperature>2)
    throw new EmberProviderError(400,"EMBER_INVALID_SETTINGS","Invalid provider generation settings.");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.min(120000,Math.max(1000,timeoutMs)));
  try {
    let response;
    try {
      response=await fetchFn("https://text.novelai.net/oa/v1/completions",{
        method:"POST",
        headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
        body:JSON.stringify({
          model,prompt,max_tokens:maxTokens,temperature,top_k:250,top_p:0.95,
          frequency_penalty:0,presence_penalty:0,stop:stops,stream:false,
        }),
        signal:controller.signal,
      });
    } catch {
      throw new EmberProviderError(controller.signal.aborted?504:502,
        controller.signal.aborted?"NOVELAI_TIMEOUT":"NOVELAI_NETWORK",
        controller.signal.aborted?"NovelAI timed out. Retry the last turn.":"Could not reach NovelAI. Retry the last turn.");
    }
    if (!response?.ok) {
      if (response?.status===429) throw new EmberProviderError(429,"NOVELAI_BUSY","NovelAI is busy. Try again shortly.");
      if ([401,403].includes(response?.status)) throw new EmberProviderError(502,"NOVELAI_AUTH","NovelAI did not accept your credential. Check Ember provider settings.");
      throw new EmberProviderError(502,"NOVELAI_UPSTREAM","NovelAI could not generate a reply. Try again.");
    }
    let payload;
    try {payload=await response.json();}
    catch {throw new EmberProviderError(502,"NOVELAI_INVALID_RESPONSE","NovelAI returned an unreadable reply.");}
    const text=resultText(payload).replace(/^(?:NARRATOR|ASSISTANT)\s*:\s*/i,"").trim();
    if (!text) throw new EmberProviderError(502,"NOVELAI_EMPTY_REPLY","NovelAI returned an empty reply.");
    if (text.length>32000) throw new EmberProviderError(502,"NOVELAI_OVERSIZED_REPLY","NovelAI returned an oversized reply.");
    const bounded=boundCompletedReply(text,maxWords);
    if(!bounded.text)
      throw new EmberProviderError(502,"NOVELAI_INCOMPLETE_REPLY",
        "NovelAI stopped before completing a sentence. No partial reply was saved. Try regenerating.");
    return {text:bounded.text,model,...(bounded.shortened?{shortened:true}:{})};
  } finally {
    clearTimeout(timer);
  }
}
