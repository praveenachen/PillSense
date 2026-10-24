/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as agentRuns from "../agentRuns.js";
import type * as agentService from "../agentService.js";
import type * as agentverse from "../agentverse.js";
import type * as agentverseService from "../agentverseService.js";
import type * as auth from "../auth.js";
import type * as careCases from "../careCases.js";
import type * as caregiver from "../caregiver.js";
import type * as crons from "../crons.js";
import type * as demo from "../demo.js";
import type * as device from "../device.js";
import type * as deviceIssues from "../deviceIssues.js";
import type * as dispensing from "../dispensing.js";
import type * as http from "../http.js";
import type * as lib_agentRunCreation from "../lib/agentRunCreation.js";
import type * as lib_authorization from "../lib/authorization.js";
import type * as lib_medicationValidation from "../lib/medicationValidation.js";
import type * as lib_occurrenceGeneration from "../lib/occurrenceGeneration.js";
import type * as lib_refillForecast from "../lib/refillForecast.js";
import type * as lib_reminderReconciliation from "../lib/reminderReconciliation.js";
import type * as lib_requireIdentity from "../lib/requireIdentity.js";
import type * as lib_scheduleTime from "../lib/scheduleTime.js";
import type * as medications from "../medications.js";
import type * as occurrences from "../occurrences.js";
import type * as patient from "../patient.js";
import type * as refills from "../refills.js";
import type * as reminders from "../reminders.js";
import type * as vision from "../vision.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  agentRuns: typeof agentRuns;
  agentService: typeof agentService;
  agentverse: typeof agentverse;
  agentverseService: typeof agentverseService;
  auth: typeof auth;
  careCases: typeof careCases;
  caregiver: typeof caregiver;
  crons: typeof crons;
  demo: typeof demo;
  device: typeof device;
  deviceIssues: typeof deviceIssues;
  dispensing: typeof dispensing;
  http: typeof http;
  "lib/agentRunCreation": typeof lib_agentRunCreation;
  "lib/authorization": typeof lib_authorization;
  "lib/medicationValidation": typeof lib_medicationValidation;
  "lib/occurrenceGeneration": typeof lib_occurrenceGeneration;
  "lib/refillForecast": typeof lib_refillForecast;
  "lib/reminderReconciliation": typeof lib_reminderReconciliation;
  "lib/requireIdentity": typeof lib_requireIdentity;
  "lib/scheduleTime": typeof lib_scheduleTime;
  medications: typeof medications;
  occurrences: typeof occurrences;
  patient: typeof patient;
  refills: typeof refills;
  reminders: typeof reminders;
  vision: typeof vision;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
