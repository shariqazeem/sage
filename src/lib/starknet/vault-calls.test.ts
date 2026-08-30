import { describe, expect, it } from "vitest";

import {
  UDC_ADDRESS,
  addMissionCall,
  fundVaultCalls,
  planVaultDeployment,
  predictVaultAddress,
  saltForJob,
  vaultConstructorCalldata,
  type PlannedMission,
} from "./vault-calls";

const OWNER = "0x46a1747d854e74e5082c3215841b26dcff182a6a6fd7a1f83c3e1d045996101";
const OPERATOR = "0x46a1747d854e74e5082c3215841b26dcff182a6a6fd7a1f83c3e1d045996101";
const TOKEN = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
const CLASS = "0x603be1eb5305099466675ed500c819d3880aa3cd950498a47eb938abf39d49a";

const missions = (n: number): PlannedMission[] =>
  Array.from({ length: n }, (_, i) => ({
    missionId: `0x${(i + 1).toString(16)}`,
    rewardBase: BigInt(500_000),
    maxCompletions: 2,
  }));

const plan = (over: Partial<Parameters<typeof planVaultDeployment>[0]> = {}) =>
  planVaultDeployment({
    campaignIdHash: "0xaaa",
    missionPlanDigest: "0xbbb",
    classHash: CLASS,
    owner: OWNER,
    operator: OPERATOR,
    token: TOKEN,
    salt: "0x1234beef",
    budgetCeilingBase: BigInt(1_000_000),
    dailyCapBase: BigInt(500_000),
    fundingBase: BigInt(1_000_000),
    missions: missions(1),
    ...over,
  });

describe("predictVaultAddress", () => {
  /**
   * PINNED TO A VAULT THAT EXISTS.
   *
   * The founder approves and funds this address in the same transaction that creates it: if the
   * derivation drifts, real USDC goes to a contract that will never exist, with no owner to refund
   * it. A failure here is not a stale fixture — it means the address is wrong.
   *
   * The vector is a REAL deployment on Starknet mainnet: job `khTLEhsyuCrR`, funded with $1.00 by
   * its founder, and the vault the chain actually created sits at the address below. The raw
   * constructor calldata is inlined rather than rebuilt through `vaultConstructorCalldata`, so this
   * pins the ADDRESS ARITHMETIC — which is what puts money in the right place — independently of
   * what the constructor happens to take. (An earlier pin went through the builder, so adding a
   * constructor argument broke a test about mainnet agreeing with us, which it still did.)
   */
  it("matches a vault Starknet mainnet actually deployed", () => {
    const address = predictVaultAddress({
      classHash: "0x603be1eb5305099466675ed500c819d3880aa3cd950498a47eb938abf39d49a",
      deployer: "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434",
      salt: "0xc0e61c54771f6c57096907a37d41db2fe5802e32f644851b5e6494dc163d59",
      constructorCalldata: [
        "2236761605855893452407200970732568023407384684816254123869308344891585197108",
        "1996697860304146133480038262605718533696463765404746157458848406677183095041",
        "1442471627432665843583957153937277124821302887621015682060980008275741980155",
        "1000000",
        "1000000",
      ],
    });
    expect(BigInt(address)).toBe(
      BigInt("0x6c70a9842ea760e65070b9af0029439550b87a22323de4a28817f47f8d5a19a"),
    );
  });

  it("binds the vault to its plan, so attach has something to compare", () => {
    // Without these on chain the agreement check has nothing to check, and the rail runs a weaker
    // promise than the one it advertises.
    const calldata = vaultConstructorCalldata({
      owner: OWNER,
      operator: OPERATOR,
      token: TOKEN,
      budgetCeilingBase: BigInt(1_000_000),
      dailyCapBase: BigInt(500_000),
      campaignIdHash: "0xaaa",
      missionPlanDigest: "0xbbb",
    });
    expect(calldata).toHaveLength(7);
    expect(BigInt(calldata[5])).toBe(BigInt("0xaaa"));
    expect(BigInt(calldata[6])).toBe(BigInt("0xbbb"));
  });

  it("reduces a 256-bit digest into the field, rather than overflowing it", () => {
    // A keccak digest is wider than a felt; passing one through would be rejected by the wallet.
    const calldata = vaultConstructorCalldata({
      owner: OWNER,
      operator: OPERATOR,
      token: TOKEN,
      budgetCeilingBase: BigInt(1_000_000),
      dailyCapBase: BigInt(500_000),
      campaignIdHash: `0x${"f".repeat(64)}`,
      missionPlanDigest: `0x${"e".repeat(64)}`,
    });
    const PRIME = (BigInt(1) << BigInt(251)) + BigInt(17) * (BigInt(1) << BigInt(192)) + BigInt(1);
    expect(BigInt(calldata[5])).toBeLessThan(PRIME);
    expect(BigInt(calldata[6])).toBeLessThan(PRIME);
  });

  it("gives two founders different addresses for the same salt", () => {
    const args = {
      classHash: CLASS,
      salt: "0x1",
      constructorCalldata: vaultConstructorCalldata({
        owner: OWNER,
        operator: OPERATOR,
        token: TOKEN,
        budgetCeilingBase: BigInt(1),
        campaignIdHash: "0xaaa",
      missionPlanDigest: "0xbbb",
      dailyCapBase: BigInt(1),
      }),
    };
    expect(predictVaultAddress({ ...args, deployer: OWNER })).not.toBe(
      predictVaultAddress({ ...args, deployer: "0x99" }),
    );
  });

  it("changes when any term of the vault changes", () => {
    const base = plan().vaultAddress;
    expect(
      plan({ budgetCeilingBase: BigInt(999_999), fundingBase: BigInt(999_999) }).vaultAddress,
    ).not.toBe(base);
    expect(plan({ dailyCapBase: BigInt(1) }).vaultAddress).not.toBe(base);
    expect(plan({ operator: "0x99" }).vaultAddress).not.toBe(base);
    expect(plan({ token: "0x99" }).vaultAddress).not.toBe(base);
  });
});

