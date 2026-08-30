import { CallData, cairo, hash, num } from "starknet";

/**
 * THE CALLS A FOUNDER'S WALLET MAKES TO STAND UP A CAMPAIGN VAULT.
 *
 * Deliberately free of `server-only` and of any credential: every one of these runs in the
 * founder's browser and is signed by the founder's own wallet. That is the whole arrangement —
 * Sage never deploys the vault, so Sage is never its owner, so Sage can never take the money back.
 *
 * ONE SIGNATURE FOR THE WHOLE THING. Starknet accounts execute a list of calls in one transaction,
 * and UDC addresses are derivable before deployment, so the vault can be deployed, approved,
 * funded and loaded with every mission's terms in a single confirmation. The EVM path needs four.
 * More than convenience: a partly-finished vault is a real hazard — funded but with no missions
 * pays nobody, missions but unfunded accepts work it cannot honour. Here there is no partial state
 * to be stranded in. Either the founder's campaign exists in full or nothing happened at all.
 */

/** The Universal Deployer, at the same address on every Starknet network. */
export const UDC_ADDRESS = "0x041a78e741e5af2fec34b695679bc6891742439f7afb8484ecd7766661ad02bf";

export interface StarknetCall {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
}

/**
 * The SAME call, in the shape a browser WALLET accepts.
 *
 * Two conventions exist for one idea and they are not interchangeable. starknet.js takes
 * `{ contractAddress, entrypoint }`, which is what every call above is built in because the
 * operator's own settlement path executes them through an `Account`. The wallet RPC
 * (`wallet_addInvokeTransaction`) takes `{ contract_address, entry_point }`, and rejects the other
 * one outright — Ready answered a camelCase payload with `INVALID_REQUEST_PAYLOAD`, at the moment
 * a founder pressed "Fund $1.00 and go live".
 *
 * Converted at the boundary rather than by changing the builders, because both consumers are real:
 * the server executes these calls itself for settlement, the browser hands them to a wallet.
 */
export interface WalletCall {
  contract_address: string;
  entry_point: string;
  calldata: string[];
}

export const toWalletCalls = (calls: readonly StarknetCall[]): WalletCall[] =>
  calls.map((c) => ({
    contract_address: c.contractAddress,
    entry_point: c.entrypoint,
    calldata: c.calldata,
  }));

/** The vault's constructor arguments, in the order `vault.cairo` declares them. */
export function vaultConstructorCalldata(args: {
  owner: string;
  operator: string;
  token: string;
  budgetCeilingBase: bigint;
  dailyCapBase: bigint;
}): string[] {
  return CallData.compile({
    owner: args.owner,
    operator: args.operator,
    token: args.token,
    budget_ceiling: args.budgetCeilingBase.toString(),
    daily_cap: args.dailyCapBase.toString(),
  });
}

/**
 * Where the vault WILL live, computed before it exists.
 *
 * This has to be exact. The founder approves and funds this address in the same transaction that
 * creates it, so an address that is merely plausible sends real USDC somewhere no contract will
 * ever be deployed, with no owner to refund it. Verified against Starknet mainnet by simulating a
 * real UDC deployment and confirming the chain's own trace computes the same address.
 *
 * `unique` is set, which mixes the caller into the salt. Two founders therefore cannot collide on
 * a shared salt, and no one else can occupy the address a founder is about to deploy to.
 */
export function predictVaultAddress(args: {
  classHash: string;
  deployer: string;
  salt: string;
  constructorCalldata: string[];
}): string {
  const namespaced = hash.computePedersenHash(args.deployer, args.salt);
  return num.toHex(
    hash.calculateContractAddressFromHash(
      namespaced,
      args.classHash,
      args.constructorCalldata,
      UDC_ADDRESS,
    ),
  );
}

/** The UDC call that creates the vault. */
export function deployVaultCall(args: {
  classHash: string;
  salt: string;
  constructorCalldata: string[];
}): StarknetCall {
  return {
    contractAddress: UDC_ADDRESS,
    entrypoint: "deployContract",
    calldata: CallData.compile({
      classHash: args.classHash,
      salt: args.salt,
      unique: 1,
      calldata: args.constructorCalldata,
    }),
  };
}

