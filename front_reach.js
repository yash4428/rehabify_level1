// front_reach.js
window.Exercises = window.Exercises || {};

window.Exercises.frontReach = {
  id: 'forwardReach',
  name: 'Front Reach',
  description: 'Reach forward alternating left and right hands',
  criteria: 'forwardReach',
  repetitions_target: 2,
  level: 1,
  showShoulderLine: true,
  requiresWaist: true,
  introSticky: true,
  introText: 'Stand up straight. Show your body till the waist. Reach forward with alternating hands to touch the glowing targets.',
  
  // Readiness check
  readinessCheck: ({ lm, shouldersLevel, visOK }) => {
    const LS = lm?.[11], RS = lm?.[12];
    if (!visOK(LS) || !visOK(RS)) {
      return { ok: false, msg: 'Keep both shoulders visible' };
    }
    if (!shouldersLevel(lm)) {
      return { ok: false, msg: 'Keep shoulders level' };
    }
    return { ok: true };
  }
};

console.log('front_reach.js loaded');
