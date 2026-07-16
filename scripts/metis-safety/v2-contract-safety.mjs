import { readFileSync } from "node:fs";
import { createWalletClient, createPublicClient, http, getAddress, keccak256, toHex, parseEventLogs, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const RPC="https://sepolia.metisdevops.link";
const chain=defineChain({id:59902,name:"Metis Sepolia",nativeCurrency:{name:"Metis",symbol:"METIS",decimals:18},rpcUrls:{default:{http:[RPC]}}});
const pub=createPublicClient({chain,transport:http(RPC,{timeout:60000,retryCount:1})});
if(await pub.getChainId()!==59902){console.log("ABORT chain");process.exit(1);}
const kf=(f,n)=>{const m=new RegExp(`^\\s*${n}\\s*=\\s*(.+?)\\s*$`,"m").exec(readFileSync(f,"utf8"));let k=m[1].trim();return k.startsWith("0x")?k:"0x"+k;};
// OPERATOR from the ISOLATED staging file (never printed)
const op=privateKeyToAccount(kf(".env.staging.metissafety","OPERATOR_PRIVATE_KEY"));
if(getAddress(op.address)!==getAddress("0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35")){console.log("ABORT operator");process.exit(1);}
const wallet=createWalletClient({account:op,chain,transport:http(RPC,{timeout:60000,retryCount:1})});
const V="0x839e4C084FeCA37bdCd6ccaA0fD480c8d3fEBF1E", T="0xF176f521290A937d81cc5878dfc19908f4D681A1";
const abi=JSON.parse(readFileSync("contracts/out/CampaignVault.sol/CampaignVault.json","utf8")).abi;
const usdc=JSON.parse(readFileSync("contracts/out/MockUSDC.sol/MockUSDC.json","utf8")).abi;
const M1="0xd9e7c7c7f10682b913168a5c6d7592aab59eaa92e1ae236b2b1fc11b39abfc23";
const M2="0xdef1bd37a411703d3e7c47d794f40b3e8773acdddbea1d3daee78bfb7e4c90f0";
const M3="0x71342bea533523546c8ee74d7522e5e6d05a920b20a5fe9b242b14aaf9f00466";
const PRIMARY=getAddress("0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3");
const SECONDARY=getAddress("0x1B409e4E7a20Ad89bcb5dad7a88d413a59F19F11");
const gp=(await pub.getGasPrice())*12n/10n;
const bal=a=>pub.readContract({address:getAddress(T),abi:usdc,functionName:"balanceOf",args:[getAddress(a)]});
const spent=async()=>(await pub.readContract({address:getAddress(V),abi,functionName:"getSpendStats"}))[0];
const rd=(fn,a=[])=>pub.readContract({address:getAddress(V),abi,functionName:fn,args:a});

async function pay(label, mission, recipient, decSalt, intentSalt){
  const dd=keccak256(toHex(decSalt)), ih=keccak256(toHex(intentSalt));
  const h=await wallet.writeContract({address:getAddress(V),abi,functionName:"requestPayout",args:[mission,recipient,dd,ih],gasPrice:gp});
  const r=await pub.waitForTransactionReceipt({hash:h});
  const evs=parseEventLogs({abi,logs:r.logs,eventName:["PayoutSettled","PayoutRejected"]});
  const e=evs[0];
  const settled=e?.eventName==="PayoutSettled";
  console.log(`${label} tx=${h} status=${r.status} event=${e?.eventName} amount=${e?.args?.amount??"-"} check=${settled?"-":e?.args?.failedCheckIndex} intent=${ih.slice(0,10)}`);
  return {h, settled, check: settled?null:Number(e?.args?.failedCheckIndex), intent: ih};
}

console.log("=== CONTRACT-LEVEL SAFETY DEMONSTRATION (operator-signed, testnet, direct requestPayout) ===");
console.log("PRE primary="+await bal(PRIMARY)+" secondary="+await bal(SECONDARY)+" spent="+await spent());
const a=await pay("T7_M1_PAY(primary,unknown,no-allowlist)", M1, PRIMARY, "dec-m1", "intent-m1");
console.log("   primary_bal="+await bal(PRIMARY)+" spent="+await spent()+" M1_completed(primary)="+await rd("hasRecipientCompleted",[M1,PRIMARY]));
const b=await pay("T9_M1_DUP(primary,fresh-intent)", M1, PRIMARY, "dec-m1-dup", "intent-m1-dup");
const c=await pay("T10_M1_FULL(secondary)", M1, SECONDARY, "dec-m1-sec", "intent-m1-sec");
const d=await pay("T8_M2_PAY(primary,diff-mission)", M2, PRIMARY, "dec-m2", "intent-m2");
console.log("   primary_bal="+await bal(PRIMARY)+" spent="+await spent()+" M2_completed(primary)="+await rd("hasRecipientCompleted",[M2,PRIMARY]));
const e2=await pay("T11_M3_VELOCITY(secondary)", M3, SECONDARY, "dec-m3", "intent-m3");
// replay: reuse the exact M1 successful intent
const f=await pay("T12_M1_REPLAY(primary,SAME-intent-as-T7)", M1, PRIMARY, "dec-m1", "intent-m1");
console.log("POST primary="+await bal(PRIMARY)+" secondary="+await bal(SECONDARY)+" spent="+await spent());
console.log("REPLAY_intent_isUsed="+await rd("isIntentUsed",[a.intent]));
console.log("M3_remaining="+await rd("getMissionRemaining",[M3])+" vault_bal="+await bal(V));
console.log("VERDICT M1paid500k="+(a.settled&&a.check===null)+" dupRej6="+(!b.settled&&b.check===6)+" fullRej7="+(!c.settled&&c.check===7)+" M2paid250k="+(d.settled)+" velRej10="+(!e2.settled&&e2.check===10)+" replayCheck="+f.check);
