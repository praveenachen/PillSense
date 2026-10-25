import type { ArduinoMotorResult } from "../dispenser/ble-protocol";

export type VoiceHardwareStage =
  | "PREPARING"
  | "MOVING"
  | "COMPLETED"
  | "UNKNOWN"
  | "BLOCKED";

type PreparedCommand = {
  commandId: string;
  operationId: string;
  slot: number;
  shouldDispatch: boolean;
  status: "AUTHORIZED" | "DISPATCHED" | "COMPLETED" | "UNKNOWN";
};

type PersistedEvent = "MOTOR_STARTED" | "MOTOR_COMPLETED" | "UNKNOWN" | "FAULT" | "DISCONNECTED";

export type VoiceHardwareDependencies = {
  occurrenceId: string;
  connectionId: string | null;
  isConnected(): boolean;
  ensureConnected?(): Promise<boolean>;
  prepare(args: { occurrenceId: string; connectionId: string }): Promise<PreparedCommand>;
  markDispatched(args: { commandId: string; connectionId: string }): Promise<{ shouldSend: boolean }>;
  dispatch(operationId: string): Promise<ArduinoMotorResult>;
  reconcile(operationId: string): Promise<ArduinoMotorResult>;
  record(args: { commandId: string; operationId: string; type: PersistedEvent; occurredAt: number }): Promise<unknown>;
  onStage?(stage: VoiceHardwareStage): void;
  wait?(milliseconds: number): Promise<void>;
  maxReconciliations?: number;
};

export type VoiceHardwareOutcome = {
  stage: VoiceHardwareStage;
  commandId?: string;
  operationId?: string;
  alreadyPersisted?: boolean;
};

const defaultWait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

/**
 * Performs one server-authorized Slot 6 dispatch. MOVE is called in exactly one
 * place; every later attempt is GET_LAST_RESULT reconciliation only.
 */
export async function runVoiceHardwareDemo(deps: VoiceHardwareDependencies): Promise<VoiceHardwareOutcome> {
  const { connectionId } = deps;
  if (!connectionId) {
    deps.onStage?.("BLOCKED");
    throw new Error("The armed Arduino connection identity is not available. No movement command was sent.");
  }
  if (!deps.isConnected() && !(await deps.ensureConnected?.())) {
    deps.onStage?.("BLOCKED");
    throw new Error("The armed Arduino GATT connection could not be restored. No movement command was sent.");
  }

  deps.onStage?.("PREPARING");
  const prepared = await deps.prepare({ occurrenceId: deps.occurrenceId, connectionId });
  if (!prepared.shouldDispatch) {
    const stage = prepared.status === "COMPLETED" ? "COMPLETED" : prepared.status === "UNKNOWN" ? "UNKNOWN" : "BLOCKED";
    deps.onStage?.(stage);
    return { stage, commandId: prepared.commandId, operationId: prepared.operationId, alreadyPersisted: true };
  }
  if (prepared.slot !== 6) throw new Error("The authorized command did not target the fixed Slot 6 demo.");
  if (!deps.isConnected()) {
    deps.onStage?.("BLOCKED");
    throw new Error("The Arduino disconnected before dispatch. No movement command was sent.");
  }

  const marked = await deps.markDispatched({ commandId: prepared.commandId, connectionId });
  if (!marked.shouldSend) {
    deps.onStage?.("BLOCKED");
    return { stage: "BLOCKED", commandId: prepared.commandId, operationId: prepared.operationId, alreadyPersisted: true };
  }

  deps.onStage?.("MOVING");
  const persist = (type: PersistedEvent) => deps.record({
    commandId: prepared.commandId,
    operationId: prepared.operationId,
    type,
    occurredAt: Date.now(),
  });
  const apply = async (result: ArduinoMotorResult): Promise<VoiceHardwareOutcome | null> => {
    if (result.operationId !== prepared.operationId) {
      await persist("UNKNOWN");
      deps.onStage?.("UNKNOWN");
      return { stage: "UNKNOWN", commandId: prepared.commandId, operationId: prepared.operationId };
    }
    if (result.kind === "DONE") {
      await persist("MOTOR_COMPLETED");
      deps.onStage?.("COMPLETED");
      return { stage: "COMPLETED", commandId: prepared.commandId, operationId: prepared.operationId };
    }
    if (result.kind === "UNKNOWN" || result.kind === "REJECTED") {
      await persist(result.kind === "REJECTED" ? "FAULT" : "UNKNOWN");
      deps.onStage?.("UNKNOWN");
      return { stage: "UNKNOWN", commandId: prepared.commandId, operationId: prepared.operationId };
    }
    await persist("MOTOR_STARTED");
    return null;
  };

  try {
    const immediate = await apply(await deps.dispatch(prepared.operationId));
    if (immediate) return immediate;
  } catch {
    // The MOVE outcome is ambiguous. Never resend it; continue only with the
    // firmware's read-only GET_LAST_RESULT command while the connection exists.
  }

  const wait = deps.wait ?? defaultWait;
  const attempts = deps.maxReconciliations ?? 30;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!deps.isConnected()) {
      await persist("DISCONNECTED");
      deps.onStage?.("UNKNOWN");
      return { stage: "UNKNOWN", commandId: prepared.commandId, operationId: prepared.operationId };
    }
    if (attempt > 0) await wait(1_000);
    try {
      const outcome = await apply(await deps.reconcile(prepared.operationId));
      if (outcome) return outcome;
    } catch {
      // A stale READY or late blocking motor response is not completion. Keep
      // issuing only the safe read-only reconciliation command within budget.
    }
  }

  await persist("UNKNOWN");
  deps.onStage?.("UNKNOWN");
  return { stage: "UNKNOWN", commandId: prepared.commandId, operationId: prepared.operationId };
}