/** Approve, then fund. The vault pulls the money rather than being sent it. */
export function fundVaultCalls(args: {
  vaultAddress: string;
  token: string;
  amountBase: bigint;
}): StarknetCall[] {
  return [
    {
      contractAddress: args.token,
      entrypoint: "approve",
      calldata: CallData.compile({
        spender: args.vaultAddress,
        amount: cairo.uint256(args.amountBase),
      }),
    },
    {
      contractAddress: args.vaultAddress,
      entrypoint: "fund",
      calldata: CallData.compile({ amount: args.amountBase.toString() }),
    },
  ];
}

/** Writes one mission's terms into the vault. After this, the vault knows what the work pays. */
export function addMissionCall(args: {
  vaultAddress: string;
  missionId: string;
  rewardBase: bigint;
  maxCompletions: number;
}): StarknetCall {
  return {
    contractAddress: args.vaultAddress,
    entrypoint: "add_mission",
    calldata: CallData.compile({
      mission_id: args.missionId,
      reward: args.rewardBase.toString(),
      max_completions: args.maxCompletions.toString(),
    }),
  };
}

export interface PlannedMission {
  /** The felt the vault stores this mission under — must match what Sage sends at settlement. */
  missionId: string;
  rewardBase: bigint;
  maxCompletions: number;
}

export interface VaultDeployment {
  vaultAddress: string;
  salt: string;
  constructorCalldata: string[];
  calls: StarknetCall[];
  /** What the founder is actually committing, for the confirmation screen. */
  fundingBase: bigint;
  budgetCeilingBase: bigint;
  dailyCapBase: bigint;
}

/**
 * The entire campaign, as one signature.
 *
 * The order matters and is not arbitrary: the vault must exist before it can be approved to pull
 * funds, must hold funds before its missions mean anything, and its missions must be written
 * before Sage attaches the campaign — otherwise Sage would accept a submission for a mission the
 * vault has never heard of and refuse the payout with `NO_SUCH_MISSION`, after the work was done.
 */
export function planVaultDeployment(args: {
  classHash: string;
  owner: string;
  operator: string;
  token: string;
  salt: string;
  budgetCeilingBase: bigint;
  dailyCapBase: bigint;
  fundingBase: bigint;
  missions: PlannedMission[];
}): VaultDeployment {
  if (!args.missions.length) {
    throw new Error("a vault with no missions could never pay anyone");
  }
  // The ceiling is what the contract enforces; funding it below that is allowed (a founder may
  // top up later) but funding ABOVE the ceiling strands money the vault will never release.
  if (args.fundingBase > args.budgetCeilingBase) {
    throw new Error("funding above the budget ceiling would strand money the vault cannot pay out");
  }
  const constructorCalldata = vaultConstructorCalldata({
    owner: args.owner,
    operator: args.operator,
    token: args.token,
    budgetCeilingBase: args.budgetCeilingBase,
    dailyCapBase: args.dailyCapBase,
  });
  const vaultAddress = predictVaultAddress({
    classHash: args.classHash,
    deployer: args.owner,
    salt: args.salt,
    constructorCalldata,
  });

  const calls: StarknetCall[] = [
    deployVaultCall({ classHash: args.classHash, salt: args.salt, constructorCalldata }),
    ...fundVaultCalls({ vaultAddress, token: args.token, amountBase: args.fundingBase }),
    ...args.missions.map((m) =>
      addMissionCall({
        vaultAddress,
        missionId: m.missionId,
        rewardBase: m.rewardBase,
        maxCompletions: m.maxCompletions,
      }),
    ),
  ];

  return {
    vaultAddress,
    salt: args.salt,
    constructorCalldata,
    calls,
    fundingBase: args.fundingBase,
    budgetCeilingBase: args.budgetCeilingBase,
    dailyCapBase: args.dailyCapBase,
  };
}

/**
 * A salt derived from the campaign, not from randomness.
 *
 * So that coming back to a half-finished launch lands on the SAME address. If the wallet
 * confirmation succeeded but the browser closed before Sage was told, a random salt would send
 * the founder to a fresh empty vault and leave the funded one orphaned; a derived salt recomputes
 * the funded address and the flow simply resumes.
 */
export function saltForJob(jobId: string): string {
  // Truncated to 248 bits so the value is always a valid felt, whatever the input.
  const digest = BigInt(hash.starknetKeccak(`sage:vault:${jobId}`).toString());
  return num.toHex(digest & ((BigInt(1) << BigInt(248)) - BigInt(1)));
}
