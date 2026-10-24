import { AppShell } from "@/components/app-shell";
import { AgentActivityList } from "@/components/agent-activity-list";
import { AgentverseActivity } from "@/components/agentverse-activity";

export default function AgentActivityPage() {
  return (
    <AppShell eyebrow="Coordinator activity" title="Evidence-first investigations, without hidden reasoning." description="Review bounded read-only tool activity, structured findings, and proposed human follow-up. The coordinator cannot dispense medication, change instructions, or resolve care cases.">
      <AgentverseActivity />
      <AgentActivityList />
    </AppShell>
  );
}
