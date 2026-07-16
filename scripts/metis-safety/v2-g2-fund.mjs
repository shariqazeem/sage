import { readFileSync } from "node:fs";
import { createWalletClient, createPublicClient, http, getAddress, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const RPC="https://sepolia.metisdevops.link";
const chain=defineChain({id:59902,name:"Metis Sepolia",nativeCurrency:{name:"Metis",symbol:"METIS",decimals:18},rpcUrls:{default:{http:[RPC]}}});
const pub=createPublicClient({chain,transport:http(RPC,{timeout:60000,retryCount:1})});
if(await pub.getChainId()!==59902){console.log("ABORT chain");process.exit(1);}
const kf=(f,n)=>{const m=new RegExp(`^\\s*${n}\\s*=\\s*(.+?)\\s*$`,"m").exec(readFileSync(f,"utf8"));let k=m[1].trim();return k.startsWith("0x")?k:"0x"+k;};
const owner=privateKeyToAccount(kf("contracts/.env","PRIVATE_KEY"));
if(getAddress(owner.address)!==getAddress("0xb77e6f5466cf52524e8465859277f192Be0bCfe4")){console.log("ABORT owner");process.exit(1);}
const wallet=createWalletClient({account:owner,chain,transport:http(RPC,{timeout:60000,retryCount:1})});
const VAULT="0x839e4C084FeCA37bdCd6ccaA0fD480c8d3fEBF1E", TOKEN="0xF176f521290A937d81cc5878dfc19908f4D681A1";
const usdcAbi=JSON.parse(readFileSync("contracts/out/MockUSDC.sol/MockUSDC.json","utf8")).abi;
const vaultAbi=JSON.parse(readFileSync("contracts/out/CampaignVault.sol/CampaignVault.json","utf8")).abi;
const gp=(await pub.getGasPrice())*12n/10n;
const send=async(o)=>{const h=await wallet.writeContract({...o,gasPrice:gp});const r=await pub.waitForTransactionReceipt({hash:h});return{h,r};};

const {h:h3}=await send({address:TOKEN,abi:usdcAbi,functionName:"mint",args:[owner.address,1000000n]});
console.log("TX3_MINT "+h3);
const {h:h4}=await send({address:TOKEN,abi:usdcAbi,functionName:"approve",args:[getAddress(VAULT),1000000n]});
console.log("TX4_APPROVE "+h4);
const {h:h5,r:r5}=await send({address:VAULT,abi:vaultAbi,functionName:"fund",args:[1000000n]});
console.log("TX5_FUND "+h5+" status="+r5.status);
const {h:h6,r:r6}=await send({address:VAULT,abi:vaultAbi,functionName:"activate",args:[]});
console.log("TX6_ACTIVATE "+h6+" status="+r6.status);

const rd=(fn,a=[])=>pub.readContract({address:VAULT,abi:vaultAbi,functionName:fn,args:a});
const bal=await pub.readContract({address:TOKEN,abi:usdcAbi,functionName:"balanceOf",args:[getAddress(VAULT)]});
const stats=await rd("getSpendStats");
console.log("VAULT_TOKEN_BAL "+bal);
console.log("BUDGET_CEILING "+await rd("getBudgetCeiling"));
console.log("TOTAL_SPENT "+stats[0]+" REMAINING "+stats[1]+" PAYOUTS "+stats[2]);
console.log("STATE "+await rd("getState")+" (2=Active)");
console.log("VELOCITY "+await rd("getDailyVelocityCap"));
console.log("M1_REWARD "+await rd("getMissionReward",["0xd9e7c7c7f10682b913168a5c6d7592aab59eaa92e1ae236b2b1fc11b39abfc23"]));
console.log("M2_REWARD "+await rd("getMissionReward",["0xdef1bd37a411703d3e7c47d794f40b3e8773acdddbea1d3daee78bfb7e4c90f0"]));
console.log("M3_REWARD "+await rd("getMissionReward",["0x71342bea533523546c8ee74d7522e5e6d05a920b20a5fe9b242b14aaf9f00466"]));
console.log("M1_REMAINING "+await rd("getMissionRemaining",["0xd9e7c7c7f10682b913168a5c6d7592aab59eaa92e1ae236b2b1fc11b39abfc23"]));
console.log("REPLAY_isIntentUsed_probe "+await rd("isIntentUsed",["0x0000000000000000000000000000000000000000000000000000000000000001"]));
console.log("GROUP2_DONE");
