# PillSense M7: Agentverse and ASI:One

PillSense implements the CalHacks Fetch.ai primary workflow through the official `AgentChatProtocol` 0.3.0. The optional typed two-uAgent exchange remains available, but it is not the primary judging path.

Verified registered agent address: `agent1qd5523n6umvc5y6pc96l8yv4k6thwtzvhk2dwpa62rlw5g5lfvpq7thj3xc`

## Mandatory acceptance gates

Do not claim M7 complete until every item is supported by real links or a recorded real run:

- [x] Official ACP models, acknowledgement, and published `AgentChatProtocol` 0.3.0 manifest implemented.
- [x] Meaningful orchestration into the existing Convex/Python coordinator and bounded evidence tools implemented.
- [x] Complete synthetic investigation can execute without the PillSense frontend after one-time caregiver preauthorization.
- [x] Innovation Lab and hackathon badges included in the repository and agent README.
- [x] PillSense agent connected and registered on Agentverse with its persistent address.
- [x] Agentverse profile published/discoverable and directly usable through ASI:One using the official ACP workflow.
- [x] Real ASI:One conversation verified through the final non-sensitive investigation result.
- [x] Actual persistent agent address added to both README files.
- [ ] Replace the marked Agentverse profile, ASI:One evidence, public GitHub, video, and Devpost URL placeholders.
- [ ] Public GitHub repository and 3-5 minute demo video submitted to Devpost and the CalHacks ASI:One Submission Agent.

The unchecked items are submission packaging requirements, not pending live-runtime tests.

