import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const RPC = process.env.ARBITRUM_SEPOLIA_RPC_URL;
if (!RPC) throw new Error("ARBITRUM_SEPOLIA_RPC_URL is required");

const sourceHead = process.env.SOURCE_HEAD;
if (!/^[0-9a-f]{40}$/.test(sourceHead ?? "")) throw new Error("SOURCE_HEAD required");

const capture = JSON.parse(readFileSync(
  "fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json","utf8"
));
const p = capture.observations.preparedSwap;
const tx = p.tx;
const chainId = 421614;
const blockHex = capture.observations.pinnedBlock?.number ?? capture.observations.observedHead;
const blockTag = blockHex.startsWith("0x") ? blockHex : "0x"+BigInt(blockHex).toString(16);
const blockNumber = BigInt(blockTag).toString();
const sender = tx.from.toLowerCase();
const recipient = sender;
const tokenOut = p.route.tokenOut.toLowerCase();
const router = tx.to.toLowerCase();
const unsigned = {kind:"unsigned",payload:{from:tx.from,to:tx.to,data:tx.data,value:tx.value}};
const txFingerprint = "sha256:"+createHash("sha256").update(JSON.stringify(unsigned)).digest("hex");
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

const rpc = async (method, params) => {
  const r = await fetch(RPC,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
  const j = await r.json();
  if (j.error) throw new Error(method+" failed: "+j.error.code);
  return j.result;
};
const sha = x => "sha256:"+createHash("sha256").update(typeof x==="string"?x:JSON.stringify(x)).digest("hex");
const addrTopic = t => ("0x"+String(t).slice(-40)).toLowerCase();
const slotAddr = v => /^0x[0-9a-fA-F]{64}$/.test(v) && !/^0x0{64}$/.test(v) ? ("0x"+v.slice(-40)).toLowerCase() : null;

const block = await rpc("eth_getBlockByNumber",[blockTag,false]);
if (!block?.hash) throw new Error("block hash unavailable");
const code = await rpc("eth_getCode",[tokenOut,blockTag]);
const implRaw = await rpc("eth_getStorageAt",[tokenOut,IMPL_SLOT,blockTag]);
const beaconRaw = await rpc("eth_getStorageAt",[tokenOut,BEACON_SLOT,blockTag]);
const implementation = slotAddr(implRaw);
const beacon = slotAddr(beaconRaw);
const implCode = implementation ? await rpc("eth_getCode",[implementation,blockTag]) : null;
const beaconCode = beacon ? await rpc("eth_getCode",[beacon,blockTag]) : null;

async function replay() {
  const capturedAt = new Date().toISOString();
  const result = await rpc("debug_traceCall",[
    {from:tx.from,to:tx.to,data:tx.data,value:tx.value},
    blockTag,
    {tracer:"callTracer",tracerConfig:{withLog:true}}
  ]);
  if (!result || typeof result!=="object") throw new Error("invalid trace");
  const topSucceeded = !result.error && !result.revertReason;
  const events=[];
  let anyErroredAncestorForRelevantLog=false;
  let logCount=0;
  function walk(frame,path="0",ancestorErrored=false) {
    if (!frame || typeof frame!=="object") return;
    const errored = ancestorErrored || Boolean(frame.error) || Boolean(frame.revertReason);
    const logs = Array.isArray(frame.logs) ? frame.logs : [];
    logCount += logs.length;
    for (let i=0;i<logs.length;i++) {
      const l=logs[i], topics=Array.isArray(l?.topics)?l.topics:[];
      if (String(l?.address??"").toLowerCase()!==tokenOut || String(topics[0]??"").toLowerCase()!==TRANSFER || topics.length<3) continue;
      const from=addrTopic(topics[1]), to=addrTopic(topics[2]);
      const amount=/^0x[0-9a-fA-F]+$/.test(l.data??"")?BigInt(l.data).toString():null;
      if (errored) anyErroredAncestorForRelevantLog=true;
      events.push({path:path+".log"+i,from,to,amount,successfulAncestry:!errored});
    }
    for(let i=0;i<(frame.calls??[]).length;i++) walk(frame.calls[i],path+"."+i,errored);
  }
  walk(result);
  const valid = events.filter(e=>e.successfulAncestry && e.amount!==null);
  let incoming=0n,outgoing=0n;
  for(const e of valid){
    const a=BigInt(e.amount);
    if(e.to===recipient && e.from!==recipient) incoming+=a;
    if(e.from===recipient && e.to!==recipient) outgoing+=a;
  }
  return {
    capturedAt,
    resultFingerprint:sha(result),
    topLevelSucceeded:topSucceeded,
    totalTraceLogCount:logCount,
    relevantTokenOutTransferCount:events.length,
    relevantTransferFingerprint:sha(events),
    anyErroredAncestorForRelevantLog,
    normalized:{
      recipient,
      tokenOut,
      incomingAtomic:incoming.toString(),
      outgoingAtomic:outgoing.toString(),
      netAtomic:(incoming-outgoing).toString(),
      events
    }
  };
}

const first=await replay();
const second=await replay();
const out={
  schemaVersion:"be-107-trace-event-evidence-qualification-v1",
  classification:"SUPPLEMENTARY_EVENT_DERIVATION_CANDIDATE_NOT_VERIFIED_GATE",
  real:true,
  sourceHead,
  chainId,
  pinnedBlock:{number:blockNumber,hash:block.hash.toLowerCase()},
  identity:{sender,recipient,tokenOut,router,preparedUnsignedTransactionFingerprint:txFingerprint},
  tracer:{method:"debug_traceCall",name:"callTracer",config:{withLog:true},stateOverrideUsed:false},
  tokenCodeIdentity:{
    address:tokenOut,
    codeSha256:sha(code.toLowerCase()),
    codeBytes:(code.length-2)/2,
    eip1967Implementation:implementation,
    implementationCodeSha256:implCode?sha(implCode.toLowerCase()):null,
    eip1967Beacon:beacon,
    beaconCodeSha256:beaconCode?sha(beaconCode.toLowerCase()):null,
    proxyQualification:implementation||beacon?"PROXY_SLOT_PRESENT_REVIEW_REQUIRED":"NO_EIP1967_IMPL_OR_BEACON_SLOT_DETECTED"
  },
  quoteAmountOutAtomic:p.quoteAmountOutAtomic,
  replays:[first,second],
  replayComparison:{
    resultFingerprintStable:first.resultFingerprint===second.resultFingerprint,
    relevantTransferFingerprintStable:first.relevantTransferFingerprint===second.relevantTransferFingerprint,
    normalizedStable:JSON.stringify(first.normalized)===JSON.stringify(second.normalized)
  },
  limitations:[
    "Transfer-event evidence is not yet qualified as final balance-delta authority.",
    "Token-specific event/balance semantic qualification is not completed by this capture.",
    "This capture does not promote provider.status to SUCCESS.",
    "This capture does not claim complete simulation/receipt/outcome/assetChanges/warnings evidence.",
    "Raw provider payload, RPC URL and credentials are not persisted."
  ]
};
writeFileSync(process.argv[2],JSON.stringify(out,null,2)+"\n");
console.log(JSON.stringify({output:process.argv[2],classification:out.classification,replayComparison:out.replayComparison,netAtomic:first.normalized.netAtomic,quoteAmountOutAtomic:p.quoteAmountOutAtomic,tokenCodeIdentity:out.tokenCodeIdentity},null,2));
