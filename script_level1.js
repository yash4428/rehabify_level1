// ==========================
// Rehabify — Level 1 (Front Reach → Shoulder Abduction → Overhead Press)
// ==========================

// ---------- DOM ----------
const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const startBtn = document.getElementById("startBtn");
const nextBtn  = document.getElementById("nextBtn");
const scoreEl  = document.getElementById("score");
const starsEl  = document.getElementById("stars");
const streakEl = document.getElementById("streak");
const statusEl = document.getElementById("status");
const repBigEl = document.getElementById("repBig");
const exerciseInfoEl = document.getElementById("exerciseInfo");
const coachBoxEl = document.getElementById("coachBox");

// keep overlay above video & ignore clicks
if (canvas) {
  canvas.style.pointerEvents = "none";
  // ensure canvas sits on top even if CSS misses it
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.zIndex = "2";
}

function status(msg){ if (statusEl) statusEl.textContent = msg || ""; }
function coach(msg){ 
  if (!coachBoxEl) return;
  coachBoxEl.textContent = msg || "";
  coachBoxEl.style.display = msg ? "block" : "none";
}

// ---------- Session State ----------
let running = false;
let latestLm = null;

let score = 0, streak = 0, starCount = 0;
let repCount = 0;

let currentExerciseIndex = 0;
let currentExercise = null;
let exercises = [];

let celebrationActive = false;   // final star state
let celebrationPopped = false;

let stars = [];                  // generic falling targets (front reach / finish)
let nextAllowedSpawnAt = 0;
let combo = 0;

// ---------- Perf pacing ----------
const PERF = { LOW: true };
const FRAME_MS = PERF.LOW ? 100 : 66;
let _prevNow = performance.now();
let _lastDrawAt = 0;

// ---------- Utilities ----------
const VIS_THRESH = 0.25;
const visOK = p => !!p && (p.visibility === undefined || p.visibility >= VIS_THRESH);
function toPix(p){ return { x:(1-p.x)*canvas.width, y:p.y*canvas.height }; } // mirror x
function dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

function angleDeg(a,b,c){
  const bax=a.x-b.x, bay=a.y-b.y, bcx=c.x-b.x, bcy=c.y-b.y;
  const den=Math.hypot(bax,bay)*Math.hypot(bcx,bcy);
  if (!den || !isFinite(den)) return 180;
  const dot=bax*bcx+bay*bcy;
  const v = Math.max(-1, Math.min(1, dot/den));
  return Math.acos(v)*180/Math.PI;
}

function shouldersLevel(lm, tolDeg=12){
  const LS=lm?.[11], RS=lm?.[12];
  if(!visOK(LS) || !visOK(RS)) return false;
  const a = Math.atan2(toPix(RS).y - toPix(LS).y, toPix(RS).x - toPix(LS).x)*180/Math.PI;
  return Math.abs(a) <= tolDeg;
}
function elbowsStraightEnough(lm){
  const Ls=lm[11], Le=lm[13], Lw=lm[15], Rs=lm[12], Re=lm[14], Rw=lm[16];
  if (![Ls,Le,Lw,Rs,Re,Rw].every(visOK)) return false;
  const leftAng  = angleDeg(toPix(Ls), toPix(Le), toPix(Lw));
  const rightAng = angleDeg(toPix(Rs), toPix(Re), toPix(Rw));
  return leftAng>150 && rightAng>150;
}
function waistVisible(lm){ return visOK(lm?.[23]) && visOK(lm?.[24]); }

// ---------- Exercises from modules ----------
const RAW = window.Exercises || {};
const E_FORWARD = RAW.frontReach || { id:'forwardReach', name:'Front Reach', description:'Reach palms to the glowing rings', criteria:'forwardReach', repetitions_target:3, requiresWaist:true };
const E_ABDUCT  = RAW.shoulderAbduction || { id:'shoulderAbduction', name:'Shoulder Abduction', description:'Raise both arms side to shoulder level along rainbow stars', criteria:'shoulderAbduction', repetitions_target:3, requiresWaist:true };
const E_OHP     = RAW.overheadPress || { id:'overheadPress', name:'Overhead Press', description:'Up over head → back to shoulder line', criteria:'overheadPress', repetitions_target:3, requiresWaist:true };

