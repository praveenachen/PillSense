import type { DispenserAdapter } from "./adapter";
import { toSlotId } from "./types";

export type AuthorizedMockCommand = {
  authorization: "AUTHORIZED";
  commandId: string;
  slot: number;
  expiresAt: number;
};

export type MockOutcome = "COMPLETED" | "UNKNOWN" | "FAULT" | "DISCONNECTED";
export type MockGatewayEventType =
  | "COMMAND_ACCEPTED"
  | "MOTOR_STARTED"
  | "MOTOR_COMPLETED"
  | "UNKNOWN"
  | "FAULT"
  | "DISCONNECTED";

export type MockGatewayEvent = {
  eventId: string;
  commandId: string;
  type: MockGatewayEventType;
  occurredAt: number;
};

export class MockDeviceGateway {
  constructor(private readonly adapter: DispenserAdapter) {}

  async connect() {
    const resettable = this.adapter as DispenserAdapter & { clearFault?: () => void };
    resettable.clearFault?.();
    return await this.adapter.connect();
  }

  async confirmHomeAligned() {
    return await this.adapter.confirmHomeAligned();
  }

  async execute(
    command: AuthorizedMockCommand,
    outcome: MockOutcome,
    onEvent: (event: MockGatewayEvent) => Promise<void>,
  ) {
    if (command.authorization !== "AUTHORIZED") {
      throw new Error("Mock gateway requires a server-authorized command");
    }
    if (Date.now() > command.expiresAt) {
      throw new Error("Authorized command has expired");
    }

    const emit = async (type: MockGatewayEventType) => {
      await onEvent({
        eventId: `${command.commandId}:${type}`,
        commandId: command.commandId,
        type,
        occurredAt: Date.now(),
      });
    };

    await emit("COMMAND_ACCEPTED");
    if (outcome === "FAULT") {
      await emit("FAULT");
      return "UNKNOWN" as const;
    }
    if (outcome === "DISCONNECTED") {
      await emit("DISCONNECTED");
      return "UNKNOWN" as const;
    }

    await emit("MOTOR_STARTED");
    const adapterWithSimulation = this.adapter as DispenserAdapter & {
      simulateNextOutcome?: (next: "UNKNOWN") => void;
    };
    if (outcome === "UNKNOWN") adapterWithSimulation.simulateNextOutcome?.("UNKNOWN");
    const result = await this.adapter.dispense({
      commandId: command.commandId,
      slotId: toSlotId(command.slot),
      requestedAt: new Date().toISOString(),
    });
    if (result.outcome === "COMPLETED") {
      await emit("MOTOR_COMPLETED");
      return "COMPLETED" as const;
    }
    await emit("UNKNOWN");
    return "UNKNOWN" as const;
  }
}
