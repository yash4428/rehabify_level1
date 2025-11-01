window.Exercises = window.Exercises || {};

window.Exercises.shoulderAbduction = {
  id: "shoulderAbduction",
  name: "Shoulder Abduction",
  description: "Raise both arms out to the sides like a rainbow",
  criteria: "shoulderAbduction",
  repetitions_target: 3,
  level: 1,
  showShoulderLine: true,
  requiresWaist: true,
  introSticky: false, // let user start quickly
  introText:
    "Keep both shoulders visible. Raise both arms out to the sides to shoulder level.",

  // simplified gate — more tolerant
  introGate: ({ lm }) => {
    if (!lm) return { ok: false, msg: "Make sure you are visible" };
    const LS = lm[11],
      RS = lm[12],
      LW = lm[15],
      RW = lm[16];

    if (!LS || !RS || !LW || !RW)
      return { ok: false, msg: "Show both shoulders and wrists" };

    // very relaxed start condition
    return { ok: true };
  },

  // make the star burst more easily
  sensitivity: {
    distanceThreshold: 100, // was ~40–50
    verticalSlack: 0.15, // accept wrist a bit below target
  },
};