Official references: [CalHacks hackpack](https://www.fetch.ai/events/hackathons/calhacks-13-0/hackpack), [ASI:One-compatible uAgent guide](https://innovationlab.fetch.ai/resources/docs/examples/chat-protocol/asi-compatible-uagents), and [Agent Chat Protocol](https://innovationlab.fetch.ai/resources/docs/agent-communication/agent-chat-protocol).

## Primary ASI:One workflow

1. ASI:One sends a standard ACP `ChatMessage` to the registered PillSense mailbox agent.
2. PillSense immediately sends `ChatAcknowledgement` for the incoming message ID.
3. A deterministic router accepts only a request to run the PillSense synthetic demo adherence investigation. It does not use chat text as an authorization source.
4. Patient IDs, case IDs, user IDs, and `demo-...` aliases supplied in chat are explicitly rejected.
5. The agent uses only `PILLSENSE_DEMO_CASE_ALIAS` from its ignored server environment. That alias must have been created by an authenticated caregiver for one current open synthetic case.
6. The authenticated Convex service bridge revalidates the alias, caregiver relationship, synthetic patient, open status, and case version, then creates or reuses a normal `agentRuns` record.
7. The existing `agent.coordinator` worker claims the run. It retains the five-call evidence budget, case-version validation, audit logging, Claude tool use, and labeled deterministic fallback.
8. PillSense replies inside the same ASI:One conversation with the execution source, evidence-tool count, finding categories and uncertainty, and proposed human follow-up.

The final response excludes patient names, medication names, aliases, internal IDs, raw evidence, and model reasoning. The workflow cannot dispense, alter medication instructions, infer ingestion, or resolve a care case.

The recommended ASI:One prompt is:

```text
Run the PillSense synthetic demo adherence investigation.
```

## Optional typed uAgent workflow

The original M7 `CareRequest`/`CareResponse` protocol remains available for a separately allowlisted External Care Request Agent. It uses protocol version `1.0`, canonical request UUIDs, an opaque alias, `ACK / IN_PROGRESS / COMPLETED / FAILED`, replay suppression, and an exact sender-address allowlist. It is bonus multi-agent orchestration, not a dependency of the ASI:One demo.

## One-time local setup

The current official guide uses Python 3.10+, `uagents==0.25.5`, `mailbox=True`, `publish_agent_details=True`, and `Protocol(spec=chat_protocol_spec)`. PillSense pins that version and verifies `AgentChatProtocol 0.3.0` in tests.

PillSense does not call the ASI:One model API, so the server does not consume an `ASI1_API_KEY`; the existing Claude coordinator performs the investigation. A real Agentverse account and an ASI:One user account are still required for registration and conversation verification.

From the repository root in PowerShell:

```powershell
py -3.11 -m venv fetch_agents\.venv
fetch_agents\.venv\Scripts\python.exe -m pip install -r fetch_agents\requirements.txt
Copy-Item .env.fetch.example .env.fetch
```

Do not run the copy command if `.env.fetch` already exists. The real file is gitignored.

Generate the required PillSense private seed:

```powershell
py -3.11 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Store it as `PILLSENSE_AGENT_SEED` in `.env.fetch`. Generate a second unrelated `EXTERNAL_CARE_AGENT_SEED` only if demonstrating the optional two-uAgent path. Copy the existing `CONVEX_AGENT_URL` and `PILLSENSE_AGENT_SERVICE_SECRET` from `.env.agent`; never place these values in `.env.local`, source code, Agentverse profile text, or a `NEXT_PUBLIC_` variable.

Derive stable addresses without contacting Agentverse or printing either seed:

```powershell
fetch_agents\.venv\Scripts\python.exe -m fetch_agents.addresses
```

Copy the printed PillSense address into `.env.fetch`. If an external seed was configured, also copy its printed address and configure the optional A2A sender allowlist in the existing Convex deployment:

```powershell
npx convex env set PILLSENSE_AGENTVERSE_ALLOWED_SENDER "agent1...external-address"
```

ACP requests do not use that optional external-agent allowlist. They are received by the verified uAgent chat handler, authenticated to the server-only bridge, and still require the server-configured caregiver alias.

## Prepare the synthetic case

1. Keep `npx convex dev` and `npm run dev` running against the existing deployment.
2. Sign in as the demo caregiver.
3. Create the synthetic Iron Pills plan if it does not exist.
4. On `/patient`, select **Simulate Overdue escalation**.
5. On `/agent-activity`, select **Authorize demo case** for the open synthetic case.
6. Copy the displayed opaque alias into `PILLSENSE_DEMO_CASE_ALIAS` in `.env.fetch`. Never paste it into ASI:One or publish it.

This is the only custom-frontend step. The full primary investigation and result then run inside ASI:One.

## Start the real processes

Use separate terminals:

```powershell
# Terminal 1 - existing Convex deployment connection
npx convex dev

# Terminal 2 - coordinator; uses Claude when the existing Anthropic key is configured
agent\.venv\Scripts\python.exe -m agent.coordinator

# Terminal 3 - ACP + mailbox agent
fetch_agents\.venv\Scripts\python.exe -m fetch_agents.pillsense_agent
```

The Next.js process may be stopped after preauthorization; it is not part of the ASI:One conversation workflow.

## Register and publish on Agentverse

1. In Terminal 3, confirm both of these lines appear:
   - `Manifest published successfully: AgentChatProtocol`
   - the actual persistent `agent1...` address.
2. Open the Agent Inspector URL printed by the process.
3. Sign in to Agentverse.
4. Select **Connect**, choose **Mailbox**, and finish the flow.
5. Wait for `Successfully registered as mailbox agent in Agentverse`.
6. Open **Agent Profile** and confirm:
   - name: `PillSense Care Coordinator`
   - handle: `@pillsense-care-coordinator`
   - README shows the `innovationlab` and `hackathon` badges
   - `AgentChatProtocol` is listed
   - the profile is public/discoverable
7. Copy the actual agent address and Agentverse profile URL into both `README.md` and `fetch_agents/README.md`.

The Inspector mailbox uses outbound connectivity; no public tunnel is required. Do not paste seed phrases or service secrets into Agentverse.

## Verified ASI:One procedure

This procedure has been completed successfully with the registered agent address above. The observed path was `ASI:One -> Agentverse -> Convex -> live Claude`.

1. From the Agentverse profile select **Chat with Agent**, or find `@pillsense-care-coordinator` in ASI:One after the profile becomes searchable.
2. Send the exact recommended prompt.
3. Confirm the conversation first reports that the request was accepted and bounded evidence tools are running.
4. Confirm the final message reports:
   - `Synthetic demo investigation completed`
   - `live Claude coordinator` for a real Claude run, or the explicitly labeled non-LLM fallback
   - a nonzero case-scoped evidence-tool count
   - safe finding categories/uncertainty
   - a proposed human follow-up
   - explicit confirmation that no dispense or medication change occurred
5. On `/agent-activity`, confirm the matching transport record says `ASI:One · AgentChatProtocol`, includes the actual remote source address, and links to the same completed coordinator run.
6. Capture the ASI:One conversation and coordinator audit in the 3-5 minute demo video. If ASI:One offers a conversation share link, include it; otherwise use the agent profile URL plus the video as verification evidence.

The verified run returned five successful case-scoped evidence tool calls, a non-sensitive result, and a safe caregiver follow-up. PillSense **Agent Activity** showed the matching investigation as completed. The case was synthetic, and no real dispense command, medication change, inventory mutation, voice action, or hardware command was issued.

Do not treat local mocks or the optional second-agent test as substitutes when repeating this verification.

## Repeat the demo safely

Reset the reminder scenario on `/patient`, create a new overdue escalation, authorize the new open case, update only `PILLSENSE_DEMO_CASE_ALIAS` in `.env.fetch`, and restart the PillSense mailbox process. No database editing is needed. Reusing an ACP message UUID or typed request UUID is rejected.

## Submission links

The registered address is final; the public submission artifacts remain intentionally explicit placeholders:

| Artifact | Submission value |
| --- | --- |
| Agent address | `agent1qd5523n6umvc5y6pc96l8yv4k6thwtzvhk2dwpa62rlw5g5lfvpq7thj3xc` |
| Agentverse profile URL | **SUBMISSION PLACEHOLDER — ADD PUBLIC PROFILE URL** |
| ASI:One conversation link | **SUBMISSION PLACEHOLDER — ADD SHARE LINK OR VIDEO EVIDENCE** |
| Public GitHub repository | **SUBMISSION PLACEHOLDER — ADD PUBLIC REPOSITORY URL** |
| Public 3-5 minute video | **SUBMISSION PLACEHOLDER — ADD VIDEO URL** |
| Devpost project | **SUBMISSION PLACEHOLDER — ADD DEVPOST URL** |
| CalHacks ASI:One Submission Agent confirmation | **PENDING FINAL SUBMISSION** |

Before submission, replace these placeholders in this document and both README files, then submit through the [CalHacks Hackathon ASI:One Submission Agent](https://asi1.ai/festival/calhacks2026/dashboard?utm_source=calhacks2026).

## Automated versus live verification

Automated tests cover ACP version, acknowledgement, intent routing, rejection of browser-provided identifiers, missing preauthorization, safe final results, typed A2A schemas, sender allowlisting, correlation, replay suppression, bridge errors, timeouts, coordinator handoff, Claude tool-use mocks, and deterministic fallback.

Those mocks cannot prove remote delivery. A separate manual run has now verified the registered Agentverse address, real ASI:One ACP routing, Convex handoff, five live Claude evidence-tool calls, a safe caregiver follow-up, and the completed PillSense Agent Activity record. Only the public links, video, Devpost entry, and final submission confirmation remain pending.
