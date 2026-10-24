"""Green hand/lip tracing with a simple hand-at-mouth indicator. Q quits."""
import argparse

import cv2

try:
    from .detector import HandMouthDetector
except ImportError:  # Direct `python hand_mouth.py` execution.
    from detector import HandMouthDetector


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--camera', type=int, default=0)
    args = parser.parse_args()
    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        cap.release()
        raise SystemExit(f'Camera {args.camera} unavailable. Try --camera 1 or --camera 2 and check macOS camera permissions.')
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    window = 'Hand at mouth demo - Q to quit'
    detector = HandMouthDetector()
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError('Camera stopped returning frames. Close other camera apps and restart.')
            result = detector.process(frame, annotate=True)
            height, width = result.frame.shape[:2]
            cv2.rectangle(result.frame, (0, 0), (width, 54), (20, 20, 20), -1)
            cv2.putText(result.frame, result.status_text, (16, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.8, detector.green, 2, cv2.LINE_AA)
            cv2.putText(result.frame, 'Q: quit | Gesture demo only', (16, height - 18),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, detector.green, 1, cv2.LINE_AA)
            cv2.imshow(window, result.frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
            if cv2.getWindowProperty(window, cv2.WND_PROP_VISIBLE) < 1:
                break
    except KeyboardInterrupt:
        pass
    finally:
        detector.close()
        cap.release()
        cv2.destroyAllWindows()


if __name__ == '__main__':
    main()
