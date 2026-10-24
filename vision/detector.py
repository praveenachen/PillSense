"""Shared MediaPipe hand-to-mouth detector used by preview and service."""

from __future__ import annotations

from dataclasses import dataclass
import time

import cv2
import mediapipe as mp
import numpy as np


@dataclass
class DetectionFrame:
    frame: object
    detected: bool
    person_visible: bool
    hand_visible: bool
    status_text: str


class HandMouthDetector:
    """Preserves the teammate's 2D fingertip-to-lip proximity behavior."""

    LIP_ORDER = [61, 40, 37, 0, 267, 270, 291, 321, 314, 17, 84, 91]
    FINGERTIPS = (4, 8, 12, 16, 20)

    def __init__(self):
        self.green = (0, 255, 0)
        self.drawing = mp.solutions.drawing_utils
        self.hand_style = self.drawing.DrawingSpec(
            color=self.green, thickness=2, circle_radius=3
        )
        self.hands = mp.solutions.hands.Hands(
            max_num_hands=2,
            min_detection_confidence=0.6,
            min_tracking_confidence=0.6,
        )
        self.face_mesh = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=2,
            min_detection_confidence=0.6,
            min_tracking_confidence=0.6,
        )
        self.near_since: float | None = None

    def process(self, source_frame: object, annotate: bool = False) -> DetectionFrame:
        frame = cv2.flip(source_frame, 1)
        height, width = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        hand_result = self.hands.process(rgb)
        face_result = self.face_mesh.process(rgb)
        faces = face_result.multi_face_landmarks or []
        tracked_hands = hand_result.multi_hand_landmarks or []
        contour = None
        mouth = None
        tolerance = 0.0

        if len(faces) == 1:
            landmarks = faces[0].landmark
            points = np.array(
                [(int(point.x * width), int(point.y * height)) for point in landmarks]
            )
            contour = points[self.LIP_ORDER].astype(np.int32)
            if annotate:
                cv2.polylines(frame, [contour], True, self.green, 2, cv2.LINE_AA)
            mouth = tuple(np.mean(contour, axis=0).astype(int))
            face_width = np.linalg.norm(points[234] - points[454])
            tolerance = 0.08 * face_width

        at_mouth = False
        nearest = None
        nearest_distance = float("inf")
        for hand in tracked_hands:
            if annotate:
                self.drawing.draw_landmarks(
                    frame,
                    hand,
                    mp.solutions.hands.HAND_CONNECTIONS,
                    self.hand_style,
                    self.hand_style,
                )
            if contour is not None and mouth is not None:
                for index in self.FINGERTIPS:
                    tip = (
                        int(hand.landmark[index].x * width),
                        int(hand.landmark[index].y * height),
                    )
                    signed_distance = cv2.pointPolygonTest(contour, tip, True)
                    if signed_distance >= -tolerance:
                        at_mouth = True
                    distance = np.linalg.norm(np.array(tip) - mouth)
                    if distance < nearest_distance:
                        nearest_distance, nearest = distance, tip

        now = time.monotonic()
        if at_mouth:
            if self.near_since is None:
                self.near_since = now
        else:
            self.near_since = None
        detected = self.near_since is not None and now - self.near_since >= 0.15

        if detected:
            text = "HAND AT MOUTH"
            if annotate and nearest is not None and mouth is not None:
                cv2.line(frame, nearest, mouth, self.green, 3, cv2.LINE_AA)
                cv2.rectangle(frame, (3, 3), (width - 4, height - 4), self.green, 6)
        elif len(faces) > 1:
            text = "Show one face at a time"
        elif not faces:
            text = "Keep your face visible"
        elif not tracked_hands:
            text = "Show your hand"
        else:
            text = "Move your fingertips toward your mouth"

        return DetectionFrame(
            frame=frame,
            detected=detected,
            person_visible=len(faces) == 1,
            hand_visible=bool(tracked_hands),
            status_text=text,
        )

    def close(self) -> None:
        self.hands.close()
        self.face_mesh.close()
