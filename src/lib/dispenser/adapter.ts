import type { DeviceStatus, DispenseCommand, DispenseEvent } from "./types";

/** Transport boundary shared by mocks and a future firmware transport. */
export interface DispenserAdapter {
  connect(): Promise<DeviceStatus>;
  getStatus(): Promise<DeviceStatus>;
  confirmHomeAligned(): Promise<DeviceStatus>;
  dispense(command: DispenseCommand): Promise<DispenseEvent>;
  getLastResult(): Promise<DispenseEvent | null>;
}
