import { readFileSync } from "node:fs";
import { createWalletClient, createPublicClient, http, getAddress, parseEventLogs, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "https://sepolia.metisdevops.link";
const chain = defineChain({ id: 59902, name: "Metis Sepolia", nativeCurrency:{name:"Metis",symbol:"METIS",decimals:18}, rpcUrls:{default:{http:[RPC]}} });
const pub = createPublicClient({ chain, transport: http(RPC,{timeout:60000,retryCount:1}) });
if (await pub.getChainId() !== 59902) { console.log("ABORT chain"); process.exit(1); }

function keyFrom(file, name) {
  const t = readFileSync(file,"utf8");
  const m = new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`,"m").exec(t);
  if (!m) throw new Error("key not found");
  let k = m[1].trim(); return k.startsWith("0x")?k:"0x"+k;
}
const owner = privateKeyToAccount(keyFrom("contracts/.env","PRIVATE_KEY"));
if (getAddress(owner.address) !== getAddress("0xb77e6f5466cf52524e8465859277f192Be0bCfe4")) { console.log("ABORT owner mismatch"); process.exit(1); }
const wallet = createWalletClient({ account: owner, chain, transport: http(RPC,{timeout:60000,retryCount:1}) });

const facArt = JSON.parse(readFileSync("contracts/out/CampaignVaultFactory.sol/CampaignVaultFactory.json","utf8"));
const facAbi = facArt.abi;
const facCode = facArt.bytecode.object.startsWith("0x")?facArt.bytecode.object:"0x"+facArt.bytecode.object;

const OPERATOR="0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35", GUARDIAN=owner.address, TOKEN="0xF176f521290A937d81cc5878dfc19908f4D681A1";
const CID="0x2dc4f4763d8efa216511429374ad5346b44ac9176d2fec15cba08e8b3e7aa509";
const MIDS=["0xd9e7c7c7f10682b913168a5c6d7592aab59eaa92e1ae236b2b1fc11b39abfc23","0xdef1bd37a411703d3e7c47d794f40b3e8773acdddbea1d3daee78bfb7e4c90f0","0x71342bea533523546c8ee74d7522e5e6d05a920b20a5fe9b242b14aaf9f00466"];
const REWARDS=[500000n,250000n,250000n], CAPS=[1n,1n,1n], VELOCITY=750000n, DURATION=604800n;
const gp = (await pub.getGasPrice())*12n/10n;

// TX 1 — deploy factory
const h1 = await wallet.deployContract({ abi: facAbi, bytecode: facCode, gasPrice: gp });
console.log("TX1_DEPLOY_FACTORY " + h1);
const r1 = await pub.waitForTransactionReceipt({ hash: h1 });
const factory = getAddress(r1.contractAddress);
console.log("FACTORY_ADDR " + factory + " block=" + r1.blockNumber + " status=" + r1.status);
if (factory !== getAddress("0x2249b773aFEd5594985F7D350581A1b55f279C7f")) { console.log("ABORT: factory != predicted"); process.exit(1); }

// TX 2 — create vault
const h2 = await wallet.writeContract({ address: factory, abi: facAbi, functionName:"createCampaignVault",
  args:[OPERATOR,GUARDIAN,TOKEN,CID,MIDS,REWARDS,CAPS,VELOCITY,DURATION], gasPrice: gp });
console.log("TX2_CREATE_VAULT " + h2);
const r2 = await pub.waitForTransactionReceipt({ hash: h2 });
console.log("CREATE_VAULT status=" + r2.status + " block=" + r2.blockNumber);
if (r2.status !== "success") { console.log("ABORT: createVault reverted"); process.exit(1); }
const ev = parseEventLogs({ abi: facAbi, logs: r2.logs, eventName:"CampaignVaultCreated" })[0];
const vault = getAddress(ev.args.vault);
console.log("VAULT_ADDR " + vault);
if (vault !== getAddress("0x839e4C084FeCA37bdCd6ccaA0fD480c8d3fEBF1E")) { console.log("ABORT: vault != predicted"); process.exit(1); }

// provenance + config read-back
const vaultAbi = JSON.parse(readFileSync("contracts/out/CampaignVault.sol/CampaignVault.json","utf8")).abi;
const rd = (fn,a=[]) => pub.readContract({ address: vault, abi: vaultAbi, functionName: fn, args: a });
console.log("PROVENANCE_isVault " + await pub.readContract({address:factory,abi:facAbi,functionName:"isVault",args:[vault]}));
console.log("V_OWNER " + await rd("getOwner"));
console.log("V_OPERATOR " + await rd("getOperator"));
console.log("V_GUARDIAN " + await rd("getGuardian"));
console.log("V_TOKEN " + await rd("getToken"));
console.log("V_CID " + await rd("getCampaignIdHash"));
console.log("V_PLAN " + await rd("getMissionPlanDigest"));
console.log("V_VELOCITY " + await rd("getDailyVelocityCap"));
console.log("V_STATE " + await rd("getState"));
console.log("V_MISSIONCOUNT " + await rd("getMissionCount"));
console.log("GROUP1_DONE");