function normalizeExercise(ex){
  return {
    level:1,
    introSticky:true,
    showShoulderLine:true,
    ...ex,
    introText: ex.introText || `${ex.name}: ${ex.description || ''}`,
  };
}
exercises = [ normalizeExercise(E_FORWARD), normalizeExercise(E_ABDUCT), normalizeExercise(E_OHP) ];

// ---------- UI helpers ----------
function updateExerciseInfo(){
  const reps = currentExercise?.repetitions_target ?? 2;
  const name = currentExercise?.name ?? '—';
  const remaining = Math.max(0, reps - repCount);
  if (exerciseInfoEl) exerciseInfoEl.textContent = `${name} | Reps ${repCount}/${reps}`;
  if (repBigEl) repBigEl.textContent = String(remaining);
}
function incrementRep(){
  repCount++;
  const total = currentExercise?.repetitions_target || 2;
  const remaining = Math.max(0, total - repCount);
  updateExerciseInfo();
  if (remaining === 0){
    coach('Excellent! Exercise completed!');
    if (currentExerciseIndex >= exercises.length - 1){
      startCelebrationStar();
    } else {
      setTimeout(()=> goToExercise(currentExerciseIndex+1), 650);
    }
  } else {
    coach(`Good! ${remaining} left.`);
  }
}
function resetPerExercise(){
  repCount = 0;
  stars = [];
  nextAllowedSpawnAt = 0;
  combo = 0;
  // rainbow reset
  rainbowStars = [];
  ascending = true;
  currentStepL = 0;
  currentStepR = 0;
  updateExerciseInfo();
  coach('');
}

// ---------- Intro overlay ----------
let _intro = { text:'', sub:'', sticky:false, visible:false, until:0 };
function showIntro(text, { sticky=false, seconds=4 }={}){
  _intro.text = text || ''; _intro.sub=''; _intro.sticky=!!sticky;
  _intro.visible = true;
  _intro.until = sticky ? 0 : (performance.now() + seconds*1000);
}
function showIntroForExercise(ex){
  const sticky = ex?.introSticky ?? true;
  const text = ex?.introText || `${ex?.name}: ${ex?.description||''}`;
  showIntro(text, { sticky, seconds: 3.5 });
}
function shouldHoldIntro(){
  if (!_intro.sticky) return false;
  if (!latestLm){ _intro.sub='Make sure you are visible'; return true; }
  if (currentExercise?.requiresWaist && !waistVisible(latestLm)){ _intro.sub='Show body till the waist'; return true; }
  if (currentExercise?.criteria === 'shoulderAbduction' && !elbowsStraightEnough(latestLm)){ _intro.sub='Straighten elbows to begin'; return true; }
  _intro.sub=''; return false;
}
function introIsActive(now){
  if (!_intro.visible) return false;
  if (!_intro.sticky){
    if (now > _intro.until){ _intro.visible=false; return false; }
    return true;
  }
  const hold = shouldHoldIntro();
  if (!hold){ _intro.visible=false; return false; }
  return true;
}
function drawIntroOverlay(now){
  if (!_intro.visible) return;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#fff';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  const base = Math.max(22, canvas.width*0.032);
  ctx.font = `600 ${base}px ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial`;
  ctx.fillText(_intro.text, canvas.width/2, canvas.height*0.38);
  if (_intro.sub){
    ctx.font = `500 ${Math.max(18, base*0.9)}px ui-sans-serif,system-ui`;
    ctx.fillStyle = '#ffe07a';
    ctx.fillText(_intro.sub, canvas.width/2, canvas.height*0.45);
  }
  ctx.restore();
}

