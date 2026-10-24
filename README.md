![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

# PillSense

PillSense is a CalHacks hardware + AI medication-support prototype built with Next.js, Convex, Clerk, an Arduino Uno R4 WiFi, Anthropic Claude, Fetch.ai uAgents, Agentverse, and the ASI:One Agent Chat Protocol.

The hackathon workflow investigates one caregiver-preauthorized synthetic missed-dose case. It is not medical advice and cannot dispense, change medication instructions, infer ingestion, or expose private patient information.

## Fetch.ai submission identity

- Agent: **PillSense Care Coordinator**
- Handle: `@pillsense-care-coordinator`
- Agent address: `agent1qd5523n6umvc5y6pc96l8yv4k6thwtzvhk2dwpa62rlw5g5lfvpq7thj3xc`
- Agentverse profile URL: **SUBMISSION PLACEHOLDER — ADD PUBLIC PROFILE URL**
- ASI:One conversation link: **SUBMISSION PLACEHOLDER — ADD SHARE LINK OR VIDEO EVIDENCE**
- Public GitHub repository: **SUBMISSION PLACEHOLDER — ADD PUBLIC REPOSITORY URL**
- Demo video: **SUBMISSION PLACEHOLDER — ADD PUBLIC 3–5 MINUTE VIDEO URL**
- Devpost: **SUBMISSION PLACEHOLDER — ADD DEVPOST PROJECT URL**

The Agentverse registration and live ASI:One workflow have been verified. The remaining placeholders are mandatory submission artifacts and must be replaced with public links before submission.

## ASI:One primary workflow

In the registered agent’s ASI:One conversation, send:

```text
Run the PillSense synthetic demo adherence investigation.
```

PillSense acknowledges the ACP message, resolves only the server-configured opaque alias, creates or reuses the existing Convex coordinator run, executes bounded evidence tools through the Python worker, and returns a non-sensitive result inside ASI:One. No custom frontend is required after the caregiver has performed the one-time synthetic-case preauthorization.

### Verified live test

The end-to-end `ASI:One -> Agentverse -> Convex -> live Claude` workflow was manually verified with the registered address above:

1. A caregiver preauthorized one synthetic demo case in PillSense.
2. The exact prompt above was sent in ASI:One without a case ID, patient ID, or private alias.
3. Agentverse delivered the ACP request and PillSense acknowledged it.
4. The existing coordinator completed five successful case-scoped evidence tool calls using live Claude.
5. ASI:One returned a non-sensitive result with uncertainty and a safe caregiver follow-up.
6. PillSense **Agent Activity** showed the matching investigation as completed.

The test used synthetic data. No real dispense command, medication change, or hardware action was issued.

The agent publishes the official `AgentChatProtocol` 0.3.0 manifest as well as the optional typed two-uAgent protocol. Full security and protocol details are in [docs/AGENTVERSE.md](docs/AGENTVERSE.md).

## Local setup

### Web application

```powershell
npm install
npx convex dev
npm run dev
```

Use the existing ignored `.env.local` and existing Convex deployment. Clerk/Convex setup is documented in [docs/SETUP.md](docs/SETUP.md).

### Medication care coordinator

```powershell
py -3.11 -m venv agent\.venv
agent\.venv\Scripts\python.exe -m pip install -r agent\requirements.txt
agent\.venv\Scripts\python.exe -m agent.coordinator
```

Configuration and the live Claude/fallback boundary are documented in [docs/AGENT_COORDINATOR.md](docs/AGENT_COORDINATOR.md).

### Fetch.ai / Agentverse / ASI:One agent

```powershell
py -3.11 -m venv fetch_agents\.venv
fetch_agents\.venv\Scripts\python.exe -m pip install -r fetch_agents\requirements.txt
Copy-Item .env.fetch.example .env.fetch
fetch_agents\.venv\Scripts\python.exe -m fetch_agents.addresses
fetch_agents\.venv\Scripts\python.exe -m fetch_agents.pillsense_agent
```

Do not overwrite an existing environment file. Seed phrases, service secrets, Anthropic keys, aliases, and other credentials remain in ignored server-only files. Follow [docs/AGENTVERSE.md](docs/AGENTVERSE.md) to preauthorize the synthetic case, connect the Agentverse mailbox, publish the profile, verify ASI:One, and collect submission links.

## Validation

```powershell
agent\.venv\Scripts\python.exe -m pytest agent\tests -q
fetch_agents\.venv\Scripts\python.exe -m pytest fetch_agents\tests -q
npm run typecheck
npm run lint
npm test
npm run build
```

Automated tests continue to mock external delivery and model responses. The separate live test described above verified registration, ASI:One routing, five live case-scoped Claude tool calls, the safe response, and the completed Agent Activity record. Public submission links and submission confirmation remain pending.
