export function canProcessRecording(cancelled: boolean, size: number) {
  return !cancelled && size > 0 && size <= 2_500_000;
}

export function canCommitVoiceAction(hasPendingAction: boolean, explicitConfirmation: boolean) {
  return hasPendingAction && explicitConfirmation;
}

export const MICROPHONE_UNAVAILABLE_MESSAGE = "Microphone permission was denied or unavailable. Use the text and touch controls.";
export const TRANSCRIPTION_UNAVAILABLE_MESSAGE = "Cartesia transcription failed. Type or choose the action instead.";
