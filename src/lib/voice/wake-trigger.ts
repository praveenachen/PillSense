/**
 * Future motion/wake hardware may implement this notification-only boundary.
 * A wake trigger may open/focus the Voice Companion; it never receives a
 * dispenser adapter, Convex mutation, medication, or command permission.
 */
export interface VoiceWakeTrigger {
  subscribe(onWakeRequested: () => void): () => void;
}
