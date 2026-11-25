/* ConfiDentist — GPU tooth particle sculpture (WebGL2, no dependencies).
 * Reusable: add <div id="ndHeroVisual" class="nd-hero-visual"> (with an optional fallback
 * <svg> inside) to any page, include /_assets/ndecc/enhance.css (or equivalent sizing CSS)
 * and load this script. Showcase/demo: /lab/tooth-particles/
 *
 * A dental-inspired particle sculpture (stylized molar) rendered with a GPU particle
 * system:
 *   • Shape: random points are projected onto a molar signed-distance function (SDF)
 *     in a fragment shader → a "target" texture (computed once, on the GPU).
 *   • Simulation: position + velocity live in float/half-float textures and are
 *     updated with ping-pong framebuffers (MRT). Forces: spring back to the target,
 *     curl-noise drift, and a screen-space fluid velocity field driven by the cursor.
 *   • Fluid: a small ping-pong velocity texture — cursor movement is splatted in,
 *     advected and dissipated each frame; particles sample it by projecting to screen.
 *   • Render: points drawn from the position texture (gl_VertexID), soft round sprites,
 *     additive blending, fake directional lighting and sparse twinkling sparkles.
 *
 * Adaptive: particle count + pixel ratio by device tier, runtime frame-time downshift,
 * paused when off-screen or the tab is hidden, no pointer interaction on touch,
 * static SVG fallback when WebGL2/float render targets are unavailable or the user
 * prefers reduced motion. All page content works without this script.
 */