describe("saltForJob", () => {
  it("returns the same salt for the same job, so an interrupted launch resumes", () => {
    expect(saltForJob("job-abc")).toBe(saltForJob("job-abc"));
  });

  it("returns a different salt for a different job", () => {
    expect(saltForJob("job-abc")).not.toBe(saltForJob("job-abd"));
  });

  it("is always a valid felt", () => {
    const MAX = BigInt(1) << BigInt(252);
    for (const id of ["a", "job-1", "x".repeat(400), "🙂", ""]) {
      expect(BigInt(saltForJob(id))).toBeLessThan(MAX);
    }
  });
});

describe("planVaultDeployment", () => {
  it("orders the calls so that nothing references a contract that does not exist yet", () => {
    const d = plan({ missions: missions(3) });
    expect(d.calls).toHaveLength(6); // deploy + approve + fund + 3 missions

    expect(d.calls[0].contractAddress).toBe(UDC_ADDRESS);
    expect(d.calls[0].entrypoint).toBe("deployContract");

    // approve goes to the TOKEN; everything after it goes to the vault the first call creates.
    expect(d.calls[1]).toMatchObject({ contractAddress: TOKEN, entrypoint: "approve" });
    for (const call of d.calls.slice(2)) {
      expect(BigInt(call.contractAddress)).toBe(BigInt(d.vaultAddress));
    }
    expect(d.calls.slice(3).map((c) => c.entrypoint)).toEqual([
      "add_mission",
      "add_mission",
      "add_mission",
    ]);
  });

  it("deploys to the address it approves and funds", () => {
    // The single most dangerous mismatch in the file: approving one address and deploying to
    // another sends the founder's money to a contract that never appears.
    const d = plan();
    const approve = d.calls[1];
    expect(BigInt(approve.calldata[0])).toBe(BigInt(d.vaultAddress));
  });

  it("refuses a vault with no missions, which could never pay anyone", () => {
    expect(() => plan({ missions: [] })).toThrow(/never pay/i);
  });

  it("refuses funding above the ceiling, which would strand the difference", () => {
    expect(() => plan({ fundingBase: BigInt(2_000_000) })).toThrow(/strand/i);
  });

  it("allows funding below the ceiling, so a founder can top up later", () => {
    expect(() => plan({ fundingBase: BigInt(400_000) })).not.toThrow();
  });

  it("carries each mission's own reward and completion count", () => {
    const d = planVaultDeployment({
      classHash: CLASS,
      owner: OWNER,
      operator: OPERATOR,
      token: TOKEN,
      salt: "0x1",
      budgetCeilingBase: BigInt(3_000_000),
      campaignIdHash: "0xaaa",
      missionPlanDigest: "0xbbb",
      dailyCapBase: BigInt(1_000_000),
      fundingBase: BigInt(3_000_000),
      missions: [
        { missionId: "0xaa", rewardBase: BigInt(250_000), maxCompletions: 4 },
        { missionId: "0xbb", rewardBase: BigInt(1_000_000), maxCompletions: 2 },
      ],
    });
    const [first, second] = d.calls.slice(3);
    expect(BigInt(first.calldata[0])).toBe(BigInt("0xaa"));
    expect(BigInt(first.calldata[1])).toBe(BigInt(250_000));
    expect(BigInt(first.calldata[2])).toBe(BigInt(4));
    expect(BigInt(second.calldata[1])).toBe(BigInt(1_000_000));
  });
});

describe("the individual builders", () => {
  it("funds through approve-then-pull, never a bare transfer", () => {
    const calls = fundVaultCalls({
      vaultAddress: "0x5",
      token: TOKEN,
      amountBase: BigInt(1_000_000),
    });
    expect(calls.map((c) => c.entrypoint)).toEqual(["approve", "fund"]);
    // uint256: the amount occupies two felts, low then high.
    expect(BigInt(calls[0].calldata[1])).toBe(BigInt(1_000_000));
    expect(BigInt(calls[0].calldata[2])).toBe(BigInt(0));
  });

  it("never puts an amount in a mission call the operator will later make", () => {
    // add_mission is the ONLY place a reward is stated, and only the owner may call it.
    const call = addMissionCall({
      vaultAddress: "0x5",
      missionId: "0x7",
      rewardBase: BigInt(400_000),
      maxCompletions: 1,
    });
    expect(call.entrypoint).toBe("add_mission");
    expect(call.calldata).toHaveLength(3);
  });
});
