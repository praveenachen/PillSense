![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

# PillSense Care Coordinator

PillSense is an ASI:One-compatible medication-adherence demonstration agent. It implements `AgentChatProtocol` 0.3.0 and invokes an existing persistent Convex/Python/Claude investigation workflow with bounded, read-only evidence tools.

## Agent identity

- Name: **PillSense Care Coordinator**
- Handle: `@pillsense-care-coordinator`
- Agent address: `agent1qd5523n6umvc5y6pc96l8yv4k6thwtzvhk2dwpa62rlw5g5lfvpq7thj3xc`
- Agentverse profile URL: **SUBMISSION PLACEHOLDER — ADD PUBLIC PROFILE URL**
- ASI:One conversation link: **SUBMISSION PLACEHOLDER — ADD SHARE LINK OR VIDEO EVIDENCE**
- Public GitHub repository: **SUBMISSION PLACEHOLDER — ADD PUBLIC REPOSITORY URL**
- Demo video: **SUBMISSION PLACEHOLDER — ADD PUBLIC 3–5 MINUTE VIDEO URL**
- Devpost: **SUBMISSION PLACEHOLDER — ADD DEVPOST PROJECT URL**
- Primary ASI:One prompt: `Run the PillSense synthetic demo adherence investigation.`

The address above is the verified registered agent address. Replace only the clearly marked submission placeholders with their final public URLs.

## What the chat workflow does

1. A caregiver preauthorizes exactly one open synthetic case in the PillSense web app.
2. The local agent stores only the opaque alias in its ignored server environment.
3. ASI:One sends a standard ACP `ChatMessage`; PillSense immediately returns `ChatAcknowledgement`.
4. The agent rejects case IDs, patient IDs, user IDs, and aliases supplied in chat.
5. Convex resolves the configured alias and creates or reuses a persisted coordinator run.
6. The existing worker executes up to five case-scoped evidence tools and uses Claude or the explicitly labeled deterministic fallback.
7. ASI:One receives a non-sensitive result containing the execution source, tool-call count, finding categories/uncertainty, and proposed human follow-up.

The agent cannot dispense, change instructions, infer ingestion, expose medication or patient details, or resolve a care case.

## Verified ASI:One test

The primary workflow was manually verified end to end through `ASI:One -> Agentverse -> Convex -> live Claude`:

1. An authenticated caregiver preauthorized one synthetic demo case.
2. The primary prompt was sent in ASI:One without any private identifier.
3. PillSense acknowledged the ACP request and started the existing Convex coordinator run.
4. Live Claude completed five successful case-scoped evidence tool calls.
5. ASI:One returned a non-sensitive result and safe caregiver follow-up.
6. The corresponding PillSense **Agent Activity** entry showed the investigation as completed.

This verification used synthetic data. It issued no real dispense command, medication mutation, inventory mutation, or hardware action.

## Run

Complete the environment and registration steps in [`docs/AGENTVERSE.md`](../docs/AGENTVERSE.md), then run:

```powershell
agent\.venv\Scripts\python.exe -m agent.coordinator
fetch_agents\.venv\Scripts\python.exe -m fetch_agents.pillsense_agent
```

To repeat the verification, open the registered Agentverse profile, select **Chat with Agent**, and use the primary prompt above. Confirm five case-scoped evidence calls in the completed coordinator audit and a safe result in the same ASI:One conversation. Never paste a case ID, patient ID, or demo alias into chat.