(function () {
  'use strict';
  var host = document.getElementById('ndHeroVisual');
  if (!host) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return; // keep the static SVG

  var canvas = document.createElement('canvas');
  canvas.className = 'nd-hero-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  var gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl) return;
  var floatExt = gl.getExtension('EXT_color_buffer_float');
  var halfExt = floatExt ? null : gl.getExtension('EXT_color_buffer_half_float');
  if (!floatExt && !halfExt) return;
  var SIM_INTERNAL = floatExt ? gl.RGBA32F : gl.RGBA16F;
  var SIM_TYPE = floatExt ? gl.FLOAT : gl.HALF_FLOAT;

  // ── Device tier → particle texture size (N×N particles) and pixel ratio ──
  var coarse = window.matchMedia('(pointer: coarse)').matches;
  var small = Math.min(window.innerWidth, window.innerHeight) < 700;
  var cores = navigator.hardwareConcurrency || 4;
  var mem = navigator.deviceMemory || 4;
  var N;
  if (coarse || small) N = cores >= 8 && mem >= 6 ? 160 : 112;      // 25.6k / 12.5k
  else if (cores >= 8 && mem >= 8) N = 320;                         // 102k
  else if (cores >= 6) N = 256;                                     // 65k
  else N = 192;                                                     // 37k
  // Testing aid: ?ndN=<size> forces the particle texture size (e.g. 64 → 4,096 particles).
  var qN = parseInt(new URLSearchParams(location.search).get('ndN') || '', 10);
  if (qN >= 32 && qN <= 512) N = qN;
  var maxDpr = coarse || small ? 1.5 : 1.75;
  var dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  var interactive = !coarse && window.matchMedia('(hover: hover)').matches;
  var FLUID = interactive ? 128 : 0;

  // ── GL helpers ──
  function sh(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function prog(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    p.u = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); p.u[info.name] = gl.getUniformLocation(p, info.name); }
    return p;
  }
  function tex(w, h, internal, type, filter) {
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function fbo(textures) {
    var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    var bufs = [];
    textures.forEach(function (t, i) { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0); bufs.push(gl.COLOR_ATTACHMENT0 + i); });
    gl.drawBuffers(bufs);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fbo incomplete');
    return f;
  }

  var QUAD_VS = '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}';

  var NOISE = [
    'vec3 hash3(vec3 p){p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yxz+33.33);return fract((p.xxy+p.yxx)*p.zyx);}',
    'float hash1(float n){return fract(sin(n)*43758.5453123);}',
    // 3D value-noise based smooth vector field and its curl
    'vec3 snoiseVec(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);',
    ' vec3 a=hash3(i),b=hash3(i+vec3(1,0,0)),c=hash3(i+vec3(0,1,0)),d=hash3(i+vec3(1,1,0));',
    ' vec3 e=hash3(i+vec3(0,0,1)),g=hash3(i+vec3(1,0,1)),h=hash3(i+vec3(0,1,1)),k=hash3(i+vec3(1,1,1));',
    ' return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,g,f.x),mix(h,k,f.x),f.y),f.z)*2.0-1.0;}',
    'vec3 curl(vec3 p){const float e=.12;',
    ' vec3 dx=vec3(e,0,0),dy=vec3(0,e,0),dz=vec3(0,0,e);',
    ' vec3 px0=snoiseVec(p-dx),px1=snoiseVec(p+dx),py0=snoiseVec(p-dy),py1=snoiseVec(p+dy),pz0=snoiseVec(p-dz),pz1=snoiseVec(p+dz);',
    ' float x=(py1.z-py0.z)-(pz1.y-pz0.y),y=(pz1.x-pz0.x)-(px1.z-px0.z),z=(px1.y-px0.y)-(py1.x-py0.x);',
    ' return vec3(x,y,z)/(2.0*e);}'
  ].join('\n');

  // Stylized molar SDF: rounded crown + 4 cusps + occlusal fissure, smooth-blended
  // into two tapering roots.
  var SDF = [
    'float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}',
    'float smax(float a,float b,float k){return -smin(-a,-b,k);}',
    'float sdRoundBox(vec3 p,vec3 b,float r){vec3 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.)-r;}',
    'float sdRoundCone(vec3 p,vec3 a,vec3 b,float r1,float r2){vec3 ba=b-a;float l2=dot(ba,ba);float rr=r1-r2;float a2=l2-rr*rr;float il2=1./l2;',
    ' vec3 pa=p-a;float y=dot(pa,ba);float z=y-l2;vec3 xv=pa*l2-ba*y;float x2=dot(xv,xv);float y2=y*y*l2;float z2=z*z*l2;',
    ' float k=sign(rr)*rr*rr*x2;if(sign(z)*a2*z2>k)return sqrt(x2+z2)*il2-r2;if(sign(y)*a2*y2<k)return sqrt(x2+y2)*il2-r1;',
    ' return (sqrt(x2*a2*il2)+y*rr)*il2-r1;}',
    'float sdTooth(vec3 p){',
    ' p.y-=.05;',
    ' float crown=sdRoundBox(p-vec3(0.,.42,0.),vec3(.62,.34,.5),.28);',
    ' float c1=length(p-vec3(.30,.74,.24))-.24,c2=length(p-vec3(-.30,.74,.24))-.24;',
    ' float c3=length(p-vec3(.30,.72,-.22))-.23,c4=length(p-vec3(-.30,.72,-.22))-.23;',
    ' float d=smin(crown,min(min(c1,c2),min(c3,c4)),.16);',
    ' d=smax(d,-(length(p-vec3(0.,.98,0.))-.2),.12);',               // central fissure
    ' float r1=sdRoundCone(p,vec3(.27,.12,.02),vec3(.36,-1.02,.06),.24,.07);',
    ' float r2=sdRoundCone(p,vec3(-.27,.12,.02),vec3(-.34,-.98,-.04),.24,.07);',
    ' d=smin(d,min(r1,r2),.2);',
    ' return d;}',
    'vec3 nTooth(vec3 p){const float e=.004;return normalize(vec3(sdTooth(p+vec3(e,0,0))-sdTooth(p-vec3(e,0,0)),sdTooth(p+vec3(0,e,0))-sdTooth(p-vec3(0,e,0)),sdTooth(p+vec3(0,0,e))-sdTooth(p-vec3(0,0,e))));}'
  ].join('\n');

  // Target shape: project hashed points onto the SDF surface; a few shell/interior
  // points for depth and a sparse halo for sparkle. w = per-particle seed.
  var SHAPE_FS = '#version 300 es\nprecision highp float;\n' + NOISE + '\n' + SDF + '\n' +
    'uniform float uN;out vec4 o;\n' +
    'void main(){vec2 id=floor(gl_FragCoord.xy);vec3 r=hash3(vec3(id,7.31));float seed=hash3(vec3(id.yx,1.7)).x;\n' +
    ' vec3 p=(r*2.-1.)*vec3(1.,1.3,.85);p.y+=.05;\n' +
    ' if(seed<.035){vec3 dir=normalize(hash3(vec3(id,3.1))*2.-1.);o=vec4(dir*(1.35+hash1(seed*91.)*.45)*vec3(1.,.95,.8),seed);return;}\n' +
    ' for(int i=0;i<14;i++){float d=sdTooth(p);p-=nTooth(p)*d;}\n' +
    ' if(seed<.38)p-=nTooth(p)*(.02+pow(hash1(seed*313.),1.6)*.32);\n' +
    ' o=vec4(p,seed);}';

  var SIM_FS = '#version 300 es\nprecision highp float;\n' + NOISE + '\n' +
    'uniform sampler2D uPos,uVel,uTarget,uFluid;uniform mat4 uMVP;uniform float uTime,uDt,uSpring,uFluidOn;\n' +
    'layout(location=0) out vec4 oPos;layout(location=1) out vec4 oVel;\n' +
    'void main(){ivec2 c=ivec2(gl_FragCoord.xy);vec4 P=texelFetch(uPos,c,0);vec3 v=texelFetch(uVel,c,0).xyz;vec4 T=texelFetch(uTarget,c,0);\n' +
    ' vec3 p=P.xyz;float seed=T.w;bool halo=seed<.035;\n' +
    ' vec3 toT=T.xyz-p;v+=toT*uSpring*(halo?.35:1.)*uDt;\n' +
    ' vec3 cn=curl(p*1.15+vec3(0.,uTime*.07,uTime*.05));v+=cn*(halo?.55:.16)*uDt;\n' +
    ' if(uFluidOn>.5){vec4 cl=uMVP*vec4(p,1.);vec2 uv=cl.xy/cl.w*.5+.5;\n' +
    '  if(uv.x>0.&&uv.x<1.&&uv.y>0.&&uv.y<1.){vec2 f=texture(uFluid,uv).xy;float m=length(f);\n' +
    '   v.xy+=f*5.5*uDt;v+=curl(p*3.1+uTime*.3)*m*2.2*uDt;}}\n' +
    ' v*=exp(-3.2*uDt);p+=v*uDt;\n' +
    ' oPos=vec4(p,1.);oVel=vec4(v,0.);}';

  var FLUID_FS = '#version 300 es\nprecision highp float;\n' +
    'uniform sampler2D uPrev;uniform vec2 uMouse,uDelta;uniform float uDt,uAspect,uSplat;out vec4 o;\n' +
    'void main(){vec2 uv=gl_FragCoord.xy/vec2(textureSize(uPrev,0));vec2 v=texture(uPrev,uv-texture(uPrev,uv).xy*uDt*.6).xy;\n' +
    ' v*=exp(-2.4*uDt);vec2 d=uv-uMouse;d.x*=uAspect;v+=uDelta*exp(-dot(d,d)/.0035)*uSplat;\n' +
    ' o=vec4(clamp(v,-4.,4.),0.,1.);}';

  var RENDER_VS = '#version 300 es\nprecision highp float;\n' +
    'uniform sampler2D uPos,uTarget;uniform mat4 uMVP;uniform mat3 uRot;uniform float uN,uSize,uTime,uFade;\n' +
    'out vec3 vCol;out float vA;\n' +
    'float h1(float n){return fract(sin(n)*43758.5453);}\n' +
    'void main(){int id=gl_VertexID;ivec2 c=ivec2(id%int(uN),id/int(uN));vec3 p=texelFetch(uPos,c,0).xyz;float seed=texelFetch(uTarget,c,0).w;\n' +
    ' vec4 cl=uMVP*vec4(p,1.);gl_Position=cl;\n' +
    ' vec3 n=normalize(uRot*(p-vec3(0.,.05,0.)));float light=clamp(dot(n,normalize(vec3(-.45,.65,.6)))*.5+.55,.15,1.15);\n' +
    // brand palette: light blue #5cb2f7, brand blue #0f7ae5, teal #3BAFBF, white
    ' vec3 c1=vec3(.36,.70,.97),c2=vec3(.06,.48,.90),c3=vec3(.23,.69,.75),w=vec3(1.);\n' +
    ' float s=h1(seed*97.13);vec3 col=s<.55?c1:(s<.82?c2:(s<.93?c3:w));\n' +
    ' col=mix(col,w,smoothstep(.8,1.15,light)*.55)*light;\n' +
    ' float tw=h1(seed*531.7);float sparkle=tw>.985?pow(.5+.5*sin(uTime*(2.+tw*3.)+seed*60.),8.):0.;\n' +
    ' float depth=clamp(1.-(cl.w-4.2)/2.6,.25,1.);\n' +
    ' bool halo=seed<.035;\n' +
    ' gl_PointSize=uSize*(.55+h1(seed*13.1)*.9)*(4.8/cl.w)*(1.+sparkle*2.2)*(halo?.8:1.);\n' +
    ' vCol=mix(col,w,sparkle);vA=(halo?.35:.62)*depth*uFade+sparkle*.6;}';

  var RENDER_FS = '#version 300 es\nprecision mediump float;in vec3 vCol;in float vA;out vec4 o;\n' +
    'void main(){vec2 q=gl_PointCoord*2.-1.;float r=dot(q,q);if(r>1.)discard;float a=exp(-r*3.2)*vA;o=vec4(vCol*a,a);}';

  var pShape, pSim, pFluid, pRender;
  try {
    pShape = prog(QUAD_VS, SHAPE_FS); pSim = prog(QUAD_VS, SIM_FS);
    pRender = prog(RENDER_VS, RENDER_FS);
    if (FLUID) pFluid = prog(QUAD_VS, FLUID_FS);
  } catch (e) { console.warn('[ndecc hero] WebGL unavailable:', e.message); return; }

  var vao = gl.createVertexArray(); gl.bindVertexArray(vao);

  // ── Resources ──
  var tTarget, tPos = [], tVel = [], fSim = [], tFluid = [], fFluid = [];
  try {
    tTarget = tex(N, N, SIM_INTERNAL, SIM_TYPE, gl.NEAREST);
    for (var i = 0; i < 2; i++) {
      tPos[i] = tex(N, N, SIM_INTERNAL, SIM_TYPE, gl.NEAREST);
      tVel[i] = tex(N, N, SIM_INTERNAL, SIM_TYPE, gl.NEAREST);
      fSim[i] = fbo([tPos[i], tVel[i]]);
    }
    if (FLUID) for (var j = 0; j < 2; j++) { tFluid[j] = tex(FLUID, FLUID, gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR); fFluid[j] = fbo([tFluid[j]]); }
    var fTarget = fbo([tTarget]);
  } catch (e) { console.warn('[ndecc hero] render targets unavailable:', e.message); return; }

  // Bake the target shape once.
  gl.bindFramebuffer(gl.FRAMEBUFFER, fTarget); gl.viewport(0, 0, N, N);
  gl.useProgram(pShape); gl.uniform1f(pShape.u.uN, N); gl.drawArrays(gl.TRIANGLES, 0, 3);
  // Initial positions: a wide scattered cloud (assembles into the tooth on load).
  var init = new Float32Array(N * N * 4), zeros = new Float32Array(N * N * 4);
  for (var k = 0; k < N * N; k++) {
    var u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rr = 2.2 + Math.random() * 2.2, s = Math.sqrt(1 - u * u);
    init[k * 4] = rr * s * Math.cos(th); init[k * 4 + 1] = rr * u; init[k * 4 + 2] = rr * s * Math.sin(th); init[k * 4 + 3] = 1;
  }
  function upload(t, data) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (SIM_TYPE === gl.FLOAT) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.FLOAT, data);
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.FLOAT, data); // WebGL2 converts FLOAT → HALF_FLOAT storage
  }
  try { upload(tPos[0], init); upload(tVel[0], zeros); }
  catch (e) { console.warn('[ndecc hero] upload failed'); return; }
  init = zeros = null;

  // ── Matrices ──
  function persp(fovy, asp, n, f) { var t = 1 / Math.tan(fovy / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; }
  function mul(a, b) { var o = new Array(16); for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { var s2 = 0; for (var q = 0; q < 4; q++) s2 += a[q * 4 + r] * b[c * 4 + q]; o[c * 4 + r] = s2; } return o; }
  function lookAt(e, t) { var z = norm([e[0] - t[0], e[1] - t[1], e[2] - t[2]]), x = norm(cross([0, 1, 0], z)), y = cross(z, x); return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]; }
  function rotY(a) { var c = Math.cos(a), s2 = Math.sin(a); return [c, 0, -s2, 0, 0, 1, 0, 0, s2, 0, c, 0, 0, 0, 0, 1]; }
  function rotX(a) { var c = Math.cos(a), s2 = Math.sin(a); return [1, 0, 0, 0, 0, c, s2, 0, 0, -s2, c, 0, 0, 0, 0, 1]; }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  // ── Sizing ──
  host.appendChild(canvas);
  var W = 1, H = 1;
  function resize() {
    var r = host.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr));
    canvas.width = W; canvas.height = H;
  }
  resize();
  var ro = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(host); else window.addEventListener('resize', resize);

  // ── Pointer (desktop only) → camera parallax + fluid splats ──
  var mouse = { x: .5, y: .5, px: .5, py: .5, inside: false }, cam = { x: 0, y: 0 };
  if (interactive) {
    var hero = host.closest('.hero') || host;
    hero.addEventListener('pointermove', function (e) {
      var r = host.getBoundingClientRect();
      mouse.x = (e.clientX - r.left) / r.width; mouse.y = 1 - (e.clientY - r.top) / r.height;
      mouse.inside = mouse.x > -.1 && mouse.x < 1.1 && mouse.y > -.1 && mouse.y < 1.1;
    }, { passive: true });
    hero.addEventListener('pointerleave', function () { mouse.inside = false; }, { passive: true });
  }

  // ── Loop ──
  var cur = 0, fcur = 0, t0 = performance.now(), last = t0, running = false, raf = 0, visible = true, onscreen = true;
  var fade = 0, drawCount = N * N, frames = 0, slowFrames = 0, downshifted = false;
  gl.disable(gl.DEPTH_TEST);

  function frame(now) {
    raf = 0;
    var dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    var t = (now - t0) / 1000;
    frames++;
    // Runtime downshift: if the first ~2s run slow, lower resolution, then draw fewer particles.
    if (frames > 20 && frames < 140 && dt > 0.026) slowFrames++;
    if (!downshifted && frames === 140 && slowFrames > 50) {
      downshifted = true; dpr = 1; resize(); drawCount = Math.floor(N * N * 0.55);
    }

    // Camera / model
    var tx = interactive && mouse.inside ? (mouse.x - .5) : 0, ty = interactive && mouse.inside ? (mouse.y - .5) : 0;
    cam.x += (tx * .55 - cam.x) * Math.min(1, dt * 2.2); cam.y += (ty * .35 - cam.y) * Math.min(1, dt * 2.2);
    var asp = W / H;
    var P = persp(0.62, asp, 0.1, 30);
    var V = lookAt([cam.x * 1.4, .25 + cam.y * 1.1, 5.4], [0, .05, 0]);
    var Mrot = mul(rotY(t * 0.16 + Math.sin(t * .23) * .25), rotX(0.18 + Math.sin(t * .31) * .05));
    var M = mul(Mrot, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, Math.sin(t * .7) * .04, 0, 1]); // gentle float
    var MVP = mul(P, mul(V, M));
    var R3 = [Mrot[0], Mrot[1], Mrot[2], Mrot[4], Mrot[5], Mrot[6], Mrot[8], Mrot[9], Mrot[10]];

    // Fluid
    if (FLUID) {
      var dx = (mouse.x - mouse.px) / Math.max(dt, 1e-3), dy = (mouse.y - mouse.py) / Math.max(dt, 1e-3);
      mouse.px = mouse.x; mouse.py = mouse.y;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fFluid[1 - fcur]); gl.viewport(0, 0, FLUID, FLUID);
      gl.useProgram(pFluid);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tFluid[fcur]); gl.uniform1i(pFluid.u.uPrev, 0);
      gl.uniform2f(pFluid.u.uMouse, mouse.x, mouse.y); gl.uniform2f(pFluid.u.uDelta, dx * .08, dy * .08);
      gl.uniform1f(pFluid.u.uDt, dt); gl.uniform1f(pFluid.u.uAspect, asp); gl.uniform1f(pFluid.u.uSplat, mouse.inside ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3); fcur = 1 - fcur;
    }

    // Simulation (ping-pong, MRT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fSim[1 - cur]); gl.viewport(0, 0, N, N);
    gl.useProgram(pSim);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tPos[cur]); gl.uniform1i(pSim.u.uPos, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tVel[cur]); gl.uniform1i(pSim.u.uVel, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tTarget); gl.uniform1i(pSim.u.uTarget, 2);
    if (FLUID) { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tFluid[fcur]); gl.uniform1i(pSim.u.uFluid, 3); }
    gl.uniformMatrix4fv(pSim.u.uMVP, false, MVP);
    gl.uniform1f(pSim.u.uTime, t); gl.uniform1f(pSim.u.uDt, dt);
    gl.uniform1f(pSim.u.uSpring, 3.2 + Math.min(t, 2.5) * 2.4); // assemble → firmer hold
    gl.uniform1f(pSim.u.uFluidOn, FLUID ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3); cur = 1 - cur;

    // Render
    fade = Math.min(1, fade + dt * .9);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(pRender);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tPos[cur]); gl.uniform1i(pRender.u.uPos, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tTarget); gl.uniform1i(pRender.u.uTarget, 1);
    gl.uniformMatrix4fv(pRender.u.uMVP, false, MVP); gl.uniformMatrix3fv(pRender.u.uRot, false, R3);
    gl.uniform1f(pRender.u.uN, N); gl.uniform1f(pRender.u.uTime, t); gl.uniform1f(pRender.u.uFade, fade);
    gl.uniform1f(pRender.u.uSize, (N >= 256 ? 2.1 : N >= 192 ? 2.5 : 2.9) * dpr * Math.min(1.3, H / 620));
    gl.drawArrays(gl.POINTS, 0, drawCount);
    gl.disable(gl.BLEND);

    if (frames === 2) host.classList.add('nd-gl-live'); // crossfade from the static SVG
    if ((frames & 31) === 0) host.setAttribute('data-frames', frames);
    if (running) raf = requestAnimationFrame(frame);
  }
  function start() { if (running || !visible || !onscreen) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

  document.addEventListener('visibilitychange', function () { visible = !document.hidden; visible ? start() : stop(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { onscreen = en[0].isIntersecting; onscreen ? start() : stop(); }, { rootMargin: '80px' }).observe(host);
  }
  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); stop(); host.classList.remove('nd-gl-live'); });

  // Dispose GPU resources when the page is torn down.
  window.addEventListener('pagehide', function (e) {
    if (e.persisted) { stop(); return; }
    stop();
    [tTarget].concat(tPos, tVel, tFluid).forEach(function (t) { if (t) gl.deleteTexture(t); });
    [fTarget].concat(fSim, fFluid).forEach(function (f) { if (f) gl.deleteFramebuffer(f); });
    [pShape, pSim, pFluid, pRender].forEach(function (p) { if (p) gl.deleteProgram(p); });
    var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) start(); });

  start();
})();
