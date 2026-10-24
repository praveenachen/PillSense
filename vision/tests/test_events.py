from vision.events import GestureDebouncer, ObservationEvent, ObservationType, SOURCE_ID


def test_observation_event_shape_is_non_clinical():
    event = ObservationEvent.create("session-1234", ObservationType.HAND_AT_MOUTH_DETECTED)
    value = event.to_dict()
    assert value["sessionId"] == "session-1234"
    assert value["source"] == SOURCE_ID
    assert value["type"] == "HAND_AT_MOUTH_DETECTED"
    assert "confidence" not in value
    assert "ingestion" not in str(value).lower()


def test_continuous_gesture_emits_once_until_clear_and_cooldown():
    debounce = GestureDebouncer(cooldown_seconds=2.0, reset_seconds=0.3)
    assert debounce.update(True, 1.0) is True
    assert debounce.update(True, 1.2) is False
    assert debounce.update(True, 2.0) is False
    assert debounce.update(False, 2.1) is False
    assert debounce.update(False, 2.5) is False
    assert debounce.update(True, 2.6) is False  # Still inside the cooldown.
    assert debounce.update(False, 2.7) is False
    assert debounce.update(False, 3.1) is False
    assert debounce.update(True, 3.2) is True
