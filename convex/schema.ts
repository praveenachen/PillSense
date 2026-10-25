import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const role = v.union(v.literal("patient"), v.literal("caregiver"));
const weekday = v.union(
  v.literal("SUN"),
  v.literal("MON"),
  v.literal("TUE"),
  v.literal("WED"),
  v.literal("THU"),
  v.literal("FRI"),
  v.literal("SAT"),
);
const careTriggerReason = v.union(
  v.literal("NO_PATIENT_RESPONSE"),
  v.literal("MOTOR_COMPLETED_INGESTION_UNCONFIRMED"),
  v.literal("MOTOR_OUTCOME_UNKNOWN"),
  v.literal("PATIENT_REPORTED_NOT_TAKEN"),
  v.literal("DEVICE_FAULT_OR_DISCONNECTED"),
);
const agentTriggerReason = v.union(
  careTriggerReason,
  v.literal("LOW_SUPPLY"),
  v.literal("UNKNOWN_SUPPLY"),
);
const findingCategory = v.union(
  v.literal("NO_RECORDED_RESPONSE"),
  v.literal("DEVICE_CONNECTIVITY"),
  v.literal("DEVICE_FAULT"),
  v.literal("POSSIBLE_SUPPLY_ISSUE"),
  v.literal("PILL_UNCOLLECTED"),
  v.literal("INSUFFICIENT_EVIDENCE"),
);
const followUpAction = v.union(
  v.literal("CONTACT_PATIENT"),
  v.literal("REVIEW_DEVICE"),
  v.literal("CHECK_PHYSICAL_SUPPLY"),
  v.literal("DOCUMENT_NO_RESPONSE"),
  v.literal("NO_ACTION"),
);

