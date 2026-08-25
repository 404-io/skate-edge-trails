# Product architecture

## Goal

The product turns a skating video into an accurate floor trajectory, shows that trajectory in AR, and improves edge classification from reviewed practice data.

## Four layers

```text
Video analysis -> AR replay -> task practice -> reviewed training dataset
```

1. **Video analysis** projects left and right toe positions from a calibrated video into rink-floor metres. Hockey-line intersections provide the calibration reference.
2. **AR replay** places the metre-based trajectory on a detected ice plane. It consumes the same JSON, rather than reinterpreting screen coordinates.
3. **Task practice** displays a task template as an AR guide. A template stores a target path and the edge that the task expects for each segment.
4. **Reviewed learning data** keeps expected, model-predicted, and coach-confirmed labels separate. Only confirmed labels are training data.

## Edge labels

`RFO`, for example, means right foot, forward, outside edge. The label is not inferred from the target path alone:

- `expectedEdge`: the edge required by the selected task
- `predictedEdge`: the classifier's candidate and confidence
- `reviewedEdge`: the observation confirmed by the skater or coach

An AR guide is useful for collecting labelled examples, but it is not ground truth by itself. A skater can trace the correct geometry while using an incorrect edge. The annotation screen must confirm or correct each segment.

## Training data unit

One review record contains the task and segment IDs, its expected and reviewed edge, a calibration quality value, the associated video and trajectory IDs, and reviewer metadata. This makes later model evaluation possible without mixing weak labels with confirmed ones.

## AR hand-off

The PWA exports a platform-independent task JSON in rink-floor metres. A Unity AR Foundation viewer will read that file, let the skater tap a detected ice plane, create one anchor for the whole guide, and draw the path as a child of that anchor. Android uses ARCore first; the same Unity scene can later use ARKit on iOS.
