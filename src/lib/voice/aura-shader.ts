/** Fragment shader for the Voice aura: flowing ribbons, a glassy fluid sphere and a soft halo. */
export const AURA_VERTEX = `attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const AURA_FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uEnergy;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

// One flowing ribbon: soft glow plus a thin bright core.
vec3 ribbon(vec2 p, float base, float amp, float freq, float speed, float phase, float width, float seed) {
  float spread = 0.06 + 0.94 * smoothstep(0.18, 0.95, abs(p.x));
  float y = base
    + amp * spread * sin(p.x * freq + uTime * speed + phase)
    + 0.55 * amp * spread * sin(p.x * freq * 2.13 - uTime * speed * 0.72 + phase * 1.7)
    + 0.25 * amp * spread * sin(p.x * freq * 0.5 + uTime * speed * 0.4 + seed);
  float d = abs(p.y - y);
  float soft = exp(-(d * d) / (width * width * 9.0));
  float core = exp(-(d * d) / (width * width * 0.35));
  float k = 0.5 + 0.5 * sin(p.x * 1.6 + seed + uTime * 0.2);
  vec3 col = mix(vec3(0.64, 0.30, 1.0), vec3(0.22, 0.56, 1.0), k);
  return col * (soft * 0.42 + core * 0.95);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float e = uEnergy;
  float speed = 1.0 + 1.6 * e;
  float T = uTime * speed;
  vec3 col = vec3(0.0);

  // Halo behind everything.
  float rr = length(p);
  col += vec3(0.38, 0.26, 0.95) * exp(-rr * 3.4) * (0.5 + 0.25 * e);
  col += vec3(0.1, 0.35, 0.95) * exp(-length(p - vec2(0.18, -0.08)) * 3.0) * 0.32;

  // Ribbons sweeping across the full width.
  float amp = 0.075 + 0.05 * e;
  col += ribbon(p, 0.02, amp, 3.1, 0.55 * speed, 0.0, 0.010, 0.4);
  col += ribbon(p, -0.03, amp * 1.15, 2.4, -0.42 * speed, 1.9, 0.012, 1.3);
  col += ribbon(p, 0.06, amp * 0.9, 3.8, 0.7 * speed, 3.1, 0.009, 2.2) * 0.85;
  col += ribbon(p, -0.07, amp * 1.3, 1.9, 0.36 * speed, 4.4, 0.014, 3.0) * 0.8;
  col += ribbon(p, 0.10, amp * 0.7, 4.6, -0.6 * speed, 5.2, 0.008, 4.1) * 0.6;
  col += ribbon(p, -0.01, amp * 1.6, 1.5, 0.3 * speed, 0.7, 0.018, 5.3) * 0.5;

  // Sphere with a gently breathing, organic outline.
  float ang = atan(p.y, p.x);
  float R = 0.305 * (1.0
    + 0.016 * sin(3.0 * ang + T * 0.5)
    + 0.012 * sin(2.0 * ang - T * 0.4 + 1.0)
    + 0.004 * sin(5.0 * ang + T * 0.9)) * (1.0 + 0.025 * e * sin(uTime * 5.0));
  float r = length(p);
  float inside = smoothstep(R, R - 0.006, r);
  vec2 q = p / R;
  float q2 = clamp(dot(q, q), 0.0, 1.0);
  float z = sqrt(1.0 - q2);
  vec3 n = vec3(q, z);

  // Fluid interior: domain-warped noise tinted blue, violet and cyan.
  float t = uTime * (0.10 + 0.22 * e);
  vec2 w = q * 1.05 + vec2(0.0, t);
  vec2 wq = vec2(fbm(w + vec2(0.0, t * 1.3)), fbm(w + vec2(5.2, 1.3) - t));
  float f = fbm(w + 2.4 * wq + vec2(t, -t * 0.6));
  vec3 c = vec3(0.025, 0.035, 0.14);
  c = mix(c, vec3(0.12, 0.18, 0.78), smoothstep(0.28, 0.72, f));
  c = mix(c, vec3(0.58, 0.26, 0.96), smoothstep(0.45, 0.86, wq.x) * 0.85);
  c += vec3(0.08, 0.72, 1.0) * smoothstep(0.6, 0.9, f) * 0.55;
  c += vec3(0.95, 0.4, 1.0) * smoothstep(0.7, 0.95, wq.y) * 0.3;
  float lines = pow(abs(sin(f * 7.0 + t * 2.0)), 90.0);
  c += vec3(0.65, 0.85, 1.0) * lines * 0.08 * (0.3 + z);
  c += vec3(0.3, 0.45, 1.0) * smoothstep(0.35, 0.8, f) * 0.15 * z;

  // Glass rim lighting.
  float fres = pow(1.0 - z, 2.4);
  vec3 rimCol = mix(vec3(0.42, 0.85, 1.0), vec3(0.82, 0.46, 1.0), 0.5 + 0.5 * sin(ang * 1.0 + uTime * 0.3));
  c += rimCol * fres * (1.2 + 0.7 * e);
  float edge = smoothstep(0.925, 1.0, sqrt(q2));
  c += rimCol * edge * (0.9 + 0.6 * e);
  c += vec3(0.85, 0.92, 1.0) * pow(max(0.0, dot(normalize(n), normalize(vec3(-0.55, 0.62, 0.62)))), 26.0) * 0.55;
  c += vec3(0.5, 0.7, 1.0) * pow(max(0.0, dot(normalize(n), normalize(vec3(0.6, -0.55, 0.55)))), 14.0) * 0.28;

  // The sphere refracts the ribbons faintly.
  col = mix(col, c + col * 0.07, inside);

  // Outer bloom on the rim.
  col += rimCol * exp(-abs(r - R) * 38.0) * 0.28 * (1.0 + e) * (1.0 - inside);

  col += rimCol * exp(-abs(r - R) * 14.0) * 0.12 * (1.0 - inside);

  // Twinkling motes.
  vec2 cell = gl_FragCoord.xy / 26.0;
  vec2 g = floor(cell);
  vec2 sp = vec2(hash(g + 7.0), hash(g + 11.0));
  float sd = length(fract(cell) - sp);
  float star = step(0.985, hash(g)) * exp(-sd * sd * 900.0) * (0.5 + 0.5 * sin(uTime * 2.0 + hash(g + 3.0) * 6.28)) * 2.5;
  col += vec3(0.8, 0.85, 1.0) * star * 0.5 * (1.0 - inside) * smoothstep(0.1, 0.4, rr);

  vec2 uv = gl_FragCoord.xy / uRes;
  float fade = smoothstep(0.0, 0.2, uv.x) * smoothstep(1.0, 0.8, uv.x) * smoothstep(0.0, 0.22, uv.y) * smoothstep(1.0, 0.78, uv.y);
  col *= fade;
  col = 1.0 - exp(-col * 1.35);
  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  gl_FragColor = vec4(min(col, vec3(a)), a);
}
`;
