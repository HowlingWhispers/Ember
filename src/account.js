// Temporary Ember account area. Never persist API credentials in browser storage.
const $ = selector => document.querySelector(selector);
const apiBase="/ember/api/guest";
async function request(path,{method="GET",body}={}) {
  const response=await fetch(apiBase+path,{
    method,credentials:"same-origin",cache:"no-store",
    ...(body?{headers:{"Content-Type":"application/json","X-Ember-Request":"guest-settings"},
      body:JSON.stringify(body)}:{})
  });
  let result={};
  try{result=await response.json();}catch{}
  if(!response.ok)throw new Error(result.error||"Ember account request failed.");
  return result;
}
const message=text=>{$("#accountMessage").textContent=text;};
async function refresh() {
  const account=await request("/session");
  $("#profileId").textContent=account.userId;
  const status=await request("/provider");
  $("#providerStatus").textContent=status.configured?"● NovelAI configured for this guest profile.":"○ NovelAI not configured yet.";
  $("#model").value=status.model||"xialong-v1";
  $("#removeButton").disabled=!status.configured;
}
$("#credentialForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const button=$("#saveButton");
  button.disabled=true;message("Saving encrypted provider settings…");
  try{
    await request("/provider",{method:"PUT",body:{model:$("#model").value,apiKey:$("#apiKey").value}});
    $("#apiKey").value="";
    await refresh();message("NovelAI settings saved securely. You can now generate directly in Ember.");
  }catch(error){message(error.message);}
  finally{button.disabled=false;}
});
$("#removeButton").addEventListener("click",async()=>{
  if(!confirm("Remove your saved NovelAI key from this guest profile? Your local cards and stories will be preserved."))return;
  const button=$("#removeButton");button.disabled=true;
  try{await request("/provider",{method:"DELETE",body:{confirm:true}});
    $("#apiKey").value="";await refresh();message("Provider key removed.");}
  catch(error){message(error.message);}
  finally{button.disabled=false;}
});
refresh().catch(error=>{message(error.message+" Try reopening Ember from its main page.");$("#providerStatus").textContent="Unavailable";});
