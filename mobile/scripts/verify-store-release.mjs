import {releaseIssues,liveReleaseChecks,loadAppConfig} from "./release-policy.mjs";

const app=await loadAppConfig();
const issues=releaseIssues(app,process.env);
if(issues.length){
  console.error("STORE RELEASE BLOCKED: "+issues.length+" unverified condition(s).");
  for(const message of issues)console.error("- "+message);
  process.exitCode=1;
}else{
  const live=await liveReleaseChecks(process.env);
  for(const result of live)console.log((result.passed?"PASS":"FAIL")+" "+result.name+(result.reason?": "+result.reason:""));
  if(live.some(x=>!x.passed)){console.error("STORE RELEASE BLOCKED: live infrastructure checks failed.");process.exitCode=1;}
  else console.log("Pre-submission gates passed; store approval still depends on Apple and Google review.");
}
