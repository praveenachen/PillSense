
#include <ArduinoBLE.h>
#include <Stepper.h>

// ========================================
// PillSense H2: BLE + MOTOR TEST
// SUPERVISED / EMPTY CAROUSEL ONLY
// ========================================

// Motor settings from the tested sketch
const int STEPS_PER_REVOLUTION = 2048;
const int STEPS_PER_SLOT = 256;
const int TOTAL_SLOTS = 8;
const int MOTOR_DIRECTION = -1;
const int MOTOR_SPEED_RPM = 8;

// Physical status indicators. These LEDs report only the firmware state;
// they do not verify carousel alignment, pill release, or ingestion.
const int RED_LED_PIN = 2;
const int YELLOW_LED_PIN = 3;
const int GREEN_LED_PIN = 4;

Stepper motor(
  STEPS_PER_REVOLUTION,
  8, 10, 9, 11
);

// Same UUIDs as the working BLE test
BLEService pillService(
  "19b10000-e8f2-537e-4f6c-d104768a1214"
);

BLEStringCharacteristic commandChar(
  "19b10001-e8f2-537e-4f6c-d104768a1214",
  BLEWrite,
  32
);

BLEStringCharacteristic statusChar(
  "19b10002-e8f2-537e-4f6c-d104768a1214",
  BLERead | BLENotify,
  40
);

// Motor position is assumed, not sensor-verified.
// Physically align Slot 0 BEFORE powering on.
int currentSlot = 0;
bool busy = false;
bool positionUncertain = false;

// Duplicate protection lasts for THIS boot only.
// Do not reuse a previous ID after reboot.
String lastCommandId = "";
String lastResult = "NONE";

void showIdleLed() {
  // Red: powered and not performing a motor operation.
  digitalWrite(RED_LED_PIN, HIGH);
  digitalWrite(YELLOW_LED_PIN, LOW);
  digitalWrite(GREEN_LED_PIN, LOW);
}

void showMotorActiveLed() {
  // Yellow: the full outbound, pause, and return sequence is in progress.
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(YELLOW_LED_PIN, HIGH);
  digitalWrite(GREEN_LED_PIN, LOW);
}

void showSequenceCompletedLed() {
  // Green: the commanded step sequence finished, including the return steps.
  // This is not sensor-verified physical alignment or dispensing evidence.
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(YELLOW_LED_PIN, LOW);
  digitalWrite(GREEN_LED_PIN, HIGH);
}

void stopMotor() {
  digitalWrite(8, LOW);
  digitalWrite(9, LOW);
  digitalWrite(10, LOW);
  digitalWrite(11, LOW);
}

void publishStatus(const String& message) {
  statusChar.writeValue(message);
  Serial.println(message);
}

void rejectCommand(const String& message) {
  // A rejected command never earns a green completion indication. If a
  // command could somehow arrive while the blocking motor sequence is active,
  // preserve yellow because the already-accepted sequence is still running.
  if (!busy) {
    showIdleLed();
  }
  publishStatus(message);
}

bool validId(const String& id) {
  if (id.length() < 1 || id.length() > 12) {
    return false;
  }

  for (unsigned int i = 0; i < id.length(); i++) {
    char c = id.charAt(i);
    if (!isalnum((unsigned char)c)) {
      return false;
    }
  }
  return true;
}

// Select the shortest direction from Slot 0.
// Return using exactly the opposite steps.
int stepsFromHome(int target) {
  int positions = target;

  if (positions > TOTAL_SLOTS / 2) {
    positions -= TOTAL_SLOTS;
  }

  return positions * STEPS_PER_SLOT
                   * MOTOR_DIRECTION;
}