// ---------- Celebration star & redirect ----------
function startCelebrationStar() {
  celebrationActive = true;
  celebrationPopped = false;
  stars = [];
  nextAllowedSpawnAt = 0;

  coach("✨ Finishing up...");
  status("Final stage — great work!");

  // Try every possible redirect path after 1.5 seconds
  setTimeout(() => {
    try {
      // If in iframe and parent can handle it
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "rehabify-finish-session" }, "*");
      }
      // Try top frame (if allowed)
      if (window.top && window.top.location) {
        window.top.location.href = ".";
      } else {
        window.location.href = ".";
      }
    } catch (err) {
      console.error("Redirect fallback:", err);
      // absolute fallback
      window.location.href = ".";
    }
  }, 1500);
}

function endSession(){
  celebrationActive = false;
  celebrationPopped = true;
  coach('✨ Session Complete! Redirecting…');
  status('All exercises done. Great work!');
  setTimeout(()=>{
    // Prefer parent navigation if inside an iframe
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type:'rehabify-finish-session' }, '*');
      } else {
        window.location.href = './';
      }
    } catch {
      // hard fallback
      window.location.href = './';
    }
  }, 1200);
}

// ---------- Drawing helpers ----------
function drawCameraFrame(){
  if (video.readyState >= 2){
    ctx.save();
    ctx.scale(-1,1); // mirror
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();
  } else {
    ctx.clearRect(0,0,canvas.width,canvas.height);
  }
}
function drawShoulderLocator(lm){
  const LS = lm?.[11], RS = lm?.[12];
  if (!visOK(LS) || !visOK(RS)) return;
  const sL = toPix(LS), sR = toPix(RS);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(sL.x, sL.y); ctx.lineTo(sR.x, sR.y); ctx.stroke();
  for (const p of [sL, sR]){
    ctx.fillStyle = '#66e3ff';
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
}
function starPath(cx, cy, spikes, outerR, innerR, rotation=-Math.PI/2){
  const step = Math.PI / spikes; ctx.beginPath();
  for (let i=0;i<spikes*2;i++){
    const r = (i%2===0) ? outerR : innerR, a = i*step + rotation;
    const x = cx + Math.cos(a)*r, y = cy + Math.sin(a)*r;
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.closePath();
}

// ---------- FRONT REACH & FINISH TARGETS ----------
const NOTE_SPEED_PX_S = 110;
const POST_HIT_DESPAWN_MS = 650;
const NEXT_DELAY_MS = 220;
const HOLD_MS_DEFAULT = 550;
const STAR_TTL_MS = 6000;
const CONTACT_RADIUS_BONUS = 28;

function palmPix(lm, side){
  const w = side==='left' ? lm?.[15] : lm?.[16];
  const i = side==='left' ? lm?.[19] : lm?.[20];
  const t = side==='left' ? lm?.[21] : lm?.[22];
  if (![w,i,t].every(visOK)) return visOK(w) ? toPix(w) : null;
  const W = toPix(w), I = toPix(i), T = toPix(t);
  return { x:(W.x+I.x+T.x)/3, y:(W.y+I.y+T.y)/3 };
}
function drawRingShape(s){
  const {x,y} = s; const r = s._rDraw ?? s.r;
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(x, y, r+14, 0, Math.PI*2); ctx.fillStyle = s.inside ? 'rgba(80,220,240,0.26)' : 'rgba(80,220,240,0.18)'; ctx.fill();
  ctx.lineWidth=Math.max(6,r*0.22); ctx.strokeStyle = s.strokeColor || '#45e0f0';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.stroke();
  ctx.lineWidth=Math.max(3,r*0.10); ctx.strokeStyle = '#fff';
  ctx.beginPath(); ctx.arc(x, y, r*0.65, 0, Math.PI*2); ctx.stroke();
}
function drawStarShape(s){
  const {x,y} = s; const r = s._rDraw ?? s.r;
  ctx.save();
  starPath(x, y, 5, r, r*0.48);
  ctx.fillStyle = s.fillColor || (s.inside ? '#ffd54a' : '#ffef7a');
  ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = '#ffffffcc'; ctx.stroke();
  ctx.restore();
}
function drawTargetShape(s){
  const {x,y} = s; const r = s._rDraw ?? s.r;
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.strokeStyle='#aaff88'; ctx.lineWidth=Math.max(6,r*0.18); ctx.stroke();
  ctx.beginPath(); ctx.arc(x,y,r*0.66,0,Math.PI*2); ctx.strokeStyle='#fff'; ctx.lineWidth=Math.max(3,r*0.10); ctx.stroke();
}

function spawnSingleStar(now) {
  // ---------- FINAL CELEBRATION STAR ----------
  if (celebrationActive) {
    // if no star yet, spawn one falling from top
    if (stars.length === 0) {
      const baseR = Math.max(36, Math.min(60, canvas.width * 0.05));
      stars.push({
        x: canvas.width / 2,
        y: -80,
        targetY: canvas.height * 0.45,
        r: baseR,
        vy: 120,
        label: "FINISH",
        hit: false,
        spawnedAt: now
      });
    }
    return; // don’t redirect immediately — wait until it's hit
  }

  // ---------- FRONT REACH NORMAL STARS ----------
  if (currentExercise?.criteria !== "forwardReach") return;
  if (stars.length > 0 || now < nextAllowedSpawnAt) return;

  if (latestLm) {
    if (currentExercise?.requiresWaist && !waistVisible(latestLm)) {
      coach("Show body till the waist");
      return;
    }
  }

  const LS = latestLm?.[11], RS = latestLm?.[12];
  if (!visOK(LS) || !visOK(RS)) return;
  const sL = toPix(LS), sR = toPix(RS);
  const midX = (sL.x + sR.x) / 2, midY = (sL.y + sR.y) / 2;
  const leftTurn = (combo % 2 === 0);

  const w = canvas.width, h = canvas.height;
  const padX = Math.max(40, w * 0.08), padY = Math.max(40, h * 0.12);
  const target = {
    x: clamp(midX + (leftTurn ? -1 : 1) * (w * 0.22), padX, w - padX),
    y: clamp(midY - h * 0.12, padY, h * 0.65),
    label: leftTurn ? "LEFT PALM" : "RIGHT PALM",
    shape: "ring",
    required: leftTurn ? "palmLeft" : "palmRight",
    holdMs: 450
  };

  const baseR = Math.max(36, Math.min(60, canvas.width * 0.05));
  stars = [{
    x: target.x,
    y: -60,
    targetY: target.y,
    r: baseR,
    vy: NOTE_SPEED_PX_S,
    spawnedAt: now,
    hit: false,
    hitAt: 0,
    holdStart: 0,
    inside: false,
    holdMs: target.holdMs ?? HOLD_MS_DEFAULT,
    required: target.required,
    label: target.label,
    shape: target.shape
  }];
}


function computeInside(star, LW, RW, LP, RP){
  const palmBonus = 10;
  const rad = (star.r || 40) + CONTACT_RADIUS_BONUS + palmBonus;
  const leftWristIn  = !!LW && dist(LW, star) <= rad;
  const rightWristIn = !!RW && dist(RW, star) <= rad;
  const leftPalmIn   = !!LP && dist(LP, star) <= rad;
  const rightPalmIn  = !!RP && dist(RP, star) <= rad;

  switch (star.required) {
    case 'bothWrists': return leftWristIn && rightWristIn;
    case 'wristLeft':  return leftWristIn;
    case 'wristRight': return rightWristIn;
    case 'bothPalms':  return leftPalmIn && rightPalmIn;
    case 'palmLeft':   return leftPalmIn;
    case 'palmRight':  return rightPalmIn;
    case 'palm':       return leftPalmIn || rightPalmIn;
    default:           return leftPalmIn || rightPalmIn || leftWristIn || rightWristIn;
  }
}

function drawStarsAndUI(now){
  for (let i=stars.length-1;i>=0;i--){
    const s = stars[i];
    if (!s.hit){ s._rDraw = s.r * (1 + 0.10*Math.sin((now - s.spawnedAt)/220)); }
    else {
      const k = Math.min(1,(now - s.hitAt)/350);
      s._rDraw = s.r*(1+0.9*k);
      ctx.globalAlpha = 1 - Math.min(1,(now - s.hitAt)/650);
    }

    // halo & shape
    ctx.beginPath(); ctx.arc(s.x, s.y, (s._rDraw||s.r)+12, 0, Math.PI*2);
    ctx.fillStyle = s.inside ? 'rgba(255,255,160,0.24)' : 'rgba(255,240,120,0.12)';
    ctx.fill();
    if (s.shape==='ring') drawRingShape(s);
    else if (s.shape==='target') drawTargetShape(s);
    else drawStarShape(s);

    // label
    ctx.globalAlpha = 1;
    const fpx = Math.max(20, (s._rDraw||s.r) * 0.65);
    ctx.font = `700 ${fpx}px ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.lineWidth = Math.max(3, fpx*0.12); ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(s.label||'', s.x, s.y);
    ctx.fillStyle='#fff';
    ctx.fillText(s.label||'', s.x, s.y);

    // fall down to target
    if (s.y < s.targetY) s.y += NOTE_SPEED_PX_S * ((performance.now() - (s.lastUpdate || performance.now()))/1000);
    s.lastUpdate = performance.now();

    // cleanup
    if (s.hit && (now - s.hitAt) > POST_HIT_DESPAWN_MS) {
      stars.splice(i, 1);
    } else if (!s.hit && (now - s.spawnedAt) > STAR_TTL_MS) {
      stars.splice(i,1); combo=0;
    }
  }

  // HUD ribbon
  ctx.save();
  ctx.fillStyle='rgba(0,0,0,0.42)'; ctx.fillRect(10,10,canvas.width-20,40);
  ctx.fillStyle='#fff'; ctx.font='16px ui-monospace,monospace';
  ctx.textAlign='left';  ctx.fillText(`Combo: ${combo}`, 20, 36);
  ctx.textAlign='right'; ctx.fillText(stars.length ? 'Move palm to the glowing target' : 'Get ready…', canvas.width-20, 36);
  ctx.restore();
}

// ---------- OVERHEAD PRESS CRITERIA ----------
const _criteriaState = { overheadPress: { phaseUp:false } };
function wristsAboveHead(lm){
  const nose = lm?.[0], LW = lm?.[15], RW = lm?.[16];
  if (![nose, LW, RW].every(visOK)) return false;
  return (LW.y < (nose.y - 0.05)) && (RW.y < (nose.y - 0.05));
}
function wristsAtShoulders(lm){
  const LS = lm?.[11], RS = lm?.[12], LW = lm?.[15], RW = lm?.[16];
  if (![LS, RS, LW, RW].every(visOK)) return false;
  const top = Math.min(LS.y, RS.y) - 0.03;
  const bot = Math.max(LS.y, RS.y) + 0.06;
  return (LW.y>top && LW.y<bot) && (RW.y>top && RW.y<bot);
}
function criteriaOverheadPress(lm){
  const st = _criteriaState.overheadPress;
  if (!st.phaseUp){
    if (wristsAboveHead(lm)){ st.phaseUp = true; status('Good! Return to shoulder line…'); }
    return null;
  } else {
    if (wristsAtShoulders(lm)){ st.phaseUp = false; return { rep_completed:true }; }
    return null;
  }
}

// ---------- SHOULDER ABDUCTION (Rainbow) ----------
const SIDE = { L:'left', R:'right' };
let rainbowStars = [];
let ascending = true;
let starRadius = 44;
let currentStepL = 0, currentStepR = 0;

function isAbduction(ex=currentExercise){ return ex?.criteria === 'shoulderAbduction'; }

function setupRainbowStars(first=false){
  const N = 4;
  const pad = Math.max(30, canvas.width*0.04);
  const baseY   = clamp(canvas.height*0.78, pad, canvas.height-pad);
  const topY    = clamp(canvas.height*0.19, pad, canvas.height-pad);
  const midY    = (baseY + topY)/2;
  const arcRadius = clamp(canvas.width*0.28, 80, canvas.width*0.40);
  const cxL = clamp(canvas.width*0.29, pad, canvas.width-pad);
  const cxR = clamp(canvas.width*0.715, pad, canvas.width-pad);
  starRadius = clamp(canvas.width*0.023, 22, 44);

  rainbowStars = [];
  const deg = Math.PI/180, thetaStart=115*deg, thetaEnd=65*deg;
  for (let i=0;i<N;i++){
    const t = thetaStart + (thetaEnd-thetaStart)*(i/(N-1));
    rainbowStars.push({ x: clamp(cxL + arcRadius*Math.cos(t), pad, canvas.width-pad), y: clamp(midY - arcRadius*Math.sin(t), pad, canvas.height-pad), hit:false, number:i+1, side:SIDE.L, color:'#4da3ff' });
    rainbowStars.push({ x: clamp(cxR - arcRadius*Math.cos(t), pad, canvas.width-pad), y: clamp(midY - arcRadius*Math.sin(t), pad, canvas.height-pad), hit:false, number:i+1, side:SIDE.R, color:'#ff6fb0' });
  }
  ascending = true; currentStepL = 0; currentStepR = 0;
}

function drawRainbowStars(){
  for (let i=0;i<rainbowStars.length;i++){
    const s = rainbowStars[i];
    ctx.save();
    ctx.globalAlpha = s.hit ? 0.18 : 1;
    ctx.fillStyle = s.color;
    starPath(s.x, s.y, 5, starRadius, starRadius*0.44);
    ctx.fill();
    ctx.lineWidth = 2.1; ctx.strokeStyle = '#fff'; ctx.stroke();

    const numSize = Math.max(20, starRadius * 1.02);
    ctx.font = `700 ${numSize}px ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.lineWidth = Math.max(3, numSize*0.12);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(String(s.number), s.x, s.y);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(s.number), s.x, s.y);
    ctx.restore();
  }
}

// STRICT one-by-one popping with a slight (~2%) leniency
function updateRainbowBilateralHits(lm, introActive){
  if (introActive) return;

  const LW = lm?.[15], RW = lm?.[16];
  if (!visOK(LW) && !visOK(RW)) return;

  // only current star on each side
  const idxL = currentStepL * 2;        // 0,2,4,6
  const idxR = currentStepR * 2 + 1;    // 1,3,5,7
  const targetL = rainbowStars[idxL];
  const targetR = rainbowStars[idxR];

  // hit radius = starRadius + 38 (just a touch more sensitive than baseline)
  const HIT_PAD = 38;
  const thresh  = starRadius + HIT_PAD;

  if (targetL && visOK(LW) && !targetL.hit){
    const pL = toPix(LW);
    if (dist(pL, targetL) <= thresh){
      targetL.hit = true;
      starCount++; score += 5; streak++; playDing();
      currentStepL += (ascending ? 1 : -1);
    }
  }

  if (targetR && visOK(RW) && !targetR.hit){
    const pR = toPix(RW);
    if (dist(pR, targetR) <= thresh){
      targetR.hit = true;
      starCount++; score += 5; streak++; playDing();
      currentStepR += (ascending ? 1 : -1);
    }
  }

  currentStepL = Math.max(0, Math.min(4, currentStepL));
  currentStepR = Math.max(0, Math.min(4, currentStepR));

  // Up run done → switch to down
  if (ascending && currentStepL >= 4 && currentStepR >= 4){
    ascending=false; currentStepL=3; currentStepR=3;
    coach("Great! Lower arms to catch 4→1.");
    for (const s of rainbowStars) s.hit=false;
  }

  // Down run finished → count a rep
  if (!ascending && currentStepL < 1 && currentStepR < 1){
    score += 20; streak++;
    incrementRep();
    if (repCount < (currentExercise?.repetitions_target || 2)){
      coach("Rep done — raise again!");
      setTimeout(()=>{ for (const s of rainbowStars) s.hit=false; ascending=true; currentStepL=0; currentStepR=0; }, 500);
    }
  }

  if (scoreEl)  scoreEl.textContent  = score;
  if (streakEl) streakEl.textContent = streak;
  if (starsEl)  starsEl.textContent  = starCount;
}

// ---------- Flow ----------
let _switching = false;
function goToExercise(index){
  if (_switching) return;
  _switching = true;

  currentExerciseIndex = Math.max(0, Math.min(exercises.length-1, index));
  currentExercise = exercises[currentExerciseIndex];

  const name = currentExercise?.name ?? '—';
  const desc = currentExercise?.description ?? '';
  coach(`Next: ${name} — ${desc}`);
  setTimeout(()=> coach(''), 900);

  status(`Exercise: ${name}`);
  resetPerExercise();

  if (isAbduction(currentExercise)) setupRainbowStars(true);

  showIntroForExercise(currentExercise);

  if (nextBtn) nextBtn.disabled = (currentExerciseIndex >= exercises.length - 1);

  setTimeout(()=>{ _switching = false; }, 80);
}

// ---------- Camera & Pose ----------
async function openCameraWithFallbacks(){
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('getUserMedia not supported');
  if (location.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)){
    status('⚠️ Use HTTPS or localhost for camera access.');
  }
  const tries = [
    { video: { facingMode:{ideal:'user'}, width:{ideal:1280}, height:{ideal:720} }, audio:false },
    { video: { facingMode:'user' }, audio:false },
    { video: true, audio:false },
  ];
  let lastErr;
  for (const c of tries){
    try { return await navigator.mediaDevices.getUserMedia(c); } catch(e){ lastErr = e; }
  }
  throw lastErr || new Error('Unable to open camera');
}