export default defineSchema({
  appUsers: defineTable({
    tokenIdentifier: v.optional(v.string()),
    displayName: v.string(),
    role,
    isSynthetic: v.boolean(),
    createdAt: v.number(),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  careRelationships: defineTable({
    caregiverId: v.id("appUsers"),
    patientId: v.id("appUsers"),
    status: v.literal("active"),
    createdAt: v.number(),
  })
    .index("by_caregiver", ["caregiverId"])
    .index("by_patient", ["patientId"])
    .index("by_caregiver_and_patient", ["caregiverId", "patientId"]),

  medications: defineTable({
    patientId: v.id("appUsers"),
    name: v.string(),
    instructions: v.string(),
    productDetails: v.optional(v.object({
      brand: v.optional(v.string()),
      activeIngredient: v.optional(v.string()),
      strength: v.optional(v.string()),
      dosageForm: v.optional(v.string()),
      din: v.optional(v.string()),
      ndc: v.optional(v.string()),
      quantity: v.optional(v.string()),
      otherVisibleDetails: v.array(v.string()),
    })),
    active: v.boolean(),
    createdBy: v.id("appUsers"),
    demoSeedKey: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_patient", ["patientId"]),

  medicationSchedules: defineTable({
    patientId: v.id("appUsers"),
    medicationId: v.id("medications"),
    localTime: v.string(),
    weekdays: v.array(weekday),
    timezone: v.string(),
    active: v.boolean(),
    revision: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_patient", ["patientId"])
    .index("by_medication", ["medicationId"]),

  devices: defineTable({
    patientId: v.id("appUsers"),
    label: v.string(),
    hardwareModel: v.literal("ARDUINO_UNO_R4_WIFI"),
    physicalPositions: v.literal(8),
    createdAt: v.number(),
  }).index("by_patient", ["patientId"]),

  compartmentAssignments: defineTable({
    deviceId: v.id("devices"),
    patientId: v.id("appUsers"),
    medicationId: v.id("medications"),
    slot: v.number(),
    demoInventory: v.number(),
    // Separate from the one-pill hardware demo inventory. This is a
    // caregiver-entered estimate used only for refill forecasting.
    estimatedSupplyCount: v.optional(v.number()),
    supplyEstimateSource: v.optional(
      v.union(v.literal("CAREGIVER_VERIFIED"), v.literal("SYNTHETIC_DEMO")),
    ),
    supplyEstimateUpdatedAt: v.optional(v.number()),
    supplyRevision: v.optional(v.number()),
    active: v.boolean(),
    assignedBy: v.id("appUsers"),
    createdAt: v.number(),
  })
    .index("by_device_and_slot", ["deviceId", "slot"])
    .index("by_patient", ["patientId"])
    .index("by_medication", ["medicationId"]),

  deviceRuntime: defineTable({
    deviceId: v.id("devices"),
    patientId: v.id("appUsers"),
    state: v.union(
      v.literal("DISCONNECTED"),
      v.literal("CALIBRATION_REQUIRED"),
      v.literal("READY"),
      v.literal("DISPENSING"),
      v.literal("FAULT"),
    ),
    connected: v.boolean(),
    homeAligned: v.boolean(),
    faultCode: v.union(v.string(), v.null()),
    updatedAt: v.number(),
  })
    .index("by_device", ["deviceId"])
    .index("by_patient", ["patientId"]),

  patientDeviceIssues: defineTable({
    issueKey: v.string(),
    patientId: v.id("appUsers"),
    deviceId: v.id("devices"),
    reportedBy: v.id("appUsers"),
    reportedProblem: v.literal("PATIENT_REPORTED_DEVICE_PROBLEM"),
    transcript: v.string(),
    observedState: v.union(
      v.literal("DISCONNECTED"),
      v.literal("CALIBRATION_REQUIRED"),
      v.literal("READY"),
      v.literal("DISPENSING"),
      v.literal("FAULT"),
      v.literal("UNKNOWN"),
    ),
    observedConnected: v.union(v.boolean(), v.null()),
    observedFaultCode: v.union(v.string(), v.null()),
    status: v.literal("OPEN"),
    createdAt: v.number(),
  })
    .index("by_issueKey", ["issueKey"])
    .index("by_patient_and_createdAt", ["patientId", "createdAt"]),

  doseOccurrences: defineTable({
    occurrenceKey: v.string(),
    patientId: v.id("appUsers"),
    medicationId: v.id("medications"),
    scheduleId: v.id("medicationSchedules"),
    scheduleRevision: v.number(),
    mode: v.union(v.literal("scheduled"), v.literal("demo")),
    scheduledFor: v.number(),
    eligibleFrom: v.number(),
    expiresAt: v.number(),
    attemptStatus: v.union(
      v.literal("NONE"),
      v.literal("AUTHORIZED"),
      v.literal("DISPATCHED"),
      v.literal("COMPLETED"),
      v.literal("UNKNOWN"),
    ),
    commandId: v.optional(v.string()),
    ingestionReport: v.union(
      v.literal("UNREPORTED"),
      v.literal("TAKEN"),
      v.literal("NOT_TAKEN"),
    ),
    reminderState: v.optional(
      v.union(
        v.literal("UPCOMING"),
        v.literal("DUE"),
        v.literal("OVERDUE"),
        v.literal("RESOLVED"),
      ),
    ),
    reminderUpdatedAt: v.optional(v.number()),
    demoScenarioRunId: v.optional(v.id("demoScenarioRuns")),
    demoTriggerHint: v.optional(v.literal("DEVICE_FAULT_OR_DISCONNECTED")),
    createdAt: v.number(),
  })
    .index("by_occurrenceKey", ["occurrenceKey"])
    .index("by_patient_and_scheduledFor", ["patientId", "scheduledFor"])
    .index("by_schedule", ["scheduleId"]),

  dispenseCommands: defineTable({
    commandId: v.string(),
    occurrenceId: v.id("doseOccurrences"),
    patientId: v.id("appUsers"),
    medicationId: v.id("medications"),
    scheduleId: v.id("medicationSchedules"),
    deviceId: v.id("devices"),
    assignmentId: v.id("compartmentAssignments"),
    slot: v.number(),
    status: v.union(
      v.literal("AUTHORIZED"),
      v.literal("DISPATCHED"),
      v.literal("COMPLETED"),
      v.literal("UNKNOWN"),
    ),
    motorCompletion: v.union(
      v.literal("NOT_STARTED"),
      v.literal("COMPLETED"),
      v.literal("UNKNOWN"),
    ),
    pillRelease: v.literal("UNKNOWN"),
    pillCollection: v.literal("UNKNOWN"),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_commandId", ["commandId"])
    .index("by_occurrence", ["occurrenceId"])
    .index("by_patient", ["patientId"]),

  deviceEvents: defineTable({
    eventId: v.string(),
    commandId: v.string(),
    patientId: v.id("appUsers"),
    deviceId: v.id("devices"),
    type: v.union(
      v.literal("COMMAND_ACCEPTED"),
      v.literal("MOTOR_STARTED"),
      v.literal("MOTOR_COMPLETED"),
      v.literal("UNKNOWN"),
      v.literal("FAULT"),
      v.literal("DISCONNECTED"),
    ),
    occurredAt: v.number(),
    receivedAt: v.number(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_commandId", ["commandId"]),

  cameraObservationSessions: defineTable({
    sessionId: v.string(),
    patientId: v.id("appUsers"),
    initiatedBy: v.id("appUsers"),
    source: v.literal("WINDOWS_OPENCV_MEDIAPIPE"),
    status: v.union(
      v.literal("ACTIVE"),
      v.literal("STOPPED"),
      v.literal("ERROR"),
      v.literal("EXPIRED"),
    ),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_patient_and_startedAt", ["patientId", "startedAt"])
    .index("by_patient_and_status", ["patientId", "status"]),

  cameraObservationEvents: defineTable({
    eventId: v.string(),
    sessionId: v.id("cameraObservationSessions"),
    patientId: v.id("appUsers"),
    type: v.union(
      v.literal("CAMERA_STARTED"),
      v.literal("CAMERA_STOPPED"),
      v.literal("PERSON_VISIBLE"),
      v.literal("PERSON_NOT_VISIBLE"),
      v.literal("HAND_AT_MOUTH_DETECTED"),
      v.literal("CAMERA_ERROR"),
    ),
    source: v.literal("WINDOWS_OPENCV_MEDIAPIPE"),
    occurredAt: v.number(),
    receivedAt: v.number(),
    diagnostic: v.optional(v.string()),
  })
    .index("by_eventId", ["eventId"])
    .index("by_session_and_occurredAt", ["sessionId", "occurredAt"])
    .index("by_patient_and_occurredAt", ["patientId", "occurredAt"]),

  reminderSettings: defineTable({
    patientId: v.id("appUsers"),
    upcomingWindowMinutes: v.number(),
    followUpWindowMinutes: v.number(),
    updatedBy: v.id("appUsers"),
    updatedAt: v.number(),
  }).index("by_patient", ["patientId"]),

  reminderEvents: defineTable({
    eventKey: v.string(),
    occurrenceId: v.id("doseOccurrences"),
    patientId: v.id("appUsers"),
    state: v.union(
      v.literal("UPCOMING"),
      v.literal("DUE"),
      v.literal("OVERDUE"),
      v.literal("RESOLVED"),
    ),
    source: v.union(v.literal("SCHEDULED_CHECK"), v.literal("DEMO_SIMULATION")),
    effectiveAt: v.number(),
    recordedAt: v.number(),
  })
    .index("by_eventKey", ["eventKey"])
    .index("by_occurrence", ["occurrenceId"])
    .index("by_patient_and_effectiveAt", ["patientId", "effectiveAt"]),

  careCases: defineTable({
    caseId: v.string(),
    patientId: v.id("appUsers"),
    occurrenceId: v.id("doseOccurrences"),
    caseVersion: v.number(),
    triggerReason: careTriggerReason,
    status: v.union(
      v.literal("OPEN"),
      v.literal("ACKNOWLEDGED"),
      v.literal("RESOLVED"),
    ),
    evidenceFingerprint: v.string(),
    evidenceReferences: v.object({
      commandId: v.union(v.string(), v.null()),
      demoScenarioRunId: v.union(v.id("demoScenarioRuns"), v.null()),
      reminderEventIds: v.array(v.id("reminderEvents")),
      deviceEventIds: v.array(v.string()),
      patientReport: v.union(
        v.literal("UNREPORTED"),
        v.literal("TAKEN"),
        v.literal("NOT_TAKEN"),
      ),
    }),
    investigationStatus: v.union(
      v.literal("NOT_REQUESTED"),
      v.literal("PENDING"),
      v.literal("RUNNING"),
      v.literal("COMPLETED"),
      v.literal("FAILED"),
    ),
    acknowledgedBy: v.union(v.id("appUsers"), v.null()),
    acknowledgedAt: v.union(v.number(), v.null()),
    resolutionNote: v.union(v.string(), v.null()),
    resolutionOutcome: v.union(
      v.null(),
      v.union(
        v.literal("FOLLOW_UP_REQUIRED"),
        v.literal("CONTACTED_PATIENT"),
        v.literal("DEVICE_REVIEW"),
        v.literal("NO_FURTHER_ACTION"),
        v.literal("OTHER"),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_caseId", ["caseId"])
    .index("by_occurrence", ["occurrenceId"])
    .index("by_patient_and_status", ["patientId", "status"]),

  careCaseTransitions: defineTable({
    caseId: v.id("careCases"),
    patientId: v.id("appUsers"),
    type: v.union(
      v.literal("OPENED"),
      v.literal("REOPENED"),
      v.literal("REASON_UPDATED"),
      v.literal("ACKNOWLEDGED"),
      v.literal("RESOLVED"),
      v.literal("DEMO_RESET"),
    ),
    fromStatus: v.union(
      v.literal("OPEN"),
      v.literal("ACKNOWLEDGED"),
      v.literal("RESOLVED"),
      v.null(),
    ),
    toStatus: v.union(
      v.literal("OPEN"),
      v.literal("ACKNOWLEDGED"),
      v.literal("RESOLVED"),
    ),
    actorId: v.optional(v.id("appUsers")),
    note: v.optional(v.string()),
    outcome: v.optional(
      v.union(
        v.literal("FOLLOW_UP_REQUIRED"),
        v.literal("CONTACTED_PATIENT"),
        v.literal("DEVICE_REVIEW"),
        v.literal("NO_FURTHER_ACTION"),
        v.literal("OTHER"),
      ),
    ),
    occurredAt: v.number(),
  }).index("by_case", ["caseId"]),

  refillSettings: defineTable({
    patientId: v.id("appUsers"),
    lowSupplyThresholdDays: v.number(),
    updatedBy: v.id("appUsers"),
    updatedAt: v.number(),
  }).index("by_patient", ["patientId"]),

  refillCases: defineTable({
    caseId: v.string(),
    patientId: v.id("appUsers"),
    medicationId: v.id("medications"),
    assignmentId: v.id("compartmentAssignments"),
    caseVersion: v.number(),
    triggerReason: v.union(v.literal("LOW_SUPPLY"), v.literal("UNKNOWN_SUPPLY")),
    status: v.union(
      v.literal("OPEN"),
      v.literal("REVIEWED"),
      v.literal("REFILL_REQUESTED"),
      v.literal("REFILL_RECEIVED"),
      v.literal("CLOSED"),
    ),
    evidenceFingerprint: v.string(),
    estimatedSupplyCount: v.union(v.number(), v.null()),
    supplyEstimateSource: v.union(
      v.literal("CAREGIVER_VERIFIED"),
      v.literal("SYNTHETIC_DEMO"),
      v.null(),
    ),
    estimatedDaysRemaining: v.union(v.number(), v.null()),
    expectedLowSupplyAt: v.union(v.number(), v.null()),
    estimatedRunOutAt: v.union(v.number(), v.null()),
    confidence: v.union(
      v.literal("HIGH"),
      v.literal("MEDIUM"),
      v.literal("LOW"),
      v.literal("UNKNOWN"),
    ),
    uncertaintyReasons: v.array(v.string()),
    lowSupplyThresholdDays: v.number(),
    investigationStatus: v.union(
      v.literal("NOT_REQUESTED"),
      v.literal("PENDING"),
      v.literal("RUNNING"),
      v.literal("COMPLETED"),
      v.literal("FAILED"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_caseId", ["caseId"])
    .index("by_patient_and_status", ["patientId", "status"])
    .index("by_medication", ["medicationId"]),

  walgreensCheckouts: defineTable({
    refillCaseId: v.id("refillCases"),
    patientId: v.id("appUsers"),
    caregiverId: v.id("appUsers"),
    provider: v.literal("WALGREENS"),
    environment: v.union(v.literal("SANDBOX"), v.literal("MOCK")),
    status: v.union(
      v.literal("APPROVED"), v.literal("REQUESTING"), v.literal("CHECKOUT_READY"),
      v.literal("CHECKOUT_RETURNED_UNVERIFIED"), v.literal("CANCELLED"),
      v.literal("BACK"), v.literal("ERROR"),
    ),
    idempotencyKey: v.optional(v.string()),
    correlationId: v.optional(v.string()),
    callbackTokenHash: v.optional(v.string()),
    callbackExpiresAt: v.optional(v.number()),
    callbackConsumedAt: v.optional(v.number()),
    landingUrl: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    approvedAt: v.number(),
    requestedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_case", ["refillCaseId"])
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_callback_token_hash", ["callbackTokenHash"]),

  walgreensCheckoutEvents: defineTable({
    checkoutId: v.id("walgreensCheckouts"),
    type: v.union(
      v.literal("APPROVED"), v.literal("REQUESTING"), v.literal("CHECKOUT_READY"),
      v.literal("CHECKOUT_RETURNED_UNVERIFIED"), v.literal("CANCELLED"),
      v.literal("BACK"), v.literal("ERROR"),
    ),
    actorId: v.optional(v.id("appUsers")),
    occurredAt: v.number(),
  }).index("by_checkout", ["checkoutId"]),

  refillCaseTransitions: defineTable({
    caseId: v.id("refillCases"),
    patientId: v.id("appUsers"),
    type: v.union(
      v.literal("OPENED"),
      v.literal("FORECAST_UPDATED"),
      v.literal("REVIEWED"),
      v.literal("SUPPLY_ADJUSTED"),
      v.literal("REFILL_REQUESTED"),
      v.literal("REFILL_RECEIVED"),
      v.literal("CLOSED"),
      v.literal("DEMO_RESET"),
    ),
    fromStatus: v.union(
      v.literal("OPEN"), v.literal("REVIEWED"), v.literal("REFILL_REQUESTED"),
      v.literal("REFILL_RECEIVED"), v.literal("CLOSED"), v.null(),
    ),
    toStatus: v.union(
      v.literal("OPEN"), v.literal("REVIEWED"), v.literal("REFILL_REQUESTED"),
      v.literal("REFILL_RECEIVED"), v.literal("CLOSED"),
    ),
    actorId: v.optional(v.id("appUsers")),
    supplyCount: v.optional(v.number()),
    note: v.optional(v.string()),
    occurredAt: v.number(),
  }).index("by_case", ["caseId"]),

  refillDemoRuns: defineTable({
    patientId: v.id("appUsers"),
    assignmentId: v.id("compartmentAssignments"),
    refillCaseId: v.optional(v.id("refillCases")),
    previousSupplyCount: v.union(v.number(), v.null()),
    previousSource: v.union(
      v.literal("CAREGIVER_VERIFIED"), v.literal("SYNTHETIC_DEMO"), v.null(),
    ),
    previousUpdatedAt: v.union(v.number(), v.null()),
    previousRevision: v.number(),
    status: v.union(v.literal("ACTIVE"), v.literal("RESET")),
    initiatedBy: v.id("appUsers"),
    createdAt: v.number(),
    resetAt: v.optional(v.number()),
  }).index("by_patient_and_status", ["patientId", "status"]),

  demoScenarioRuns: defineTable({
    runId: v.string(),
    patientId: v.id("appUsers"),
    occurrenceId: v.optional(v.id("doseOccurrences")),
    scenario: v.union(
      v.literal("DUE_REMINDER"),
      v.literal("UNANSWERED_ROUTINE"),
      v.literal("OVERDUE_ESCALATION"),
      v.literal("DEVICE_UNRESOLVED"),
    ),
    status: v.union(v.literal("ACTIVE"), v.literal("RESET")),
    simulatedNow: v.number(),
    initiatedBy: v.id("appUsers"),
    createdAt: v.number(),
    resetAt: v.optional(v.number()),
  })
    .index("by_runId", ["runId"])
    .index("by_patient_and_status", ["patientId", "status"]),

  medicationInteractionSessions: defineTable({
    occurrenceId: v.id("doseOccurrences"),
    patientId: v.id("appUsers"),
    medicationId: v.id("medications"),
    firstInteraction: v.boolean(),
    state: v.union(
      v.literal("AWAITING_READINESS"),
      v.literal("AWAITING_EDUCATION_CHOICE"),
      v.literal("AWAITING_CONTINUE"),
      v.literal("READY_FOR_SUPERVISED_ROUTINE"),
      v.literal("DECLINED"),
      v.literal("COMPLETED"),
    ),
    greetingStatus: v.union(
      v.literal("NOT_ISSUED"),
      v.literal("CLAIMED"),
      v.literal("PLAYED"),
      v.literal("PLAYBACK_BLOCKED"),
      v.literal("FAILED"),
    ),
    cameraConsent: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_occurrence", ["occurrenceId"])
    .index("by_patient_and_medication", ["patientId", "medicationId"]),

  medicationInteractionEvents: defineTable({
    sessionId: v.id("medicationInteractionSessions"),
    occurrenceId: v.id("doseOccurrences"),
    patientId: v.id("appUsers"),
    type: v.union(
      v.literal("SESSION_CREATED"),
      v.literal("GREETING_CLAIMED"),
      v.literal("GREETING_PLAYED"),
      v.literal("GREETING_PLAYBACK_BLOCKED"),
      v.literal("GREETING_FAILED"),
      v.literal("PATIENT_INTENT"),
      v.literal("EDUCATION_PRESENTED"),
      v.literal("CAMERA_CONSENT_CHANGED"),
      v.literal("ROUTINE_READY"),
      v.literal("SESSION_DECLINED"),
      v.literal("SESSION_COMPLETED"),
    ),
    intent: v.optional(
      v.union(
        v.literal("YES"),
        v.literal("NO"),
        v.literal("REPEAT"),
        v.literal("REQUEST_MORE_INFORMATION"),
      ),
    ),
    detailCode: v.optional(v.string()),
    source: v.union(v.literal("VOICE"), v.literal("TEXT"), v.literal("SYSTEM")),
    occurredAt: v.number(),
  })
    .index("by_session_and_occurredAt", ["sessionId", "occurredAt"])
    .index("by_patient_and_occurredAt", ["patientId", "occurredAt"]),

  agentRuns: defineTable({
    runId: v.string(),
    careCaseId: v.optional(v.id("careCases")),
    refillCaseId: v.optional(v.id("refillCases")),
    patientId: v.id("appUsers"),
    caseVersion: v.number(),
    triggerReason: agentTriggerReason,
    workflowType: v.union(
      v.literal("ADHERENCE_INVESTIGATION"),
      v.literal("REFILL_INVESTIGATION"),
    ),
    source: v.optional(
      v.union(v.literal("CAREGIVER_UI"), v.literal("AGENTVERSE"), v.literal("AUTOMATION")),
    ),
    agentverseRequestId: v.optional(v.id("agentverseRequests")),
    status: v.union(
      v.literal("PENDING"),
      v.literal("RUNNING"),
      v.literal("COMPLETED"),
      v.literal("FAILED"),
    ),
    requestedBy: v.id("appUsers"),
    claimIdempotencyKey: v.union(v.string(), v.null()),
    claimTokenHash: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    provider: v.union(
      v.literal("OPENAI"),
      v.literal("ANTHROPIC"),
      v.literal("DETERMINISTIC_FALLBACK"),
      v.null(),
    ),
    model: v.union(v.string(), v.null()),
    findings: v.union(
      v.object({
        items: v.array(
          v.object({
            category: findingCategory,
            evidenceReferences: v.array(v.string()),
            uncertainty: v.union(
              v.literal("LOW"),
              v.literal("MEDIUM"),
              v.literal("HIGH"),
            ),
            explanation: v.string(),
          }),
        ),
        overallSummary: v.string(),
        proposedFollowUp: v.object({
          actionType: followUpAction,
          explanation: v.string(),
        }),
      }),
      v.null(),
    ),
    failureCode: v.union(v.string(), v.null()),
    submissionIdempotencyKey: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
    claimedAt: v.union(v.number(), v.null()),
    completedAt: v.union(v.number(), v.null()),
  })
    .index("by_runId", ["runId"])
    .index("by_claimIdempotencyKey", ["claimIdempotencyKey"])
    .index("by_case", ["careCaseId"])
    .index("by_refill_case", ["refillCaseId"])
    .index("by_patient_and_createdAt", ["patientId", "createdAt"])
    .index("by_status_and_createdAt", ["status", "createdAt"]),

  agentverseScopes: defineTable({
    alias: v.string(),
    caregiverId: v.id("appUsers"),
    patientId: v.id("appUsers"),
    careCaseId: v.optional(v.id("careCases")),
    refillCaseId: v.optional(v.id("refillCases")),
    caseVersion: v.number(),
    requestType: v.union(v.literal("DEMO_ADHERENCE_INVESTIGATION"), v.literal("DEMO_REFILL_STATUS")),
    status: v.union(v.literal("ACTIVE"), v.literal("REVOKED")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_alias", ["alias"])
    .index("by_case", ["careCaseId"])
    .index("by_refill_case", ["refillCaseId"])
    .index("by_caregiver_and_updatedAt", ["caregiverId", "updatedAt"]),

  agentverseRequests: defineTable({
    requestKey: v.string(),
    requestId: v.string(),
    protocolVersion: v.literal("1.0"),
    sourceAgentAddress: v.string(),
    transport: v.optional(
      v.union(v.literal("UAGENT_A2A"), v.literal("ASI_ONE_ACP")),
    ),
    requestType: v.union(v.literal("DEMO_ADHERENCE_INVESTIGATION"), v.literal("DEMO_REFILL_STATUS")),
    caseAlias: v.string(),
    scopeId: v.id("agentverseScopes"),
    caregiverId: v.id("appUsers"),
    patientId: v.id("appUsers"),
    careCaseId: v.optional(v.id("careCases")),
    refillCaseId: v.optional(v.id("refillCases")),
    caseVersion: v.optional(v.number()),
    agentRunId: v.optional(v.id("agentRuns")),
    status: v.union(
      v.literal("ACK"),
      v.literal("IN_PROGRESS"),
      v.literal("COMPLETED"),
      v.literal("FAILED"),
    ),
    outcomeCode: v.union(v.string(), v.null()),
    sentAt: v.number(),
    receivedAt: v.number(),
    acknowledgedAt: v.number(),
    startedAt: v.union(v.number(), v.null()),
    completedAt: v.union(v.number(), v.null()),
    lastResponseStatus: v.union(
      v.null(),
      v.literal("ACK"),
      v.literal("IN_PROGRESS"),
      v.literal("COMPLETED"),
      v.literal("FAILED"),
    ),
    lastResponseSubmittedAt: v.union(v.number(), v.null()),
    updatedAt: v.number(),
  })
    .index("by_requestKey", ["requestKey"])
    .index("by_scope_and_receivedAt", ["scopeId", "receivedAt"])
    .index("by_caregiver_and_receivedAt", ["caregiverId", "receivedAt"]),

  agentActions: defineTable({
    actionId: v.string(),
    runId: v.id("agentRuns"),
    patientId: v.id("appUsers"),
    kind: v.union(v.literal("TOOL"), v.literal("WORKFLOW")),
    toolName: v.union(
      v.literal("get_dose_context"),
      v.literal("get_dispense_history"),
      v.literal("get_device_status"),
      v.literal("get_inventory_context"),
      v.literal("get_patient_reports"),
      v.literal("get_tray_observations"),
      v.literal("get_supply_estimate"),
      v.literal("get_consumption_forecast"),
      v.literal("get_refill_case_history"),
      v.literal("get_refill_checkout_status"),
      v.literal("submit_investigation"),
      v.literal("workflow_failure"),
    ),
    status: v.union(v.literal("SUCCESS"), v.literal("FAILED")),
    startedAt: v.number(),
    completedAt: v.number(),
    evidenceReferences: v.array(v.string()),
    summary: v.string(),
    errorCode: v.union(v.string(), v.null()),
  })
    .index("by_actionId", ["actionId"])
    .index("by_run_and_startedAt", ["runId", "startedAt"]),
});