void moveAndReturn(int target, String id) {
  if (busy || positionUncertain || currentSlot != 0) {
    rejectCommand("REJECT,NOT_READY");
    return;
  }

  // Same ID must not cause another movement.
  if (id == lastCommandId) {
    publishStatus(lastResult);
    return;
  }

  // This sketch allows one motor operation per
  // boot. Power cycling is NOT a safe retry.
  // Persistent command recovery comes later.
  if (lastCommandId.length() > 0) {
    rejectCommand("REJECT,TEST_LIMIT");
    return;
  }

  busy = true;
  lastCommandId = id;
  lastResult = "UNKNOWN," + id;
  showMotorActiveLed();

  int steps = stepsFromHome(target);

  Serial.print("Target Slot: ");
  Serial.println(target);
  Serial.print("Motor steps: ");
  Serial.println(steps);

  publishStatus("STARTED," + id);

  // Stepper.step() blocks until the requested
  // sequence finishes. Physical position is
  // NOT measured by this sketch.
  motor.step(steps);
  stopMotor();

  // Pause at target for visual inspection.
  delay(700);

  // Automatically return to Slot 0.
  motor.step(-steps);
  stopMotor();

  currentSlot = 0;
  busy = false;

  // Means the commanded step sequence finished;
  // NOT verified alignment or pill dispensing.
  lastResult = "DONE," + id;
  showSequenceCompletedLed();
  publishStatus(lastResult);

  Serial.println("Return sequence complete.");
  Serial.println("Visually verify Slot 0.");
}

void handleCommand(String command) {
  command.trim();
  command.toUpperCase();

  Serial.print("Received: ");
  Serial.println(command);

  if (command == "GET_STATUS") {
    if (positionUncertain) {
      publishStatus("UNKNOWN_POSITION");
    } else if (busy) {
      publishStatus("BUSY");
    } else {
      publishStatus("READY");
    }
    return;
  }

  if (command == "GET_LAST_RESULT") {
    publishStatus(lastResult);
    return;
  }

  // Exact format: MOVE,<slot>,<id>
  // Example: MOVE,6,1001
  if (command.startsWith("MOVE,")) {
    int separator = command.indexOf(',', 5);

    if (separator < 0) {
      rejectCommand("REJECT,BAD_FORMAT");
      return;
    }

    String slotText = command.substring(5, separator);
    String id = command.substring(separator + 1);

    if (slotText.length() != 1 ||
        slotText.charAt(0) < '1' ||
        slotText.charAt(0) > '7' ||
        !validId(id)) {
      rejectCommand("REJECT,BAD_ARGUMENTS");
      return;
    }

    int target = slotText.charAt(0) - '0';
    moveAndReturn(target, id);
    return;
  }

  rejectCommand("REJECT,UNKNOWN_COMMAND");
}

void setup() {
  Serial.begin(115200);

  unsigned long started = millis();
  while (!Serial && millis() - started < 3000) {}

  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(YELLOW_LED_PIN, OUTPUT);
  pinMode(GREEN_LED_PIN, OUTPUT);
  showIdleLed();

  motor.setSpeed(MOTOR_SPEED_RPM);
  stopMotor();

  Serial.println("=== PillSense BLE Motor Test ===");
  Serial.println("EMPTY CAROUSEL ONLY");
  Serial.println("Starting position ASSUMED Slot 0");

  if (!BLE.begin()) {
    Serial.println("BLE initialization failed");
    while (true) {
      delay(1000);
    }
  }

  BLE.setDeviceName("PillSense");
  BLE.setLocalName("PillSense");

  pillService.addCharacteristic(commandChar);
  pillService.addCharacteristic(statusChar);

  BLE.setAdvertisedService(pillService);
  BLE.addService(pillService);

  statusChar.writeValue("READY");

  BLE.advertise();

  Serial.println("PillSense BLE advertising");
  Serial.println("Command: GET_STATUS");
  Serial.println("Command: MOVE,6,1001");
  Serial.println("Command: GET_LAST_RESULT");
}

void loop() {
  BLE.poll();

  if (commandChar.written()) {
    handleCommand(commandChar.value());
  }
}