function setCanvasSize(){
  const targetW = video.videoWidth  || 640;
  const targetH = video.videoHeight || 480;
  canvas.width  = targetW;
  canvas.height = targetH;
  // if currently on abduction, recompute layout
  if (isAbduction()) setupRainbowStars(false);
}

let pose = null;
async function start(){
  if (running) return; running = true;
  try{
    status('requesting camera…');
    const stream = await openCameraWithFallbacks();
    video.srcObject = stream;

    await new Promise(res=>{
      if (video.readyState >= 1) return res();
      video.addEventListener('loadedmetadata', res, {once:true});
    });
    await video.play().catch(()=>{});

    setCanvasSize();
    window.addEventListener('resize', setCanvasSize);

    goToExercise(0);
    renderLoop();
    status('camera ready');

    const PoseCtor =
      (window.Pose && window.Pose.Pose) ? window.Pose.Pose :
      (window.Pose) ? window.Pose :
      (window.pose && window.pose.Pose) ? window.pose.Pose :
      null;

    if (!PoseCtor){ status('ERROR: Pose constructor not found'); return; }

    pose = new PoseCtor({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}` });
    pose.setOptions({
      modelComplexity: PERF.LOW ? 0 : 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    pose.onResults(({ poseLandmarks })=> { latestLm = poseLandmarks || null; });

    if (typeof Camera === 'function'){
      const cam = new Camera(video, { onFrame: async () => { await pose.send({ image: video }); }, width: canvas.width, height: canvas.height });
      cam.start(); status('running…');
    } else {
      (async function loop(){ await pose.send({ image: video }); requestAnimationFrame(loop); })();
      status('running…');
    }
  }catch(e){
    let errorMsg = 'Camera Error: ';
    if (e.name === 'NotAllowedError') errorMsg += 'Camera permission denied.';
    else if (e.name === 'NotFoundError') errorMsg += 'No camera found.';
    else if (e.name === 'NotReadableError') errorMsg += 'Camera in use.';
    else if (e.name === 'OverconstrainedError') errorMsg += 'Camera constraints not supported.';
    else errorMsg += e?.message || e;
    status(errorMsg);
    running=false;
  }
}

// ---------- Main Render Loop ----------
function renderLoop(){
  const now = performance.now();
  if (now - _lastDrawAt < FRAME_MS) { requestAnimationFrame(renderLoop); return; }
  const dt = (now - _prevNow)/1000; _prevNow = now; _lastDrawAt = now;

  // 1) draw mirrored camera
  drawCameraFrame();

  // 2) intro overlay (sticky gating)
  const introActive = introIsActive(now);
  if (introActive) drawIntroOverlay(now);

  // 3) overlays and logic
  if (latestLm){
    if (currentExercise?.showShoulderLine) drawShoulderLocator(latestLm);

    if (celebrationActive){
      spawnSingleStar(now);                    // falling finish star
      updateCoachTargets(latestLm, dt, now, introActive);
      drawStarsAndUI(now);
    } else if (isAbduction()){
      updateRainbowBilateralHits(latestLm, introActive);
      drawRainbowStars();
    } else {
      if (!introActive && currentExercise?.criteria === 'overheadPress'){
        const out = criteriaOverheadPress(latestLm);
        if (out && out.rep_completed){ score += 10; streak++; playDing(); incrementRep(); }
      }
      spawnSingleStar(now);                    // front reach targets
      updateCoachTargets(latestLm, dt, now, introActive);
      drawStarsAndUI(now);
    }
  }

  requestAnimationFrame(renderLoop);
}

// update stars (front reach + finish star)
function updateCoachTargets(lm, dt, now, introActive){
  if (introActive) return;

  for (let i=stars.length-1;i>=0;i--){
    const star = stars[i];

    // fall to target
    if (star.y < star.targetY){
      star.y += NOTE_SPEED_PX_S * dt;
      if (star.y >= star.targetY) star.y = star.targetY;
    }

    const LW = visOK(lm[15]) ? toPix(lm[15]) : null;
    const RW = visOK(lm[16]) ? toPix(lm[16]) : null;
    const LP = palmPix(lm, 'left');
    const RP = palmPix(lm, 'right');

    const wasInside = star.inside;
    star.inside = computeInside(star, LW, RW, LP, RP);
    if (star.inside && !wasInside) star.holdStart = now;

    if (star.inside && !star.hit && (now - star.holdStart) >= (star.holdMs || HOLD_MS_DEFAULT)) {
  star.hit = true;
  star.label = "WELL DONE";
  star.hitAt = now;
  playDing();

  if (celebrationActive) {
    // let the burst animation finish, then redirect
    setTimeout(endSession, 1000);
  } else {
    score += 15;
    streak++;
    combo++;
    incrementRep();
    nextAllowedSpawnAt = now + NEXT_DELAY_MS;
  }
}

  }

  if (scoreEl)  scoreEl.textContent  = score;
  if (streakEl) streakEl.textContent = streak;
  if (starsEl)  starsEl.textContent  = starCount;
}

// tiny ping
let audioCtx=null;
function playDing(){
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type='sine'; o.frequency.value=880; o.connect(g); g.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.6,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+0.25);
    o.start(t); o.stop(t+0.26);
  }catch{}
}

// ---------- Buttons ----------
if (startBtn) startBtn.addEventListener('click', start);
if (nextBtn){
  nextBtn.addEventListener('click', ()=>{
    if (currentExerciseIndex >= exercises.length - 1 && !celebrationActive){
      startCelebrationStar();
    } else {
      goToExercise(currentExerciseIndex + 1);
    }
  });
}

// auto-start if requested
if (window.AUTO_START) {
  // don't block UI thread; wait a tick for DOM
  setTimeout(()=> startBtn?.click(), 80);
}

// init
updateExerciseInfo();
status('Ready. Click Start when you are set.');
